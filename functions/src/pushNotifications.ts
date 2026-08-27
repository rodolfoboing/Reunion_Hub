import * as admin from 'firebase-admin';

export type PushChannel = 'messages' | 'events' | 'recommendations';

export type PushMessage = {
    userId: string;
    registrationPath?: string;
    expoToken?: string;
    nativeToken?: string;
    platform?: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
    channel: PushChannel;
    priority: 'normal' | 'high';
    tag?: string;
    collapseKey?: string;
};

export type PushDeliverySummary = {
    requested: number;
    deliveredToProvider: number;
    rejected: number;
    missingToken: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isExpoPushToken(token: string | undefined): token is string {
    return typeof token === 'string' && (token.startsWith('ExponentPushToken') || token.startsWith('ExpoPushToken'));
}

function stringData(data: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(Object.entries(data).flatMap(([key, value]) => {
        if (typeof value === 'string') return [[key, value]];
        if (typeof value === 'number' || typeof value === 'boolean') return [[key, String(value)]];
        return [];
    }));
}

async function clearInvalidToken(
    db: FirebaseFirestore.Firestore,
    message: PushMessage,
    field: 'nativePushToken' | 'expoPushToken'
): Promise<void> {
    if (!message.registrationPath?.startsWith('pushDevices/')) return;
    const tokenRef = db.doc(message.registrationPath);
    const tokenSnapshot = await tokenRef.get();
    if (!tokenSnapshot.exists) return;

    const otherField = field === 'nativePushToken' ? 'expoPushToken' : 'nativePushToken';
    const otherToken = tokenSnapshot.data()?.[otherField];
    if (typeof otherToken !== 'string' || !otherToken) {
        await tokenRef.delete();
        return;
    }
    await tokenRef.update({ [field]: admin.firestore.FieldValue.delete() });
}

async function sendExpoFallback(
    db: FirebaseFirestore.Firestore,
    messages: PushMessage[]
): Promise<{ delivered: number; rejected: number }> {
    let delivered = 0;
    let rejected = 0;
    for (const message of messages) {
        if (!isExpoPushToken(message.expoToken)) {
            rejected += 1;
            continue;
        }
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
                body: JSON.stringify({
                    to: message.expoToken,
                    sound: 'default',
                    title: message.title,
                    body: message.body,
                    data: message.data,
                    channelId: message.channel,
                    priority: message.priority,
                    collapseId: message.collapseKey,
                }),
                signal: controller.signal,
            });
            const payload: unknown = await response.json().catch(() => null);
            const ticket = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
            if (!response.ok || !ticket || ticket.status !== 'ok') {
                rejected += 1;
                const errorCode = ticket && isRecord(ticket.details) && typeof ticket.details.error === 'string'
                    ? ticket.details.error
                    : `HTTP_${response.status}`;
                console.error('[PushNotification] expo_rejected', { userId: message.userId, errorCode });
                if (errorCode === 'DeviceNotRegistered') await clearInvalidToken(db, message, 'expoPushToken');
                continue;
            }
            delivered += 1;
        } catch (error: unknown) {
            rejected += 1;
            console.error(error instanceof Error && error.name === 'AbortError'
                ? '[PushNotification] expo_timeout'
                : '[PushNotification] expo_request_failed', { userId: message.userId });
        } finally {
            clearTimeout(timeout);
        }
    }
    return { delivered, rejected };
}

export async function sendPushMessages(
    db: FirebaseFirestore.Firestore,
    messages: PushMessage[]
): Promise<PushDeliverySummary> {
    const summary: PushDeliverySummary = {
        requested: messages.length,
        deliveredToProvider: 0,
        rejected: 0,
        missingToken: 0,
    };
    const expoFallback: PushMessage[] = [];
    const nativeMessages = messages.filter((message) => message.platform === 'android' && typeof message.nativeToken === 'string' && message.nativeToken.length > 0);
    const nativeRegistrationPaths = new Set(nativeMessages.map(({ registrationPath }) => registrationPath).filter((value): value is string => Boolean(value)));
    messages.filter((message) => !message.registrationPath || !nativeRegistrationPaths.has(message.registrationPath)).forEach((message) => {
        if (isExpoPushToken(message.expoToken)) expoFallback.push(message);
        else summary.missingToken += 1;
    });

    for (let offset = 0; offset < nativeMessages.length; offset += 500) {
        const chunk = nativeMessages.slice(offset, offset + 500);
        const response = await admin.messaging().sendEach(chunk.map((message) => ({
            token: message.nativeToken!,
            notification: { title: message.title, body: message.body },
            data: stringData(message.data),
            android: {
                priority: message.priority,
                collapseKey: message.collapseKey,
                notification: {
                    channelId: message.channel,
                    sound: 'default',
                    tag: message.tag,
                },
            },
        })));
        for (let index = 0; index < response.responses.length; index += 1) {
            const result = response.responses[index];
            const message = chunk[index];
            if (result.success) {
                summary.deliveredToProvider += 1;
                continue;
            }
            const errorCode = result.error?.code || 'messaging/unknown-error';
            console.error('[PushNotification] fcm_rejected', { userId: message.userId, errorCode });
            if (errorCode === 'messaging/registration-token-not-registered' || errorCode === 'messaging/invalid-registration-token') {
                await clearInvalidToken(db, message, 'nativePushToken');
            }
            if (isExpoPushToken(message.expoToken)) expoFallback.push(message);
            else summary.rejected += 1;
        }
    }

    const expoResult = await sendExpoFallback(db, expoFallback);
    summary.deliveredToProvider += expoResult.delivered;
    summary.rejected += expoResult.rejected;
    console.info('[PushNotification] delivery_completed', summary);
    return summary;
}
