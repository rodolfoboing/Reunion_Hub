export function canFavoriteEndedEvent(
    status: unknown,
    eventEndMs: number | null,
    nowMs: number,
    hasConfirmedCheckIn: boolean,
): boolean {
    if (!hasConfirmedCheckIn || status === 'cancelled') return false;
    return status === 'completed' || (eventEndMs !== null && eventEndMs <= nowMs);
}

export function canCancelEventAt(status: unknown, eventEndMs: number | null, nowMs: number): boolean {
    return (!status || status === 'active')
        && eventEndMs !== null
        && eventEndMs > nowMs;
}

export const CHECK_IN_REVIEW_WINDOW_MS = 2 * 60 * 60 * 1000;

export function checkInReviewDeadlineMs(eventEndMs: number): number {
    return eventEndMs + CHECK_IN_REVIEW_WINDOW_MS;
}

export function canManuallyReviewCheckIns(
    status: unknown,
    eventEndMs: number,
    reviewDeadlineMs: number,
    nowMs: number,
): boolean {
    return status !== 'completed'
        && status !== 'cancelled'
        && nowMs >= eventEndMs
        && nowMs <= reviewDeadlineMs;
}

export function canSettleExpiredEventForUser(
    status: unknown,
    eventEndMs: number | null,
    nowMs: number,
    eventEndDate: string,
    currentDate: string,
    belongsToUser: boolean,
): boolean {
    return belongsToUser
        && (!status || status === 'active')
        && eventEndMs !== null
        && eventEndMs <= nowMs
        && eventEndDate < currentDate;
}

// Fronteira explícita da migração: eventos encerrados antes desta versão podem
// ter tido reputação calculada pela lógica antiga sem um marcador persistido.
export const COMPLETION_LEDGER_V2_STARTED_AT_MS = Date.parse('2026-08-25T00:18:00.000Z');

export function shouldApplyCompletionReputation(
    eventEndMs: number,
    hasProcessingMarker: boolean,
): boolean {
    return !hasProcessingMarker && eventEndMs >= COMPLETION_LEDGER_V2_STARTED_AT_MS;
}
