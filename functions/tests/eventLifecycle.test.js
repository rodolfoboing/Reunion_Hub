const test = require('node:test');
const assert = require('node:assert/strict');
const {
    canCancelEventAt,
    canFavoriteEndedEvent,
    canManuallyReviewCheckIns,
    canSettleExpiredEventForUser,
    checkInReviewDeadlineMs,
    COMPLETION_LEDGER_V2_STARTED_AT_MS,
    shouldApplyCompletionReputation,
} = require('../lib/eventLifecycle');

const now = Date.parse('2026-08-24T18:00:00.000Z');

test('allows a confirmed attendee to favorite after schedule end before nightly processing', () => {
    assert.equal(canFavoriteEndedEvent('active', now - 1, now, true), true);
});

test('does not favorite future, cancelled or unconfirmed attendance', () => {
    assert.equal(canFavoriteEndedEvent('active', now + 1, now, true), false);
    assert.equal(canFavoriteEndedEvent('cancelled', now - 1, now, true), false);
    assert.equal(canFavoriteEndedEvent('completed', now - 1, now, false), false);
});

test('allows cancellation only while an active event has not ended', () => {
    assert.equal(canCancelEventAt('active', now + 1, now), true);
    assert.equal(canCancelEventAt('active', now, now), false);
    assert.equal(canCancelEventAt('completed', now + 1, now), false);
});

test('manual check-in review is limited to two hours after the event ends', () => {
    const eventEnd = now;
    const deadline = checkInReviewDeadlineMs(eventEnd);
    assert.equal(canManuallyReviewCheckIns('active', eventEnd, deadline, eventEnd), true);
    assert.equal(canManuallyReviewCheckIns('awaiting_review', eventEnd, deadline, deadline), true);
    assert.equal(canManuallyReviewCheckIns('awaiting_review', eventEnd, deadline, deadline + 1), false);
    assert.equal(canManuallyReviewCheckIns('completed', eventEnd, deadline, eventEnd + 1), false);
});

test('settles only expired events from a previous local day that belong to the user', () => {
    assert.equal(canSettleExpiredEventForUser('active', now - 1, now, '2026-08-23', '2026-08-24', true), true);
    assert.equal(canSettleExpiredEventForUser(undefined, now - 1, now, '2026-08-23', '2026-08-24', true), true);
    assert.equal(canSettleExpiredEventForUser('active', now - 1, now, '2026-08-24', '2026-08-24', true), false);
    assert.equal(canSettleExpiredEventForUser('completed', now - 1, now, '2026-08-23', '2026-08-24', true), false);
    assert.equal(canSettleExpiredEventForUser('active', now - 1, now, '2026-08-23', '2026-08-24', false), false);
});

test('preserves reputation for ambiguous legacy events and applies it after the ledger migration', () => {
    assert.equal(shouldApplyCompletionReputation(COMPLETION_LEDGER_V2_STARTED_AT_MS - 1, false), false);
    assert.equal(shouldApplyCompletionReputation(COMPLETION_LEDGER_V2_STARTED_AT_MS, false), true);
    assert.equal(shouldApplyCompletionReputation(COMPLETION_LEDGER_V2_STARTED_AT_MS + 1, true), false);
});
