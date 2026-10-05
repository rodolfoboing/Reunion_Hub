"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushMessages = exports.processExpoReceipts = exports.planPushRouting = exports.stringData = exports.isExpoPushToken = void 0;
const admin = require("firebase-admin");
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isExpoPushToken(token) {
    return typeof token === 'string' && (token.startsWith('ExponentPushToken') || token.startsWith('ExpoPushToken'));
}
exports.isExpoPushToken = isExpoPushToken;
/**
 * O payload `data` do FCM aceita apenas strings. Valores não primitivos são
 * DESCARTADOS aqui — e o fallback Expo envia `message.data` cru (sem esta
 * conversão), então um campo objeto chegaria diferente nos dois caminhos.
 * Hoje todos os call sites mandam só strings; o teste fixa esse contrato.
 */
function stringData(data) {
    return Object.fromEntries(Object.entries(data).flatMap(([key, value]) => {
        if (typeof value === 'string')
            return [[key, value]];
        if (typeof value === 'number' || typeof value === 'boolean')
            return [[key, String(value)]];
        return [];
    }));
}
exports.stringData = stringData;
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
function planPushRouting(messages) {
    const native = messages.filter((message) => message.platform === 'android'
        && typeof message.nativeToken === 'string'
        && message.nativeToken.length > 0);
    const nativeRegistrationPaths = new Set(native.map(({ registrationPath }) => registrationPath).filter((value) => Boolean(value)));
    const expoFallback = [];
    let missingToken = 0;
    messages
        .filter((message) => !message.registrationPath || !nativeRegistrationPaths.has(message.registrationPath))
        .forEach((message) => {
        if (isExpoPushToken(message.expoToken))
            expoFallback.push(message);
        else
            missingToken += 1;
    });
    return { native, expoFallback, missingToken };
}
exports.planPushRouting = planPushRouting;
async function clearInvalidToken(db, message, field) {
    var _a, _b, _c;
    if (!((_a = message.registrationPath) === null || _a === void 0 ? void 0 : _a.startsWith('pushDevices/')))
        return;
    const tokenRef = db.doc(message.registrationPath);
    const tokenSnapshot = await tokenRef.get();
    if (!tokenSnapshot.exists)
        return;
    const failedToken = field === 'nativePushToken' ? message.nativeToken : message.expoToken;
    if (!failedToken || ((_b = tokenSnapshot.data()) === null || _b === void 0 ? void 0 : _b[field]) !== failedToken)
        return;
    const otherField = field === 'nativePushToken' ? 'expoPushToken' : 'nativePushToken';
    const otherToken = (_c = tokenSnapshot.data()) === null || _c === void 0 ? void 0 : _c[otherField];
    if (typeof otherToken !== 'string' || !otherToken) {
        await tokenRef.delete();
        return;
    }
    await tokenRef.update({ [field]: admin.firestore.FieldValue.delete() });
}
const EXPO_URL = 'https://exp.host/--/api/v2/push';
const EXPO_BATCH_SIZE = 100;
const EXPO_CONCURRENCY = 6;
async function expoRequest(path, body) {
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
            const payload = await response.json().catch(() => null);
            if (response.status !== 429 && response.status < 500)
                return { status: response.status, payload };
            if (attempt === 2)
                return { status: response.status, payload };
        }
        catch (error) {
            if (attempt === 2)
                throw error;
        }
        finally {
            clearTimeout(timeout);
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
    }
    throw new Error('Expo request exhausted retries');
}
async function sendExpoFallback(db, messages) {
    const valid = messages.filter((message) => isExpoPushToken(message.expoToken));
    let delivered = 0;
    let rejected = messages.length - valid.length;
    const retryable = [];
    const chunks = [];
    for (let offset = 0; offset < valid.length; offset += EXPO_BATCH_SIZE) {
        chunks.push(valid.slice(offset, offset + EXPO_BATCH_SIZE));
    }
    let nextChunk = 0;
    await Promise.all(Array.from({ length: Math.min(EXPO_CONCURRENCY, chunks.length) }, async () => {
        var _a;
        while (nextChunk < chunks.length) {
            const chunk = chunks[nextChunk++];
            try {
                const { status, payload } = await expoRequest('send', chunk.map((message) => (Object.assign({ to: message.expoToken, sound: 'default', title: message.title, body: message.body, data: message.data, channelId: message.channel, priority: message.priority, collapseId: message.collapseKey }, (message.expiresAtMs ? { ttl: Math.max(0, Math.floor((message.expiresAtMs - Date.now()) / 1000)) } : {})))));
                const tickets = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
                if (status < 200 || status >= 300 || tickets.length !== chunk.length) {
                    rejected += chunk.length;
                    if (status === 429 || status >= 500 || tickets.length !== chunk.length)
                        retryable.push(...chunk);
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
                                registrationPath: (_a = message.registrationPath) !== null && _a !== void 0 ? _a : null,
                                expoToken: message.expoToken,
                                userId: message.userId,
                                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            });
                            receiptCount += 1;
                        }
                    }
                    else {
                        rejected += 1;
                        const errorCode = isRecord(ticket) && isRecord(ticket.details) ? ticket.details.error : 'unknown';
                        console.error('[PushNotification] expo_rejected', { userId: message.userId, errorCode });
                        if (errorCode === 'DeviceNotRegistered')
                            await clearInvalidToken(db, message, 'expoPushToken');
                        else if (errorCode === 'MessageRateExceeded' || errorCode === 'ExpoServerError')
                            retryable.push(message);
                    }
                }
                if (receiptCount > 0)
                    await receiptBatch.commit();
            }
            catch (_b) {
                rejected += chunk.length;
                retryable.push(...chunk);
                console.error('[PushNotification] expo_request_failed', { count: chunk.length });
            }
        }
    }));
    return { delivered, rejected, retryable };
}
async function processExpoReceipts(db) {
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 15 * 60 * 1000);
    const documents = await db.collection('expoPushReceipts').where('createdAt', '<=', cutoff).limit(100).get();
    if (documents.empty)
        return 0;
    const ids = documents.docs.map((document) => document.id);
    const { status, payload } = await expoRequest('getReceipts', { ids });
    if (status < 200 || status >= 300 || !isRecord(payload) || !isRecord(payload.data)) {
        throw new Error(`Expo receipts rejected: ${status}`);
    }
    const batch = db.batch();
    for (const document of documents.docs) {
        const receipt = payload.data[document.id];
        if (!isRecord(receipt)) {
            if (document.data().createdAt.toMillis() < Date.now() - 24 * 60 * 60 * 1000)
                batch.delete(document.ref);
            continue;
        }
        if (receipt.status === 'error') {
            const errorCode = isRecord(receipt.details) ? receipt.details.error : 'unknown';
            console.error('[PushNotification] expo_receipt_error', { userId: document.data().userId, errorCode });
            if (errorCode === 'DeviceNotRegistered')
                await clearInvalidToken(db, document.data(), 'expoPushToken');
        }
        batch.delete(document.ref);
    }
    await batch.commit();
    return documents.size;
}
exports.processExpoReceipts = processExpoReceipts;
async function sendPushMessages(db, messages) {
    var _a;
    const summary = {
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
        let response;
        try {
            response = await admin.messaging().sendEach(chunk.map((message) => ({
                token: message.nativeToken,
                notification: { title: message.title, body: message.body },
                data: stringData(message.data),
                android: Object.assign(Object.assign({ priority: message.priority, collapseKey: message.collapseKey }, (message.expiresAtMs ? { ttl: Math.max(0, message.expiresAtMs - Date.now()) } : {})), { notification: {
                        channelId: message.channel,
                        sound: 'default',
                        tag: message.tag,
                    } }),
            })));
        }
        catch (_b) {
            console.error('[PushNotification] fcm_batch_failed', { count: chunk.length });
            chunk.forEach((message) => {
                if (isExpoPushToken(message.expoToken))
                    expoFallback.push(message);
                else {
                    summary.rejected += 1;
                    if (message.registrationPath)
                        summary.retryableRegistrationPaths.push(message.registrationPath);
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
            const errorCode = ((_a = result.error) === null || _a === void 0 ? void 0 : _a.code) || 'messaging/unknown-error';
            console.error('[PushNotification] fcm_rejected', { userId: message.userId, errorCode });
            if (errorCode === 'messaging/registration-token-not-registered' || errorCode === 'messaging/invalid-registration-token') {
                await clearInvalidToken(db, message, 'nativePushToken');
            }
            if (isExpoPushToken(message.expoToken))
                expoFallback.push(message);
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
        .filter((path) => typeof path === 'string'));
    console.info('[PushNotification] delivery_completed', {
        requested: summary.requested,
        deliveredToProvider: summary.deliveredToProvider,
        rejected: summary.rejected,
        missingToken: summary.missingToken,
        retryable: summary.retryableRegistrationPaths.length,
    });
    return summary;
}
exports.sendPushMessages = sendPushMessages;
//# sourceMappingURL=pushNotifications.js.map