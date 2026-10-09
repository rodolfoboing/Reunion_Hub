export function selectEventChatRecipients(
    attendeeIds: string[],
    creatorId: string,
    senderId: string,
    mutedIds: string[],
    notifiedIds: string[],
    limit = 150,
): string[] {
    const muted = new Set(mutedIds);
    const notified = new Set(notifiedIds);
    return [...new Set([...attendeeIds, creatorId].filter(Boolean))]
        .filter((userId) => userId !== senderId && !muted.has(userId) && !notified.has(userId))
        .slice(0, limit);
}
