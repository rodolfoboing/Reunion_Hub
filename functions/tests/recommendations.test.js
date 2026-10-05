const test = require('node:test');
const assert = require('node:assert/strict');
const {
    canSendDailyRecommendation,
    isNotificationPreferenceEnabled,
    recommendationCooldownNotificationIds,
    selectDailyRecommendation,
} = require('../lib/recommendations');

const nowMs = Date.parse('2026-08-22T12:00:00.000Z');

test('enables notifications by default and preserves an explicit opt-out', () => {
    assert.equal(isNotificationPreferenceEnabled(undefined), true);
    assert.equal(isNotificationPreferenceEnabled(true), true);
    assert.equal(isNotificationPreferenceEnabled(false), false);
});

function event(overrides = {}) {
    return {
        eventId: 'event-1',
        title: 'Caminhada',
        type: 'in-person',
        interests: ['Esportes'],
        latitude: -23.55,
        longitude: -46.63,
        startsAtMs: nowMs + 60_000,
        endsAtMs: nowMs + 3_600_000,
        createdBy: 'creator',
        attendees: ['creator'],
        ...overrides,
    };
}

const user = {
    userId: 'recipient',
    interests: ['Esportes'],
    location: { latitude: -23.55, longitude: -46.64 },
};

test('selects a nearby event with a matching interest', () => {
    assert.equal(selectDailyRecommendation([event()], user, nowMs)?.eventId, 'event-1');
});

test('rejects distant in-person events but accepts online matches', () => {
    const distant = event({ eventId: 'distant', latitude: -22.9, longitude: -43.2 });
    const online = event({ eventId: 'online', type: 'online', latitude: null, longitude: null });
    assert.equal(selectDailyRecommendation([distant, online], user, nowMs)?.eventId, 'online');
});

test('does not classify an in-person event beyond 10 km as nearby', () => {
    const beyondTenKilometers = event({ eventId: 'beyond-10-km', latitude: -23.44, longitude: -46.64 });
    assert.equal(selectDailyRecommendation([beyondTenKilometers], user, nowMs), null);
});

test('recommends an event at a declared frequent place without a recent location', () => {
    const frequentEvent = event({ eventId: 'frequent', placeId: 'cafe-1', latitude: -22.9, longitude: -43.2 });
    const frequentUser = {
        ...user,
        location: null,
        frequentedPlaces: { 'cafe-1': { saturday: ['Manhã'] } },
    };
    assert.equal(selectDailyRecommendation([frequentEvent], frequentUser, nowMs)?.eventId, 'frequent');
    assert.equal(selectDailyRecommendation([frequentEvent], { ...frequentUser, interests: ['Música'] }, nowMs), null);
    assert.equal(selectDailyRecommendation([
        { ...frequentEvent, placeId: 'another-cafe' },
    ], frequentUser, nowMs), null);
});

test('prefers a matching frequent place and period over a nearby event', () => {
    const startsAtMs = Date.parse('2026-08-23T22:00:00.000Z'); // domingo, 19h em São Paulo
    const common = { startsAtMs, endsAtMs: startsAtMs + 3_600_000 };
    const nearby = event({ ...common, eventId: 'nearby', createdAtMs: nowMs - 60_000 });
    const frequent = event({
        ...common, eventId: 'frequent', placeId: 'cafe-1', latitude: -22.9, longitude: -43.2,
    });
    const frequentUser = {
        ...user,
        frequentedPlaces: { 'cafe-1': { sunday: ['Noite'] } },
    };
    assert.equal(selectDailyRecommendation([nearby, frequent], frequentUser, nowMs)?.eventId, 'frequent');
});

test('does not recommend events already joined or outside user interests', () => {
    const joined = event({ attendees: ['creator', 'recipient'] });
    const unrelated = event({ eventId: 'unrelated', interests: ['Música'] });
    assert.equal(selectDailyRecommendation([joined, unrelated], user, nowMs), null);
});

test('includes the third previous calendar date when checking a 72-hour cooldown', () => {
    assert.deepEqual(recommendationCooldownNotificationIds('2026-08-22', 'recipient'), [
        'daily_recommendation_2026-08-22_recipient',
        'daily_recommendation_2026-08-21_recipient',
        'daily_recommendation_2026-08-20_recipient',
        'daily_recommendation_2026-08-19_recipient',
    ]);
});

test('handles recommendation cooldown across month boundaries', () => {
    assert.deepEqual(recommendationCooldownNotificationIds('2026-03-01', 'recipient'), [
        'daily_recommendation_2026-03-01_recipient',
        'daily_recommendation_2026-02-28_recipient',
        'daily_recommendation_2026-02-27_recipient',
        'daily_recommendation_2026-02-26_recipient',
    ]);
});

test('blocks duplicate recommendations during the three daily executions in the cooldown', () => {
    assert.equal(canSendDailyRecommendation(
        nowMs,
        [nowMs - 60_000],
    ), false);
    assert.equal(canSendDailyRecommendation(
        nowMs,
        [nowMs - 71 * 60 * 60 * 1000],
    ), false);
});

test('allows a new recommendation on the fourth daily execution', () => {
    assert.equal(canSendDailyRecommendation(
        nowMs,
        [nowMs - 72 * 60 * 60 * 1000],
    ), true);
});

test('does not recommend blocked creators or recipients, or events nearly over', () => {
    assert.equal(selectDailyRecommendation([event()], { ...user, blockedUserIds: ['creator'] }, nowMs), null);
    assert.equal(selectDailyRecommendation([event({ blockedRecipientIds: ['recipient'] })], user, nowMs), null);
    assert.equal(selectDailyRecommendation([event({ startsAtMs: nowMs - 10_000, endsAtMs: nowMs + 60_000 })], user, nowMs), null);
});

test('matches legacy interest aliases and favors a fresh upcoming event', () => {
    const aliasUser = { ...user, interests: ['Tecnologia'] };
    const oldEvent = event({ eventId: 'old', type: 'online', interests: ['Tecnologia & Inovação'], createdAtMs: nowMs - 7 * 86_400_000 });
    const newEvent = event({ eventId: 'new', type: 'online', interests: ['Tecnologia & Inovação'], createdAtMs: nowMs - 60_000 });
    assert.equal(selectDailyRecommendation([oldEvent, newEvent], aliasUser, nowMs)?.eventId, 'new');
});
