import * as admin from 'firebase-admin';

export type ExpoPushMessage = {
    token: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isExpoPushToken(token: string): boolean {
    return token.startsWith('ExponentPushToken') || token.startsWith('ExpoPushToken');
}

async function removeInvalidPushTokens(
    db: FirebaseFirestore.Firestore,
    invalidTokens: string[]
): Promise<void> {
    const uniqueTokens = [...new Set(invalidTokens)];
    for (let index = 0; index < uniqueTokens.length; index += 10) {
        const tokenChunk = uniqueTokens.slice(index, index + 10);
        const profiles = await db.collection('users').where('expoPushToken', 'in', tokenChunk).get();
        if (profiles.empty) continue;

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

export async function sendExpoPushMessages(
    db: FirebaseFirestore.Firestore,
    messages: ExpoPushMessage[]
): Promise<void> {
    const validMessages = messages.filter(({ token }) => isExpoPushToken(token));
    if (validMessages.length === 0) return;

    const invalidTokens: string[] = [];
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

            const payload: unknown = await response.json();
            const tickets = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
            tickets.forEach((ticket, ticketIndex) => {
                if (!isRecord(ticket) || ticket.status !== 'error' || !isRecord(ticket.details)) return;
                if (ticket.details.error === 'DeviceNotRegistered') {
                    const message = chunk[ticketIndex];
                    if (message) invalidTokens.push(message.token);
                }
            });
        } catch (error: unknown) {
            const timedOut = error instanceof Error && error.name === 'AbortError';
            console.error(timedOut ? '[PushNotification] request_timeout' : '[PushNotification] request_failed', { recipientCount: chunk.length });
        } finally {
            clearTimeout(timeout);
        }
    }

    if (invalidTokens.length > 0) {
        try {
            await removeInvalidPushTokens(db, invalidTokens);
        } catch {
            console.error('[PushNotification] invalid_token_cleanup_failed', { tokenCount: invalidTokens.length });
        }
    }
}

export async function sendExpoPushNotification(
    db: FirebaseFirestore.Firestore,
    pushTokens: string[],
    title: string,
    body: string,
    data: Record<string, unknown> = {}
): Promise<void> {
    await sendExpoPushMessages(db, pushTokens.map((token) => ({ token, title, body, data })));
}
