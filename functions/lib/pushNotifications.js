"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendExpoPushNotification = exports.sendExpoPushMessages = void 0;
const admin = require("firebase-admin");
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isExpoPushToken(token) {
    return token.startsWith('ExponentPushToken') || token.startsWith('ExpoPushToken');
}
async function removeInvalidPushTokens(db, invalidTokens) {
    const uniqueTokens = [...new Set(invalidTokens)];
    for (let index = 0; index < uniqueTokens.length; index += 10) {
        const tokenChunk = uniqueTokens.slice(index, index + 10);
        const profiles = await db.collection('users').where('expoPushToken', 'in', tokenChunk).get();
        if (profiles.empty)
            continue;
        const batch = db.batch();
        profiles.docs.forEach((profile) => {
            // A consulta seleciona somente perfis que ainda possuem um dos tokens inválidos.
            batch.update(profile.ref, { expoPushToken: admin.firestore.FieldValue.delete() });
        });
        await batch.commit();
    }
    if (uniqueTokens.length > 0) {
        console.info('[PushNotification] invalid_tokens_removed', { tokenCount: uniqueTokens.length });
    }
}
async function sendExpoPushMessages(db, messages) {
    const validMessages = messages.filter(({ token }) => isExpoPushToken(token));
    if (validMessages.length === 0)
        return;
    const invalidTokens = [];
    for (let index = 0; index < validMessages.length; index += 100) {
        const chunk = validMessages.slice(index, index + 100);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Accept-encoding': 'gzip, deflate',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(chunk.map(({ token, title, body, data }) => ({
                    to: token,
                    sound: 'default',
                    title,
                    body,
                    data,
                }))),
                signal: controller.signal,
            });
            if (!response.ok) {
                console.warn('[PushNotification] request_rejected', { recipientCount: chunk.length, status: response.status });
                continue;
            }
            const payload = await response.json();
            const tickets = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
            tickets.forEach((ticket, ticketIndex) => {
                if (!isRecord(ticket) || ticket.status !== 'error' || !isRecord(ticket.details))
                    return;
                if (ticket.details.error === 'DeviceNotRegistered') {
                    const message = chunk[ticketIndex];
                    if (message)
                        invalidTokens.push(message.token);
                }
            });
        }
        catch (error) {
            const timedOut = error instanceof Error && error.name === 'AbortError';
            console.error(timedOut ? '[PushNotification] request_timeout' : '[PushNotification] request_failed', { recipientCount: chunk.length });
        }
        finally {
            clearTimeout(timeout);
        }
    }
    if (invalidTokens.length > 0) {
        try {
            await removeInvalidPushTokens(db, invalidTokens);
        }
        catch (_a) {
            console.error('[PushNotification] invalid_token_cleanup_failed', { tokenCount: invalidTokens.length });
        }
    }
}
exports.sendExpoPushMessages = sendExpoPushMessages;
async function sendExpoPushNotification(db, pushTokens, title, body, data = {}) {
    await sendExpoPushMessages(db, pushTokens.map((token) => ({ token, title, body, data })));
}
exports.sendExpoPushNotification = sendExpoPushNotification;
//# sourceMappingURL=pushNotifications.js.map