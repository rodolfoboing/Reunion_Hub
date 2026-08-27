const test = require('node:test');
const assert = require('node:assert/strict');
const {
    canSendDailyRecommendation,
    recommendationCooldownNotificationIds,
    selectDailyRecommendation,
} = require('../lib/recommendations');

const nowMs = Date.parse('2026-08-22T12:00:00.000Z');

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

test('does not recommend events already joined or outside user interests', () => {
    const joined = event({ attendees: ['creator', 'recipient'] });
    const unrelated = event({ eventId: 'unrelated', interests: ['Música'] });
    assert.equal(selectDailyRecommendation([joined, unrelated], user, nowMs), null);
});

test('builds a three-day recommendation cooldown with stable notification IDs', () => {
    assert.deepEqual(recommendationCooldownNotificationIds('2026-08-22', 'recipient'), [
        'daily_recommendation_2026-08-22_recipient',
        'daily_recommendation_2026-08-21_recipient',
        'daily_recommendation_2026-08-20_recipient',
    ]);
});

test('handles recommendation cooldown across month boundaries', () => {
    assert.deepEqual(recommendationCooldownNotificationIds('2026-03-01', 'recipient'), [
        'daily_recommendation_2026-03-01_recipient',
        'daily_recommendation_2026-02-28_recipient',
        'daily_recommendation_2026-02-27_recipient',
    ]);
});

test('blocks duplicate recommendations during the three daily executions in the cooldown', () => {
    assert.equal(canSendDailyRecommendation(
        '2026-08-22',
        'recipient',
        new Set(['daily_recommendation_2026-08-22_recipient']),
    ), false);
    assert.equal(canSendDailyRecommendation(
        '2026-08-24',
        'recipient',
        new Set(['daily_recommendation_2026-08-22_recipient']),
    ), false);
});

test('allows a new recommendation on the fourth daily execution', () => {
    assert.equal(canSendDailyRecommendation(
        '2026-08-25',
        'recipient',
        new Set(['daily_recommendation_2026-08-22_recipient']),
    ), true);
});
