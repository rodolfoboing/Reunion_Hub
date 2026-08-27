"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectDailyRecommendation = exports.distanceInKm = exports.canSendDailyRecommendation = exports.recommendationCooldownNotificationIds = exports.DAILY_RECOMMENDATION_COOLDOWN_DAYS = exports.DAILY_RECOMMENDATION_RADIUS_KM = void 0;
// Deve representar o mesmo conceito de "perto" usado no aplicativo.
// O código das Functions não importa arquivos externos ao próprio rootDir.
exports.DAILY_RECOMMENDATION_RADIUS_KM = 10;
exports.DAILY_RECOMMENDATION_COOLDOWN_DAYS = 3;
function normalizedInterest(value) {
    return value.trim().toLocaleLowerCase('pt-BR');
}
function recommendationCooldownNotificationIds(today, userId) {
    const [year, month, day] = today.split('-').map(Number);
    const referenceDate = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(referenceDate.getTime()))
        return [];
    return Array.from({ length: exports.DAILY_RECOMMENDATION_COOLDOWN_DAYS }, (_, offset) => {
        const date = new Date(referenceDate);
        date.setUTCDate(referenceDate.getUTCDate() - offset);
        const dateKey = date.toISOString().slice(0, 10);
        return `daily_recommendation_${dateKey}_${userId}`;
    });
}
exports.recommendationCooldownNotificationIds = recommendationCooldownNotificationIds;
function canSendDailyRecommendation(today, userId, existingNotificationIds) {
    return recommendationCooldownNotificationIds(today, userId)
        .every((notificationId) => !existingNotificationIds.has(notificationId));
}
exports.canSendDailyRecommendation = canSendDailyRecommendation;
function distanceInKm(first, second) {
    const earthRadiusKm = 6371;
    const toRadians = (degrees) => degrees * Math.PI / 180;
    const latitudeDelta = toRadians(second.latitude - first.latitude);
    const longitudeDelta = toRadians(second.longitude - first.longitude);
    const firstLatitude = toRadians(first.latitude);
    const secondLatitude = toRadians(second.latitude);
    const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}
exports.distanceInKm = distanceInKm;
function selectDailyRecommendation(events, user, nowMs) {
    var _a;
    const userInterests = new Set(user.interests.map(normalizedInterest).filter(Boolean));
    if (userInterests.size === 0)
        return null;
    const eligibleEvents = events.filter((event) => {
        if (event.endsAtMs <= nowMs || event.createdBy === user.userId || event.attendees.includes(user.userId))
            return false;
        if (!event.interests.some((interest) => userInterests.has(normalizedInterest(interest))))
            return false;
        if (event.type === 'online')
            return true;
        if (!user.location || event.latitude === null || event.longitude === null)
            return false;
        return distanceInKm(user.location, { latitude: event.latitude, longitude: event.longitude }) <= exports.DAILY_RECOMMENDATION_RADIUS_KM;
    });
    eligibleEvents.sort((first, second) => {
        const firstInProgress = first.startsAtMs <= nowMs ? 1 : 0;
        const secondInProgress = second.startsAtMs <= nowMs ? 1 : 0;
        if (firstInProgress !== secondInProgress)
            return secondInProgress - firstInProgress;
        if (first.attendees.length !== second.attendees.length)
            return second.attendees.length - first.attendees.length;
        return first.startsAtMs - second.startsAtMs;
    });
    return (_a = eligibleEvents[0]) !== null && _a !== void 0 ? _a : null;
}
exports.selectDailyRecommendation = selectDailyRecommendation;
//# sourceMappingURL=recommendations.js.map