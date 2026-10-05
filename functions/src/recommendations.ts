// Deve representar o mesmo conceito de "perto" usado no aplicativo.
// O código das Functions não importa arquivos externos ao próprio rootDir.
export const DAILY_RECOMMENDATION_RADIUS_KM = 10;
export const DAILY_RECOMMENDATION_COOLDOWN_DAYS = 3;
export const DAILY_RECOMMENDATION_COOLDOWN_MS = 72 * 60 * 60 * 1000;
const MIN_REMAINING_ONLINE_MS = 30 * 60 * 1000;
const MIN_REMAINING_IN_PERSON_MS = 90 * 60 * 1000;
const RECOMMENDATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type RecommendationLocation = {
    latitude: number;
    longitude: number;
};

export type RecommendationUser = {
    userId: string;
    interests: string[];
    location: RecommendationLocation | null;
    frequentedPlaces?: Record<string, Partial<Record<RecommendationWeekday, string[]>>>;
    blockedUserIds?: string[];
};

type RecommendationWeekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
const saoPauloHabitFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'long', hour: '2-digit', hourCycle: 'h23',
});

export type RecommendationEvent = {
    eventId: string;
    title: string;
    type: 'in-person' | 'online';
    placeId?: string;
    interests: string[];
    latitude: number | null;
    longitude: number | null;
    startsAtMs: number;
    endsAtMs: number;
    createdBy: string;
    attendees: string[];
    createdAtMs?: number | null;
    blockedRecipientIds?: string[];
};

export function isNotificationPreferenceEnabled(value: unknown): boolean {
    return value !== false;
}

// Mesmos aliases legados da taxonomia do cliente. Functions têm rootDir próprio
// e não podem importar Interests.ts; manter os dois lados sincronizados (§9).
const LEGACY_INTEREST_ALIASES: Record<string, string> = {
    tecnologia: 'tecnologia & inovacao', arte: 'artes & cultura',
    negocios: 'negocios & carreira', viagens: 'viagens & aventura',
    cinema: 'cinema & teatro', workshops: 'educacao & workshops',
    social: 'networking', esportivo: 'esportes',
    online: 'tecnologia & inovacao', feiras: 'negocios & carreira',
};

function normalizedInterest(value: string): string {
    const key = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
    return LEGACY_INTEREST_ALIASES[key] ?? key;
}

export function recommendationCooldownNotificationIds(today: string, userId: string): string[] {
    const [year, month, day] = today.split('-').map(Number);
    const referenceDate = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(referenceDate.getTime())) return [];

    // Inclui o terceiro dia ANTERIOR: às 7h de quinta ainda pode estar dentro
    // das 72h de uma notificação de segunda às 13h.
    return Array.from({ length: DAILY_RECOMMENDATION_COOLDOWN_DAYS + 1 }, (_, offset) => {
        const date = new Date(referenceDate);
        date.setUTCDate(referenceDate.getUTCDate() - offset);
        const dateKey = date.toISOString().slice(0, 10);
        return `daily_recommendation_${dateKey}_${userId}`;
    });
}

export function canSendDailyRecommendation(
    nowMs: number,
    previousNotificationTimesMs: readonly number[],
): boolean {
    return previousNotificationTimesMs.every((sentAtMs) => nowMs - sentAtMs >= DAILY_RECOMMENDATION_COOLDOWN_MS);
}

export function distanceInKm(first: RecommendationLocation, second: RecommendationLocation): number {
    const earthRadiusKm = 6371;
    const toRadians = (degrees: number) => degrees * Math.PI / 180;
    const latitudeDelta = toRadians(second.latitude - first.latitude);
    const longitudeDelta = toRadians(second.longitude - first.longitude);
    const firstLatitude = toRadians(first.latitude);
    const secondLatitude = toRadians(second.latitude);
    const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function isFrequentedPlaceEvent(event: RecommendationEvent, user: RecommendationUser): boolean {
    return event.type === 'in-person' && Boolean(event.placeId && user.frequentedPlaces?.[event.placeId]);
}

function matchesHabitSchedule(event: RecommendationEvent, user: RecommendationUser): boolean {
    if (!isFrequentedPlaceEvent(event, user)) return false;
    const parts = saoPauloHabitFormatter.formatToParts(new Date(event.startsAtMs));
    const weekday = parts.find((part) => part.type === 'weekday')?.value.toLowerCase() as RecommendationWeekday | undefined;
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    if (!weekday || !Number.isInteger(hour)) return false;
    const period = hour < 5 || hour >= 18 ? 'Noite' : hour < 12 ? 'Manhã' : 'Tarde';
    return user.frequentedPlaces?.[event.placeId!]?.[weekday]?.includes(period) === true;
}

export function selectDailyRecommendation(
    events: RecommendationEvent[],
    user: RecommendationUser,
    nowMs: number,
): RecommendationEvent | null {
    const userInterests = new Set(user.interests.map(normalizedInterest).filter(Boolean));
    if (userInterests.size === 0) return null;

    const eligibleEvents = events.filter((event) => {
        if (event.endsAtMs <= nowMs || event.createdBy === user.userId || event.attendees.includes(user.userId)) return false;
        if (user.blockedUserIds?.includes(event.createdBy) || event.blockedRecipientIds?.includes(user.userId)) return false;
        if (event.startsAtMs > nowMs + RECOMMENDATION_WINDOW_MS) return false;
        if (event.startsAtMs <= nowMs && event.endsAtMs - nowMs <
            (event.type === 'online' ? MIN_REMAINING_ONLINE_MS : MIN_REMAINING_IN_PERSON_MS)) return false;
        if (!event.interests.some((interest) => userInterests.has(normalizedInterest(interest)))) return false;
        if (event.type === 'online') return true;
        if (isFrequentedPlaceEvent(event, user)) return true;
        if (!user.location || event.latitude === null || event.longitude === null) return false;
        // Localização salva com duas casas decimais: margem inferior a 1 km
        // evita excluir um local perto do limite por arredondamento.
        return distanceInKm(user.location, { latitude: event.latitude, longitude: event.longitude }) <= DAILY_RECOMMENDATION_RADIUS_KM + 0.8;
    });

    const score = (event: RecommendationEvent): number => {
        const matches = new Set(event.interests.map(normalizedInterest).filter((interest) => userInterests.has(interest))).size;
        const untilStart = event.startsAtMs - nowMs;
        const timing = untilStart > 0 && untilStart <= 24 * 60 * 60 * 1000 ? 25
            : untilStart > 0 ? 15 : 5;
        const popularity = Math.min(event.attendees.length, 10) * 2;
        const newEvent = typeof event.createdAtMs === 'number'
            && event.createdAtMs <= nowMs
            && nowMs - event.createdAtMs <= 48 * 60 * 60 * 1000 ? 15 : 0;
        const placeAffinity = isFrequentedPlaceEvent(event, user) ? 150 : 0;
        const habitTiming = matchesHabitSchedule(event, user) ? 30 : 0;
        return matches * 100 + timing + popularity + newEvent + placeAffinity + habitTiming;
    };
    eligibleEvents.sort((first, second) => score(second) - score(first)
        || first.startsAtMs - second.startsAtMs
        || first.eventId.localeCompare(second.eventId));
    return eligibleEvents[0] ?? null;
}
