"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectDailyRecommendation = exports.isFrequentedPlaceEvent = exports.distanceInKm = exports.canSendDailyRecommendation = exports.recommendationCooldownNotificationIds = exports.isNotificationPreferenceEnabled = exports.DAILY_RECOMMENDATION_COOLDOWN_MS = exports.DAILY_RECOMMENDATION_COOLDOWN_DAYS = exports.DAILY_RECOMMENDATION_RADIUS_KM = void 0;
// Deve representar o mesmo conceito de "perto" usado no aplicativo.
// O código das Functions não importa arquivos externos ao próprio rootDir.
exports.DAILY_RECOMMENDATION_RADIUS_KM = 10;
exports.DAILY_RECOMMENDATION_COOLDOWN_DAYS = 3;
exports.DAILY_RECOMMENDATION_COOLDOWN_MS = 72 * 60 * 60 * 1000;
const MIN_REMAINING_ONLINE_MS = 30 * 60 * 1000;
const MIN_REMAINING_IN_PERSON_MS = 90 * 60 * 1000;
const RECOMMENDATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const saoPauloHabitFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'long', hour: '2-digit', hourCycle: 'h23',
});
function isNotificationPreferenceEnabled(value) {
    return value !== false;
}
exports.isNotificationPreferenceEnabled = isNotificationPreferenceEnabled;
// Mesmos aliases legados da taxonomia do cliente. Functions têm rootDir próprio
// e não podem importar Interests.ts; manter os dois lados sincronizados (§9).
const LEGACY_INTEREST_ALIASES = {
    tecnologia: 'tecnologia & inovacao', arte: 'artes & cultura',
    negocios: 'negocios & carreira', viagens: 'viagens & aventura',
    cinema: 'cinema & teatro', workshops: 'educacao & workshops',
    social: 'networking', esportivo: 'esportes',
    online: 'tecnologia & inovacao', feiras: 'negocios & carreira',
};
function normalizedInterest(value) {
    var _a;
    const key = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
    return (_a = LEGACY_INTEREST_ALIASES[key]) !== null && _a !== void 0 ? _a : key;
}
function recommendationCooldownNotificationIds(today, userId) {
    const [year, month, day] = today.split('-').map(Number);
    const referenceDate = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(referenceDate.getTime()))
        return [];
    // Inclui o terceiro dia ANTERIOR: às 7h de quinta ainda pode estar dentro
    // das 72h de uma notificação de segunda às 13h.
    return Array.from({ length: exports.DAILY_RECOMMENDATION_COOLDOWN_DAYS + 1 }, (_, offset) => {
        const date = new Date(referenceDate);
        date.setUTCDate(referenceDate.getUTCDate() - offset);
        const dateKey = date.toISOString().slice(0, 10);
        return `daily_recommendation_${dateKey}_${userId}`;
    });
}
exports.recommendationCooldownNotificationIds = recommendationCooldownNotificationIds;
function canSendDailyRecommendation(nowMs, previousNotificationTimesMs) {
    return previousNotificationTimesMs.every((sentAtMs) => nowMs - sentAtMs >= exports.DAILY_RECOMMENDATION_COOLDOWN_MS);
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
function isFrequentedPlaceEvent(event, user) {
    var _a;
    return event.type === 'in-person' && Boolean(event.placeId && ((_a = user.frequentedPlaces) === null || _a === void 0 ? void 0 : _a[event.placeId]));
}
exports.isFrequentedPlaceEvent = isFrequentedPlaceEvent;
function matchesHabitSchedule(event, user) {
    var _a, _b, _c, _d, _e;
    if (!isFrequentedPlaceEvent(event, user))
        return false;
    const parts = saoPauloHabitFormatter.formatToParts(new Date(event.startsAtMs));
    const weekday = (_a = parts.find((part) => part.type === 'weekday')) === null || _a === void 0 ? void 0 : _a.value.toLowerCase();
    const hour = Number((_b = parts.find((part) => part.type === 'hour')) === null || _b === void 0 ? void 0 : _b.value);
    if (!weekday || !Number.isInteger(hour))
        return false;
    const period = hour < 5 || hour >= 18 ? 'Noite' : hour < 12 ? 'Manhã' : 'Tarde';
    return ((_e = (_d = (_c = user.frequentedPlaces) === null || _c === void 0 ? void 0 : _c[event.placeId]) === null || _d === void 0 ? void 0 : _d[weekday]) === null || _e === void 0 ? void 0 : _e.includes(period)) === true;
}
function selectDailyRecommendation(events, user, nowMs) {
    var _a;
    const userInterests = new Set(user.interests.map(normalizedInterest).filter(Boolean));
    if (userInterests.size === 0)
        return null;
    const eligibleEvents = events.filter((event) => {
        var _a, _b;
        if (event.endsAtMs <= nowMs || event.createdBy === user.userId || event.attendees.includes(user.userId))
            return false;
        if (((_a = user.blockedUserIds) === null || _a === void 0 ? void 0 : _a.includes(event.createdBy)) || ((_b = event.blockedRecipientIds) === null || _b === void 0 ? void 0 : _b.includes(user.userId)))
            return false;
        if (event.startsAtMs > nowMs + RECOMMENDATION_WINDOW_MS)
            return false;
        if (event.startsAtMs <= nowMs && event.endsAtMs - nowMs <
            (event.type === 'online' ? MIN_REMAINING_ONLINE_MS : MIN_REMAINING_IN_PERSON_MS))
            return false;
        if (!event.interests.some((interest) => userInterests.has(normalizedInterest(interest))))
            return false;
        if (event.type === 'online')
            return true;
        if (isFrequentedPlaceEvent(event, user))
            return true;
        if (!user.location || event.latitude === null || event.longitude === null)
            return false;
        // Localização salva com duas casas decimais: margem inferior a 1 km
        // evita excluir um local perto do limite por arredondamento.
        return distanceInKm(user.location, { latitude: event.latitude, longitude: event.longitude }) <= exports.DAILY_RECOMMENDATION_RADIUS_KM + 0.8;
    });
    const score = (event) => {
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
    return (_a = eligibleEvents[0]) !== null && _a !== void 0 ? _a : null;
}
exports.selectDailyRecommendation = selectDailyRecommendation;
//# sourceMappingURL=recommendations.js.map