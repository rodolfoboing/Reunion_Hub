import { CONFIG } from '@/src/constants/Config';
import { hasMatchingInterest } from '@/src/constants/Interests';
import type { Meeting } from '@/src/types';
import { getDateAfterDays, getTodayStr, normalizeDate } from '@/src/utils/dateUtils';
import { getDistanceFromLatLonInKm } from '@/src/utils/distance';
import { hasEventEnded, isEventInProgress } from '@/src/utils/eventSchedule';

export type UserCoordinates = {
    latitude: number;
    longitude: number;
};

type DiscoveryMeeting = Pick<
    Meeting,
    'attendees' | 'date' | 'endDate' | 'endTime' | 'interests' | 'lat' | 'lng' | 'status' | 'theme' | 'time' | 'title' | 'type'
>;

export type DiscoveryReason = 'in_progress' | 'interest' | 'history' | 'popular' | 'nearby';

export type EventDiscoveryContext = {
    userCoordinates?: UserCoordinates | null;
    userInterests?: unknown;
    historyTitles?: readonly string[];
    now?: Date;
};

export type EventDiscovery = {
    isRecommended: boolean;
    primaryReason: DiscoveryReason | null;
    reasons: DiscoveryReason[];
    shouldAnimateOnMap: boolean;
};

export const DISCOVERY_REASON_LABELS: Record<DiscoveryReason, string> = {
    in_progress: 'Em andamento',
    interest: 'Seu interesse',
    history: 'Parecido com eventos anteriores',
    popular: 'Popular',
    nearby: 'Perto de você',
};

const DISCOVERY_REASON_PRIORITY: DiscoveryReason[] = [
    'in_progress',
    'interest',
    'history',
    'popular',
    'nearby',
];

const hasActiveStatus = (meeting: DiscoveryMeeting): boolean =>
    meeting.status !== 'cancelled' && meeting.status !== 'completed';

function hasPopularAttendance(meeting: Pick<Meeting, 'attendees'>): boolean {
    return (meeting.attendees?.length || 0) >= CONFIG.POPULAR_ATTENDEES_COUNT;
}

export function isMeetingNearby(
    meeting: Pick<Meeting, 'lat' | 'lng' | 'type'>,
    userCoordinates: UserCoordinates | null | undefined,
): boolean {
    if (meeting.type === 'online' || !userCoordinates) return false;

    const latitude = Number(meeting.lat);
    const longitude = Number(meeting.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;

    return getDistanceFromLatLonInKm(
        userCoordinates.latitude,
        userCoordinates.longitude,
        latitude,
        longitude,
    ) <= CONFIG.NEARBY_RADIUS_KM;
}

function isWithinDiscoveryWindow(
    meeting: Pick<Meeting, 'date'>,
    now = new Date(),
): boolean {
    const date = normalizeDate(meeting.date);
    return !!date
        && date >= getTodayStr(now)
        && date <= getDateAfterDays(CONFIG.AGENDA_DISCOVERY_DAYS, now);
}

// Popularidade contextual: online não depende de distância; presencial só é
// relevante para o usuário quando está dentro do raio configurado.
function isPopularForUser(
    meeting: Pick<Meeting, 'attendees' | 'lat' | 'lng' | 'type'>,
    userCoordinates: UserCoordinates | null | undefined,
): boolean {
    if (!hasPopularAttendance(meeting)) return false;
    return meeting.type === 'online' || isMeetingNearby(meeting, userCoordinates);
}

/**
 * Classifica um evento para a descoberta sem persistir dados derivados.
 * A mesma função atende Início, Agenda e Explorar, evitando que um selo
 * tenha significado diferente em cada tela.
 */
export function getEventDiscovery(
    meeting: DiscoveryMeeting,
    context: EventDiscoveryContext = {},
): EventDiscovery {
    const now = context.now ?? new Date();
    const reasons: DiscoveryReason[] = [];
    const active = hasActiveStatus(meeting);
    const ended = active && hasEventEnded(meeting, now);
    const withinWindow = active && !ended && isWithinDiscoveryWindow(meeting, now);
    const nearby = withinWindow && isMeetingNearby(meeting, context.userCoordinates);
    const geographicallyEligible = meeting.type === 'online' || nearby;
    const matchesInterest = withinWindow
        && geographicallyEligible
        && hasMatchingInterest([...(meeting.interests || []), meeting.theme], context.userInterests);
    const matchesHistory = withinWindow
        && geographicallyEligible
        && typeof meeting.title === 'string'
        && (context.historyTitles?.includes(meeting.title) ?? false);
    const popular = withinWindow && isPopularForUser(meeting, context.userCoordinates);
    const inProgress = active && !ended && isEventInProgress(meeting, now);

    if (inProgress) reasons.push('in_progress');
    if (matchesInterest) reasons.push('interest');
    if (matchesHistory) reasons.push('history');
    if (popular) reasons.push('popular');
    if (nearby) reasons.push('nearby');

    const isRecommended = matchesInterest || matchesHistory || popular;
    const primaryReason = DISCOVERY_REASON_PRIORITY.find((reason) => reasons.includes(reason)) ?? null;
    const happensToday = normalizeDate(meeting.date) === getTodayStr(now);

    return {
        isRecommended,
        primaryReason,
        reasons,
        shouldAnimateOnMap: inProgress || popular || (matchesInterest && happensToday && nearby),
    };
}
