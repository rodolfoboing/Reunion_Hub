// Deve representar o mesmo conceito de "perto" usado no aplicativo.
// O código das Functions não importa arquivos externos ao próprio rootDir.
export const DAILY_RECOMMENDATION_RADIUS_KM = 10;
export const DAILY_RECOMMENDATION_COOLDOWN_DAYS = 3;

export type RecommendationLocation = {
    latitude: number;
    longitude: number;
};

export type RecommendationUser = {
    userId: string;
    interests: string[];
    location: RecommendationLocation | null;
};

export type RecommendationEvent = {
    eventId: string;
    title: string;
    type: 'in-person' | 'online';
    interests: string[];
    latitude: number | null;
    longitude: number | null;
    startsAtMs: number;
    endsAtMs: number;
    createdBy: string;
    attendees: string[];
};

function normalizedInterest(value: string): string {
    return value.trim().toLocaleLowerCase('pt-BR');
}

export function recommendationCooldownNotificationIds(today: string, userId: string): string[] {
    const [year, month, day] = today.split('-').map(Number);
    const referenceDate = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(referenceDate.getTime())) return [];

    return Array.from({ length: DAILY_RECOMMENDATION_COOLDOWN_DAYS }, (_, offset) => {
        const date = new Date(referenceDate);
        date.setUTCDate(referenceDate.getUTCDate() - offset);
        const dateKey = date.toISOString().slice(0, 10);
        return `daily_recommendation_${dateKey}_${userId}`;
    });
}

export function canSendDailyRecommendation(
    today: string,
    userId: string,
    existingNotificationIds: ReadonlySet<string>,
): boolean {
    return recommendationCooldownNotificationIds(today, userId)
        .every((notificationId) => !existingNotificationIds.has(notificationId));
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

export function selectDailyRecommendation(
    events: RecommendationEvent[],
    user: RecommendationUser,
    nowMs: number,
): RecommendationEvent | null {
    const userInterests = new Set(user.interests.map(normalizedInterest).filter(Boolean));
    if (userInterests.size === 0) return null;

    const eligibleEvents = events.filter((event) => {
        if (event.endsAtMs <= nowMs || event.createdBy === user.userId || event.attendees.includes(user.userId)) return false;
        if (!event.interests.some((interest) => userInterests.has(normalizedInterest(interest)))) return false;
        if (event.type === 'online') return true;
        if (!user.location || event.latitude === null || event.longitude === null) return false;
        return distanceInKm(user.location, { latitude: event.latitude, longitude: event.longitude }) <= DAILY_RECOMMENDATION_RADIUS_KM;
    });

    eligibleEvents.sort((first, second) => {
        const firstInProgress = first.startsAtMs <= nowMs ? 1 : 0;
        const secondInProgress = second.startsAtMs <= nowMs ? 1 : 0;
        if (firstInProgress !== secondInProgress) return secondInProgress - firstInProgress;
        if (first.attendees.length !== second.attendees.length) return second.attendees.length - first.attendees.length;
        return first.startsAtMs - second.startsAtMs;
    });
    return eligibleEvents[0] ?? null;
}
