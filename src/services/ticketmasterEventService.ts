import { getCurrentTimeStr, getDateStr, getTodayStr } from '@/src/utils/dateUtils';
import { getDistanceFromLatLonInKm } from '@/src/utils/distance';

export type ExternalEvent = {
    id: string;
    title: string;
    localDate: string;
    localTime?: string;
    suggestedDate: string;
    suggestedTime?: string;
    venueName: string;
    latitude: number;
    longitude: number;
    category?: string;
    imageUrl?: string;
    imageAttribution?: string;
    externalUrl?: string;
};

const API_KEY = process.env.EXPO_PUBLIC_TICKETMASTER_API_KEY?.trim();
const SEARCH_RADIUS_KM = 20;
// A busca parte do centro da célula geohash, que pode estar alguns quilômetros
// distante do centro atual do mapa.
const API_RADIUS_KM = 25;
const SEARCH_SIZE = 30;
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 20;
const REQUEST_TIMEOUT_MS = 15_000;
const GEOHASH_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';
const cache = new Map<string, { expiresAt: number; events: ExternalEvent[] }>();

export const isTicketmasterConfigured = Boolean(API_KEY);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstRecord(value: unknown): Record<string, unknown> | null {
    return Array.isArray(value) && isRecord(value[0]) ? value[0] : null;
}

function finiteNumber(value: unknown): number | null {
    const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
}

function httpsUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' ? url.toString() : undefined;
    } catch {
        return undefined;
    }
}

// A Discovery API recebe geoPoint como geohash. Cinco caracteres agrupam
// movimentos curtos do mapa no mesmo cache, evitando chamadas por arrasto.
export function ticketmasterGeoPoint(latitude: number, longitude: number): string {
    let latRange: [number, number] = [-90, 90];
    let lonRange: [number, number] = [-180, 180];
    let result = '';
    let bits = 0;
    let value = 0;
    let longitudeBit = true;
    while (result.length < 5) {
        const range = longitudeBit ? lonRange : latRange;
        const coordinate = longitudeBit ? longitude : latitude;
        const middle = (range[0] + range[1]) / 2;
        value = (value << 1) | (coordinate >= middle ? 1 : 0);
        if (coordinate >= middle) range[0] = middle;
        else range[1] = middle;
        longitudeBit = !longitudeBit;
        bits += 1;
        if (bits === 5) {
            result += GEOHASH_ALPHABET[value];
            bits = 0;
            value = 0;
        }
    }
    return result;
}

function eventFromApi(value: unknown, now: Date): ExternalEvent | null {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
    const dates = isRecord(value.dates) ? value.dates : null;
    const start = dates && isRecord(dates.start) ? dates.start : null;
    const status = dates && isRecord(dates.status) ? dates.status.code : null;
    if (status === 'cancelled' || status === 'postponed') return null;
    const localDate = start?.localDate;
    if (typeof localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;
    const hasSpecificTime = start?.timeTBA !== true && start?.noSpecificTime !== true;
    const sourceTime = start?.localTime;
    const localTime = hasSpecificTime && typeof sourceTime === 'string'
        && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(sourceTime)
        ? sourceTime.slice(0, 5) : undefined;
    // O banco do Reunion Hub interpreta `date`/`time` em São Paulo. O instante
    // da API evita copiar um horário local incorreto de outro fuso brasileiro.
    const sourceDateTime = start?.dateTime;
    const startInstant = hasSpecificTime && typeof sourceDateTime === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(sourceDateTime)
        ? new Date(sourceDateTime) : null;
    const validInstant = startInstant && !Number.isNaN(startInstant.getTime()) ? startInstant : null;
    if (validInstant ? validInstant < now : localDate < getTodayStr(now)) return null;
    const suggestedDate = validInstant ? getDateStr(validInstant) : localDate;
    const suggestedTime = validInstant ? getCurrentTimeStr(validInstant)
        : dates?.timezone === 'America/Sao_Paulo' ? localTime : undefined;

    const embedded = isRecord(value._embedded) ? value._embedded : null;
    const venue = embedded ? firstRecord(embedded.venues) : null;
    const location = venue && isRecord(venue.location) ? venue.location : null;
    const venueLatitude = finiteNumber(location?.latitude);
    const venueLongitude = finiteNumber(location?.longitude);
    if (!venue || typeof venue.name !== 'string' || !venue.name.trim()
        || venueLatitude === null || venueLongitude === null
        || Math.abs(venueLatitude) > 90 || Math.abs(venueLongitude) > 180
        || (venueLatitude === 0 && venueLongitude === 0)) return null;

    const image = Array.isArray(value.images)
        ? value.images.find((candidate): candidate is Record<string, unknown> => isRecord(candidate)
            && candidate.ratio === '16_9' && candidate.fallback !== true && Boolean(httpsUrl(candidate.url)))
        : undefined;
    const classification = firstRecord(value.classifications);
    const segment = classification && isRecord(classification.segment) ? classification.segment : null;
    return {
        id: `ticketmaster_${value.id}`,
        title: value.name.trim(),
        localDate,
        localTime,
        suggestedDate,
        suggestedTime,
        venueName: venue.name.trim(),
        latitude: venueLatitude,
        longitude: venueLongitude,
        category: typeof segment?.name === 'string' ? segment.name : undefined,
        imageUrl: httpsUrl(image?.url),
        imageAttribution: typeof image?.attribution === 'string' ? image.attribution : undefined,
        externalUrl: httpsUrl(value.url),
    };
}

function withinMapRadius(events: ExternalEvent[], latitude: number, longitude: number): ExternalEvent[] {
    return events.filter((event) => getDistanceFromLatLonInKm(
        latitude, longitude, event.latitude, event.longitude,
    ) <= SEARCH_RADIUS_KM);
}

export async function fetchNearbyTicketmasterEvents(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
): Promise<ExternalEvent[]> {
    if (!API_KEY || !Number.isFinite(latitude) || !Number.isFinite(longitude)
        || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    const geoPoint = ticketmasterGeoPoint(latitude, longitude);
    const cached = cache.get(geoPoint);
    if (cached && cached.expiresAt > Date.now()) return withinMapRadius(cached.events, latitude, longitude);
    if (signal?.aborted) return [];

    const now = new Date();
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
        apikey: API_KEY,
        countryCode: 'BR',
        geoPoint,
        radius: String(API_RADIUS_KM),
        unit: 'km',
        startDateTime: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        endDateTime: end.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        sort: 'date,asc',
        size: String(SEARCH_SIZE),
        page: '0',
    });
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`, {
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`ticketmaster_http_${response.status}`);
        const payload: unknown = await response.json();
        if (!isRecord(payload)) throw new Error('ticketmaster_invalid_response');
        const embedded = isRecord(payload._embedded) ? payload._embedded : null;
        const rawEvents = embedded?.events;
        if (rawEvents !== undefined && !Array.isArray(rawEvents)) throw new Error('ticketmaster_invalid_events');
        const events = (Array.isArray(rawEvents) ? rawEvents : [])
            .map((event) => eventFromApi(event, now))
            .filter((event): event is ExternalEvent => event !== null);
        if (!signal?.aborted) {
            const oldestKey = cache.keys().next().value;
            if (cache.size >= MAX_CACHE_ENTRIES && oldestKey) cache.delete(oldestKey);
            cache.set(geoPoint, { events, expiresAt: Date.now() + CACHE_TTL_MS });
        }
        return withinMapRadius(events, latitude, longitude);
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
    }
}
