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
    expiresAtMs?: number;
};

export type PushDeliverySummary = {
    requested: number;
    deliveredToProvider: number;
    rejected: number;
    missingToken: number;
    retryableRegistrationPaths: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function isExpoPushToken(token: string | undefined): token is string {
    return typeof token === 'string' && (token.startsWith('ExponentPushToken') || token.startsWith('ExpoPushToken'));
}

/**
 * O payload `data` do FCM aceita apenas strings. Valores não primitivos são
 * DESCARTADOS aqui — e o fallback Expo envia `message.data` cru (sem esta
 * conversão), então um campo objeto chegaria diferente nos dois caminhos.
 * Hoje todos os call sites mandam só strings; o teste fixa esse contrato.
 */
export function stringData(data: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(Object.entries(data).flatMap(([key, value]) => {
        if (typeof value === 'string') return [[key, value]];
        if (typeof value === 'number' || typeof value === 'boolean') return [[key, String(value)]];
        return [];
    }));
}

export type PushRoutingPlan = {
    /** Android com token nativo: vai por FCM. */
    native: PushMessage[];
    /** Sem caminho nativo, mas com token Expo válido. */
    expoFallback: PushMessage[];
    /** Sem nenhum caminho de entrega. */
    missingToken: number;
};

/**
 * Decide por onde cada mensagem sai. Pura de propósito: é a lógica que causa
 * notificação duplicada (mesma mensagem indo por FCM e Expo) ou silenciosa
 * (nenhum caminho), então precisa ser testável sem tocar em rede nem Firestore.
 *
 * Um aparelho já roteado por FCM é excluído do Expo pelo `registrationPath` —
 * é o que impede a duplicação. Mensagens sem `registrationPath` (o formato
 * legado, criado quando o usuário não tem device registrado) nunca têm caminho
 * nativo, então caem no Expo ou em missingToken.
 */
export function planPushRouting(messages: PushMessage[]): PushRoutingPlan {
    const native = messages.filter((message) => message.platform === 'android'
        && typeof message.nativeToken === 'string'
        && message.nativeToken.length > 0);
    const nativeRegistrationPaths = new Set(
        native.map(({ registrationPath }) => registrationPath).filter((value): value is string => Boolean(value)),
    );

    const expoFallback: PushMessage[] = [];
    let missingToken = 0;
    messages
        .filter((message) => !message.registrationPath || !nativeRegistrationPaths.has(message.registrationPath))
        .forEach((message) => {
            if (isExpoPushToken(message.expoToken)) expoFallback.push(message);
            else missingToken += 1;
        });

    return { native, expoFallback, missingToken };
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
    const failedToken = field === 'nativePushToken' ? message.nativeToken : message.expoToken;
    if (!failedToken || tokenSnapshot.data()?.[field] !== failedToken) return;

    const otherField = field === 'nativePushToken' ? 'expoPushToken' : 'nativePushToken';
    const otherToken = tokenSnapshot.data()?.[otherField];
    if (typeof otherToken !== 'string' || !otherToken) {
        await tokenRef.delete();
        return;
    }
    await tokenRef.update({ [field]: admin.firestore.FieldValue.delete() });
}

const EXPO_URL = 'https://exp.host/--/api/v2/push';
const EXPO_BATCH_SIZE = 100;
const EXPO_CONCURRENCY = 6;

async function expoRequest(path: string, body: unknown): Promise<{ status: number; payload: unknown }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetch(`${EXPO_URL}/${path}`, {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            const payload: unknown = await response.json().catch(() => null);
            if (response.status !== 429 && response.status < 500) return { status: response.status, payload };
            if (attempt === 2) return { status: response.status, payload };
        } catch (error) {
            if (attempt === 2) throw error;
        } finally {
            clearTimeout(timeout);
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
    }
    throw new Error('Expo request exhausted retries');
}

async function sendExpoFallback(
    db: FirebaseFirestore.Firestore,
    messages: PushMessage[]
): Promise<{ delivered: number; rejected: number; retryable: PushMessage[] }> {
    const valid = messages.filter((message) => isExpoPushToken(message.expoToken));
    let delivered = 0;
    let rejected = messages.length - valid.length;
    const retryable: PushMessage[] = [];
    const chunks: PushMessage[][] = [];
    for (let offset = 0; offset < valid.length; offset += EXPO_BATCH_SIZE) {
        chunks.push(valid.slice(offset, offset + EXPO_BATCH_SIZE));
    }
    let nextChunk = 0;
    await Promise.all(Array.from({ length: Math.min(EXPO_CONCURRENCY, chunks.length) }, async () => {
        while (nextChunk < chunks.length) {
            const chunk = chunks[nextChunk++];
            try {
                const { status, payload } = await expoRequest('send', chunk.map((message) => ({
                    to: message.expoToken,
                    sound: 'default',
                    title: message.title,
                    body: message.body,
                    data: message.data,
                    channelId: message.channel,
                    priority: message.priority,
                    collapseId: message.collapseKey,
                    ...(message.expiresAtMs ? { ttl: Math.max(0, Math.floor((message.expiresAtMs - Date.now()) / 1000)) } : {}),
                })));
                const tickets = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
                if (status < 200 || status >= 300 || tickets.length !== chunk.length) {
                    rejected += chunk.length;
                    if (status === 429 || status >= 500 || tickets.length !== chunk.length) retryable.push(...chunk);
                    console.error('[PushNotification] expo_batch_rejected', { status, count: chunk.length });
                    continue;
                }
                const receiptBatch = db.batch();
                let receiptCount = 0;
                for (let index = 0; index < chunk.length; index += 1) {
                    const ticket = tickets[index];
                    const message = chunk[index];
                    if (isRecord(ticket) && ticket.status === 'ok') {
                        delivered += 1;
                        if (typeof ticket.id === 'string') {
                            receiptBatch.set(db.collection('expoPushReceipts').doc(ticket.id), {
                                registrationPath: message.registrationPath ?? null,
                                expoToken: message.expoToken,
                                userId: message.userId,
                                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            });
                            receiptCount += 1;
                        }
                    } else {
                        rejected += 1;
                        const errorCode = isRecord(ticket) && isRecord(ticket.details) ? ticket.details.error : 'unknown';
                        console.error('[PushNotification] expo_rejected', { userId: message.userId, errorCode });
                        if (errorCode === 'DeviceNotRegistered') await clearInvalidToken(db, message, 'expoPushToken');
                        else if (errorCode === 'MessageRateExceeded' || errorCode === 'ExpoServerError') retryable.push(message);
                    }
                }
                if (receiptCount > 0) await receiptBatch.commit();
            } catch {
                rejected += chunk.length;
                retryable.push(...chunk);
                console.error('[PushNotification] expo_request_failed', { count: chunk.length });
            }
        }
    }));
    return { delivered, rejected, retryable };
}

export async function processExpoReceipts(db: FirebaseFirestore.Firestore): Promise<number> {
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 15 * 60 * 1000);
    const documents = await db.collection('expoPushReceipts').where('createdAt', '<=', cutoff).limit(100).get();
    if (documents.empty) return 0;
    const ids = documents.docs.map((document) => document.id);
    const { status, payload } = await expoRequest('getReceipts', { ids });
    if (status < 200 || status >= 300 || !isRecord(payload) || !isRecord(payload.data)) {
        throw new Error(`Expo receipts rejected: ${status}`);
    }
    const batch = db.batch();
    for (const document of documents.docs) {
        const receipt = payload.data[document.id];
        if (!isRecord(receipt)) {
            if (document.data().createdAt.toMillis() < Date.now() - 24 * 60 * 60 * 1000) batch.delete(document.ref);
            continue;
        }
        if (receipt.status === 'error') {
            const errorCode = isRecord(receipt.details) ? receipt.details.error : 'unknown';
            console.error('[PushNotification] expo_receipt_error', { userId: document.data().userId, errorCode });
            if (errorCode === 'DeviceNotRegistered') await clearInvalidToken(db, document.data() as PushMessage, 'expoPushToken');
        }
        batch.delete(document.ref);
    }
    await batch.commit();
    return documents.size;
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
        retryableRegistrationPaths: [],
    };
    const plan = planPushRouting(messages);
    const nativeMessages = plan.native;
    // Cópia: mensagens cujo envio nativo falhar são acrescentadas aqui abaixo.
    const expoFallback = [...plan.expoFallback];
    summary.missingToken = plan.missingToken;

    for (let offset = 0; offset < nativeMessages.length; offset += 500) {
        const chunk = nativeMessages.slice(offset, offset + 500);
        let response: admin.messaging.BatchResponse;
        try {
            response = await admin.messaging().sendEach(chunk.map((message) => ({
            token: message.nativeToken!,
            notification: { title: message.title, body: message.body },
            data: stringData(message.data),
            android: {
                priority: message.priority,
                collapseKey: message.collapseKey,
                ...(message.expiresAtMs ? { ttl: Math.max(0, message.expiresAtMs - Date.now()) } : {}),
                notification: {
                    channelId: message.channel,
                    sound: 'default',
                    tag: message.tag,
                },
            },
            })));
        } catch {
            console.error('[PushNotification] fcm_batch_failed', { count: chunk.length });
            chunk.forEach((message) => {
                if (isExpoPushToken(message.expoToken)) expoFallback.push(message);
                else {
                    summary.rejected += 1;
                    if (message.registrationPath) summary.retryableRegistrationPaths.push(message.registrationPath);
                }
            });
            continue;
        }
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
            else {
                summary.rejected += 1;
                if (message.registrationPath && errorCode !== 'messaging/registration-token-not-registered'
                    && errorCode !== 'messaging/invalid-registration-token') {
                    summary.retryableRegistrationPaths.push(message.registrationPath);
                }
            }
        }
    }

    const expoResult = await sendExpoFallback(db, expoFallback);
    summary.deliveredToProvider += expoResult.delivered;
    summary.rejected += expoResult.rejected;
    summary.retryableRegistrationPaths.push(...expoResult.retryable
        .map((message) => message.registrationPath)
        .filter((path): path is string => typeof path === 'string'));
    console.info('[PushNotification] delivery_completed', {
        requested: summary.requested,
        deliveredToProvider: summary.deliveredToProvider,
        rejected: summary.rejected,
        missingToken: summary.missingToken,
        retryable: summary.retryableRegistrationPaths.length,
    });
    return summary;
}
