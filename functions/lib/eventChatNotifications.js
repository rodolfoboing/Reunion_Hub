"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectEventChatRecipients = void 0;
function selectEventChatRecipients(attendeeIds, creatorId, senderId, mutedIds, notifiedIds, limit = 150) {
    const muted = new Set(mutedIds);
    const notified = new Set(notifiedIds);
    return [...new Set([...attendeeIds, creatorId].filter(Boolean))]
        .filter((userId) => userId !== senderId && !muted.has(userId) && !notified.has(userId))
        .slice(0, limit);
}
exports.selectEventChatRecipients = selectEventChatRecipients;
//# sourceMappingURL=eventChatNotifications.js.map