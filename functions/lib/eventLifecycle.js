"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldApplyCompletionReputation = exports.COMPLETION_LEDGER_V2_STARTED_AT_MS = exports.canSettleExpiredEventForUser = exports.canManuallyReviewCheckIns = exports.checkInReviewDeadlineMs = exports.CHECK_IN_REVIEW_WINDOW_MS = exports.canCancelEventAt = exports.canFavoriteEndedEvent = void 0;
function canFavoriteEndedEvent(status, eventEndMs, nowMs, hasConfirmedCheckIn) {
    if (!hasConfirmedCheckIn || status === 'cancelled')
        return false;
    return status === 'completed' || (eventEndMs !== null && eventEndMs <= nowMs);
}
exports.canFavoriteEndedEvent = canFavoriteEndedEvent;
function canCancelEventAt(status, eventEndMs, nowMs) {
    return (!status || status === 'active')
        && eventEndMs !== null
        && eventEndMs > nowMs;
}
exports.canCancelEventAt = canCancelEventAt;
exports.CHECK_IN_REVIEW_WINDOW_MS = 2 * 60 * 60 * 1000;
function checkInReviewDeadlineMs(eventEndMs) {
    return eventEndMs + exports.CHECK_IN_REVIEW_WINDOW_MS;
}
exports.checkInReviewDeadlineMs = checkInReviewDeadlineMs;
function canManuallyReviewCheckIns(status, eventEndMs, reviewDeadlineMs, nowMs) {
    return status !== 'completed'
        && status !== 'cancelled'
        && nowMs >= eventEndMs
        && nowMs <= reviewDeadlineMs;
}
exports.canManuallyReviewCheckIns = canManuallyReviewCheckIns;
function canSettleExpiredEventForUser(status, eventEndMs, nowMs, eventEndDate, currentDate, belongsToUser) {
    return belongsToUser
        && (!status || status === 'active')
        && eventEndMs !== null
        && eventEndMs <= nowMs
        && eventEndDate < currentDate;
}
exports.canSettleExpiredEventForUser = canSettleExpiredEventForUser;
// Fronteira explícita da migração: eventos encerrados antes desta versão podem
// ter tido reputação calculada pela lógica antiga sem um marcador persistido.
exports.COMPLETION_LEDGER_V2_STARTED_AT_MS = Date.parse('2026-08-25T00:18:00.000Z');
function shouldApplyCompletionReputation(eventEndMs, hasProcessingMarker) {
    return !hasProcessingMarker && eventEndMs >= exports.COMPLETION_LEDGER_V2_STARTED_AT_MS;
}
exports.shouldApplyCompletionReputation = shouldApplyCompletionReputation;
//# sourceMappingURL=eventLifecycle.js.map