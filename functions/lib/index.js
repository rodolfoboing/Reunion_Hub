"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteMyAccount = exports.banUser = exports.removeReportedEvent = exports.editEvent = exports.cancelEvent = exports.closeExpiredEventsDaily = exports.processEventCheckInReviews = exports.dailyEventRecommendations = exports.retryPendingEventPushes = exports.checkExpoPushReceipts = exports.settleMyExpiredEvents = exports.reviewAndCompleteEvent = exports.completeEvent = exports.checkInToEvent = exports.setFrequentedPlacesPrivacy = exports.removePlaceHabit = exports.savePlaceHabit = exports.sendChatMessage = exports.getOrCreateConversation = exports.inviteUserToEvent = exports.getEventInviteCandidates = exports.leaveEvent = exports.proposeFavoriteEventRepeat = exports.recreateFavoriteEvent = exports.toggleEventFavorite = exports.rsvpToEvent = exports.reportEventLinkIssue = exports.recoverEventNotifications = exports.setEventChatNotifications = exports.notifyEventChatMessage = exports.onReportCreated = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const eventChatNotifications_1 = require("./eventChatNotifications");
const pushNotifications_1 = require("./pushNotifications");
const validation_1 = require("./validation");
const recommendations_1 = require("./recommendations");
const eventLifecycle_1 = require("./eventLifecycle");
admin.initializeApp();
const db = admin.firestore();
// O app ainda é pequeno: limita concorrência e memória para evitar picos de custo.
// Callables comuns usam 30 s; a rotina diária recebe configuração própria abaixo.
const smallFunction = functions.runWith({
    memory: '128MB',
    timeoutSeconds: 30,
    maxInstances: 5,
});
const dailyFunction = functions.runWith({
    memory: '128MB',
    timeoutSeconds: 120,
    maxInstances: 1,
});
const recommendationFunction = functions.runWith({
    memory: '256MB',
    timeoutSeconds: 540,
    maxInstances: 1,
});
// Exclusão é rara, mas percorre todas as coleções ligadas à conta. Um limite
// maior evita exclusão parcial sem aumentar custo quando a Function está ociosa.
const accountFunction = functions.runWith({
    memory: '128MB',
    timeoutSeconds: 120,
    maxInstances: 2,
});
async function pushMessagesForUser(userId, title, body, data, options) {
    var _a, _b, _c;
    const preferenceField = options.preferenceField;
    const [devicesSnapshot, settingsSnapshot] = await Promise.all([
        db.collection('pushDevices').where('userId', '==', userId).get(),
        preferenceField ? db.collection('notificationSettings').doc(userId).get() : Promise.resolve(null),
    ]);
    if (settingsSnapshot && preferenceField && ((_a = settingsSnapshot.data()) === null || _a === void 0 ? void 0 : _a[preferenceField]) === false)
        return [];
    const channel = (_b = options.channel) !== null && _b !== void 0 ? _b : 'events';
    const priority = (_c = options.priority) !== null && _c !== void 0 ? _c : 'high';
    const common = {
        userId,
        title,
        body,
        data,
        channel,
        priority,
        tag: options.tag,
        collapseKey: options.collapseKey,
    };
    if (devicesSnapshot.empty)
        return [Object.assign({}, common)];
    return devicesSnapshot.docs.map((device) => {
        const tokenData = device.data();
        return Object.assign(Object.assign({}, common), { registrationPath: device.ref.path, expoToken: typeof tokenData.expoPushToken === 'string' ? tokenData.expoPushToken : undefined, nativeToken: typeof tokenData.nativePushToken === 'string' ? tokenData.nativePushToken : undefined, platform: typeof tokenData.platform === 'string' ? tokenData.platform : undefined });
    });
}
async function sendPushNotification(userIds, title, body, data = {}, options = {}) {
    const resolvedOptions = Object.assign({ channel: 'events', priority: 'high', preferenceField: 'notifyEventUpdates' }, options);
    const messages = (await Promise.all([...new Set(userIds)].map((userId) => pushMessagesForUser(userId, title, body, data, resolvedOptions)))).flat();
    return (0, pushNotifications_1.sendPushMessages)(db, messages);
}
async function requireStaff(context) {
    var _a, _b;
    const uid = requireAuthenticated(context);
    const profile = await db.collection('users').doc(uid).get();
    const role = (_a = profile.data()) === null || _a === void 0 ? void 0 : _a.role;
    if (((_b = profile.data()) === null || _b === void 0 ? void 0 : _b.banned) === true || (role !== 'admin' && role !== 'moderator')) {
        throw new functions.https.HttpsError('permission-denied', 'Apenas a moderacao pode executar esta acao.');
    }
    return uid;
}
async function settlePushOutbox(deliveries, messages, summary) {
    const failedPaths = new Set(summary.retryableRegistrationPaths);
    const failedByNotification = new Map();
    messages.forEach((message) => {
        var _a, _b;
        const outboxId = (_a = message.data.outboxId) !== null && _a !== void 0 ? _a : message.data.notificationId;
        if (!message.registrationPath || !failedPaths.has(message.registrationPath) || typeof outboxId !== 'string')
            return;
        const paths = (_b = failedByNotification.get(outboxId)) !== null && _b !== void 0 ? _b : new Set();
        paths.add(message.registrationPath);
        failedByNotification.set(outboxId, paths);
    });
    for (let offset = 0; offset < deliveries.length; offset += 400) {
        const batch = db.batch();
        deliveries.slice(offset, offset + 400).forEach((delivery) => {
            var _a;
            const reference = db.collection('pushOutbox').doc(delivery.id);
            const paths = [...((_a = failedByNotification.get(delivery.id)) !== null && _a !== void 0 ? _a : [])];
            if (paths.length > 0)
                batch.set(reference, { registrationPaths: paths }, { merge: true });
            else
                batch.delete(reference);
        });
        await batch.commit();
    }
}
async function deliverEventNotifications(deliveries) {
    if (deliveries.length === 0)
        return;
    const recipientIds = [...new Set(deliveries.map(({ userId }) => userId))];
    const recipientProfiles = new Map();
    for (let index = 0; index < recipientIds.length; index += 100) {
        const chunk = recipientIds.slice(index, index + 100);
        const profiles = await db.getAll(...chunk.map((userId) => db.collection('users').doc(userId)));
        profiles.forEach((profile) => {
            if (profile.exists)
                recipientProfiles.set(profile.id, profile.data());
        });
    }
    const validDeliveries = deliveries.filter(({ userId }) => {
        const profile = recipientProfiles.get(userId);
        return Boolean(profile && profile.banned !== true);
    });
    for (let index = 0; index < validDeliveries.length; index += 200) {
        const batch = db.batch();
        validDeliveries.slice(index, index + 200).forEach((delivery) => {
            batch.set(db.collection('notifications').doc(delivery.id), Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ userId: delivery.userId, type: delivery.type, title: delivery.title, body: delivery.body, meetingId: delivery.meetingId }, (typeof delivery.reputationDelta === 'number' ? { reputationDelta: delivery.reputationDelta } : {})), (delivery.detailTitle ? { detailTitle: delivery.detailTitle } : {})), (delivery.detailBody ? { detailBody: delivery.detailBody } : {})), (delivery.revision ? { revision: delivery.revision } : {})), { createdAt: admin.firestore.FieldValue.serverTimestamp(), read: false }), { merge: true });
            batch.set(db.collection('pushOutbox').doc(delivery.id), {
                delivery: JSON.parse(JSON.stringify(delivery)),
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        });
        await batch.commit();
    }
    const pushMessages = (await Promise.all(validDeliveries.map((delivery) => {
        var _a, _b;
        return pushMessagesForUser(delivery.userId, delivery.title, delivery.body, {
            path: `/event/${delivery.meetingId}`,
            meetingId: delivery.meetingId,
            notificationType: delivery.type,
            notificationId: delivery.id,
        }, Object.assign({ channel: (_a = delivery.channel) !== null && _a !== void 0 ? _a : 'events', priority: delivery.type === 'event_completed' || delivery.type === 'daily_event_recommendation' ? 'normal' : 'high', preferenceField: (_b = delivery.preferenceField) !== null && _b !== void 0 ? _b : 'notifyEventUpdates' }, (delivery.type === 'checkin_request' || delivery.type === 'checkin_review_ready' ? {
            tag: `checkin_review_${delivery.meetingId}`,
            collapseKey: `checkin_review_${delivery.meetingId}`,
        } : { tag: delivery.id, collapseKey: delivery.id })));
    }))).flat();
    try {
        const summary = await (0, pushNotifications_1.sendPushMessages)(db, pushMessages);
        await settlePushOutbox(validDeliveries, pushMessages, summary);
    }
    catch (_a) {
        // A notificação interna já foi persistida. Push não pode desfazer a ação principal.
        console.error('[MeetingNotification] push_delivery_failed', { recipientCount: validDeliveries.length });
    }
}
async function notifyReportersOfModerationAction(targetType, targetId, body, path) {
    const reports = await db.collection('reports')
        .where('type', '==', targetType)
        .where('targetId', '==', targetId)
        .get();
    const reporterIds = [...new Set(reports.docs.map((report) => report.data().reportedBy).filter((userId) => typeof userId === 'string'))];
    if (reporterIds.length === 0)
        return;
    for (let index = 0; index < reporterIds.length; index += 400) {
        const batch = db.batch();
        reporterIds.slice(index, index + 400).forEach((userId) => {
            batch.set(db.collection('notifications').doc(`report_resolved_${targetType}_${targetId}_${userId}`), {
                userId,
                type: 'report_resolved',
                title: 'Denúncia analisada',
                body,
                path,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                read: false,
            }, { merge: true });
        });
        await batch.commit();
    }
    try {
        await sendPushNotification(reporterIds, 'Denúncia analisada', body, { path, notificationType: 'report_resolved' }, { priority: 'normal' });
    }
    catch (_a) {
        console.error('[Moderation] reporter_push_failed', { targetType, reporterCount: reporterIds.length });
    }
}
exports.onReportCreated = functions.runWith({
    memory: '128MB',
    timeoutSeconds: 30,
    maxInstances: 5,
    failurePolicy: true,
}).firestore
    .document('reports/{reportId}')
    .onCreate(async (snapshot) => {
    var _a;
    const report = snapshot.data();
    const currentReport = await snapshot.ref.get();
    if ((_a = currentReport.data()) === null || _a === void 0 ? void 0 : _a.moderatorNotifiedAt)
        return null;
    const staffProfiles = await db.collection('users')
        .where('role', 'in', ['admin', 'moderator'])
        .get();
    const staffIds = staffProfiles.docs
        .filter((profile) => profile.data().banned !== true)
        .map((profile) => profile.id);
    if (staffIds.length === 0) {
        console.warn('[Moderation] report_without_available_staff');
        return null;
    }
    const targetLabel = report.type === 'user' ? 'usuário' : 'evento';
    for (let offset = 0; offset < staffIds.length; offset += 400) {
        const batch = db.batch();
        staffIds.slice(offset, offset + 400).forEach((userId) => {
            batch.set(db.collection('notifications').doc(`report_received_${snapshot.id}_${userId}`), {
                userId,
                type: 'report_received',
                title: 'Nova denúncia para análise',
                body: `Uma denúncia de ${targetLabel} aguarda moderação.`,
                path: '/(drawer)/(tabs)/moderation',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                read: false,
            }, { merge: true });
        });
        if (offset + 400 >= staffIds.length) {
            batch.set(snapshot.ref, { moderatorNotifiedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
        await batch.commit();
    }
    try {
        await sendPushNotification(staffIds, 'Nova denúncia para análise', `Uma denúncia de ${targetLabel} aguarda moderação.`, { path: '/(drawer)/(tabs)/moderation', notificationType: 'report_received' }, { priority: 'normal', preferenceField: undefined });
    }
    catch (_b) {
        console.error('[Moderation] report_push_failed', { staffCount: staffIds.length });
    }
    console.info('[Moderation] report_alert_created', { staffCount: staffIds.length, targetType: report.type });
    return null;
});
function requireAuthenticated(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Faça login para continuar.');
    }
    return context.auth.uid;
}
function requireRecentAuthentication(context, maximumAgeSeconds = 5 * 60) {
    var _a;
    const uid = requireAuthenticated(context);
    const authTime = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token.auth_time;
    const ageSeconds = typeof authTime === 'number' ? Math.floor(Date.now() / 1000) - authTime : Number.POSITIVE_INFINITY;
    if (ageSeconds < 0 || ageSeconds > maximumAgeSeconds) {
        throw new functions.https.HttpsError('failed-precondition', 'Confirme sua senha novamente antes de realizar esta ação.');
    }
    return uid;
}
function requireEventId(data) {
    return (0, validation_1.requireDocumentIdField)(data, 'eventId', 500);
}
function requireEventIds(data) {
    if (!(0, validation_1.isRecord)(data) || !Array.isArray(data.eventIds)) {
        throw new functions.https.HttpsError('invalid-argument', 'A lista de eventos é obrigatória.');
    }
    const eventIds = [...new Set(data.eventIds.map((eventId) => (0, validation_1.requireDocumentIdValue)(eventId, 'eventIds', 500)))];
    if (eventIds.length === 0 || eventIds.length > 10) {
        throw new functions.https.HttpsError('invalid-argument', 'Envie entre 1 e 10 eventos por vez.');
    }
    return eventIds;
}
function isBlockedBy(profile, userId) {
    const blockedUsers = profile === null || profile === void 0 ? void 0 : profile.blockedUsers;
    return Array.isArray(blockedUsers) && blockedUsers.includes(userId);
}
function notificationSnapshotTimestamp(value) {
    return value instanceof admin.firestore.Timestamp ? value.toDate() : null;
}
function conversationIdFor(firstUserId, secondUserId) {
    return [firstUserId, secondUserId].sort().join('_');
}
function getEventStartDate(event) {
    if (event.startsAt instanceof admin.firestore.Timestamp)
        return event.startsAt.toDate();
    if (typeof event.date !== 'string' || typeof event.time !== 'string')
        return null;
    if (!(0, validation_1.isValidCalendarDate)(event.date) || !(0, validation_1.isValidClockTime)(event.time))
        return null;
    // Eventos do produto são registrados no horário de São Paulo. Sem o offset,
    // o runtime das Functions (UTC) adiantaria a janela de check-in em três horas.
    const date = new Date(`${event.date}T${event.time}:00-03:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}
function getEventEndDate(event) {
    if (event.endsAt instanceof admin.firestore.Timestamp)
        return event.endsAt.toDate();
    if (typeof event.date !== 'string' || typeof event.time !== 'string')
        return null;
    const endTime = typeof event.endTime === 'string' ? event.endTime : '';
    const endDate = typeof event.endDate === 'string' && (0, validation_1.isValidCalendarDate)(event.endDate) ? event.endDate : event.date;
    const end = endTime && (0, validation_1.isValidCalendarDate)(endDate) && (0, validation_1.isValidClockTime)(endTime)
        ? new Date(`${endDate}T${endTime}:00-03:00`)
        : null;
    if (end && !Number.isNaN(end.getTime()))
        return end;
    const start = getEventStartDate(event);
    return start ? new Date(start.getTime() + 3 * 60 * 60 * 1000) : null;
}
function getCheckInReviewDeadline(event, eventEnd) {
    if (event.checkInReviewDeadlineAt instanceof admin.firestore.Timestamp) {
        return event.checkInReviewDeadlineAt.toDate();
    }
    return new Date((0, eventLifecycle_1.checkInReviewDeadlineMs)(eventEnd.getTime()));
}
function isCheckInWindowOpen(event, now) {
    const start = getEventStartDate(event);
    const end = getEventEndDate(event);
    return Boolean(start && end && now >= start && now <= end);
}
function pendingCheckIns(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap((item) => {
        if (!(0, validation_1.isRecord)(item) || typeof item.userId !== 'string' || !item.userId)
            return [];
        return [Object.assign({ userId: item.userId, displayName: typeof item.displayName === 'string' && item.displayName ? item.displayName : 'Usuário' }, (item.requestedAt instanceof admin.firestore.Timestamp ? { requestedAt: item.requestedAt } : {}))];
    });
}
const HABIT_WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
function requireHabitWeekday(data) {
    const weekday = data.weekday;
    const matchedWeekday = typeof weekday === 'string' ? HABIT_WEEKDAYS.find((day) => day === weekday) : undefined;
    if (!matchedWeekday) {
        throw new functions.https.HttpsError('invalid-argument', 'Dia da semana inválido.');
    }
    return matchedWeekday;
}
function requireHabitSchedule(data) {
    const normalizedSchedule = {};
    const requestedSchedule = data.schedule;
    if ((0, validation_1.isRecord)(requestedSchedule)) {
        HABIT_WEEKDAYS.forEach((weekday) => {
            const periods = requestedSchedule[weekday];
            if (!Array.isArray(periods))
                return;
            const normalizedPeriods = [...new Set(periods
                    .filter((period) => typeof period === 'string')
                    .map((period) => period.trim())
                    .filter((period) => ['Manhã', 'Tarde', 'Noite'].includes(period)))].slice(0, 3);
            if (normalizedPeriods.length > 0)
                normalizedSchedule[weekday] = normalizedPeriods;
        });
    }
    else {
        const weekday = requireHabitWeekday(data);
        const periods = Array.isArray(data.periods)
            ? [...new Set(data.periods
                    .filter((period) => typeof period === 'string')
                    .map((period) => period.trim())
                    .filter((period) => ['Manhã', 'Tarde', 'Noite'].includes(period)))].slice(0, 3)
            : [];
        if (periods.length > 0)
            normalizedSchedule[weekday] = periods;
    }
    if (Object.keys(normalizedSchedule).length === 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Selecione ao menos um dia e período.');
    }
    return normalizedSchedule;
}
function stringIds(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
// Mesmo critério usado por banUser e deleteMyAccount para decidir quais eventos
// de um usuário ainda merecem aviso/cancelamento: sem status (legado) ou 'active'.
// Eventos 'completed'/'awaiting_review'/'cancelled' ficam de fora (ver §10/§9).
function isEventStillActive(status) {
    return !status || status === 'active';
}
async function notifyCancelledEvents(events) {
    const deliveries = events.flatMap(({ eventId, event }) => {
        const creatorId = typeof event.createdBy === 'string' ? event.createdBy : '';
        const title = typeof event.title === 'string' && event.title ? event.title : 'sem título';
        return [...new Set(stringIds(event.attendees))]
            .filter((userId) => userId !== creatorId)
            .map((userId) => ({
            id: `event_cancelled_${eventId}_${userId}`,
            userId,
            type: 'event_cancelled',
            title: 'Evento cancelado',
            body: `O evento "${title}" foi cancelado pelo organizador.`,
            meetingId: eventId,
        }));
    });
    await deliverEventNotifications(deliveries);
    console.info('[MeetingNotification] cancellations_delivered', { eventCount: events.length, recipientCount: deliveries.length });
}
async function deleteEventChatMessages(eventId) {
    const messagesRef = db.collection('meetings').doc(eventId).collection('chatMessages');
    let deleted = 0;
    while (true) {
        const page = await messagesRef.limit(400).get();
        if (page.empty)
            break;
        const batch = db.batch();
        page.docs.forEach((message) => batch.delete(message.ref));
        await batch.commit();
        deleted += page.size;
        if (page.size < 400)
            break;
    }
    if (deleted > 0)
        console.info('[EventChat] messages_deleted', { eventId, deleted });
    const notificationsRef = db.collection('notifications');
    while (true) {
        const page = await notificationsRef.where('eventChatId', '==', eventId).limit(400).get();
        if (page.empty)
            break;
        const batch = db.batch();
        page.docs.forEach((notification) => batch.delete(notification.ref));
        await batch.commit();
        if (page.size < 400)
            break;
    }
    await db.collection('eventChatStates').doc(eventId).delete();
}
function eventChatNotificationId(eventId, userId) {
    return `event_chat_${eventId}_${userId}`;
}
async function eventChatPushMessages(delivery) {
    const messages = await pushMessagesForUser(delivery.userId, delivery.title, delivery.body, {
        path: `/event/chat/${delivery.eventChatId}`,
        eventChatId: delivery.eventChatId,
        notificationType: delivery.type,
        notificationId: eventChatNotificationId(delivery.eventChatId, delivery.userId),
        outboxId: delivery.id,
    }, {
        channel: 'messages',
        priority: 'high',
        preferenceField: 'notifyMessages',
        tag: `event_chat_${delivery.eventChatId}`,
        collapseKey: `event_chat_${delivery.eventChatId}`,
    });
    return messages.map((message) => (Object.assign(Object.assign({}, message), { expiresAtMs: delivery.expiresAtMs })));
}
// Um aviso pendente por participante/evento. A transação no estado privado do chat
// resolve mensagens simultâneas sem consultar cada notificação a cada mensagem.
exports.notifyEventChatMessage = functions.runWith({
    memory: '128MB', timeoutSeconds: 120, maxInstances: 5, failurePolicy: true,
}).firestore.document('meetings/{eventId}/chatMessages/{messageId}').onCreate(async (snapshot, context) => {
    const eventId = context.params.eventId;
    const senderId = snapshot.data().senderId;
    if (typeof senderId !== 'string')
        return;
    const eventRef = db.collection('meetings').doc(eventId);
    const stateRef = db.collection('eventChatStates').doc(eventId);
    const deliveries = [];
    while (true) {
        const created = await db.runTransaction(async (transaction) => {
            var _a, _b;
            const [eventSnapshot, stateSnapshot] = await Promise.all([transaction.get(eventRef), transaction.get(stateRef)]);
            if (!eventSnapshot.exists)
                return [];
            const event = eventSnapshot.data();
            const end = getEventEndDate(event);
            if (!isEventStillActive(event.status) || !end || end.getTime() <= Date.now())
                return [];
            const members = [...new Set([...stringIds(event.attendees), ...(typeof event.createdBy === 'string' ? [event.createdBy] : [])])];
            if (!members.includes(senderId))
                return [];
            const recipients = (0, eventChatNotifications_1.selectEventChatRecipients)(stringIds(event.attendees), typeof event.createdBy === 'string' ? event.createdBy : '', senderId, stringIds((_a = stateSnapshot.data()) === null || _a === void 0 ? void 0 : _a.mutedUserIds), stringIds((_b = stateSnapshot.data()) === null || _b === void 0 ? void 0 : _b.notifiedUserIds));
            if (recipients.length === 0)
                return [];
            const title = 'Novas mensagens no evento';
            const body = `Há novidades no chat de ${String(event.title || 'seu evento').slice(0, 80)}. Toque para abrir.`;
            const newDeliveries = recipients.map((userId) => ({
                id: `event_chat_push_${eventId}_${userId}_${snapshot.id}`,
                userId, type: 'event_chat', title, body, eventChatId: eventId,
                messageId: snapshot.id, expiresAtMs: end.getTime(),
            }));
            transaction.set(stateRef, { notifiedUserIds: admin.firestore.FieldValue.arrayUnion(...recipients) }, { merge: true });
            newDeliveries.forEach((delivery) => {
                transaction.set(db.collection('notifications').doc(eventChatNotificationId(eventId, delivery.userId)), {
                    userId: delivery.userId, type: delivery.type, title, body,
                    eventChatId: eventId, messageId: snapshot.id,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(), read: false,
                });
                transaction.set(db.collection('pushOutbox').doc(delivery.id), {
                    delivery, createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            });
            return newDeliveries;
        });
        deliveries.push(...created);
        if (created.length < 150)
            break;
    }
    const currentTime = Date.now();
    const expired = deliveries.filter((delivery) => delivery.expiresAtMs <= currentTime);
    if (expired.length > 0) {
        const batch = db.batch();
        expired.forEach((delivery) => batch.delete(db.collection('pushOutbox').doc(delivery.id)));
        await batch.commit();
    }
    const ready = deliveries.filter((delivery) => delivery.expiresAtMs > currentTime);
    if (ready.length === 0)
        return;
    const pushResults = await Promise.allSettled(ready.map(async (delivery) => ({
        delivery, messages: await eventChatPushMessages(delivery),
    })));
    const prepared = pushResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    if (prepared.length < ready.length) {
        console.error('[EventChat] push_preparation_failed', { eventId, failed: ready.length - prepared.length });
    }
    if (prepared.length > 0) {
        try {
            const messages = prepared.flatMap(({ messages: userMessages }) => userMessages);
            const summary = await (0, pushNotifications_1.sendPushMessages)(db, messages);
            await settlePushOutbox(prepared.map(({ delivery }) => delivery), messages, summary);
        }
        catch (_a) {
            console.error('[EventChat] push_delivery_failed', { eventId });
        }
    }
});
exports.setEventChatNotifications = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const enabled = (0, validation_1.isRecord)(data) ? data.enabled : undefined;
    const markRead = (0, validation_1.isRecord)(data) && data.markRead === true;
    if (enabled !== undefined && typeof enabled !== 'boolean') {
        throw new functions.https.HttpsError('invalid-argument', 'Preferência inválida.');
    }
    if (enabled === undefined && !markRead) {
        throw new functions.https.HttpsError('invalid-argument', 'Informe uma ação para o chat.');
    }
    const eventRef = db.collection('meetings').doc(eventId);
    const stateRef = db.collection('eventChatStates').doc(eventId);
    const notificationRef = db.collection('notifications').doc(eventChatNotificationId(eventId, uid));
    const currentEnabled = await db.runTransaction(async (transaction) => {
        var _a, _b, _c, _d, _e;
        const [eventSnapshot, stateSnapshot] = await Promise.all([transaction.get(eventRef), transaction.get(stateRef)]);
        if (!eventSnapshot.exists)
            throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnapshot.data();
        if (event.createdBy !== uid && !stringIds(event.attendees).includes(uid)) {
            throw new functions.https.HttpsError('permission-denied', 'Você não participa deste evento.');
        }
        if (enabled !== undefined && (!isEventStillActive(event.status)
            || ((_b = (_a = getEventEndDate(event)) === null || _a === void 0 ? void 0 : _a.getTime()) !== null && _b !== void 0 ? _b : 0) <= Date.now())) {
            throw new functions.https.HttpsError('failed-precondition', 'O chat deste evento terminou.');
        }
        const wasNotified = stringIds((_c = stateSnapshot.data()) === null || _c === void 0 ? void 0 : _c.notifiedUserIds).includes(uid);
        const wasMuted = stringIds((_d = stateSnapshot.data()) === null || _d === void 0 ? void 0 : _d.mutedUserIds).includes(uid);
        const notificationSnapshot = (markRead || enabled === false) && wasNotified
            ? await transaction.get(notificationRef) : null;
        const updates = {};
        if (enabled !== undefined && enabled === wasMuted)
            updates.mutedUserIds = enabled
                ? admin.firestore.FieldValue.arrayRemove(uid)
                : admin.firestore.FieldValue.arrayUnion(uid);
        if ((markRead || enabled === false) && wasNotified) {
            updates.notifiedUserIds = admin.firestore.FieldValue.arrayRemove(uid);
            if ((notificationSnapshot === null || notificationSnapshot === void 0 ? void 0 : notificationSnapshot.exists) && ((_e = notificationSnapshot.data()) === null || _e === void 0 ? void 0 : _e.read) !== true) {
                transaction.update(notificationRef, { read: true });
            }
        }
        if (Object.keys(updates).length > 0)
            transaction.set(stateRef, updates, { merge: true });
        return enabled === undefined ? !wasMuted : enabled;
    });
    return { enabled: currentEnabled };
});
// A gravação do evento e o envio podem ocorrer em processos diferentes. Este
// gatilho recupera avisos que faltaram após uma falha entre essas duas etapas.
exports.recoverEventNotifications = functions.runWith({
    memory: '128MB',
    timeoutSeconds: 120,
    failurePolicy: true,
}).firestore.document('meetings/{eventId}').onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const eventId = context.params.eventId;
    // O gatilho já acompanha todas as transições; nenhuma nova rotina periódica
    // precisa consultar o histórico de chats. Com retry ativo, falha de limpeza
    // repete este evento até todas as páginas de mensagens serem removidas.
    if ((before.status === 'active' || before.status === undefined)
        && ['awaiting_review', 'completed', 'cancelled'].includes(after.status)) {
        await deleteEventChatMessages(eventId);
    }
    const attendees = [...new Set(stringIds(after.attendees))].filter((userId) => userId !== after.createdBy);
    const eventTitle = typeof after.title === 'string' ? after.title : 'Evento';
    let deliveries = [];
    if (before.status !== 'cancelled' && after.status === 'cancelled') {
        deliveries = attendees.map((userId) => ({
            id: `event_cancelled_${eventId}_${userId}`, userId, type: 'event_cancelled',
            title: 'Evento cancelado', body: `O evento "${eventTitle}" foi cancelado pelo organizador.`, meetingId: eventId,
        }));
    }
    else if (before.status !== 'completed' && after.status === 'completed') {
        deliveries = [...new Set([...stringIds(after.attendees), ...stringIds(after.checkedIn),
                ...(typeof after.createdBy === 'string' ? [after.createdBy] : [])])].map((userId) => ({
            id: `event_completed_${eventId}_${userId}`, userId, type: 'event_completed',
            title: 'Evento encerrado', body: `O evento "${eventTitle}" foi encerrado. Confira seu histórico.`, meetingId: eventId,
        }));
    }
    else if (before.status !== 'awaiting_review' && after.status === 'awaiting_review') {
        const creatorId = typeof after.createdBy === 'string' ? after.createdBy : '';
        if (creatorId)
            deliveries = [{
                    id: `checkin_review_ready_${eventId}_${creatorId}`, userId: creatorId, type: 'checkin_review_ready',
                    title: 'Revise os check-ins do evento', body: `Há presenças de "${eventTitle}" aguardando sua validação.`, meetingId: eventId,
                }];
    }
    else if (isEventStillActive(after.status)) {
        const changes = [
            before.date !== after.date || before.time !== after.time || before.endDate !== after.endDate || before.endTime !== after.endTime ? 'data/horário' : null,
            before.locationName !== after.locationName ? 'local' : null,
            before.meetingLink !== after.meetingLink ? 'link' : null,
        ].filter(Boolean).join(', ');
        if (changes)
            deliveries = attendees.map((userId) => ({
                id: `event_updated_${eventId}_${userId}`, userId, type: 'event_updated',
                title: 'Evento atualizado', body: `"${eventTitle}" teve mudança de ${changes}. Confira os novos detalhes.`,
                meetingId: eventId, preferenceField: 'notifyEventUpdates', channel: 'events',
                revision: typeof after.notificationRevision === 'string' ? after.notificationRevision : undefined,
            }));
    }
    if (deliveries.length === 0)
        return;
    // A chamada que alterou o evento normalmente grava o aviso logo em seguida.
    // Dar um intervalo curto evita um segundo push quando os dois caminhos correm juntos.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const existing = [];
    for (let offset = 0; offset < deliveries.length; offset += 100) {
        existing.push(...await db.getAll(...deliveries.slice(offset, offset + 100)
            .map((delivery) => db.collection('notifications').doc(delivery.id))));
    }
    const missing = deliveries.filter((delivery, index) => {
        var _a;
        return !existing[index].exists
            || (delivery.revision && ((_a = existing[index].data()) === null || _a === void 0 ? void 0 : _a.revision) !== delivery.revision);
    });
    if (missing.length > 0)
        await deliverEventNotifications(missing);
});
function eventInviteCount(event, userId) {
    const counts = event.inviteCounts;
    if (!(0, validation_1.isRecord)(counts))
        return 0;
    const count = counts[userId];
    return typeof count === 'number' && Number.isFinite(count) ? count : 0;
}
function displayNameFor(profile) {
    return typeof (profile === null || profile === void 0 ? void 0 : profile.nick) === 'string'
        ? profile.nick
        : typeof (profile === null || profile === void 0 ? void 0 : profile.displayName) === 'string'
            ? profile.displayName
            : 'Usuário';
}
function getInviteTarget(data) {
    if (!(0, validation_1.isRecord)(data)) {
        throw new functions.https.HttpsError('invalid-argument', 'Destino do convite é obrigatório.');
    }
    const rawTargetUserId = typeof data.targetUserId === 'string' ? data.targetUserId.trim() : '';
    const targetUserId = rawTargetUserId ? (0, validation_1.requireDocumentIdValue)(rawTargetUserId, 'targetUserId', 128) : '';
    const targetNick = typeof data.targetNick === 'string' ? data.targetNick.trim().toLowerCase().replace(/\s+/g, '') : '';
    if (Boolean(targetUserId) === Boolean(targetNick)) {
        throw new functions.https.HttpsError('invalid-argument', 'Informe apenas um destino para o convite.');
    }
    return targetUserId ? { targetUserId } : { targetNick };
}
// Mutations that change attendance, reputation or event status run in trusted code.
// They read only the event and the requesting user's profile; no collection scan is used.
exports.reportEventLinkIssue = smallFunction.https.onCall(async (data, context) => {
    const reporterId = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const notificationRef = db.collection('notifications').doc(`event_link_issue_${eventId}_${reporterId}`);
    const result = await db.runTransaction(async (transaction) => {
        var _a;
        const [eventSnapshot, notificationSnapshot] = await Promise.all([
            transaction.get(eventRef),
            transaction.get(notificationRef),
        ]);
        if (!eventSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        }
        const event = eventSnapshot.data();
        const creatorId = typeof event.createdBy === 'string' ? event.createdBy : '';
        const meetingLink = typeof event.meetingLink === 'string' ? event.meetingLink : '';
        if (!creatorId || event.type !== 'online' || !meetingLink) {
            throw new functions.https.HttpsError('failed-precondition', 'Este evento não possui um link online para avisar.');
        }
        if (creatorId === reporterId) {
            throw new functions.https.HttpsError('failed-precondition', 'O criador já pode editar o link do próprio evento.');
        }
        if (event.status === 'cancelled' || event.status === 'completed') {
            throw new functions.https.HttpsError('failed-precondition', 'Este evento já foi encerrado.');
        }
        const previousLink = (_a = notificationSnapshot.data()) === null || _a === void 0 ? void 0 : _a.reportedLink;
        if (notificationSnapshot.exists && previousLink === meetingLink) {
            return { created: false, creatorId, eventTitle: '' };
        }
        const eventTitle = typeof event.title === 'string' && event.title.trim() ? event.title.trim() : 'seu evento';
        transaction.set(notificationRef, {
            userId: creatorId,
            type: 'event_link_issue',
            title: 'Possível problema no link',
            body: `Uma pessoa informou que o link de "${eventTitle}" pode não estar funcionando. Alguns links só abrem perto do horário; verifique quando possível.`,
            meetingId: eventId,
            reporterId,
            reportedLink: meetingLink,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            read: false,
        });
        return { created: true, creatorId, eventTitle };
    });
    if (!result.created)
        return { sent: false, alreadyReported: true };
    try {
        await sendPushNotification([result.creatorId], 'Possível problema no link', `Um participante pediu que você verifique o link de "${result.eventTitle}".`, { path: `/event/${eventId}`, meetingId: eventId, notificationType: 'event_link_issue' });
    }
    catch (_a) {
        // O aviso dentro do app já foi salvo; falha no push não invalida a ação do usuário.
        console.error('[EventLinkIssue] push_delivery_failed', { eventId });
    }
    console.info('[EventLinkIssue] creator_notified', { eventId });
    return { sent: true, alreadyReported: false };
});
exports.rsvpToEvent = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const userRef = db.collection('users').doc(uid);
    const result = await db.runTransaction(async (transaction) => {
        var _a, _b, _c;
        const [eventSnap, userSnap] = await Promise.all([transaction.get(eventRef), transaction.get(userRef)]);
        if (!eventSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnap.data();
        if (event.status && event.status !== 'active') {
            throw new functions.https.HttpsError('failed-precondition', 'Este evento não está disponível.');
        }
        const eventStart = getEventStartDate(event);
        if (!eventStart || new Date() >= eventStart) {
            throw new functions.https.HttpsError('failed-precondition', 'As confirmações de presença encerram no início do evento.');
        }
        if (event.createdBy === uid || stringIds(event.attendees).includes(uid)) {
            return { added: false, creatorId: '', eventTitle: '' };
        }
        if (!userSnap.exists || ((_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.banned) === true) {
            throw new functions.https.HttpsError('permission-denied', 'Sua conta não pode confirmar presença.');
        }
        const creatorId = typeof event.createdBy === 'string' ? event.createdBy : '';
        if (!creatorId)
            throw new functions.https.HttpsError('failed-precondition', 'Evento sem organizador válido.');
        const creatorSnap = await transaction.get(db.collection('users').doc(creatorId));
        if (!creatorSnap.exists || ((_b = creatorSnap.data()) === null || _b === void 0 ? void 0 : _b.banned) === true
            || isBlockedBy(userSnap.data(), creatorId) || isBlockedBy(creatorSnap.data(), uid)) {
            throw new functions.https.HttpsError('permission-denied', 'Não é possível participar deste evento.');
        }
        if ((((_c = userSnap.data()) === null || _c === void 0 ? void 0 : _c.reputation) || 0) <= -50) {
            throw new functions.https.HttpsError('permission-denied', 'Sua reputação não permite novas confirmações.');
        }
        transaction.update(eventRef, { attendees: admin.firestore.FieldValue.arrayUnion(uid) });
        return {
            added: true,
            creatorId,
            eventTitle: typeof event.title === 'string' ? event.title : 'seu evento',
        };
    });
    if (result.added && result.creatorId) {
        try {
            const attendeeSnap = await userRef.get();
            const attendeeName = displayNameFor(attendeeSnap.data());
            await db.collection('notifications').doc(`event_rsvp_${eventId}_${uid}`).set({
                userId: result.creatorId,
                type: 'event_rsvp',
                title: 'Nova presença confirmada',
                body: `${attendeeName} confirmou presença em "${result.eventTitle}".`,
                meetingId: eventId,
                fromUserId: uid,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                read: false,
            }, { merge: true });
            const push = await sendPushNotification([result.creatorId], 'Nova presença confirmada', `${attendeeName} confirmou presença em "${result.eventTitle}".`, { path: `/event/${eventId}`, meetingId: eventId, notificationType: 'event_rsvp' });
            console.info('[EventRsvp] organizer_notified', { deliveredToProvider: push.deliveredToProvider, rejected: push.rejected, missingToken: push.missingToken });
        }
        catch (_a) {
            console.error('[EventRsvp] organizer_notification_failed', { eventId });
        }
    }
    return { ok: true, added: result.added };
});
function favoriteSnapshotFor(event, eventId) {
    const eventTime = typeof event.time === 'string' ? event.time : '';
    const compatibleEnd = getEventEndDate(event);
    const compatibleEndTime = typeof event.endTime === 'string' && event.endTime
        ? event.endTime
        : compatibleEnd ? timeStringInSaoPaulo(compatibleEnd) : '';
    const compatibleEndDate = typeof event.endDate === 'string' && (0, validation_1.isValidCalendarDate)(event.endDate)
        ? event.endDate
        : compatibleEnd ? dateStringInSaoPaulo(compatibleEnd) : (typeof event.date === 'string' ? event.date : '');
    return {
        sourceEventId: eventId,
        isFavoriteSnapshot: true,
        title: typeof event.title === 'string' ? event.title : 'Evento',
        theme: typeof event.theme === 'string' ? event.theme : '',
        interests: Array.isArray(event.interests) ? event.interests.filter((interest) => typeof interest === 'string').slice(0, 10) : [],
        description: typeof event.description === 'string' ? event.description : '',
        locationName: typeof event.locationName === 'string' ? event.locationName : '',
        date: typeof event.date === 'string' ? event.date : '',
        time: eventTime,
        endDate: compatibleEndDate,
        endTime: compatibleEndTime,
        type: event.type === 'online' ? 'online' : 'in-person',
        meetingLink: typeof event.meetingLink === 'string' ? event.meetingLink : '',
        placeId: typeof event.placeId === 'string' ? event.placeId : '',
        lat: typeof event.lat === 'number' ? event.lat : null,
        lng: typeof event.lng === 'number' ? event.lng : null,
        createdBy: typeof event.createdBy === 'string' ? event.createdBy : '',
        creatorName: typeof event.creatorName === 'string' ? event.creatorName : 'Usuário',
        attendees: stringIds(event.attendees),
        checkedIn: stringIds(event.checkedIn),
        status: 'completed',
        favoritedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
}
function requireDateField(data, field) {
    const date = (0, validation_1.requireStringField)(data, field);
    if (!(0, validation_1.isValidCalendarDate)(date)) {
        throw new functions.https.HttpsError('invalid-argument', `${field} é inválida.`);
    }
    return date;
}
function requireClockField(data, field) {
    const time = (0, validation_1.requireStringField)(data, field);
    if (!(0, validation_1.isValidClockTime)(time)) {
        throw new functions.https.HttpsError('invalid-argument', `${field} é inválido.`);
    }
    return time;
}
/**
 * Interesses do evento: 1 a 10 strings não vazias, mesmo teto das
 * `firestore.rules` na criação (§9 — a regra vive nos dois lados de propósito,
 * porque o Admin SDK não passa pelas regras).
 */
function requireEventInterests(data) {
    const raw = (0, validation_1.isRecord)(data) ? data.interests : undefined;
    if (!Array.isArray(raw)) {
        throw new functions.https.HttpsError('invalid-argument', 'Selecione ao menos um interesse.');
    }
    const interests = [...new Set(raw.filter((value) => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean))];
    if (interests.length === 0 || interests.length > 10) {
        throw new functions.https.HttpsError('invalid-argument', 'Selecione de 1 a 10 interesses.');
    }
    return interests;
}
exports.toggleEventFavorite = smallFunction.https.onCall(async (data, context) => {
    var _a;
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const userRef = db.collection('users').doc(uid);
    const favoriteRef = userRef.collection('favoriteEvents').doc(eventId);
    // Eventos legados sem `status` e eventos cujo fechamento diário atrasou são
    // concluídos sob demanda. Isso permite favoritar um check-in pendente antigo
    // sem criar uma rotina frequente, mantendo a transação de conclusão idempotente.
    const eventBeforeToggle = await eventRef.get();
    if (eventBeforeToggle.exists) {
        const event = eventBeforeToggle.data();
        const eventEnd = getEventEndDate(event);
        const belongsToUser = event.createdBy === uid || stringIds(event.attendees).includes(uid);
        const shouldSettle = (0, eventLifecycle_1.canSettleExpiredEventForUser)(event.status, (_a = eventEnd === null || eventEnd === void 0 ? void 0 : eventEnd.getTime()) !== null && _a !== void 0 ? _a : null, Date.now(), eventEnd ? dateStringInSaoPaulo(eventEnd) : '', dateInSaoPaulo(), belongsToUser);
        if (shouldSettle) {
            const completion = await completeEventTransaction(eventRef);
            if (!completion.alreadyCompleted) {
                try {
                    await deliverHistorySettlementSummaries(historySettlementSummariesFor(completion), dateInSaoPaulo());
                }
                catch (_b) {
                    console.error('[FavoriteEvent] settlement_summary_failed');
                }
            }
        }
    }
    const result = await db.runTransaction(async (transaction) => {
        var _a, _b;
        const [eventSnap, userSnap, favoriteSnap] = await Promise.all([
            transaction.get(eventRef),
            transaction.get(userRef),
            transaction.get(favoriteRef),
        ]);
        if (!userSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Perfil não encontrado.');
        const currentFavorites = stringIds((_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.favorites);
        if (favoriteSnap.exists) {
            transaction.delete(favoriteRef);
            transaction.update(userRef, { favorites: currentFavorites.filter((favoriteId) => favoriteId !== eventId) });
            return { favorited: false };
        }
        if (!eventSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnap.data();
        const eventEnd = getEventEndDate(event);
        const canFavorite = (0, eventLifecycle_1.canFavoriteEndedEvent)(event.status, (_b = eventEnd === null || eventEnd === void 0 ? void 0 : eventEnd.getTime()) !== null && _b !== void 0 ? _b : null, Date.now(), stringIds(event.checkedIn).includes(uid));
        if (!canFavorite) {
            throw new functions.https.HttpsError('failed-precondition', 'Somente eventos encerrados com seu check-in confirmado podem ser favoritos.');
        }
        transaction.set(favoriteRef, favoriteSnapshotFor(event, eventId));
        transaction.update(userRef, { favorites: [...new Set([...currentFavorites, eventId])] });
        return { favorited: true };
    });
    console.info('[FavoriteEvent] toggled', { favorited: result.favorited });
    return Object.assign({ ok: true }, result);
});
exports.recreateFavoriteEvent = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const date = requireDateField(data, 'date');
    // APKs antigos não enviam requestId e continuam funcionando. Clientes novos
    // reutilizam a mesma chave quando repetem uma tentativa sem resposta.
    const requestId = (0, validation_1.optionalDocumentIdField)(data, 'requestId', 200)
        || db.collection('operationIds').doc().id;
    const userRef = db.collection('users').doc(uid);
    const favoriteRef = userRef.collection('favoriteEvents').doc(eventId);
    const repeatKey = (0, crypto_1.createHash)('sha256').update(`${uid}\u0000${requestId}`).digest('hex').slice(0, 40);
    const newEventRef = db.collection('meetings').doc(`repeat_${repeatKey}`);
    const result = await db.runTransaction(async (transaction) => {
        var _a, _b, _c;
        const [favoriteSnap, userSnap, existingEventSnap] = await Promise.all([
            transaction.get(favoriteRef),
            transaction.get(userRef),
            transaction.get(newEventRef),
        ]);
        if (!favoriteSnap.exists || !userSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Favorito ou perfil não encontrado.');
        if (((_b = (_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.reputation) !== null && _b !== void 0 ? _b : 0) <= -50)
            throw new functions.https.HttpsError('permission-denied', 'Sua reputação não permite criar novos eventos.');
        const favorite = favoriteSnap.data();
        if (favorite.createdBy !== uid)
            throw new functions.https.HttpsError('permission-denied', 'Apenas o criador original pode repetir este evento.');
        if (((_c = userSnap.data()) === null || _c === void 0 ? void 0 : _c.banned) === true)
            throw new functions.https.HttpsError('permission-denied', 'Sua conta não pode criar eventos.');
        if (favorite.type === 'online' && (typeof favorite.meetingLink !== 'string' || !/^https:\/\/.+/.test(favorite.meetingLink) || favorite.meetingLink.length > 500)) {
            throw new functions.https.HttpsError('failed-precondition', 'Este favorito não possui um link online válido para ser repetido.');
        }
        if (!Array.isArray(favorite.interests) || favorite.interests.length < 1 || favorite.interests.length > 10) {
            throw new functions.https.HttpsError('failed-precondition', 'Este favorito não possui interesses válidos para ser repetido.');
        }
        if (date <= dateInSaoPaulo())
            throw new functions.https.HttpsError('invalid-argument', 'Escolha uma data futura para repetir o evento.');
        if (typeof favorite.time !== 'string' || typeof favorite.endTime !== 'string')
            throw new functions.https.HttpsError('failed-precondition', 'Este favorito não possui horários suficientes para ser repetido.');
        const favoriteStart = getEventStartDate(favorite);
        const favoriteEnd = getEventEndDate(favorite);
        if (!favoriteStart || !favoriteEnd)
            throw new functions.https.HttpsError('failed-precondition', 'Este favorito não possui uma duração válida.');
        const durationMs = favoriteEnd.getTime() - favoriteStart.getTime();
        if (durationMs < 15 * 60 * 1000 || durationMs > 12 * 60 * 60 * 1000) {
            throw new functions.https.HttpsError('failed-precondition', 'Este favorito possui uma duração incompatível com as regras atuais.');
        }
        const newStart = new Date(`${date}T${favorite.time}:00-03:00`);
        const newEnd = new Date(newStart.getTime() + durationMs);
        if (Number.isNaN(newStart.getTime()) || newStart <= new Date()) {
            throw new functions.https.HttpsError('invalid-argument', 'Escolha uma data e horário futuros para repetir o evento.');
        }
        if (existingEventSnap.exists) {
            const existingEvent = existingEventSnap.data();
            if ((existingEvent === null || existingEvent === void 0 ? void 0 : existingEvent.createdBy) !== uid || existingEvent.repeatedFrom !== eventId || existingEvent.date !== date) {
                throw new functions.https.HttpsError('already-exists', 'Esta operação já foi usada para outro evento.');
            }
            return { alreadyCreated: true };
        }
        transaction.create(newEventRef, {
            title: favorite.title,
            theme: favorite.theme,
            interests: Array.isArray(favorite.interests) ? favorite.interests : [],
            description: favorite.description,
            locationName: favorite.locationName,
            date,
            time: favorite.time,
            endDate: dateStringInSaoPaulo(newEnd),
            endTime: favorite.endTime,
            startsAt: admin.firestore.Timestamp.fromDate(newStart),
            endsAt: admin.firestore.Timestamp.fromDate(newEnd),
            type: favorite.type === 'online' ? 'online' : 'in-person',
            meetingLink: favorite.type === 'online' ? favorite.meetingLink || '' : '',
            placeId: favorite.type === 'in-person' ? favorite.placeId || '' : '',
            lat: favorite.type === 'in-person' && typeof favorite.lat === 'number' ? favorite.lat : null,
            lng: favorite.type === 'in-person' && typeof favorite.lng === 'number' ? favorite.lng : null,
            createdBy: uid,
            creatorName: displayNameFor(userSnap.data()),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            attendees: [uid],
            suggestedInviteeIds: stringIds(favorite.checkedIn).filter((participantId) => participantId !== uid).slice(0, 50),
            status: 'active',
            isRepeated: false,
            seriesId: null,
            repeatedFrom: eventId,
        });
        return { alreadyCreated: false };
    });
    console.info('[FavoriteEvent] recreated', { alreadyCreated: result.alreadyCreated });
    return { ok: true, eventId: newEventRef.id, alreadyCreated: result.alreadyCreated };
});
exports.proposeFavoriteEventRepeat = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const favoriteRef = db.collection('users').doc(uid).collection('favoriteEvents').doc(eventId);
    const notificationRef = db.collection('notifications').doc(`repeat_proposal_${eventId}_${uid}`);
    const result = await db.runTransaction(async (transaction) => {
        const [favoriteSnap, notificationSnap] = await Promise.all([
            transaction.get(favoriteRef),
            transaction.get(notificationRef),
        ]);
        if (!favoriteSnap.exists)
            throw new functions.https.HttpsError('failed-precondition', 'Favorite este evento antes de propor uma nova edição.');
        const favorite = favoriteSnap.data();
        const creatorId = typeof favorite.createdBy === 'string' ? favorite.createdBy : '';
        if (!creatorId || creatorId === uid)
            throw new functions.https.HttpsError('failed-precondition', 'Você pode repetir diretamente um evento que criou.');
        if (notificationSnap.exists)
            return { alreadyProposed: true, creatorId: '' };
        transaction.create(notificationRef, {
            userId: creatorId,
            type: 'repeat_proposal',
            title: 'Pedido para repetir evento',
            body: `Uma pessoa que participou de "${typeof favorite.title === 'string' ? favorite.title : 'seu evento'}" gostaria de uma nova edição.`,
            path: '/(drawer)/(tabs)/agenda?tab=history',
            fromUserId: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            read: false,
        });
        return { alreadyProposed: false, creatorId };
    });
    if (!result.alreadyProposed) {
        try {
            await sendPushNotification([result.creatorId], 'Pedido para repetir evento', 'Uma pessoa pediu uma nova edição de um evento seu.', { path: '/(drawer)/(tabs)/agenda', notificationType: 'repeat_proposal' }, { priority: 'normal' });
        }
        catch (_a) {
            console.error('[FavoriteEvent] repeat_proposal_push_failed', { eventId });
        }
    }
    console.info('[FavoriteEvent] repeat_proposal_processed', { alreadyProposed: result.alreadyProposed });
    return { ok: true, alreadyProposed: result.alreadyProposed };
});
exports.leaveEvent = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const chatStateRef = db.collection('eventChatStates').doc(eventId);
    const chatNotificationRef = db.collection('notifications').doc(eventChatNotificationId(eventId, uid));
    const result = await db.runTransaction(async (transaction) => {
        var _a;
        const [eventSnap, attendeeSnap, chatStateSnap, chatNotificationSnap] = await Promise.all([
            transaction.get(eventRef),
            transaction.get(db.collection('users').doc(uid)),
            transaction.get(chatStateRef),
            transaction.get(chatNotificationRef),
        ]);
        if (!eventSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnap.data();
        if (event.createdBy === uid) {
            throw new functions.https.HttpsError('failed-precondition', 'O criador deve cancelar o evento em vez de sair.');
        }
        if (event.status && event.status !== 'active') {
            throw new functions.https.HttpsError('failed-precondition', 'Este evento não está mais ativo.');
        }
        const eventStart = getEventStartDate(event);
        if (!eventStart || new Date() >= eventStart || stringIds(event.checkedIn).includes(uid)) {
            throw new functions.https.HttpsError('failed-precondition', 'A presença só pode ser cancelada antes do início do evento.');
        }
        transaction.update(eventRef, {
            attendees: admin.firestore.FieldValue.arrayRemove(uid),
            checkedIn: admin.firestore.FieldValue.arrayRemove(uid),
            pendingCheckIns: pendingCheckIns(event.pendingCheckIns).filter((request) => request.userId !== uid),
        });
        if (chatStateSnap.exists && stringIds((_a = chatStateSnap.data()) === null || _a === void 0 ? void 0 : _a.notifiedUserIds).includes(uid)) {
            transaction.update(chatStateRef, { notifiedUserIds: admin.firestore.FieldValue.arrayRemove(uid) });
        }
        if (chatNotificationSnap.exists)
            transaction.delete(chatNotificationRef);
        return {
            creatorId: typeof event.createdBy === 'string' ? event.createdBy : '',
            eventTitle: typeof event.title === 'string' ? event.title : 'seu evento',
            attendeeName: displayNameFor(attendeeSnap.data()),
        };
    });
    if (result.creatorId) {
        try {
            await db.collection('notifications').doc(`event_leave_${eventId}_${uid}`).set({
                userId: result.creatorId,
                type: 'event_attendee_left',
                title: 'Participante cancelou presença',
                body: `${result.attendeeName} saiu de "${result.eventTitle}".`,
                meetingId: eventId,
                fromUserId: uid,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                read: false,
            }, { merge: true });
            await sendPushNotification([result.creatorId], 'Participante cancelou presença', `${result.attendeeName} saiu de "${result.eventTitle}".`, { path: `/event/${eventId}`, meetingId: eventId, notificationType: 'event_attendee_left' });
        }
        catch (_a) {
            console.error('[EventLeave] organizer_notification_failed', { eventId });
        }
    }
    return { ok: true };
});
exports.getEventInviteCandidates = smallFunction.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const [eventSnap, callerSnap, historySnap] = await Promise.all([
        db.collection('meetings').doc(eventId).get(),
        db.collection('users').doc(uid).get(),
        db.collection('meetings')
            .where('attendees', 'array-contains', uid)
            .orderBy('date', 'desc')
            .limit(25)
            .get(),
    ]);
    if (!eventSnap.exists)
        throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
    const event = eventSnap.data();
    if (!callerSnap.exists || ((_a = callerSnap.data()) === null || _a === void 0 ? void 0 : _a.banned) === true) {
        throw new functions.https.HttpsError('permission-denied', 'Sua conta não pode convidar pessoas.');
    }
    if (!stringIds(event.attendees).includes(uid)) {
        throw new functions.https.HttpsError('permission-denied', 'Confirme presença no evento para convidar pessoas.');
    }
    if (event.status && event.status !== 'active') {
        throw new functions.https.HttpsError('failed-precondition', 'Este evento não aceita convites.');
    }
    const currentAttendees = new Set(stringIds(event.attendees));
    const candidates = new Map();
    stringIds(event.suggestedInviteeIds).forEach((candidateId) => {
        if (candidateId !== uid && !currentAttendees.has(candidateId)) {
            candidates.set(candidateId, { priority: 100, sharedEventsCount: 0, previousParticipant: true });
        }
    });
    const now = new Date();
    for (const historyDocument of historySnap.docs) {
        if (historyDocument.id === eventId)
            continue;
        const historyEvent = historyDocument.data();
        const eventStart = getEventStartDate(historyEvent);
        if (!eventStart || eventStart >= now || historyEvent.status === 'cancelled')
            continue;
        const checkedIn = stringIds(historyEvent.checkedIn);
        if (!checkedIn.includes(uid))
            continue;
        checkedIn.forEach((candidateId) => {
            if (candidateId === uid || currentAttendees.has(candidateId))
                return;
            const current = candidates.get(candidateId) || { priority: 0, sharedEventsCount: 0, previousParticipant: false };
            candidates.set(candidateId, {
                priority: current.priority + 1,
                sharedEventsCount: current.sharedEventsCount + 1,
                previousParticipant: current.previousParticipant,
            });
        });
    }
    const rankedCandidateIds = [...candidates.entries()]
        .sort((first, second) => second[1].priority - first[1].priority)
        .map(([candidateId]) => candidateId);
    if (rankedCandidateIds.length === 0)
        return { candidates: [] };
    const callerProfile = callerSnap.data();
    const result = [];
    for (let offset = 0; offset < rankedCandidateIds.length && result.length < 12; offset += 100) {
        const candidateProfiles = await db.getAll(...rankedCandidateIds.slice(offset, offset + 100)
            .map((candidateId) => db.collection('users').doc(candidateId)));
        for (const candidateProfile of candidateProfiles) {
            if (!candidateProfile.exists || ((_b = candidateProfile.data()) === null || _b === void 0 ? void 0 : _b.banned) === true
                || isBlockedBy(callerProfile, candidateProfile.id) || isBlockedBy(candidateProfile.data(), uid))
                continue;
            const profile = candidateProfile.data();
            result.push({
                uid: candidateProfile.id,
                displayName: displayNameFor(profile),
                nick: typeof (profile === null || profile === void 0 ? void 0 : profile.nick) === 'string' ? profile.nick : undefined,
                photoURL: typeof (profile === null || profile === void 0 ? void 0 : profile.photoURL) === 'string' ? profile.photoURL : undefined,
                sharedEventsCount: ((_c = candidates.get(candidateProfile.id)) === null || _c === void 0 ? void 0 : _c.sharedEventsCount) || 0,
                previousParticipant: ((_d = candidates.get(candidateProfile.id)) === null || _d === void 0 ? void 0 : _d.previousParticipant) === true,
            });
            if (result.length === 12)
                break;
        }
    }
    console.info('[EventInvite] candidates_loaded', { count: result.length });
    return { candidates: result };
});
exports.inviteUserToEvent = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const target = getInviteTarget(data);
    let targetRef;
    if (target.targetUserId) {
        targetRef = db.collection('users').doc(target.targetUserId);
    }
    else {
        const matchingUsers = await db.collection('users').where('searchName', '==', target.targetNick).limit(2).get();
        if (matchingUsers.empty || matchingUsers.size > 1) {
            throw new functions.https.HttpsError('not-found', 'Usuário não encontrado.');
        }
        targetRef = matchingUsers.docs[0].ref;
    }
    const eventRef = db.collection('meetings').doc(eventId);
    const inviterRef = db.collection('users').doc(uid);
    const invitationRef = db.collection('eventInvitations').doc(`${eventId}_${targetRef.id}`);
    const notificationRef = db.collection('notifications').doc(`event_invitation_${eventId}_${targetRef.id}`);
    const result = await db.runTransaction(async (transaction) => {
        var _a, _b;
        const [eventSnap, inviterSnap, inviteeSnap, existingInvitation] = await Promise.all([
            transaction.get(eventRef),
            transaction.get(inviterRef),
            transaction.get(targetRef),
            transaction.get(invitationRef),
        ]);
        if (!eventSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        if (!inviterSnap.exists || ((_a = inviterSnap.data()) === null || _a === void 0 ? void 0 : _a.banned) === true) {
            throw new functions.https.HttpsError('permission-denied', 'Sua conta não pode enviar convites.');
        }
        if (!inviteeSnap.exists || ((_b = inviteeSnap.data()) === null || _b === void 0 ? void 0 : _b.banned) === true) {
            throw new functions.https.HttpsError('not-found', 'Usuário não encontrado.');
        }
        if (existingInvitation.exists)
            return { alreadyInvited: true, eventTitle: '' };
        const event = eventSnap.data();
        const eventStart = getEventStartDate(event);
        if ((event.status && event.status !== 'active') || !eventStart || eventStart <= new Date()) {
            throw new functions.https.HttpsError('failed-precondition', 'Este evento não aceita novos convites.');
        }
        if (!stringIds(event.attendees).includes(uid)) {
            throw new functions.https.HttpsError('permission-denied', 'Confirme presença no evento para convidar pessoas.');
        }
        if (targetRef.id === uid || stringIds(event.attendees).includes(targetRef.id)) {
            throw new functions.https.HttpsError('failed-precondition', 'Esta pessoa já participa do evento.');
        }
        if (eventInviteCount(event, uid) >= 10) {
            throw new functions.https.HttpsError('resource-exhausted', 'Você atingiu o limite de 10 convites para este evento.');
        }
        if (isBlockedBy(inviterSnap.data(), targetRef.id) || isBlockedBy(inviteeSnap.data(), uid)) {
            throw new functions.https.HttpsError('permission-denied', 'Não é possível enviar convite para esta pessoa.');
        }
        const inviterName = displayNameFor(inviterSnap.data());
        transaction.create(invitationRef, {
            eventId,
            inviterId: uid,
            inviteeId: targetRef.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        transaction.create(notificationRef, {
            userId: targetRef.id,
            type: 'event_invitation',
            title: 'Você recebeu um convite',
            body: `${inviterName} convidou você para "${event.title || 'um evento'}". Abra o evento e confirme presença se quiser participar.`,
            meetingId: eventId,
            fromUserId: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            read: false,
        });
        transaction.update(eventRef, {
            [`inviteCounts.${uid}`]: admin.firestore.FieldValue.increment(1),
        });
        return {
            alreadyInvited: false,
            eventTitle: typeof event.title === 'string' ? event.title : 'um evento',
        };
    });
    if (result.alreadyInvited) {
        console.info('[EventInvite] duplicate_ignored');
        return { ok: true, alreadyInvited: true };
    }
    let push = null;
    try {
        push = await sendPushNotification([targetRef.id], 'Você recebeu um convite', `Abra o Reunion Hub para ver o convite para "${result.eventTitle}".`, { path: `/event/${eventId}`, meetingId: eventId, notificationType: 'event_invitation' });
    }
    catch (_a) {
        console.error('[EventInvite] invitation_push_failed', { eventId });
    }
    console.info('[EventInvite] invitation_created', { deliveredToProvider: (push === null || push === void 0 ? void 0 : push.deliveredToProvider) || 0, rejected: (push === null || push === void 0 ? void 0 : push.rejected) || 0, missingToken: (push === null || push === void 0 ? void 0 : push.missingToken) || 0 });
    return { ok: true, alreadyInvited: false };
});
exports.getOrCreateConversation = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const targetUserId = (0, validation_1.requireDocumentIdField)(data, 'targetUserId', 128);
    if (targetUserId === uid) {
        throw new functions.https.HttpsError('invalid-argument', 'Não é possível iniciar uma conversa consigo mesmo.');
    }
    const conversationId = conversationIdFor(uid, targetUserId);
    const conversationRef = db.collection('conversations').doc(conversationId);
    const callerRef = db.collection('users').doc(uid);
    const targetRef = db.collection('users').doc(targetUserId);
    const result = await db.runTransaction(async (transaction) => {
        var _a, _b, _c;
        const [existing, callerSnap, targetSnap] = await Promise.all([
            transaction.get(conversationRef),
            transaction.get(callerRef),
            transaction.get(targetRef),
        ]);
        if (!callerSnap.exists || ((_a = callerSnap.data()) === null || _a === void 0 ? void 0 : _a.banned) === true) {
            throw new functions.https.HttpsError('permission-denied', 'Sua conta não pode iniciar conversas.');
        }
        if (!targetSnap.exists || ((_b = targetSnap.data()) === null || _b === void 0 ? void 0 : _b.banned) === true) {
            throw new functions.https.HttpsError('not-found', 'Usuário não encontrado.');
        }
        if (isBlockedBy(callerSnap.data(), targetUserId)) {
            throw new functions.https.HttpsError('permission-denied', 'Você bloqueou esta pessoa. Desbloqueie-a no seu perfil para conversar.');
        }
        if (isBlockedBy(targetSnap.data(), uid)) {
            throw new functions.https.HttpsError('permission-denied', 'Esta pessoa bloqueou você e não pode receber suas mensagens.');
        }
        const target = targetSnap.data();
        const participantName = (target === null || target === void 0 ? void 0 : target.nick) || (target === null || target === void 0 ? void 0 : target.displayName) || 'Usuário';
        const caller = callerSnap.data();
        const callerName = (caller === null || caller === void 0 ? void 0 : caller.nick) || (caller === null || caller === void 0 ? void 0 : caller.displayName) || 'Usuário';
        if (existing.exists) {
            const participants = stringIds((_c = existing.data()) === null || _c === void 0 ? void 0 : _c.participants);
            if (participants.length !== 2 || !participants.includes(uid) || !participants.includes(targetUserId)) {
                throw new functions.https.HttpsError('failed-precondition', 'Esta conversa pertence a outras pessoas.');
            }
            transaction.update(conversationRef, {
                deletedBy: admin.firestore.FieldValue.arrayRemove(uid),
                [`participantNames.${uid}`]: callerName,
                [`participantNames.${targetUserId}`]: participantName,
            });
            return { conversationId, participantName, created: false };
        }
        transaction.create(conversationRef, {
            participants: [uid, targetUserId].sort(),
            participantNames: {
                [uid]: (caller === null || caller === void 0 ? void 0 : caller.nick) || (caller === null || caller === void 0 ? void 0 : caller.displayName) || 'Usuário',
                [targetUserId]: (target === null || target === void 0 ? void 0 : target.nick) || (target === null || target === void 0 ? void 0 : target.displayName) || 'Usuário',
            },
            lastMessage: '',
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            unreadCounts: { [uid]: 0, [targetUserId]: 0 },
            deletedBy: [],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { conversationId, participantName, created: true };
    });
    console.info('[Conversation] get_or_create_completed', { created: result.created });
    return result;
});
exports.sendChatMessage = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const conversationId = (0, validation_1.requireDocumentIdField)(data, 'conversationId', 300);
    const text = (0, validation_1.requireStringField)(data, 'text');
    if (text.length > 2000) {
        throw new functions.https.HttpsError('invalid-argument', 'A mensagem é muito longa.');
    }
    const conversationRef = db.collection('conversations').doc(conversationId);
    const requestedMessageId = (0, validation_1.optionalDocumentIdField)(data, 'messageId', 200);
    const messageRef = requestedMessageId
        ? conversationRef.collection('messages').doc(requestedMessageId)
        : conversationRef.collection('messages').doc();
    const pushThrottleCutoff = Date.now() - (2 * 60 * 1000);
    const delivery = await db.runTransaction(async (transaction) => {
        var _a, _b, _c;
        const conversationSnap = await transaction.get(conversationRef);
        if (!conversationSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Conversa não encontrada.');
        const conversation = conversationSnap.data();
        const participants = stringIds(conversation.participants);
        if (participants.length !== 2 || !participants.includes(uid)) {
            throw new functions.https.HttpsError('permission-denied', 'Você não participa desta conversa.');
        }
        const otherUserId = participants.find((participantId) => participantId !== uid);
        if (!otherUserId)
            throw new functions.https.HttpsError('failed-precondition', 'Conversa sem destinatário válido.');
        const existingMessageSnap = await transaction.get(messageRef);
        if (existingMessageSnap.exists) {
            const existingMessage = existingMessageSnap.data();
            if (!existingMessage || existingMessage.senderId !== uid || existingMessage.text !== text) {
                throw new functions.https.HttpsError('already-exists', 'Este identificador já pertence a outra mensagem.');
            }
            return { senderName: '', recipientUserId: '', shouldPush: false, alreadySent: true };
        }
        const notificationRef = db.collection('notifications').doc(`chat_${conversationId}_${otherUserId}`);
        const [senderSnap, recipientSnap, notificationSnap] = await Promise.all([
            transaction.get(db.collection('users').doc(uid)),
            transaction.get(db.collection('users').doc(otherUserId)),
            transaction.get(notificationRef),
        ]);
        if (!senderSnap.exists || ((_a = senderSnap.data()) === null || _a === void 0 ? void 0 : _a.banned) === true) {
            throw new functions.https.HttpsError('failed-precondition', 'Seu perfil não está disponível para enviar mensagens.');
        }
        if (!recipientSnap.exists || ((_b = recipientSnap.data()) === null || _b === void 0 ? void 0 : _b.banned) === true) {
            throw new functions.https.HttpsError('failed-precondition', 'Este usuário não está mais disponível.');
        }
        if (isBlockedBy(senderSnap.data(), otherUserId)) {
            throw new functions.https.HttpsError('permission-denied', 'Você bloqueou esta pessoa. Desbloqueie-a no seu perfil para enviar mensagens.');
        }
        if (isBlockedBy(recipientSnap.data(), uid)) {
            throw new functions.https.HttpsError('permission-denied', 'Esta pessoa bloqueou você e não pode receber suas mensagens.');
        }
        transaction.create(messageRef, {
            text,
            senderId: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        transaction.update(conversationRef, {
            lastMessage: text,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            lastSenderId: uid,
            [`unreadCounts.${otherUserId}`]: admin.firestore.FieldValue.increment(1),
            deletedBy: admin.firestore.FieldValue.arrayRemove(uid, otherUserId),
        });
        const senderName = displayNameFor(senderSnap.data());
        const previousPushAt = notificationSnapshotTimestamp((_c = notificationSnap.data()) === null || _c === void 0 ? void 0 : _c.lastPushAt);
        const shouldPush = !previousPushAt || previousPushAt.getTime() <= pushThrottleCutoff;
        transaction.set(notificationRef, Object.assign({ userId: otherUserId, type: 'chat', title: `Nova mensagem de ${senderName}`, body: text, conversationId, fromUserId: uid, createdAt: admin.firestore.FieldValue.serverTimestamp(), read: false }, (shouldPush ? { lastPushAt: admin.firestore.FieldValue.serverTimestamp() } : {})), { merge: true });
        if (shouldPush) {
            const chatDelivery = {
                id: `chat_push_${conversationId}_${otherUserId}_${messageRef.id}`,
                userId: otherUserId,
                type: 'chat',
                title: `Nova mensagem de ${senderName}`,
                body: text,
                conversationId,
            };
            transaction.set(db.collection('pushOutbox').doc(chatDelivery.id), {
                delivery: chatDelivery,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        return {
            senderName,
            recipientUserId: otherUserId,
            shouldPush,
            alreadySent: false,
        };
    });
    let push = null;
    if (delivery.shouldPush && delivery.recipientUserId) {
        try {
            const chatDelivery = {
                id: `chat_push_${conversationId}_${delivery.recipientUserId}_${messageRef.id}`,
                userId: delivery.recipientUserId,
                type: 'chat',
                title: `Nova mensagem de ${delivery.senderName}`,
                body: text,
                conversationId,
            };
            const messages = await pushMessagesForUser(chatDelivery.userId, chatDelivery.title, chatDelivery.body, {
                path: `/conversation/${conversationId}`,
                conversationId,
                notificationType: 'chat',
                notificationId: `chat_${conversationId}_${chatDelivery.userId}`,
                outboxId: chatDelivery.id,
            }, {
                channel: 'messages',
                priority: 'high',
                preferenceField: 'notifyMessages',
                tag: `chat_${conversationId}`,
                collapseKey: `chat_${conversationId}`,
            });
            push = await (0, pushNotifications_1.sendPushMessages)(db, messages);
            await settlePushOutbox([chatDelivery], messages, push);
        }
        catch (_a) {
            console.error('[ChatMessage] push_delivery_failed', { conversationId });
        }
    }
    console.info('[ChatMessage] processed', {
        pushRequested: delivery.shouldPush,
        deliveredToProvider: (push === null || push === void 0 ? void 0 : push.deliveredToProvider) || 0,
        rejected: (push === null || push === void 0 ? void 0 : push.rejected) || 0,
        missingToken: (push === null || push === void 0 ? void 0 : push.missingToken) || 0,
        alreadySent: delivery.alreadySent,
    });
    return { ok: true, alreadySent: delivery.alreadySent, messageId: messageRef.id };
});
exports.savePlaceHabit = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    if (!data || typeof data !== 'object')
        throw new functions.https.HttpsError('invalid-argument', 'Dados do local são obrigatórios.');
    const payload = data;
    const placeId = (0, validation_1.requireDocumentIdField)(data, 'placeId', 200);
    const name = (0, validation_1.requireStringField)(data, 'name');
    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    const schedule = requireHabitSchedule(payload);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        throw new functions.https.HttpsError('invalid-argument', 'Coordenadas inválidas.');
    }
    if (placeId.length > 200 || name.length > 150) {
        throw new functions.https.HttpsError('invalid-argument', 'Identificação do local inválida.');
    }
    const vocations = Array.isArray(payload.vocations)
        ? payload.vocations.filter((vocation) => typeof vocation === 'string').slice(0, 10)
        : [];
    const placeRef = db.collection('places').doc(placeId);
    const userRef = db.collection('users').doc(uid);
    const privateHabitRef = userRef.collection('placeHabits').doc(placeId);
    await db.runTransaction(async (transaction) => {
        const [placeSnap, userSnap] = await Promise.all([
            transaction.get(placeRef),
            transaction.get(userRef),
        ]);
        if (!userSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Perfil não encontrado.');
        const discovererName = displayNameFor(userSnap.data());
        transaction.set(privateHabitRef, {
            placeId,
            name,
            latitude,
            longitude,
            vocations,
            schedule,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        if (!placeSnap.exists) {
            transaction.create(placeRef, {
                id: placeId,
                name,
                latitude,
                longitude,
                vocations,
                frequenters: [uid],
                habitSchedules: { [uid]: schedule },
                discovererId: uid,
                discovererName,
                discoveredAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return;
        }
        const place = placeSnap.data();
        const existingFrequenters = stringIds(place.frequenters);
        const existingDiscovererId = typeof place.discovererId === 'string' ? place.discovererId : '';
        const inferredDiscovererId = existingDiscovererId || existingFrequenters[0] || uid;
        const discovererFields = place.discoveredAt
            ? {}
            : Object.assign(Object.assign({ discovererId: inferredDiscovererId }, (inferredDiscovererId === uid ? { discovererName } : {})), { discoveredAt: admin.firestore.FieldValue.serverTimestamp() });
        transaction.update(placeRef, Object.assign({ frequenters: admin.firestore.FieldValue.arrayUnion(uid), [`habitSchedules.${uid}`]: schedule, [`habits.${uid}`]: admin.firestore.FieldValue.delete() }, discovererFields));
    });
    const periodsCount = Object.values(schedule).reduce((total, periods) => total + ((periods === null || periods === void 0 ? void 0 : periods.length) || 0), 0);
    console.info('[PlaceHabit] saved', { dayCount: Object.keys(schedule).length, periodsCount });
    return { ok: true };
});
exports.removePlaceHabit = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const placeId = (0, validation_1.requireDocumentIdField)(data, 'placeId', 200);
    const userRef = db.collection('users').doc(uid);
    const placeRef = db.collection('places').doc(placeId);
    const privateHabitRef = userRef.collection('placeHabits').doc(placeId);
    await db.runTransaction(async (transaction) => {
        const [placeSnap, privateHabitSnap] = await Promise.all([
            transaction.get(placeRef),
            transaction.get(privateHabitRef),
        ]);
        if (privateHabitSnap.exists)
            transaction.delete(privateHabitRef);
        if (placeSnap.exists) {
            transaction.update(placeRef, {
                frequenters: admin.firestore.FieldValue.arrayRemove(uid),
                [`habitSchedules.${uid}`]: admin.firestore.FieldValue.delete(),
                [`habits.${uid}`]: admin.firestore.FieldValue.delete(),
            });
        }
    });
    console.info('[PlaceHabit] removed');
    return { ok: true };
});
// Compatibilidade temporaria com APKs anteriores. As versoes atuais salvam esta
// preferencia junto do perfil; esta ponte faz somente uma escrita e nao percorre
// nem altera os locais frequentados. Remover apos os builds antigos serem retirados.
exports.setFrequentedPlacesPrivacy = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    if (!data || typeof data !== 'object' || typeof data.enabled !== 'boolean') {
        throw new functions.https.HttpsError('invalid-argument', 'A preferencia de privacidade e obrigatoria.');
    }
    const enabled = data.enabled;
    const userRef = db.collection('users').doc(uid);
    if (!(await userRef.get()).exists)
        throw new functions.https.HttpsError('not-found', 'Perfil não encontrado.');
    await userRef.update({ shareFrequentedPlaces: enabled });
    console.info('[ProfilePrivacy] compatibility_preference_updated');
    return { ok: true };
});
exports.checkInToEvent = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const userRef = db.collection('users').doc(uid);
    const result = await db.runTransaction(async (transaction) => {
        var _a;
        const [eventSnap, userSnap] = await Promise.all([transaction.get(eventRef), transaction.get(userRef)]);
        if (!eventSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        if (!userSnap.exists || ((_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.banned) === true) {
            throw new functions.https.HttpsError('permission-denied', 'Sua conta não pode registrar check-in.');
        }
        const event = eventSnap.data();
        if ((event.status && event.status !== 'active') || !stringIds(event.attendees).includes(uid) || !isCheckInWindowOpen(event, new Date())) {
            throw new functions.https.HttpsError('failed-precondition', 'O check-in só pode ser solicitado entre o início e o término do evento ativo.');
        }
        if (stringIds(event.checkedIn).includes(uid))
            return { requested: false, alreadyConfirmed: true, organizerConfirmed: event.createdBy === uid, creatorId: '', eventTitle: '', requesterName: '' };
        const requests = pendingCheckIns(event.pendingCheckIns);
        if (requests.some((request) => request.userId === uid))
            return { requested: false, alreadyConfirmed: false, organizerConfirmed: false, creatorId: '', eventTitle: '', requesterName: '' };
        const requesterName = displayNameFor(userSnap.data());
        const creatorId = typeof event.createdBy === 'string' ? event.createdBy : '';
        const now = admin.firestore.Timestamp.now();
        if (creatorId === uid) {
            transaction.update(eventRef, {
                checkedIn: admin.firestore.FieldValue.arrayUnion(uid),
            });
            transaction.set(db.collection('eventCheckInReviews').doc(`${eventId}_${uid}`), {
                eventId,
                userId: uid,
                displayName: requesterName,
                requestedAt: now,
                status: 'confirmed',
                reviewedAt: now,
                reviewedBy: uid,
            });
            transaction.update(userRef, {
                reputation: admin.firestore.FieldValue.increment(10),
                eventsAttended: admin.firestore.FieldValue.increment(1),
            });
            return { requested: false, alreadyConfirmed: false, organizerConfirmed: true, creatorId: '', eventTitle: '', requesterName };
        }
        if (!creatorId)
            throw new functions.https.HttpsError('failed-precondition', 'Este evento não possui um organizador válido.');
        transaction.update(eventRef, {
            pendingCheckIns: [...requests, { userId: uid, displayName: requesterName, requestedAt: now }],
        });
        return {
            requested: true,
            alreadyConfirmed: false,
            organizerConfirmed: false,
            creatorId,
            eventTitle: typeof event.title === 'string' ? event.title : 'este evento',
            requesterName,
        };
    });
    if (result.requested && result.creatorId) {
        try {
            await deliverEventNotifications([{
                    id: `checkin_review_${eventId}_${result.creatorId}`,
                    userId: result.creatorId,
                    type: 'checkin_request',
                    title: 'Check-in para revisar',
                    body: `${result.requesterName} registrou check-in em "${result.eventTitle}". Revise as presenças ao final do evento.`,
                    meetingId: eventId,
                }]);
        }
        catch (_a) {
            console.error('[CheckIn] request_notification_failed', { eventId });
        }
    }
    console.info('[CheckIn] request_processed', { requested: result.requested, alreadyConfirmed: result.alreadyConfirmed, organizerConfirmed: result.organizerConfirmed });
    return Object.assign({ ok: true }, result);
});
function requireCheckInDecisions(data) {
    if (!(0, validation_1.isRecord)(data) || !Array.isArray(data.decisions) || data.decisions.length > 100) {
        throw new functions.https.HttpsError('invalid-argument', 'A revisão de check-ins é inválida.');
    }
    const decisions = data.decisions.flatMap((decision) => {
        if (!(0, validation_1.isRecord)(decision) || (decision.status !== 'confirmed' && decision.status !== 'rejected'))
            return [];
        return [{
                userId: (0, validation_1.requireDocumentIdValue)(decision.userId, 'userId', 128),
                status: decision.status,
            }];
    });
    if (decisions.length !== data.decisions.length || new Set(decisions.map(({ userId }) => userId)).size !== decisions.length) {
        throw new functions.https.HttpsError('invalid-argument', 'Cada participante deve ter uma única decisão válida.');
    }
    return decisions;
}
function completedEventDeliveries(eventId, result) {
    const manuallyConfirmed = new Set(result.manuallyConfirmedUserIds);
    const autoConfirmed = new Set(result.autoConfirmedUserIds);
    const rejected = new Set(result.rejectedUserIds);
    const compactTitle = result.title.length > 42 ? `${result.title.slice(0, 39)}...` : result.title;
    const participantDeliveries = result.checkedInUserIds.map((userId) => {
        const receivedPoints = autoConfirmed.has(userId) || manuallyConfirmed.has(userId);
        if (!receivedPoints) {
            return {
                id: `event_completed_${eventId}_${userId}`,
                userId,
                type: 'event_completed',
                title: 'Evento encerrado',
                body: `O evento "${compactTitle}" foi encerrado. Obrigado por participar!`,
                meetingId: eventId,
            };
        }
        const approvedAutomatically = autoConfirmed.has(userId);
        return {
            id: `event_completed_${eventId}_${userId}`,
            userId,
            type: 'event_completed',
            title: 'Reputação +10',
            body: approvedAutomatically
                ? `Check-in aprovado em "${compactTitle}". Toque para entender.`
                : `Presença confirmada em "${compactTitle}". Toque para entender.`,
            detailTitle: 'Presença confirmada',
            detailBody: approvedAutomatically
                ? `Seu check-in em "${result.title}" foi aprovado automaticamente no encerramento porque não houve uma revisão válida do organizador. Sua reputação aumentou em 10 pontos.`
                : `O organizador confirmou sua presença em "${result.title}". Sua reputação aumentou em 10 pontos.`,
            reputationDelta: 10,
            meetingId: eventId,
        };
    });
    const penaltyDeliveries = result.penalizedUserIds.map((userId) => {
        const penalty = Math.abs(result.penalty);
        const wasRejected = rejected.has(userId);
        return {
            id: `event_completed_${eventId}_${userId}`,
            userId,
            type: 'event_completed',
            title: `Reputação -${penalty}`,
            body: wasRejected
                ? `Check-in não confirmado em "${compactTitle}". Toque para ver os detalhes.`
                : result.noCheckIns
                    ? 'Evento sem presença comprovada: -1 ponto. Toque para entender.'
                    : `Presença não confirmada em "${compactTitle}": -${penalty} pontos.`,
            detailTitle: wasRejected ? 'Check-in não confirmado' : 'Presença não confirmada',
            detailBody: wasRejected
                ? `O organizador informou que não conseguiu confirmar sua presença em "${result.title}". Por isso, sua reputação foi reduzida em ${penalty} pontos. Se essa revisão estiver incorreta, você pode denunciar o evento nesta tela.`
                : result.noCheckIns
                    ? `O evento "${result.title}" terminou sem nenhum check-in confirmado. Como não houve presença comprovada e ninguém foi diretamente prejudicado, foi aplicada a penalidade reduzida de 1 ponto a cada pessoa inscrita.`
                    : `Você estava inscrito em "${result.title}", mas não teve um check-in confirmado durante o período do evento. Por isso, sua reputação foi reduzida em ${penalty} pontos.`,
            reputationDelta: result.penalty,
            meetingId: eventId,
        };
    });
    return [...participantDeliveries, ...penaltyDeliveries];
}
async function notifyCompletedEvent(eventId, result) {
    await deliverEventNotifications(completedEventDeliveries(eventId, result));
    console.info('[MeetingNotification] completion_delivered', {
        participantCount: result.checkedInUserIds.length,
        penalizedCount: result.penalizedUserIds.length,
        noCheckIns: result.noCheckIns,
    });
}
function historySettlementSummariesFor(result) {
    const rewarded = new Set([...result.manuallyConfirmedUserIds, ...result.autoConfirmedUserIds]);
    const penalized = new Set(result.penalizedUserIds);
    return result.registeredUserIds.map((userId) => ({
        userId,
        eventCount: 1,
        reputationDelta: rewarded.has(userId) ? 10 : penalized.has(userId) ? result.penalty : 0,
    }));
}
function historySettlementBody(eventCount, reputationDelta) {
    const eventLabel = eventCount === 1 ? '1 evento antigo' : `${eventCount} eventos antigos`;
    if (reputationDelta > 0)
        return `Atualizamos ${eventLabel} do seu histórico. Saldo de reputação: +${reputationDelta} pontos.`;
    if (reputationDelta < 0)
        return `Atualizamos ${eventLabel} do seu histórico. Saldo de reputação: ${reputationDelta} pontos.`;
    return `Atualizamos ${eventLabel} do seu histórico sem recalcular sua reputação.`;
}
async function deliverHistorySettlementSummaries(summaries, dateKey) {
    if (summaries.length === 0)
        return;
    const totals = new Map();
    summaries.forEach((summary) => {
        var _a;
        const current = (_a = totals.get(summary.userId)) !== null && _a !== void 0 ? _a : { userId: summary.userId, eventCount: 0, reputationDelta: 0 };
        current.eventCount += summary.eventCount;
        current.reputationDelta += summary.reputationDelta;
        totals.set(summary.userId, current);
    });
    const userIds = [...totals.keys()];
    const notificationRefs = userIds.map((userId) => db.collection('notifications').doc(`history_settlement_${dateKey}_${userId}`));
    const [notificationSnapshots, profileSnapshots] = await Promise.all([
        db.getAll(...notificationRefs),
        db.getAll(...userIds.map((userId) => db.collection('users').doc(userId))),
    ]);
    const profilesById = new Map(profileSnapshots.map((profile) => [profile.id, profile]));
    const pushSummaries = [];
    const batch = db.batch();
    notificationSnapshots.forEach((snapshot, index) => {
        var _a, _b, _c;
        const userId = userIds[index];
        const profile = profilesById.get(userId);
        if (!(profile === null || profile === void 0 ? void 0 : profile.exists) || ((_a = profile.data()) === null || _a === void 0 ? void 0 : _a.banned) === true)
            return;
        const incoming = totals.get(userId);
        const previousCount = typeof ((_b = snapshot.data()) === null || _b === void 0 ? void 0 : _b.eventCount) === 'number' ? snapshot.data().eventCount : 0;
        const previousDelta = typeof ((_c = snapshot.data()) === null || _c === void 0 ? void 0 : _c.reputationDelta) === 'number' ? snapshot.data().reputationDelta : 0;
        const eventCount = previousCount + incoming.eventCount;
        const reputationDelta = previousDelta + incoming.reputationDelta;
        const notificationId = snapshot.id;
        batch.set(snapshot.ref, Object.assign(Object.assign({ userId, type: 'history_settlement_summary', title: 'Histórico atualizado', body: historySettlementBody(eventCount, reputationDelta), eventCount,
            reputationDelta, path: '/(drawer)/(tabs)/agenda?tab=history' }, (!snapshot.exists ? { createdAt: admin.firestore.FieldValue.serverTimestamp() } : {})), { updatedAt: admin.firestore.FieldValue.serverTimestamp(), read: false }), { merge: true });
        if (!snapshot.exists)
            pushSummaries.push(Object.assign(Object.assign({}, incoming), { notificationId }));
    });
    await batch.commit();
    const pushMessages = (await Promise.all(pushSummaries.map((summary) => pushMessagesForUser(summary.userId, 'Histórico atualizado', historySettlementBody(summary.eventCount, summary.reputationDelta), {
        path: '/(drawer)/(tabs)/agenda',
        notificationType: 'history_settlement_summary',
        notificationId: summary.notificationId,
    }, {
        channel: 'events',
        priority: 'normal',
        preferenceField: 'notifyEventUpdates',
        tag: 'history_settlement_summary',
        collapseKey: 'history_settlement_summary',
    })))).flat();
    await (0, pushNotifications_1.sendPushMessages)(db, pushMessages);
}
async function completeEventTransaction(eventRef, expectedCreatorId, decisions) {
    return db.runTransaction(async (transaction) => {
        var _a;
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnap.data();
        if (expectedCreatorId && event.createdBy !== expectedCreatorId)
            throw new functions.https.HttpsError('permission-denied', 'Apenas o criador pode encerrar este evento.');
        if (event.status === 'completed')
            return {
                noShows: 0,
                becameFounder: false,
                alreadyCompleted: true,
                noCheckIns: false,
                registeredUserIds: [],
                checkedInUserIds: [],
                penalizedUserIds: [],
                manuallyConfirmedUserIds: [],
                autoConfirmedUserIds: [],
                rejectedUserIds: [],
                penalty: 0,
                title: '',
                confirmedCheckIns: 0,
                rejectedCheckIns: 0,
                reputationApplied: false,
            };
        if (event.status === 'cancelled')
            throw new functions.https.HttpsError('failed-precondition', 'Um evento cancelado não pode ser encerrado.');
        const eventEnd = getEventEndDate(event);
        const now = new Date();
        if (!eventEnd || now < eventEnd)
            throw new functions.https.HttpsError('failed-precondition', 'O evento só pode ser encerrado após o horário de término.');
        const reviewDeadline = getCheckInReviewDeadline(event, eventEnd);
        const reputationApplied = (0, eventLifecycle_1.shouldApplyCompletionReputation)(eventEnd.getTime(), event.reputationProcessedAt instanceof admin.firestore.Timestamp);
        const creatorId = typeof event.createdBy === 'string' ? event.createdBy : '';
        const attendees = [...new Set(stringIds(event.attendees))];
        const previouslyCheckedIn = [...new Set(stringIds(event.checkedIn))];
        const creatorCheckedIn = Boolean(creatorId && previouslyCheckedIn.includes(creatorId));
        const pending = pendingCheckIns(event.pendingCheckIns)
            .filter((request) => attendees.includes(request.userId) && !previouslyCheckedIn.includes(request.userId));
        const pendingIds = new Set(pending.map(({ userId }) => userId));
        if (!expectedCreatorId && creatorCheckedIn && pending.length > 0 && now < reviewDeadline) {
            throw new functions.https.HttpsError('failed-precondition', 'A janela de revisão do organizador ainda está aberta.');
        }
        if (expectedCreatorId && creatorCheckedIn && pending.length > 0 && decisions === undefined) {
            throw new functions.https.HttpsError('failed-precondition', 'Revise todos os check-ins pendentes antes de encerrar o evento.');
        }
        let acceptedRequests = [];
        let rejectedRequests = [];
        let reviewStatus = 'auto_confirmed';
        let reviewedBy = null;
        if (decisions !== undefined) {
            if (!expectedCreatorId || expectedCreatorId !== creatorId || !creatorCheckedIn) {
                throw new functions.https.HttpsError('permission-denied', 'O organizador precisa fazer check-in para revisar presenças.');
            }
            if (!(0, eventLifecycle_1.canManuallyReviewCheckIns)(event.status, eventEnd.getTime(), reviewDeadline.getTime(), now.getTime())) {
                throw new functions.https.HttpsError('deadline-exceeded', 'O prazo de duas horas para revisar os check-ins terminou.');
            }
            const decisionIds = new Set(decisions.map(({ userId }) => userId));
            if (decisionIds.size !== pendingIds.size || [...pendingIds].some((userId) => !decisionIds.has(userId))) {
                throw new functions.https.HttpsError('failed-precondition', 'Revise todas as solicitações pendentes antes de concluir.');
            }
            const statusByUserId = new Map(decisions.map((decision) => [decision.userId, decision.status]));
            acceptedRequests = pending.filter(({ userId }) => statusByUserId.get(userId) === 'confirmed');
            rejectedRequests = pending.filter(({ userId }) => statusByUserId.get(userId) === 'rejected');
            reviewStatus = 'confirmed';
            reviewedBy = creatorId;
        }
        else {
            acceptedRequests = pending;
        }
        const newlyConfirmedUserIds = acceptedRequests.map(({ userId }) => userId);
        const checkedInUserIds = [...new Set([...previouslyCheckedIn, ...newlyConfirmedUserIds])];
        const checkedIn = new Set(checkedInUserIds);
        const noCheckIns = checkedInUserIds.length === 0;
        const allRegisteredUserIds = [...new Set([...attendees, ...(creatorId ? [creatorId] : [])])];
        const noShows = noCheckIns
            ? allRegisteredUserIds
            : allRegisteredUserIds.filter((attendeeId) => !checkedIn.has(attendeeId));
        const noShowPenalty = noCheckIns ? -1 : -20;
        const placeRef = typeof event.placeId === 'string' && event.placeId ? db.collection('places').doc(event.placeId) : null;
        const placeSnap = placeRef ? await transaction.get(placeRef) : null;
        const becameFounder = Boolean(creatorId && checkedIn.has(creatorId) && placeRef && (!(placeSnap === null || placeSnap === void 0 ? void 0 : placeSnap.exists) || !((_a = placeSnap.data()) === null || _a === void 0 ? void 0 : _a.founderId)));
        const reviewedAt = admin.firestore.Timestamp.now();
        const rejectedReviews = rejectedRequests.map((request) => (Object.assign(Object.assign({}, request), { status: 'rejected', reviewedAt,
            reviewedBy })));
        const newReviews = [
            ...acceptedRequests.map((request) => (Object.assign(Object.assign({}, request), { status: reviewStatus, reviewedAt, reviewedBy }))),
            ...rejectedReviews,
        ];
        transaction.update(eventRef, {
            status: 'completed',
            checkedIn: checkedInUserIds,
            pendingCheckIns: [],
            completedAt: reviewedAt,
            checkInReviewCompletedAt: reviewedAt,
            reputationProcessedAt: reviewedAt,
            reputationProcessingVersion: 2,
            reputationProcessingMode: reputationApplied ? 'applied' : 'legacy_preserved',
        });
        newReviews.forEach((review) => transaction.set(db.collection('eventCheckInReviews').doc(`${eventRef.id}_${review.userId}`), Object.assign({ eventId: eventRef.id }, review)));
        if (reputationApplied) {
            newlyConfirmedUserIds.forEach((userId) => transaction.update(db.collection('users').doc(userId), {
                reputation: admin.firestore.FieldValue.increment(10),
                eventsAttended: admin.firestore.FieldValue.increment(1),
            }));
            noShows.forEach((attendeeId) => transaction.update(db.collection('users').doc(attendeeId), { reputation: admin.firestore.FieldValue.increment(noShowPenalty) }));
        }
        if (reputationApplied && becameFounder && placeRef && creatorId) {
            const founderName = typeof event.creatorName === 'string' ? event.creatorName : 'Fundador';
            if (placeSnap === null || placeSnap === void 0 ? void 0 : placeSnap.exists) {
                transaction.update(placeRef, { founderId: creatorId, founderName });
            }
            else {
                transaction.create(placeRef, {
                    id: event.placeId,
                    name: typeof event.locationName === 'string' ? event.locationName : 'Local de encontro',
                    latitude: typeof event.lat === 'number' ? event.lat : null,
                    longitude: typeof event.lng === 'number' ? event.lng : null,
                    vocations: [],
                    frequenters: [],
                    habitSchedules: {},
                    discovererId: creatorId,
                    discovererName: founderName,
                    discoveredAt: admin.firestore.FieldValue.serverTimestamp(),
                    founderId: creatorId,
                    founderName,
                });
            }
            transaction.update(db.collection('users').doc(creatorId), { foundedPlacesCount: admin.firestore.FieldValue.increment(1) });
        }
        return {
            noShows: noShows.length,
            becameFounder: reputationApplied && becameFounder,
            alreadyCompleted: false,
            noCheckIns,
            registeredUserIds: allRegisteredUserIds,
            checkedInUserIds,
            penalizedUserIds: reputationApplied ? noShows : [],
            manuallyConfirmedUserIds: reputationApplied && reviewStatus === 'confirmed' ? newlyConfirmedUserIds : [],
            autoConfirmedUserIds: reputationApplied && reviewStatus === 'auto_confirmed' ? newlyConfirmedUserIds : [],
            rejectedUserIds: rejectedRequests.map(({ userId }) => userId),
            penalty: noShowPenalty,
            title: typeof event.title === 'string' ? event.title : 'este evento',
            confirmedCheckIns: acceptedRequests.length,
            rejectedCheckIns: rejectedRequests.length,
            reputationApplied,
        };
    });
}
// Completion is a single trusted transaction so status, penalties and pioneer data
// cannot be partially applied or race with another event at the same place.
exports.completeEvent = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const result = await completeEventTransaction(eventRef, uid);
    if (!result.alreadyCompleted) {
        try {
            await notifyCompletedEvent(eventId, result);
        }
        catch (_a) {
            console.error('[MeetingNotification] completion_delivery_failed', { eventId });
        }
    }
    return {
        noShows: result.noShows,
        becameFounder: result.becameFounder,
        alreadyCompleted: result.alreadyCompleted,
        noCheckIns: result.noCheckIns,
        confirmedCheckIns: result.confirmedCheckIns,
        rejectedCheckIns: result.rejectedCheckIns,
        callerReputationDelta: result.penalizedUserIds.includes(uid) ? result.penalty : 0,
    };
});
exports.reviewAndCompleteEvent = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const decisions = requireCheckInDecisions(data);
    const result = await completeEventTransaction(db.collection('meetings').doc(eventId), uid, decisions);
    if (!result.alreadyCompleted) {
        try {
            await notifyCompletedEvent(eventId, result);
        }
        catch (_a) {
            console.error('[MeetingNotification] reviewed_completion_delivery_failed', { eventId });
        }
    }
    console.info('[CheckInReview] event_completed', {
        confirmed: result.confirmedCheckIns,
        rejected: result.rejectedCheckIns,
        noShows: result.noShows,
    });
    return {
        noShows: result.noShows,
        becameFounder: result.becameFounder,
        alreadyCompleted: result.alreadyCompleted,
        noCheckIns: result.noCheckIns,
        confirmedCheckIns: result.confirmedCheckIns,
        rejectedCheckIns: result.rejectedCheckIns,
        callerReputationDelta: result.penalizedUserIds.includes(uid) ? result.penalty : 0,
    };
});
/**
 * Recupera, sob demanda, eventos do histórico que ficaram ativos por atraso do
 * fechamento diário ou por serem documentos legados sem o campo `status`.
 * A lista vem da Agenda do próprio usuário e é curta; cada evento ainda é
 * revalidado no servidor antes da transação idempotente de reputação.
 */
exports.settleMyExpiredEvents = smallFunction.https.onCall(async (data, context) => {
    var _a;
    const uid = requireAuthenticated(context);
    const eventIds = requireEventIds(data);
    const currentDate = dateInSaoPaulo();
    const nowMs = Date.now();
    let completed = 0;
    let alreadySettled = 0;
    let skipped = 0;
    let failed = 0;
    const settlementSummaries = [];
    for (const eventId of eventIds) {
        const eventRef = db.collection('meetings').doc(eventId);
        try {
            const snapshot = await eventRef.get();
            if (!snapshot.exists) {
                skipped += 1;
                continue;
            }
            const event = snapshot.data();
            if (event.status === 'completed') {
                alreadySettled += 1;
                continue;
            }
            const eventEnd = getEventEndDate(event);
            const belongsToUser = event.createdBy === uid || stringIds(event.attendees).includes(uid);
            if (!(0, eventLifecycle_1.canSettleExpiredEventForUser)(event.status, (_a = eventEnd === null || eventEnd === void 0 ? void 0 : eventEnd.getTime()) !== null && _a !== void 0 ? _a : null, nowMs, eventEnd ? dateStringInSaoPaulo(eventEnd) : '', currentDate, belongsToUser)) {
                skipped += 1;
                continue;
            }
            const result = await completeEventTransaction(eventRef);
            if (result.alreadyCompleted) {
                alreadySettled += 1;
                continue;
            }
            completed += 1;
            settlementSummaries.push(...historySettlementSummariesFor(result));
        }
        catch (_b) {
            failed += 1;
            console.error('[EventHistorySettlement] completion_failed');
        }
    }
    try {
        await deliverHistorySettlementSummaries(settlementSummaries, currentDate);
    }
    catch (_c) {
        console.error('[EventHistorySettlement] summary_delivery_failed', { recipientCount: settlementSummaries.length });
    }
    console.info('[EventHistorySettlement] batch_completed', {
        requested: eventIds.length,
        completed,
        alreadySettled,
        skipped,
        failed,
    });
    return { completed, alreadySettled, skipped, failed };
});
function dateInSaoPaulo(daysOffset = 0) {
    const target = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(target);
    const valueFor = (type) => { var _a; return (_a = parts.find((part) => part.type === type)) === null || _a === void 0 ? void 0 : _a.value; };
    return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
}
function dateStringInSaoPaulo(target) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(target);
    const valueFor = (type) => { var _a; return (_a = parts.find((part) => part.type === type)) === null || _a === void 0 ? void 0 : _a.value; };
    return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
}
function timeStringInSaoPaulo(target) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(target);
    const valueFor = (type) => { var _a; return (_a = parts.find((part) => part.type === type)) === null || _a === void 0 ? void 0 : _a.value; };
    return `${valueFor('hour')}:${valueFor('minute')}`;
}
async function cleanUpOldEventHistory() {
    const cutoffDate = dateInSaoPaulo(-90);
    const oldEvents = await db.collection('meetings')
        .where('status', 'in', ['completed', 'cancelled'])
        .where('date', '<', cutoffDate)
        .orderBy('date', 'asc')
        .limit(15)
        .get();
    if (oldEvents.empty)
        return 0;
    // Firestore não apaga subcoleções ao remover o documento pai. A limpeza
    // normal ocorre no encerramento; isto cobre qualquer evento legado/órfão.
    const readyToDelete = [];
    for (const eventDocument of oldEvents.docs) {
        try {
            await deleteEventChatMessages(eventDocument.id);
            readyToDelete.push(eventDocument);
        }
        catch (_a) {
            console.error('[EventHistoryCleanup] chat_cleanup_failed', { eventId: eventDocument.id });
        }
    }
    if (readyToDelete.length === 0)
        return 0;
    const eventIds = readyToDelete.map((eventDocument) => eventDocument.id);
    const relatedDocuments = [];
    for (let index = 0; index < eventIds.length; index += 10) {
        const eventIdChunk = eventIds.slice(index, index + 10);
        const [invitations, notifications, checkInReviewDocuments] = await Promise.all([
            db.collection('eventInvitations').where('eventId', 'in', eventIdChunk).get(),
            db.collection('notifications').where('meetingId', 'in', eventIdChunk).get(),
            db.collection('eventCheckInReviews').where('eventId', 'in', eventIdChunk).get(),
        ]);
        relatedDocuments.push(...invitations.docs, ...notifications.docs, ...checkInReviewDocuments.docs);
    }
    const documentsToDelete = [...readyToDelete, ...relatedDocuments];
    for (let index = 0; index < documentsToDelete.length; index += 400) {
        const batch = db.batch();
        documentsToDelete.slice(index, index + 400).forEach((document) => batch.delete(document.ref));
        await batch.commit();
    }
    return readyToDelete.length;
}
/**
 * Retenção do sino. 30 dias, não 90: a lista in-app é um mural do que está
 * acontecendo agora, não arquivo histórico — e o cliente já mostra só as 50 mais
 * recentes, então o que passa disso é peso morto no banco.
 *
 * Uma notificação continua não lida depois de 30 dias é abandonada na prática;
 * não separamos lida de não lida para não exigir índice composto novo.
 */
const NOTIFICATION_RETENTION_DAYS = 30;
/**
 * Teto por execução diária. O valor antigo era 50 num único lote: com o app
 * gerando mais de 50 notificações por dia, a limpeza nunca alcançava o acúmulo e
 * a coleção crescia para sempre. Drenar em rodadas resolve o atraso acumulado e,
 * uma vez em dia, o custo volta a ser 1 consulta vazia por dia.
 */
const NOTIFICATION_CLEANUP_DAILY_LIMIT = 1000;
const NOTIFICATION_CLEANUP_CHUNK = 250;
async function cleanUpOldNotifications() {
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let deleted = 0;
    while (deleted < NOTIFICATION_CLEANUP_DAILY_LIMIT) {
        const oldNotifications = await db.collection('notifications')
            .where('createdAt', '<', cutoff)
            .orderBy('createdAt', 'asc')
            .limit(Math.min(NOTIFICATION_CLEANUP_CHUNK, NOTIFICATION_CLEANUP_DAILY_LIMIT - deleted))
            .get();
        if (oldNotifications.empty)
            break;
        const batch = db.batch();
        oldNotifications.docs.forEach((notification) => batch.delete(notification.ref));
        await batch.commit();
        deleted += oldNotifications.size;
        // Lote incompleto = acabou o que havia para apagar antes do teto.
        if (oldNotifications.size < NOTIFICATION_CLEANUP_CHUNK)
            break;
    }
    return deleted;
}
const DAILY_RECOMMENDATION_EVENT_LIMIT = 30;
const DAILY_RECOMMENDATION_DEVICE_LIMIT = 200;
const DAILY_RECOMMENDATION_USER_LIMIT = 100;
const DAILY_RECOMMENDATION_WINDOW_DAYS = 7;
const RECOMMENDATION_LOCATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
function recommendationLocationFrom(settings) {
    const location = settings === null || settings === void 0 ? void 0 : settings.recommendationLocation;
    if (!(0, validation_1.isRecord)(location)
        || typeof location.latitude !== 'number'
        || typeof location.longitude !== 'number'
        || !Number.isFinite(location.latitude)
        || !Number.isFinite(location.longitude)
        || !(location.updatedAt instanceof admin.firestore.Timestamp)
        || Date.now() - location.updatedAt.toMillis() > RECOMMENDATION_LOCATION_MAX_AGE_MS)
        return null;
    return { latitude: location.latitude, longitude: location.longitude };
}
function recommendationEventFrom(eventDocument) {
    const event = eventDocument.data();
    const start = getEventStartDate(event);
    const end = getEventEndDate(event);
    const createdBy = typeof event.createdBy === 'string' ? event.createdBy : '';
    if (!start || !end || !createdBy)
        return null;
    const interests = Array.isArray(event.interests)
        ? event.interests.filter((interest) => typeof interest === 'string')
        : [];
    if (typeof event.theme === 'string')
        interests.push(event.theme);
    return {
        eventId: eventDocument.id,
        title: typeof event.title === 'string' && event.title.trim() ? event.title.trim() : 'Evento',
        type: event.type === 'online' ? 'online' : 'in-person',
        placeId: typeof event.placeId === 'string' ? event.placeId : undefined,
        interests,
        latitude: typeof event.lat === 'number' && Number.isFinite(event.lat) ? event.lat : null,
        longitude: typeof event.lng === 'number' && Number.isFinite(event.lng) ? event.lng : null,
        startsAtMs: start.getTime(),
        endsAtMs: end.getTime(),
        createdBy,
        attendees: stringIds(event.attendees),
        createdAtMs: event.createdAt instanceof admin.firestore.Timestamp ? event.createdAt.toMillis() : null,
    };
}
// Três execuções dão chance aos eventos publicados depois das 13h. A janela
// de sete dias deixa a pessoa se planejar; o cooldown de 72 horas usa o
// instante real de criação do aviso, não só a data no calendário.
exports.checkExpoPushReceipts = dailyFunction.pubsub
    .schedule('*/15 * * * *')
    .timeZone('America/Sao_Paulo')
    .onRun(async () => {
    const checked = await (0, pushNotifications_1.processExpoReceipts)(db);
    console.info('[PushNotification] receipts_checked', { checked });
    return null;
});
exports.retryPendingEventPushes = dailyFunction.pubsub
    .schedule('*/10 * * * *')
    .timeZone('America/Sao_Paulo')
    .onRun(async () => {
    var _a, _b, _c, _d, _e, _f;
    const pending = await db.collection('pushOutbox').orderBy('createdAt').limit(100).get();
    let retried = 0;
    for (const document of pending.docs) {
        const delivery = document.data().delivery;
        if (!(delivery === null || delivery === void 0 ? void 0 : delivery.userId) || ('conversationId' in delivery ? !delivery.conversationId
            : 'eventChatId' in delivery ? !delivery.eventChatId : !delivery.meetingId)) {
            await document.ref.delete();
            continue;
        }
        if ('expiresAtMs' in delivery && delivery.expiresAtMs && Date.now() >= delivery.expiresAtMs) {
            await document.ref.delete();
            continue;
        }
        const createdAt = document.data().createdAt;
        if (createdAt instanceof admin.firestore.Timestamp && Date.now() - createdAt.toMillis() > 24 * 60 * 60 * 1000) {
            await document.ref.delete();
            continue;
        }
        try {
            const isChat = 'conversationId' in delivery;
            const isEventChat = 'eventChatId' in delivery;
            if (isEventChat) {
                const [notification, event, state] = await Promise.all([
                    db.collection('notifications').doc(eventChatNotificationId(delivery.eventChatId, delivery.userId)).get(),
                    db.collection('meetings').doc(delivery.eventChatId).get(),
                    db.collection('eventChatStates').doc(delivery.eventChatId).get(),
                ]);
                const eventData = event.data();
                if (!notification.exists || ((_a = notification.data()) === null || _a === void 0 ? void 0 : _a.read) === true
                    || ((_b = notification.data()) === null || _b === void 0 ? void 0 : _b.messageId) !== delivery.messageId
                    || !eventData || !isEventStillActive(eventData.status)
                    || !stringIds((_c = state.data()) === null || _c === void 0 ? void 0 : _c.notifiedUserIds).includes(delivery.userId)
                    || stringIds((_d = state.data()) === null || _d === void 0 ? void 0 : _d.mutedUserIds).includes(delivery.userId)
                    || (eventData.createdBy !== delivery.userId && !stringIds(eventData.attendees).includes(delivery.userId))) {
                    await document.ref.delete();
                    continue;
                }
            }
            const allMessages = isEventChat ? await eventChatPushMessages(delivery) : await pushMessagesForUser(delivery.userId, delivery.title, delivery.body, isChat ? {
                path: `/conversation/${delivery.conversationId}`,
                conversationId: delivery.conversationId,
                notificationType: delivery.type,
                notificationId: `chat_${delivery.conversationId}_${delivery.userId}`,
                outboxId: delivery.id,
            } : {
                path: `/event/${delivery.meetingId}`,
                meetingId: delivery.meetingId,
                notificationType: delivery.type,
                notificationId: delivery.id,
            }, Object.assign({ channel: isChat ? 'messages' : (_e = delivery.channel) !== null && _e !== void 0 ? _e : 'events', priority: isChat || (delivery.type !== 'event_completed' && delivery.type !== 'daily_event_recommendation') ? 'high' : 'normal', preferenceField: isChat ? 'notifyMessages' : (_f = delivery.preferenceField) !== null && _f !== void 0 ? _f : 'notifyEventUpdates' }, (isChat ? { tag: `chat_${delivery.conversationId}`, collapseKey: `chat_${delivery.conversationId}` }
                : delivery.type === 'checkin_request' || delivery.type === 'checkin_review_ready' ? {
                    tag: `checkin_review_${delivery.meetingId}`,
                    collapseKey: `checkin_review_${delivery.meetingId}`,
                } : { tag: delivery.id, collapseKey: delivery.id })));
            const pendingPaths = document.data().registrationPaths;
            const messages = allMessages
                .filter((message) => !Array.isArray(pendingPaths) || pendingPaths.includes(message.registrationPath))
                .map((message) => (Object.assign(Object.assign({}, message), { expiresAtMs: 'expiresAtMs' in delivery ? delivery.expiresAtMs : undefined })));
            const summary = await (0, pushNotifications_1.sendPushMessages)(db, messages);
            await settlePushOutbox([delivery], messages, summary);
            retried += 1;
        }
        catch (_g) {
            console.error('[PushNotification] outbox_retry_failed', { notificationId: delivery.id });
        }
    }
    console.info('[PushNotification] outbox_retry_completed', { retried, pending: pending.size });
    return null;
});
exports.dailyEventRecommendations = recommendationFunction.pubsub
    .schedule('0 7,13,19 * * *')
    .timeZone('America/Sao_Paulo')
    .onRun(async () => {
    const today = dateInSaoPaulo();
    const firstDate = dateInSaoPaulo(-1);
    const finalDate = dateInSaoPaulo(DAILY_RECOMMENDATION_WINDOW_DAYS);
    const events = [];
    let lastEvent;
    while (true) {
        let eventQuery = db.collection('meetings')
            .where('status', '==', 'active')
            .where('date', '>=', firstDate)
            .where('date', '<=', finalDate)
            .orderBy('date', 'asc')
            .limit(DAILY_RECOMMENDATION_EVENT_LIMIT);
        if (lastEvent)
            eventQuery = eventQuery.startAfter(lastEvent);
        const page = await eventQuery.get();
        events.push(...page.docs.map(recommendationEventFrom)
            .filter((event) => event !== null));
        if (page.empty || page.size < DAILY_RECOMMENDATION_EVENT_LIMIT)
            break;
        lastEvent = page.docs[page.docs.length - 1];
    }
    const devicesByUser = new Map();
    let lastDevice;
    while (true) {
        let deviceQuery = db.collection('pushDevices')
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(DAILY_RECOMMENDATION_DEVICE_LIMIT);
        if (lastDevice)
            deviceQuery = deviceQuery.startAfter(lastDevice);
        const page = await deviceQuery.get();
        page.docs.forEach((device) => {
            var _a;
            const uid = device.data().userId;
            if (typeof uid !== 'string' || !uid)
                return;
            devicesByUser.set(uid, [...((_a = devicesByUser.get(uid)) !== null && _a !== void 0 ? _a : []), device]);
        });
        if (page.empty || page.size < DAILY_RECOMMENDATION_DEVICE_LIMIT)
            break;
        lastDevice = page.docs[page.docs.length - 1];
    }
    const nowMs = Date.now();
    const availableEvents = events.filter((event) => event.endsAtMs > nowMs);
    if (availableEvents.length === 0) {
        console.info('[DailyRecommendation] no_candidates', { eventCount: availableEvents.length });
        return null;
    }
    const creatorIds = [...new Set(availableEvents.map((event) => event.createdBy))];
    const creatorProfiles = new Map();
    for (let offset = 0; offset < creatorIds.length; offset += DAILY_RECOMMENDATION_USER_LIMIT) {
        const chunk = creatorIds.slice(offset, offset + DAILY_RECOMMENDATION_USER_LIMIT);
        const documents = await db.getAll(...chunk.map((uid) => db.collection('users').doc(uid)));
        documents.forEach((document) => {
            if (document.exists)
                creatorProfiles.set(document.id, document.data());
        });
    }
    const eligibleEvents = availableEvents.filter((event) => { var _a; return ((_a = creatorProfiles.get(event.createdBy)) === null || _a === void 0 ? void 0 : _a.banned) !== true; })
        .map((event) => {
        var _a;
        return (Object.assign(Object.assign({}, event), { blockedRecipientIds: stringIds((_a = creatorProfiles.get(event.createdBy)) === null || _a === void 0 ? void 0 : _a.blockedUsers) }));
    });
    // Um documento por local de evento, sem consultar o histórico de GPS nem
    // percorrer a subcoleção privada de cada usuário em cada execução.
    const placeIds = [...new Set(eligibleEvents
            .filter((event) => event.type === 'in-person' && event.placeId)
            .map((event) => event.placeId))];
    const frequentedPlacesByUser = new Map();
    for (let offset = 0; offset < placeIds.length; offset += 100) {
        const places = await db.getAll(...placeIds.slice(offset, offset + 100)
            .map((placeId) => db.collection('places').doc(placeId)));
        places.forEach((place) => {
            var _a, _b;
            if (!place.exists)
                return;
            const schedules = (_a = place.data()) === null || _a === void 0 ? void 0 : _a.habitSchedules;
            stringIds((_b = place.data()) === null || _b === void 0 ? void 0 : _b.frequenters).forEach((userId) => {
                var _a;
                const userPlaces = (_a = frequentedPlacesByUser.get(userId)) !== null && _a !== void 0 ? _a : {};
                userPlaces[place.id] = (0, validation_1.isRecord)(schedules) && (0, validation_1.isRecord)(schedules[userId])
                    ? schedules[userId] : {};
                frequentedPlacesByUser.set(userId, userPlaces);
            });
        });
    }
    let matched = 0;
    let created = 0;
    let recipientCount = 0;
    let lastProfile;
    while (true) {
        let profileQuery = db.collection('users').orderBy(admin.firestore.FieldPath.documentId())
            .limit(DAILY_RECOMMENDATION_USER_LIMIT);
        if (lastProfile)
            profileQuery = profileQuery.startAfter(lastProfile);
        const profilePage = await profileQuery.get();
        if (profilePage.empty)
            break;
        const profiles = profilePage.docs;
        recipientCount += profiles.length;
        lastProfile = profiles[profiles.length - 1];
        const settingsDocuments = await db.getAll(...profiles.map((profile) => db.collection('notificationSettings').doc(profile.id)));
        const settingsByUserId = new Map(settingsDocuments.map((settings) => [settings.id, settings.data()]));
        const deliveries = profiles.flatMap((profile) => {
            const profileData = profile.data();
            if (!profile.exists || !profileData || profileData.banned === true)
                return [];
            const settings = settingsByUserId.get(profile.id);
            if (!(0, recommendations_1.isNotificationPreferenceEnabled)(settings === null || settings === void 0 ? void 0 : settings.notifyRecommendations))
                return [];
            const user = {
                userId: profile.id,
                interests: Array.isArray(profileData.interests)
                    ? profileData.interests.filter((interest) => typeof interest === 'string')
                    : [],
                location: recommendationLocationFrom(settings),
                frequentedPlaces: frequentedPlacesByUser.get(profile.id),
                blockedUserIds: stringIds(profileData.blockedUsers),
            };
            const selectedEvent = (0, recommendations_1.selectDailyRecommendation)(eligibleEvents, user, nowMs);
            if (!selectedEvent)
                return [];
            const inProgress = selectedEvent.startsAtMs <= nowMs;
            const when = selectedEvent.startsAtMs - nowMs <= 24 * 60 * 60 * 1000 ? 'hoje ou amanhã' : 'nos próximos dias';
            return [{
                    id: `daily_recommendation_${today}_${profile.id}`,
                    userId: profile.id,
                    type: 'daily_event_recommendation',
                    title: inProgress ? 'Um evento do seu interesse está acontecendo' : `Evento do seu interesse ${when}`,
                    body: selectedEvent.type === 'online'
                        ? `"${selectedEvent.title}" é online e combina com seus interesses.`
                        : (0, recommendations_1.isFrequentedPlaceEvent)(selectedEvent, user)
                            ? `"${selectedEvent.title}" acontece ${when} em um lugar que você frequenta.`
                            : `"${selectedEvent.title}" acontece ${when} perto de você.`,
                    meetingId: selectedEvent.eventId,
                    expiresAtMs: selectedEvent.endsAtMs,
                    preferenceField: 'notifyRecommendations',
                    channel: 'recommendations',
                }];
        });
        matched += deliveries.length;
        if (deliveries.length === 0) {
            if (profiles.length < DAILY_RECOMMENDATION_USER_LIMIT)
                break;
            continue;
        }
        // O job roda sempre no mesmo horário. Consultar hoje e os dois dias
        // anteriores cria um cooldown de 72 horas sem outro documento de estado,
        // escrita adicional ou consulta aberta por usuário.
        const cooldownReferences = deliveries.flatMap((delivery) => (0, recommendations_1.recommendationCooldownNotificationIds)(today, delivery.userId)
            .map((notificationId) => db.collection('notifications').doc(notificationId)));
        const existingNotifications = [];
        for (let index = 0; index < cooldownReferences.length; index += 100) {
            existingNotifications.push(...await db.getAll(...cooldownReferences.slice(index, index + 100)));
        }
        const existingTimes = new Map();
        existingNotifications.forEach((notification) => {
            var _a, _b, _c;
            const userId = (_a = notification.data()) === null || _a === void 0 ? void 0 : _a.userId;
            const createdAt = (_b = notification.data()) === null || _b === void 0 ? void 0 : _b.createdAt;
            if (typeof userId !== 'string' || !(createdAt instanceof admin.firestore.Timestamp))
                return;
            existingTimes.set(userId, [...((_c = existingTimes.get(userId)) !== null && _c !== void 0 ? _c : []), createdAt.toMillis()]);
        });
        const newDeliveries = deliveries.filter((delivery) => { var _a; return (0, recommendations_1.canSendDailyRecommendation)(nowMs, (_a = existingTimes.get(delivery.userId)) !== null && _a !== void 0 ? _a : []); });
        if (newDeliveries.length > 0) {
            const notificationBatch = db.batch();
            newDeliveries.forEach((delivery) => notificationBatch.create(db.collection('notifications').doc(delivery.id), {
                userId: delivery.userId,
                type: delivery.type,
                title: delivery.title,
                body: delivery.body,
                meetingId: delivery.meetingId,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                read: false,
            }));
            newDeliveries.forEach((delivery) => notificationBatch.set(db.collection('pushOutbox').doc(delivery.id), {
                delivery: JSON.parse(JSON.stringify(delivery)),
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            }));
            await notificationBatch.commit();
            const deliveryByUserId = new Map(newDeliveries.map((delivery) => [delivery.userId, delivery]));
            const pushMessages = [...devicesByUser.values()].flat().flatMap((device) => {
                var _a;
                const deviceData = device.data();
                const userId = typeof deviceData.userId === 'string' ? deviceData.userId : '';
                const delivery = deliveryByUserId.get(userId);
                if (!delivery)
                    return [];
                return [{
                        userId,
                        registrationPath: device.ref.path,
                        expoToken: typeof deviceData.expoPushToken === 'string' ? deviceData.expoPushToken : undefined,
                        nativeToken: typeof deviceData.nativePushToken === 'string' ? deviceData.nativePushToken : undefined,
                        platform: typeof deviceData.platform === 'string' ? deviceData.platform : undefined,
                        title: delivery.title,
                        body: delivery.body,
                        data: {
                            path: `/event/${delivery.meetingId}`,
                            meetingId: delivery.meetingId,
                            notificationType: delivery.type,
                            notificationId: delivery.id,
                        },
                        channel: 'recommendations',
                        priority: 'normal',
                        expiresAtMs: (_a = eligibleEvents.find((event) => event.eventId === delivery.meetingId)) === null || _a === void 0 ? void 0 : _a.endsAtMs,
                        tag: 'daily_event_recommendation',
                        collapseKey: 'daily_event_recommendation',
                    }];
            });
            try {
                const summary = await (0, pushNotifications_1.sendPushMessages)(db, pushMessages);
                await settlePushOutbox(newDeliveries, pushMessages, summary);
            }
            catch (_a) {
                console.error('[DailyRecommendation] push_delivery_failed', { recipientCount: newDeliveries.length });
            }
            created += newDeliveries.length;
        }
        if (profiles.length < DAILY_RECOMMENDATION_USER_LIMIT)
            break;
    }
    console.info('[DailyRecommendation] completed', {
        eventCount: availableEvents.length,
        recipientCount,
        matched,
        created,
    });
    return null;
});
async function openCheckInReviewWindow(eventRef, now) {
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(eventRef);
        if (!snapshot.exists)
            return null;
        const event = snapshot.data();
        if (event.status !== 'active')
            return null;
        const eventEnd = getEventEndDate(event);
        const creatorId = typeof event.createdBy === 'string' ? event.createdBy : '';
        const creatorCheckedIn = creatorId !== '' && stringIds(event.checkedIn).includes(creatorId);
        const attendees = new Set(stringIds(event.attendees));
        const alreadyCheckedIn = new Set(stringIds(event.checkedIn));
        const pending = pendingCheckIns(event.pendingCheckIns)
            .filter((request) => attendees.has(request.userId) && !alreadyCheckedIn.has(request.userId));
        if (!eventEnd || eventEnd > now || !creatorCheckedIn || pending.length === 0)
            return null;
        const deadline = new Date(eventEnd.getTime() + eventLifecycle_1.CHECK_IN_REVIEW_WINDOW_MS);
        if (deadline <= now)
            return null;
        transaction.update(eventRef, {
            status: 'awaiting_review',
            checkInReviewStartedAt: admin.firestore.Timestamp.fromDate(now),
            checkInReviewDeadlineAt: admin.firestore.Timestamp.fromDate(deadline),
        });
        return {
            creatorId,
            eventTitle: typeof event.title === 'string' && event.title.trim() ? event.title.trim() : 'Evento',
            pendingCount: pending.length,
            deadline,
        };
    });
}
async function processCompletedEventForSchedule(eventId, eventRef, completionDeliveries, legacySettlementSummaries) {
    const result = await completeEventTransaction(eventRef);
    if (result.alreadyCompleted)
        return false;
    if (result.reputationApplied) {
        completionDeliveries.push(...completedEventDeliveries(eventId, result));
    }
    else {
        // Evento anterior à fronteira de migração (eventLifecycle.ts): sem
        // reputação recalculada, mas ainda avisa quem participou — mesmo
        // fallback que closeExpiredEventsDaily e settleMyExpiredEvents já usam.
        legacySettlementSummaries.push(...historySettlementSummariesFor(result));
    }
    return true;
}
// Uma única rotina curta, a cada cinco minutos, cobre dois momentos confiáveis:
// abre a revisão após o término e conclui automaticamente ao vencer as duas horas.
// As consultas são indexadas, limitadas e não percorrem o histórico do app.
exports.processEventCheckInReviews = dailyFunction.pubsub
    .schedule('every 5 minutes')
    .timeZone('America/Sao_Paulo')
    .onRun(async () => {
    const now = new Date();
    const nowTimestamp = admin.firestore.Timestamp.fromDate(now);
    const [endedActiveEvents, expiredReviewWindows] = await Promise.all([
        db.collection('meetings')
            .where('status', '==', 'active')
            .where('endsAt', '<=', nowTimestamp)
            .orderBy('endsAt', 'asc')
            .limit(50)
            .get(),
        db.collection('meetings')
            .where('status', '==', 'awaiting_review')
            .where('checkInReviewDeadlineAt', '<=', nowTimestamp)
            .orderBy('checkInReviewDeadlineAt', 'asc')
            .limit(50)
            .get(),
    ]);
    const reviewDeliveries = [];
    const completionDeliveries = [];
    const legacySettlementSummaries = [];
    let reviewsOpened = 0;
    let completed = 0;
    for (const eventDocument of endedActiveEvents.docs) {
        try {
            const reviewWindow = await openCheckInReviewWindow(eventDocument.ref, now);
            if (reviewWindow) {
                reviewsOpened += 1;
                const compactTitle = reviewWindow.eventTitle.length > 42
                    ? `${reviewWindow.eventTitle.slice(0, 39)}...`
                    : reviewWindow.eventTitle;
                reviewDeliveries.push({
                    id: `checkin_review_ready_${eventDocument.id}_${reviewWindow.creatorId}`,
                    userId: reviewWindow.creatorId,
                    type: 'checkin_review_ready',
                    title: 'Revise os check-ins do evento',
                    body: `${reviewWindow.pendingCount} presença(s) de "${compactTitle}" aguardam sua validação até ${timeStringInSaoPaulo(reviewWindow.deadline)}.`,
                    meetingId: eventDocument.id,
                });
                continue;
            }
            if (await processCompletedEventForSchedule(eventDocument.id, eventDocument.ref, completionDeliveries, legacySettlementSummaries)) {
                completed += 1;
            }
        }
        catch (error) {
            console.error('[CheckInReviewSchedule] active_event_failed', {
                eventId: eventDocument.id,
                code: error instanceof functions.https.HttpsError ? error.code : 'unknown',
            });
        }
    }
    for (const eventDocument of expiredReviewWindows.docs) {
        try {
            if (await processCompletedEventForSchedule(eventDocument.id, eventDocument.ref, completionDeliveries, legacySettlementSummaries)) {
                completed += 1;
            }
        }
        catch (error) {
            console.error('[CheckInReviewSchedule] expired_review_failed', {
                eventId: eventDocument.id,
                code: error instanceof functions.https.HttpsError ? error.code : 'unknown',
            });
        }
    }
    // Duas entregas independentes em try/catch separados: uma falhar não pode
    // impedir a outra de rodar (elas não dependem uma da outra).
    try {
        await deliverEventNotifications([...reviewDeliveries, ...completionDeliveries]);
    }
    catch (_a) {
        console.error('[CheckInReviewSchedule] notification_delivery_failed', {
            reviewCount: reviewDeliveries.length,
            completionCount: completionDeliveries.length,
        });
    }
    try {
        await deliverHistorySettlementSummaries(legacySettlementSummaries, dateInSaoPaulo());
    }
    catch (_b) {
        console.error('[CheckInReviewSchedule] legacy_settlement_delivery_failed', {
            legacySettlementCount: legacySettlementSummaries.length,
        });
    }
    console.info('[CheckInReviewSchedule] run_completed', {
        activeCandidates: endedActiveEvents.size,
        expiredCandidates: expiredReviewWindows.size,
        reviewsOpened,
        completed,
    });
    return null;
});
// Uma execução diária mantém o tratamento de eventos legados e a limpeza.
// Eventos modernos são processados pela rotina indexada de revisão acima.
exports.closeExpiredEventsDaily = dailyFunction.pubsub
    .schedule('10 0 * * *')
    .timeZone('America/Sao_Paulo')
    .onRun(async () => {
    const lastEligibleDate = dateInSaoPaulo();
    const activeCandidates = await db.collection('meetings')
        .where('status', '==', 'active')
        .where('date', '<=', lastEligibleDate)
        .orderBy('date', 'asc')
        .limit(50)
        .get();
    const now = new Date();
    const expiredEvents = activeCandidates.docs.filter((eventDocument) => {
        const end = getEventEndDate(eventDocument.data());
        return Boolean(end && end <= now);
    });
    let completed = 0;
    const completionDeliveries = [];
    const legacySettlementSummaries = [];
    for (const eventDocument of expiredEvents) {
        try {
            const result = await completeEventTransaction(eventDocument.ref);
            if (!result.alreadyCompleted) {
                completed += 1;
                if (result.reputationApplied) {
                    completionDeliveries.push(...completedEventDeliveries(eventDocument.id, result));
                }
                else {
                    legacySettlementSummaries.push(...historySettlementSummariesFor(result));
                }
            }
        }
        catch (_a) {
            console.error('[EventAutoClose] completion_failed', { eventId: eventDocument.id });
        }
    }
    // Duas entregas independentes em try/catch separados: uma falhar não pode
    // impedir a outra de rodar (elas não dependem uma da outra).
    try {
        await deliverEventNotifications(completionDeliveries);
    }
    catch (_b) {
        console.error('[EventAutoClose] notification_delivery_failed', { recipientCount: completionDeliveries.length });
    }
    try {
        await deliverHistorySettlementSummaries(legacySettlementSummaries, dateInSaoPaulo());
    }
    catch (_c) {
        console.error('[EventAutoClose] legacy_settlement_delivery_failed', { recipientCount: legacySettlementSummaries.length });
    }
    // O portão protege só a limpeza de histórico, que é cara: ela varre
    // eventos e cruza 3 coleções. A de notificações é uma consulta indexada
    // simples e não depende da carga de eventos — ficava refém do portão e,
    // justamente nos dias de maior volume (quando mais notificação é criada),
    // era a que mais precisava rodar e não rodava.
    const canRunMaintenance = activeCandidates.size < 50;
    const cleaned = canRunMaintenance ? await cleanUpOldEventHistory() : 0;
    const notificationsCleaned = await cleanUpOldNotifications();
    console.info('[EventAutoClose] daily_run_completed', {
        scanned: activeCandidates.size,
        expired: expiredEvents.length,
        completed,
        cleaned,
        notificationsCleaned,
    });
    return null;
});
exports.cancelEvent = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const userRef = db.collection('users').doc(uid);
    const result = await db.runTransaction(async (transaction) => {
        var _a;
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnap.data();
        if (event.createdBy !== uid)
            throw new functions.https.HttpsError('permission-denied', 'Apenas o criador pode cancelar.');
        if (event.status && event.status !== 'active')
            return { penalized: false, alreadyClosed: true, cancelledEvent: null };
        const eventEnd = getEventEndDate(event);
        if (!(0, eventLifecycle_1.canCancelEventAt)(event.status, (_a = eventEnd === null || eventEnd === void 0 ? void 0 : eventEnd.getTime()) !== null && _a !== void 0 ? _a : null, Date.now())) {
            throw new functions.https.HttpsError('failed-precondition', 'Eventos que já terminaram não podem ser cancelados.');
        }
        const hasOtherAttendees = stringIds(event.attendees).some((attendeeId) => attendeeId !== uid);
        transaction.update(eventRef, { status: 'cancelled' });
        if (hasOtherAttendees) {
            transaction.update(userRef, { reputation: admin.firestore.FieldValue.increment(-15) });
        }
        return { penalized: hasOtherAttendees, alreadyClosed: false, cancelledEvent: { eventId, event } };
    });
    if (result.cancelledEvent) {
        try {
            await notifyCancelledEvents([result.cancelledEvent]);
        }
        catch (_a) {
            console.error('[EventCancel] notification_failed', { eventId });
        }
    }
    console.info('[EventCancel] completed', { penalized: result.penalized, alreadyClosed: result.alreadyClosed });
    return { ok: true, penalized: result.penalized, alreadyClosed: result.alreadyClosed };
});
/**
 * Prazo em que o evento deixa de aceitar edição, medido a partir do horário de
 * início ATUALMENTE gravado. Existe para que ninguém confirme presença com base
 * numa informação e chegue ao local encontrando outra.
 */
const EVENT_EDIT_LOCK_MS = 24 * 60 * 60 * 1000;
const EVENT_MIN_LEAD_MS = 5 * 60 * 1000;
const EVENT_MIN_DURATION_MS = 15 * 60 * 1000;
const EVENT_MAX_DURATION_MS = 12 * 60 * 60 * 1000;
/**
 * Edição de evento pelo criador, até 24 h antes do início.
 *
 * Existe porque a única alternativa era cancelar e recriar — o que perdia todos
 * os confirmados E tirava 15 pontos de reputação de quem só errou um horário.
 *
 * NÃO são editáveis de propósito: o tipo (presencial ↔ online trocaria a
 * natureza do evento e deixaria `lat`/`lng` ou `meetingLink` órfãos), as
 * coordenadas no mapa, e a série de repetições. O nome do local é editável; mover
 * o pino exige o seletor de mapa e fica para depois.
 *
 * Passa por callable, e não por escrita direta, porque `meetings` tem
 * `allow update: if false` nas regras: o Admin SDK é quem pode escrever, e é aqui
 * que as validações de duração, prazo e autoria são garantidas.
 */
exports.editEvent = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const title = (0, validation_1.requireStringField)(data, 'title').trim();
    const description = (0, validation_1.requireStringField)(data, 'description').trim();
    const locationName = (0, validation_1.requireStringField)(data, 'locationName').trim();
    const date = requireDateField(data, 'date');
    const time = requireClockField(data, 'time');
    const endDate = requireDateField(data, 'endDate');
    const endTime = requireClockField(data, 'endTime');
    const interests = requireEventInterests(data);
    const meetingLinkInput = (0, validation_1.isRecord)(data) && typeof data.meetingLink === 'string' ? data.meetingLink.trim() : '';
    if (title.length < 3 || title.length > 100) {
        throw new functions.https.HttpsError('invalid-argument', 'O nome do evento deve ter de 3 a 100 caracteres.');
    }
    if (description.length < 1 || description.length > 2000) {
        throw new functions.https.HttpsError('invalid-argument', 'A descrição deve ter de 1 a 2000 caracteres.');
    }
    if (locationName.length < 1 || locationName.length > 150) {
        throw new functions.https.HttpsError('invalid-argument', 'O local deve ter de 1 a 150 caracteres.');
    }
    const nextStart = new Date(`${date}T${time}:00-03:00`);
    const nextEnd = new Date(`${endDate}T${endTime}:00-03:00`);
    if (Number.isNaN(nextStart.getTime()) || Number.isNaN(nextEnd.getTime())) {
        throw new functions.https.HttpsError('invalid-argument', 'Revise a data e os horários.');
    }
    const durationMs = nextEnd.getTime() - nextStart.getTime();
    if (durationMs < EVENT_MIN_DURATION_MS) {
        throw new functions.https.HttpsError('invalid-argument', 'O evento precisa durar pelo menos 15 minutos.');
    }
    if (durationMs > EVENT_MAX_DURATION_MS) {
        throw new functions.https.HttpsError('invalid-argument', 'Um evento pode durar no máximo 12 horas.');
    }
    if (nextStart.getTime() <= Date.now() + EVENT_MIN_LEAD_MS) {
        throw new functions.https.HttpsError('invalid-argument', 'Escolha um horário com pelo menos 5 minutos de antecedência.');
    }
    const eventRef = db.collection('meetings').doc(eventId);
    const notificationRevision = db.collection('notifications').doc().id;
    const result = await db.runTransaction(async (transaction) => {
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnap.data();
        if (event.createdBy !== uid) {
            throw new functions.https.HttpsError('permission-denied', 'Apenas o criador pode editar este evento.');
        }
        if (event.status && event.status !== 'active') {
            throw new functions.https.HttpsError('failed-precondition', 'Este evento já foi encerrado ou cancelado.');
        }
        const currentStart = getEventStartDate(event);
        if (!currentStart) {
            throw new functions.https.HttpsError('failed-precondition', 'Este evento não tem horário válido para edição.');
        }
        const msUntilStart = currentStart.getTime() - Date.now();
        if (msUntilStart < EVENT_EDIT_LOCK_MS) {
            throw new functions.https.HttpsError('failed-precondition', 'A edição fecha 24 horas antes do início, para ninguém ser pego de surpresa. Se precisar mudar algo agora, fale com os participantes ou cancele o evento.');
        }
        const isOnline = event.type === 'online';
        let meetingLink = typeof event.meetingLink === 'string' ? event.meetingLink : '';
        if (isOnline) {
            // Mesmo esquema minúsculo e sem espaço em branco que o cliente grava:
            // as regras comparam com `^https://` literal e o `matches()` do
            // Firestore casa a string inteira, então um `\n` colado reprovaria.
            meetingLink = meetingLinkInput.replace(/[\s​‌‍⁠﻿]+/g, '').replace(/^https:\/\//i, 'https://');
            if (!/^https:\/\/.+/.test(meetingLink) || meetingLink.length > 500) {
                throw new functions.https.HttpsError('invalid-argument', 'Informe um link HTTPS válido para a reunião online.');
            }
        }
        const scheduleChanged = event.date !== date
            || event.time !== time
            || event.endDate !== endDate
            || event.endTime !== endTime;
        const placeChanged = (typeof event.locationName === 'string' ? event.locationName : '') !== locationName;
        const linkChanged = isOnline && (typeof event.meetingLink === 'string' ? event.meetingLink : '') !== meetingLink;
        transaction.update(eventRef, Object.assign(Object.assign({ title,
            description,
            locationName,
            interests, theme: interests[0], date,
            time,
            endDate,
            endTime, startsAt: admin.firestore.Timestamp.fromDate(nextStart), endsAt: admin.firestore.Timestamp.fromDate(nextEnd) }, (isOnline ? { meetingLink } : {})), { updatedAt: admin.firestore.FieldValue.serverTimestamp(), notificationRevision }));
        return {
            title,
            scheduleChanged,
            placeChanged,
            linkChanged,
            notificationRevision,
            // O próprio criador não precisa de aviso do que ele acabou de fazer.
            attendees: stringIds(event.attendees).filter((attendeeId) => attendeeId !== uid),
        };
    });
    const mattersToAttendees = result.scheduleChanged || result.placeChanged || result.linkChanged;
    if (mattersToAttendees && result.attendees.length > 0) {
        const changes = [
            result.scheduleChanged ? 'data/horário' : null,
            result.placeChanged ? 'local' : null,
            result.linkChanged ? 'link' : null,
        ].filter(Boolean).join(', ');
        try {
            await deliverEventNotifications(result.attendees.map((attendeeId) => ({
                // Id determinístico: uma segunda edição substitui o aviso anterior
                // em vez de empilhar notificação para o mesmo evento.
                id: `event_updated_${eventId}_${attendeeId}`,
                userId: attendeeId,
                type: 'event_updated',
                title: 'Evento atualizado',
                body: `"${result.title}" teve mudança de ${changes}. Confira os novos detalhes.`,
                meetingId: eventId,
                revision: result.notificationRevision,
                preferenceField: 'notifyEventUpdates',
                channel: 'events',
            })));
        }
        catch (_a) {
            console.error('[EventEdit] notification_failed', { eventId });
        }
    }
    console.info('[EventEdit] completed', {
        scheduleChanged: result.scheduleChanged,
        placeChanged: result.placeChanged,
        linkChanged: result.linkChanged,
        notified: mattersToAttendees ? result.attendees.length : 0,
    });
    return { ok: true, scheduleChanged: result.scheduleChanged };
});
async function processQueryInBatches(query, apply) {
    const batchSize = 200;
    while (true) {
        const snapshot = await query.limit(batchSize).get();
        if (snapshot.empty)
            return;
        const batch = db.batch();
        snapshot.docs.forEach((document) => apply(batch, document));
        await batch.commit();
        if (snapshot.size < batchSize)
            return;
    }
}
exports.removeReportedEvent = smallFunction.https.onCall(async (data, context) => {
    await requireStaff(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const result = await db.runTransaction(async (transaction) => {
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists)
            return { removed: false, cancelledEvent: null };
        const event = eventSnap.data();
        // Só remove evento ainda ativo (mesma regra de banUser): um evento já
        // concluído já processou reputação e não deve ser reescrito, e um
        // evento em revisão de check-in ficaria órfão da rotina de 5 min, que
        // só varre status 'active'/'awaiting_review'.
        if (event.status && event.status !== 'active')
            return { removed: false, cancelledEvent: null };
        transaction.update(eventRef, { status: 'cancelled', moderationRemoved: true });
        return { removed: true, cancelledEvent: { eventId, event } };
    });
    if (result.cancelledEvent) {
        try {
            await notifyCancelledEvents([result.cancelledEvent]);
        }
        catch (_a) {
            console.error('[Moderation] reported_event_notification_failed', { eventId });
        }
        await notifyReportersOfModerationAction('event', eventId, 'A moderação analisou sua denúncia e removeu o evento informado.', `/event/${eventId}`).catch(() => console.error('[Moderation] reporter_resolution_failed', { targetType: 'event' }));
    }
    console.info('[Moderation] reported_event_removed', { removed: result.removed });
    return { ok: true, removed: result.removed };
});
// Faz tantas operações em cascata (cancela eventos, notifica participantes e
// denunciantes, revoga Auth, limpa 8+ coleções) quanto deleteMyAccount — por
// isso usa o mesmo runWith de timeout maior (accountFunction), não o padrão
// curto de smallFunction.
exports.banUser = accountFunction.https.onCall(async (data, context) => {
    var _a;
    const moderatorId = await requireStaff(context);
    const targetUserId = (0, validation_1.requireDocumentIdField)(data, 'targetUserId', 128);
    if (targetUserId === moderatorId) {
        throw new functions.https.HttpsError('failed-precondition', 'Você não pode banir sua própria conta.');
    }
    const targetUserRef = db.collection('users').doc(targetUserId);
    const targetProfile = await targetUserRef.get();
    if (!targetProfile.exists)
        throw new functions.https.HttpsError('not-found', 'Usuário não encontrado.');
    const targetRole = (_a = targetProfile.data()) === null || _a === void 0 ? void 0 : _a.role;
    if (targetRole === 'admin' || targetRole === 'moderator') {
        throw new functions.https.HttpsError('permission-denied', 'Contas da moderação não podem ser banidas por esta ferramenta.');
    }
    await Promise.all([
        admin.auth().updateUser(targetUserId, { disabled: true }),
        admin.auth().revokeRefreshTokens(targetUserId),
    ]);
    await targetUserRef.set({
        banned: true,
        bannedAt: admin.firestore.FieldValue.serverTimestamp(),
        bannedBy: moderatorId,
    }, { merge: true });
    // A conta continua marcada como banida para impedir nova sessão; as demais
    // relações do usuário saem do app por consultas limitadas e sob demanda.
    let cancelledEvents = 0;
    let createdEventsCursor;
    while (true) {
        let createdEventsQuery = db.collection('meetings').where('createdBy', '==', targetUserId)
            .orderBy(admin.firestore.FieldPath.documentId()).limit(200);
        if (createdEventsCursor)
            createdEventsQuery = createdEventsQuery.startAfter(createdEventsCursor);
        const createdEvents = await createdEventsQuery.get();
        if (createdEvents.empty)
            break;
        const eventsToCancel = createdEvents.docs.filter((eventDocument) => isEventStillActive(eventDocument.data().status));
        if (eventsToCancel.length > 0) {
            const batch = db.batch();
            eventsToCancel.forEach((eventDocument) => batch.update(eventDocument.ref, { status: 'cancelled', moderationRemoved: true }));
            await batch.commit();
            cancelledEvents += eventsToCancel.length;
            try {
                await notifyCancelledEvents(eventsToCancel.map((eventDocument) => ({ eventId: eventDocument.id, event: eventDocument.data() })));
            }
            catch (_b) {
                console.error('[Moderation] banned_event_notifications_failed', { eventCount: eventsToCancel.length });
            }
        }
        if (createdEvents.size < 200)
            break;
        createdEventsCursor = createdEvents.docs[createdEvents.docs.length - 1];
    }
    await processQueryInBatches(db.collection('meetings').where('attendees', 'array-contains', targetUserId), (batch, document) => batch.update(document.ref, {
        attendees: admin.firestore.FieldValue.arrayRemove(targetUserId),
        checkedIn: admin.firestore.FieldValue.arrayRemove(targetUserId),
        pendingCheckIns: pendingCheckIns(document.data().pendingCheckIns).filter((request) => request.userId !== targetUserId),
    }));
    // Preserva o contrato estrutural de dois participantes e o histórico da
    // outra pessoa; getOrCreateConversation/sendChatMessage barram conta banida.
    let conversationCursor;
    while (true) {
        let conversationQuery = db.collection('conversations')
            .where('participants', 'array-contains', targetUserId)
            .orderBy(admin.firestore.FieldPath.documentId()).limit(200);
        if (conversationCursor)
            conversationQuery = conversationQuery.startAfter(conversationCursor);
        const conversations = await conversationQuery.get();
        if (conversations.empty)
            break;
        const batch = db.batch();
        conversations.docs.forEach((document) => batch.update(document.ref, {
            deletedBy: admin.firestore.FieldValue.arrayUnion(targetUserId),
            [`participantNames.${targetUserId}`]: 'Usuário banido',
            [`unreadCounts.${targetUserId}`]: admin.firestore.FieldValue.delete(),
        }));
        await batch.commit();
        if (conversations.size < 200)
            break;
        conversationCursor = conversations.docs[conversations.docs.length - 1];
    }
    await processQueryInBatches(db.collectionGroup('messages').where('senderId', '==', targetUserId), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('eventInvitations').where('inviterId', '==', targetUserId), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('eventInvitations').where('inviteeId', '==', targetUserId), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('eventCheckInReviews').where('userId', '==', targetUserId), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('pushDevices').where('userId', '==', targetUserId), (batch, document) => batch.delete(document.ref));
    await db.collection('pushTokens').doc(targetUserId).delete().catch(() => undefined);
    await db.collection('notificationSettings').doc(targetUserId).delete().catch(() => undefined);
    await processQueryInBatches(targetUserRef.collection('favoriteEvents'), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(targetUserRef.collection('placeHabits'), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('places').where('frequenters', 'array-contains', targetUserId), (batch, document) => batch.update(document.ref, {
        frequenters: admin.firestore.FieldValue.arrayRemove(targetUserId),
        [`habits.${targetUserId}`]: admin.firestore.FieldValue.delete(),
        [`habitSchedules.${targetUserId}`]: admin.firestore.FieldValue.delete(),
    }));
    await processQueryInBatches(db.collection('users').where('blockedUsers', 'array-contains', targetUserId), (batch, document) => batch.update(document.ref, {
        blockedUsers: admin.firestore.FieldValue.arrayRemove(targetUserId),
    }));
    await admin.storage().bucket().deleteFiles({ prefix: `avatars/${targetUserId}_` }).catch(() => {
        console.warn('[Moderation] banned_avatar_cleanup_failed');
    });
    await notifyReportersOfModerationAction('user', targetUserId, 'A moderação analisou a denúncia e tomou uma medida sobre a conta informada.', '/notifications').catch(() => console.error('[Moderation] reporter_resolution_failed', { targetType: 'user' }));
    console.info('[Moderation] user_banned', { cancelledEvents });
    return { ok: true, cancelledEvents };
});
exports.deleteMyAccount = accountFunction.https.onCall(async (_data, context) => {
    var _a, _b;
    const uid = requireRecentAuthentication(context);
    const userRef = db.collection('users').doc(uid);
    const userSnapshot = await userRef.get();
    const searchName = typeof ((_a = userSnapshot.data()) === null || _a === void 0 ? void 0 : _a.searchName) === 'string'
        ? userSnapshot.data().searchName
        : null;
    console.info('[AccountDeletion] started');
    // Os eventos deste usuário serão apagados de vez (não só cancelados), então
    // o aviso aos participantes só pode ser enviado agora, com os dados ainda
    // disponíveis — mesmo texto/idempotência de notifyCancelledEvents (banUser
    // usa a mesma função quando cancela, em vez de apagar, os eventos do alvo).
    // Pagina em blocos de 200: a exclusão logo abaixo (processQueryInBatches) não
    // tem teto, então o aviso também não pode ter, senão quem criou mais de 200
    // eventos teria os excedentes apagados sem ninguém ser notificado.
    let createdEventsCursor;
    while (true) {
        let createdEventsQuery = db.collection('meetings').where('createdBy', '==', uid).orderBy('__name__').limit(200);
        if (createdEventsCursor)
            createdEventsQuery = createdEventsQuery.startAfter(createdEventsCursor);
        const createdEventsSnapshot = await createdEventsQuery.get();
        if (createdEventsSnapshot.empty)
            break;
        const eventsToNotify = createdEventsSnapshot.docs.filter((eventDocument) => isEventStillActive(eventDocument.data().status));
        if (eventsToNotify.length > 0) {
            try {
                await notifyCancelledEvents(eventsToNotify.map((eventDocument) => ({ eventId: eventDocument.id, event: eventDocument.data() })));
            }
            catch (_c) {
                console.error('[AccountDeletion] attendee_notification_failed', { eventCount: eventsToNotify.length });
            }
        }
        // Os documentos ligados ao evento deixam de ser alcançáveis pela rotina
        // de retenção depois que o evento é apagado. Limpá-los primeiro também
        // permite retomar a exclusão com segurança caso um lote falhe.
        for (let offset = 0; offset < createdEventsSnapshot.size; offset += 10) {
            const eventIds = createdEventsSnapshot.docs.slice(offset, offset + 10).map((event) => event.id);
            await processQueryInBatches(db.collection('eventInvitations').where('eventId', 'in', eventIds), (batch, document) => batch.delete(document.ref));
            await processQueryInBatches(db.collection('eventCheckInReviews').where('eventId', 'in', eventIds), (batch, document) => batch.delete(document.ref));
        }
        if (createdEventsSnapshot.size < 200)
            break;
        createdEventsCursor = createdEventsSnapshot.docs[createdEventsSnapshot.docs.length - 1];
    }
    // Cada atualização remove o documento do resultado da própria consulta. Isso evita
    // paginação frágil e mantém cada lote bem abaixo do limite de 500 operações.
    await processQueryInBatches(db.collection('meetings').where('createdBy', '==', uid), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('notifications').where('userId', '==', uid), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('pushDevices').where('userId', '==', uid), (batch, document) => batch.delete(document.ref));
    await db.collection('pushTokens').doc(uid).delete().catch(() => undefined);
    await db.collection('notificationSettings').doc(uid).delete().catch(() => undefined);
    await processQueryInBatches(db.collection('reports').where('reportedBy', '==', uid), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('eventInvitations').where('inviterId', '==', uid), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('eventInvitations').where('inviteeId', '==', uid), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('eventCheckInReviews').where('userId', '==', uid), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(userRef.collection('favoriteEvents'), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(userRef.collection('placeHabits'), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collectionGroup('messages').where('senderId', '==', uid), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('places').where('frequenters', 'array-contains', uid), (batch, document) => batch.update(document.ref, {
        frequenters: admin.firestore.FieldValue.arrayRemove(uid),
        [`habits.${uid}`]: admin.firestore.FieldValue.delete(),
        [`habitSchedules.${uid}`]: admin.firestore.FieldValue.delete()
    }));
    await processQueryInBatches(db.collection('meetings').where('attendees', 'array-contains', uid), (batch, document) => batch.update(document.ref, {
        attendees: admin.firestore.FieldValue.arrayRemove(uid),
        checkedIn: admin.firestore.FieldValue.arrayRemove(uid),
        pendingCheckIns: pendingCheckIns(document.data().pendingCheckIns).filter((request) => request.userId !== uid)
    }));
    // `participants` é parte do contrato do chat; sua preservação exige cursor,
    // pois atualizar os documentos não os retira do resultado da consulta.
    let conversationCursor;
    while (true) {
        let conversationQuery = db.collection('conversations')
            .where('participants', 'array-contains', uid)
            .orderBy(admin.firestore.FieldPath.documentId()).limit(200);
        if (conversationCursor)
            conversationQuery = conversationQuery.startAfter(conversationCursor);
        const conversations = await conversationQuery.get();
        if (conversations.empty)
            break;
        const batch = db.batch();
        conversations.docs.forEach((document) => batch.update(document.ref, {
            deletedBy: admin.firestore.FieldValue.arrayUnion(uid),
            [`participantNames.${uid}`]: 'Usuário excluído',
            [`unreadCounts.${uid}`]: admin.firestore.FieldValue.delete(),
        }));
        await batch.commit();
        if (conversations.size < 200)
            break;
        conversationCursor = conversations.docs[conversations.docs.length - 1];
    }
    if (searchName) {
        const nicknameRef = db.collection('nicknames').doc(searchName);
        const nicknameSnapshot = await nicknameRef.get();
        if (((_b = nicknameSnapshot.data()) === null || _b === void 0 ? void 0 : _b.uid) === uid)
            await nicknameRef.delete();
    }
    await userRef.delete();
    await admin.storage().bucket().deleteFiles({ prefix: `avatars/${uid}_` }).catch(() => {
        console.warn('[AccountDeletion] avatar_cleanup_failed');
    });
    await admin.auth().deleteUser(uid);
    console.info('[AccountDeletion] completed');
    return { ok: true };
});
//# sourceMappingURL=index.js.map