"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteMyAccount = exports.banUser = exports.removeReportedEvent = exports.cancelEvent = exports.closeExpiredEventsDaily = exports.completeEvent = exports.confirmEventCheckIn = exports.checkInToEvent = exports.setFrequentedPlacesPrivacy = exports.removePlaceHabit = exports.savePlaceHabit = exports.sendChatMessage = exports.getOrCreateConversation = exports.inviteUserToEvent = exports.getEventInviteCandidates = exports.leaveEvent = exports.proposeFavoriteEventRepeat = exports.recreateFavoriteEvent = exports.toggleEventFavorite = exports.rsvpToEvent = exports.reportEventLinkIssue = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const pushNotifications_1 = require("./pushNotifications");
const validation_1 = require("./validation");
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
async function sendExpoPushMessages(messages) {
    await (0, pushNotifications_1.sendExpoPushMessages)(db, messages);
}
async function sendExpoPushNotification(pushTokens, title, body, data = {}) {
    await (0, pushNotifications_1.sendExpoPushNotification)(db, pushTokens, title, body, data);
}
async function requireStaff(context) {
    var _a;
    const uid = requireAuthenticated(context);
    const profile = await db.collection('users').doc(uid).get();
    const role = (_a = profile.data()) === null || _a === void 0 ? void 0 : _a.role;
    if (role !== 'admin' && role !== 'moderator') {
        throw new functions.https.HttpsError('permission-denied', 'Apenas a moderacao pode executar esta acao.');
    }
    return uid;
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
    const validDeliveries = deliveries.filter(({ userId }) => recipientProfiles.has(userId));
    for (let index = 0; index < validDeliveries.length; index += 400) {
        const batch = db.batch();
        validDeliveries.slice(index, index + 400).forEach((delivery) => {
            batch.set(db.collection('notifications').doc(delivery.id), {
                userId: delivery.userId,
                type: delivery.type,
                title: delivery.title,
                body: delivery.body,
                meetingId: delivery.meetingId,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                read: false,
            }, { merge: true });
        });
        await batch.commit();
    }
    await sendExpoPushMessages(validDeliveries.flatMap((delivery) => {
        var _a;
        const token = (_a = recipientProfiles.get(delivery.userId)) === null || _a === void 0 ? void 0 : _a.expoPushToken;
        if (typeof token !== 'string')
            return [];
        return [{
                token,
                title: delivery.title,
                body: delivery.body,
                data: {
                    path: `/event/${delivery.meetingId}`,
                    meetingId: delivery.meetingId,
                    notificationType: delivery.type,
                },
            }];
    }));
}
function requireAuthenticated(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Faça login para continuar.');
    }
    return context.auth.uid;
}
function requireEventId(data) {
    return (0, validation_1.requireDocumentIdField)(data, 'eventId', 500);
}
function isBlockedBy(profile, userId) {
    const blockedUsers = profile === null || profile === void 0 ? void 0 : profile.blockedUsers;
    return Array.isArray(blockedUsers) && blockedUsers.includes(userId);
}
function conversationIdFor(firstUserId, secondUserId) {
    return [firstUserId, secondUserId].sort().join('_');
}
function getEventStartDate(event) {
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
    if (typeof event.date !== 'string' || typeof event.time !== 'string')
        return null;
    const endTime = typeof event.endTime === 'string' ? event.endTime : '';
    const end = endTime && (0, validation_1.isValidCalendarDate)(event.date) && (0, validation_1.isValidClockTime)(endTime)
        ? new Date(`${event.date}T${endTime}:00-03:00`)
        : null;
    if (end && !Number.isNaN(end.getTime()))
        return end;
    const start = getEventStartDate(event);
    return start ? new Date(start.getTime() + 3 * 60 * 60 * 1000) : null;
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
        return [{
                userId: item.userId,
                displayName: typeof item.displayName === 'string' && item.displayName ? item.displayName : 'Usuário',
            }];
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
                    .filter(Boolean))].slice(0, 3);
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
                    .filter(Boolean))].slice(0, 3)
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
    var _a;
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
            body: `Um participante informou que o link de "${eventTitle}" pode não estar funcionando. Alguns links só abrem perto do horário; verifique quando possível.`,
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
        const creatorSnapshot = await db.collection('users').doc(result.creatorId).get();
        const token = (_a = creatorSnapshot.data()) === null || _a === void 0 ? void 0 : _a.expoPushToken;
        if (typeof token === 'string') {
            await sendExpoPushNotification([token], 'Possível problema no link', `Um participante pediu que você verifique o link de "${result.eventTitle}".`, { path: `/event/${eventId}`, meetingId: eventId, notificationType: 'event_link_issue' });
        }
    }
    catch (_b) {
        // O aviso dentro do app já foi salvo; falha no push não invalida a ação do usuário.
        console.error('[EventLinkIssue] push_delivery_failed', { eventId });
    }
    console.info('[EventLinkIssue] creator_notified', { eventId });
    return { sent: true, alreadyReported: false };
});
exports.rsvpToEvent = smallFunction.https.onCall(async (data, context) => {
    var _a;
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const userRef = db.collection('users').doc(uid);
    const result = await db.runTransaction(async (transaction) => {
        var _a;
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
        if ((((_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.reputation) || 0) <= -50) {
            throw new functions.https.HttpsError('permission-denied', 'Sua reputação não permite novas confirmações.');
        }
        transaction.update(eventRef, { attendees: admin.firestore.FieldValue.arrayUnion(uid) });
        return {
            added: true,
            creatorId: typeof event.createdBy === 'string' ? event.createdBy : '',
            eventTitle: typeof event.title === 'string' ? event.title : 'seu evento',
        };
    });
    if (result.added && result.creatorId) {
        try {
            const [creatorSnap, attendeeSnap] = await Promise.all([
                db.collection('users').doc(result.creatorId).get(),
                userRef.get(),
            ]);
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
            const token = (_a = creatorSnap.data()) === null || _a === void 0 ? void 0 : _a.expoPushToken;
            if (typeof token === 'string') {
                await sendExpoPushNotification([token], 'Nova presença confirmada', `${attendeeName} confirmou presença em "${result.eventTitle}".`, { path: `/event/${eventId}`, meetingId: eventId, notificationType: 'event_rsvp' });
            }
            console.info('[EventRsvp] organizer_notified');
        }
        catch (_b) {
            console.error('[EventRsvp] organizer_notification_failed', { eventId });
        }
    }
    return { ok: true, added: result.added };
});
function favoriteSnapshotFor(event, eventId) {
    const eventTime = typeof event.time === 'string' ? event.time : '';
    const legacyTimeMatch = /^(\d{2}):(\d{2})$/.exec(eventTime);
    const legacyStartMinutes = legacyTimeMatch
        ? Number(legacyTimeMatch[1]) * 60 + Number(legacyTimeMatch[2])
        : Number.NaN;
    const legacyEndMinutes = Number.isFinite(legacyStartMinutes) && legacyStartMinutes < (23 * 60 + 59)
        ? Math.min(legacyStartMinutes + 180, 23 * 60 + 59)
        : Number.NaN;
    const compatibleEndTime = typeof event.endTime === 'string' && event.endTime
        ? event.endTime
        : Number.isFinite(legacyEndMinutes)
            ? `${String(Math.floor(legacyEndMinutes / 60)).padStart(2, '0')}:${String(legacyEndMinutes % 60).padStart(2, '0')}`
            : '';
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
exports.toggleEventFavorite = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const userRef = db.collection('users').doc(uid);
    const favoriteRef = userRef.collection('favoriteEvents').doc(eventId);
    const result = await db.runTransaction(async (transaction) => {
        var _a;
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
        if (event.status !== 'completed' || !stringIds(event.checkedIn).includes(uid)) {
            throw new functions.https.HttpsError('failed-precondition', 'Somente eventos concluídos com seu check-in confirmado podem ser favoritadas.');
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
        var _a, _b;
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
        if (date <= dateInSaoPaulo())
            throw new functions.https.HttpsError('invalid-argument', 'Escolha uma data futura para repetir o evento.');
        if (typeof favorite.time !== 'string' || typeof favorite.endTime !== 'string')
            throw new functions.https.HttpsError('failed-precondition', 'Este favorito não possui horários suficientes para ser repetido.');
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
            endTime: favorite.endTime,
            type: favorite.type === 'online' ? 'online' : 'in-person',
            meetingLink: favorite.type === 'online' ? favorite.meetingLink || '' : '',
            placeId: favorite.type === 'in-person' ? favorite.placeId || '' : '',
            lat: favorite.type === 'in-person' && typeof favorite.lat === 'number' ? favorite.lat : null,
            lng: favorite.type === 'in-person' && typeof favorite.lng === 'number' ? favorite.lng : null,
            createdBy: uid,
            creatorName: displayNameFor(userSnap.data()),
            createdAt: new Date().toISOString(),
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
    var _a;
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
            meetingId: eventId,
            fromUserId: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            read: false,
        });
        return { alreadyProposed: false, creatorId };
    });
    if (!result.alreadyProposed) {
        const creatorSnap = await db.collection('users').doc(result.creatorId).get();
        const token = (_a = creatorSnap.data()) === null || _a === void 0 ? void 0 : _a.expoPushToken;
        if (typeof token === 'string') {
            await sendExpoPushNotification([token], 'Pedido para repetir evento', 'Uma pessoa pediu uma nova edição de um evento seu.', { path: '/(drawer)/(tabs)/agenda', notificationType: 'repeat_proposal' });
        }
    }
    console.info('[FavoriteEvent] repeat_proposal_processed', { alreadyProposed: result.alreadyProposed });
    return { ok: true, alreadyProposed: result.alreadyProposed };
});
exports.leaveEvent = smallFunction.https.onCall(async (data, context) => {
    var _a;
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const result = await db.runTransaction(async (transaction) => {
        const [eventSnap, attendeeSnap] = await Promise.all([
            transaction.get(eventRef),
            transaction.get(db.collection('users').doc(uid)),
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
        return {
            creatorId: typeof event.createdBy === 'string' ? event.createdBy : '',
            eventTitle: typeof event.title === 'string' ? event.title : 'seu evento',
            attendeeName: displayNameFor(attendeeSnap.data()),
        };
    });
    if (result.creatorId) {
        try {
            const creatorSnap = await db.collection('users').doc(result.creatorId).get();
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
            const token = (_a = creatorSnap.data()) === null || _a === void 0 ? void 0 : _a.expoPushToken;
            if (typeof token === 'string') {
                await sendExpoPushNotification([token], 'Participante cancelou presença', `${result.attendeeName} saiu de "${result.eventTitle}".`, { path: `/event/${eventId}`, meetingId: eventId, notificationType: 'event_attendee_left' });
            }
        }
        catch (_b) {
            console.error('[EventLeave] organizer_notification_failed', { eventId });
        }
    }
    return { ok: true };
});
exports.getEventInviteCandidates = smallFunction.https.onCall(async (data, context) => {
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
    const candidateIds = [...candidates.entries()]
        .sort((first, second) => second[1].priority - first[1].priority)
        .slice(0, 12)
        .map(([candidateId]) => candidateId);
    if (candidateIds.length === 0)
        return { candidates: [] };
    const candidateProfiles = await db.getAll(...candidateIds.map((candidateId) => db.collection('users').doc(candidateId)));
    const callerProfile = callerSnap.data();
    const result = candidateProfiles.flatMap((candidateProfile) => {
        var _a, _b;
        if (!candidateProfile.exists || isBlockedBy(callerProfile, candidateProfile.id) || isBlockedBy(candidateProfile.data(), uid))
            return [];
        const profile = candidateProfile.data();
        return [{
                uid: candidateProfile.id,
                displayName: displayNameFor(profile),
                nick: typeof (profile === null || profile === void 0 ? void 0 : profile.nick) === 'string' ? profile.nick : undefined,
                photoURL: typeof (profile === null || profile === void 0 ? void 0 : profile.photoURL) === 'string' ? profile.photoURL : undefined,
                sharedEventsCount: ((_a = candidates.get(candidateProfile.id)) === null || _a === void 0 ? void 0 : _a.sharedEventsCount) || 0,
                previousParticipant: ((_b = candidates.get(candidateProfile.id)) === null || _b === void 0 ? void 0 : _b.previousParticipant) === true,
            }];
    });
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
        if (!inviteeSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Usuário não encontrado.');
        if (existingInvitation.exists)
            return { alreadyInvited: true, inviteeToken: undefined, eventTitle: '' };
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
            inviteeToken: typeof ((_a = inviteeSnap.data()) === null || _a === void 0 ? void 0 : _a.expoPushToken) === 'string' ? (_b = inviteeSnap.data()) === null || _b === void 0 ? void 0 : _b.expoPushToken : undefined,
            eventTitle: typeof event.title === 'string' ? event.title : 'um evento',
        };
    });
    if (result.alreadyInvited) {
        console.info('[EventInvite] duplicate_ignored');
        return { ok: true, alreadyInvited: true };
    }
    if (result.inviteeToken) {
        await sendExpoPushNotification([result.inviteeToken], 'Você recebeu um convite', `Abra o Reunion Hub para ver o convite para "${result.eventTitle}".`, { path: `/event/${eventId}`, meetingId: eventId, notificationType: 'event_invitation' });
    }
    console.info('[EventInvite] invitation_created', { pushSent: Boolean(result.inviteeToken) });
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
        const [existing, callerSnap, targetSnap] = await Promise.all([
            transaction.get(conversationRef),
            transaction.get(callerRef),
            transaction.get(targetRef),
        ]);
        if (!targetSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Usuário não encontrado.');
        if (isBlockedBy(callerSnap.data(), targetUserId)) {
            throw new functions.https.HttpsError('permission-denied', 'Você bloqueou esta pessoa. Desbloqueie-a no seu perfil para conversar.');
        }
        if (isBlockedBy(targetSnap.data(), uid)) {
            throw new functions.https.HttpsError('permission-denied', 'Esta pessoa bloqueou você e não pode receber suas mensagens.');
        }
        const target = targetSnap.data();
        const participantName = (target === null || target === void 0 ? void 0 : target.nick) || (target === null || target === void 0 ? void 0 : target.displayName) || 'Usuário';
        if (existing.exists) {
            transaction.update(conversationRef, {
                deletedBy: admin.firestore.FieldValue.arrayRemove(uid),
            });
            return { conversationId, participantName, created: false };
        }
        const caller = callerSnap.data();
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
    const delivery = await db.runTransaction(async (transaction) => {
        var _a, _b;
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
            return { senderName: '', recipientToken: '', alreadySent: true };
        }
        const notificationRef = db.collection('notifications').doc(`chat_${conversationId}_${otherUserId}`);
        const [senderSnap, recipientSnap, notificationSnap] = await Promise.all([
            transaction.get(db.collection('users').doc(uid)),
            transaction.get(db.collection('users').doc(otherUserId)),
            transaction.get(notificationRef),
        ]);
        if (!senderSnap.exists)
            throw new functions.https.HttpsError('failed-precondition', 'Seu perfil não está disponível.');
        if (!recipientSnap.exists)
            throw new functions.https.HttpsError('failed-precondition', 'Este usuário não está mais disponível.');
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
        transaction.set(notificationRef, {
            userId: otherUserId,
            type: 'chat',
            title: `Nova mensagem de ${senderName}`,
            body: text,
            conversationId,
            fromUserId: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            read: false,
        }, { merge: true });
        const hasUnreadNotification = notificationSnap.exists && ((_a = notificationSnap.data()) === null || _a === void 0 ? void 0 : _a.read) === false;
        const recipientToken = (_b = recipientSnap.data()) === null || _b === void 0 ? void 0 : _b.expoPushToken;
        return {
            senderName,
            recipientToken: !hasUnreadNotification && typeof recipientToken === 'string' ? recipientToken : '',
            alreadySent: false,
        };
    });
    if (delivery.recipientToken) {
        await sendExpoPushNotification([delivery.recipientToken], `Nova mensagem de ${delivery.senderName}`, text, { path: `/conversation/${conversationId}`, conversationId });
    }
    console.info('[ChatMessage] processed', { pushSent: Boolean(delivery.recipientToken), alreadySent: delivery.alreadySent });
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
        var _a;
        const [placeSnap, userSnap] = await Promise.all([
            transaction.get(placeRef),
            transaction.get(userRef),
        ]);
        if (!userSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Perfil não encontrado.');
        const discovererName = displayNameFor(userSnap.data());
        const sharePublicly = ((_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.shareFrequentedPlaces) === true;
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
                frequenters: sharePublicly ? [uid] : [],
                habitSchedules: sharePublicly ? { [uid]: schedule } : {},
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
        transaction.update(placeRef, Object.assign({ frequenters: sharePublicly
                ? admin.firestore.FieldValue.arrayUnion(uid)
                : admin.firestore.FieldValue.arrayRemove(uid), [`habitSchedules.${uid}`]: sharePublicly
                ? schedule
                : admin.firestore.FieldValue.delete(), [`habits.${uid}`]: admin.firestore.FieldValue.delete() }, discovererFields));
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
exports.setFrequentedPlacesPrivacy = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    if (!(0, validation_1.isRecord)(data) || typeof data.enabled !== 'boolean') {
        throw new functions.https.HttpsError('invalid-argument', 'A preferência de privacidade é obrigatória.');
    }
    const enabled = data.enabled;
    const userRef = db.collection('users').doc(uid);
    const habitsSnapshot = await userRef.collection('placeHabits').limit(50).get();
    const batch = db.batch();
    batch.set(userRef, { shareFrequentedPlaces: enabled }, { merge: true });
    habitsSnapshot.docs.forEach((habitDocument) => {
        const schedule = habitDocument.data().schedule;
        const placeRef = db.collection('places').doc(habitDocument.id);
        batch.set(placeRef, {
            frequenters: enabled
                ? admin.firestore.FieldValue.arrayUnion(uid)
                : admin.firestore.FieldValue.arrayRemove(uid),
            [`habitSchedules.${uid}`]: enabled && (0, validation_1.isRecord)(schedule)
                ? schedule
                : admin.firestore.FieldValue.delete(),
            [`habits.${uid}`]: admin.firestore.FieldValue.delete(),
        }, { merge: true });
    });
    await batch.commit();
    if (!enabled) {
        await processQueryInBatches(db.collection('places').where('frequenters', 'array-contains', uid), (cleanupBatch, document) => cleanupBatch.update(document.ref, {
            frequenters: admin.firestore.FieldValue.arrayRemove(uid),
            [`habitSchedules.${uid}`]: admin.firestore.FieldValue.delete(),
            [`habits.${uid}`]: admin.firestore.FieldValue.delete(),
        }));
    }
    console.info('[PlaceHabit] privacy_updated', { enabled, habitCount: habitsSnapshot.size });
    return { ok: true };
});
exports.checkInToEvent = smallFunction.https.onCall(async (data, context) => {
    var _a;
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const userRef = db.collection('users').doc(uid);
    const result = await db.runTransaction(async (transaction) => {
        const [eventSnap, userSnap] = await Promise.all([transaction.get(eventRef), transaction.get(userRef)]);
        if (!eventSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnap.data();
        if ((event.status && event.status !== 'active') || !stringIds(event.attendees).includes(uid) || !isCheckInWindowOpen(event, new Date())) {
            throw new functions.https.HttpsError('failed-precondition', 'O check-in só pode ser solicitado entre o início e o término do evento ativo.');
        }
        if (stringIds(event.checkedIn).includes(uid))
            return { requested: false, alreadyConfirmed: true, creatorId: '' };
        const requests = pendingCheckIns(event.pendingCheckIns);
        if (requests.some((request) => request.userId === uid))
            return { requested: false, alreadyConfirmed: false, creatorId: '' };
        const requesterName = displayNameFor(userSnap.data());
        transaction.update(eventRef, {
            pendingCheckIns: [...requests, { userId: uid, displayName: requesterName }],
        });
        return { requested: true, alreadyConfirmed: false, creatorId: typeof event.createdBy === 'string' ? event.createdBy : '', eventTitle: typeof event.title === 'string' ? event.title : 'este evento' };
    });
    if (result.requested && result.creatorId && result.creatorId !== uid) {
        try {
            const creatorSnap = await db.collection('users').doc(result.creatorId).get();
            const token = (_a = creatorSnap.data()) === null || _a === void 0 ? void 0 : _a.expoPushToken;
            await db.collection('notifications').doc(`checkin_request_${eventId}_${uid}`).set({
                userId: result.creatorId,
                type: 'checkin_request',
                title: 'Confirmação de presença pendente',
                body: 'Um participante pediu confirmação de check-in.',
                meetingId: eventId,
                fromUserId: uid,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                read: false,
            }, { merge: true });
            if (typeof token === 'string') {
                await sendExpoPushNotification([token], 'Confirmação de presença pendente', `Confirme o check-in em "${result.eventTitle || 'seu evento'}".`, { path: `/event/${eventId}`, meetingId: eventId, notificationType: 'checkin_request' });
            }
        }
        catch (_b) {
            console.error('[CheckIn] request_notification_failed');
        }
    }
    console.info('[CheckIn] request_processed', { requested: result.requested, alreadyConfirmed: result.alreadyConfirmed });
    return Object.assign({ ok: true }, result);
});
exports.confirmEventCheckIn = smallFunction.https.onCall(async (data, context) => {
    var _a;
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const targetUserId = (0, validation_1.requireDocumentIdField)(data, 'targetUserId', 128);
    if (targetUserId === uid)
        throw new functions.https.HttpsError('permission-denied', 'Outra pessoa deve confirmar seu check-in.');
    const eventRef = db.collection('meetings').doc(eventId);
    const targetUserRef = db.collection('users').doc(targetUserId);
    const result = await db.runTransaction(async (transaction) => {
        const [eventSnap, targetUserSnap] = await Promise.all([transaction.get(eventRef), transaction.get(targetUserRef)]);
        if (!eventSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        if (!targetUserSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Participante não encontrado.');
        const event = eventSnap.data();
        const attendees = stringIds(event.attendees);
        if (!attendees.includes(uid) || !attendees.includes(targetUserId) || !isCheckInWindowOpen(event, new Date())) {
            throw new functions.https.HttpsError('failed-precondition', 'Esta confirmação não está disponível.');
        }
        if (event.status && event.status !== 'active')
            throw new functions.https.HttpsError('failed-precondition', 'Este evento não está ativo.');
        if (stringIds(event.checkedIn).includes(targetUserId))
            return { confirmed: false, title: '' };
        const requests = pendingCheckIns(event.pendingCheckIns);
        if (!requests.some((request) => request.userId === targetUserId)) {
            throw new functions.https.HttpsError('failed-precondition', 'Não há solicitação de check-in pendente para este participante.');
        }
        transaction.update(eventRef, {
            checkedIn: admin.firestore.FieldValue.arrayUnion(targetUserId),
            pendingCheckIns: requests.filter((request) => request.userId !== targetUserId),
        });
        transaction.update(targetUserRef, {
            reputation: admin.firestore.FieldValue.increment(10),
            eventsAttended: admin.firestore.FieldValue.increment(1),
        });
        return { confirmed: true, title: typeof event.title === 'string' ? event.title : 'o evento' };
    });
    if (result.confirmed) {
        try {
            const targetSnap = await targetUserRef.get();
            const token = (_a = targetSnap.data()) === null || _a === void 0 ? void 0 : _a.expoPushToken;
            await db.collection('notifications').doc(`checkin_confirmed_${eventId}_${targetUserId}`).set({
                userId: targetUserId,
                type: 'checkin_confirmed',
                title: 'Check-in confirmado',
                body: `Sua presença em "${result.title}" foi confirmada e seus pontos foram adicionados.`,
                meetingId: eventId,
                fromUserId: uid,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                read: false,
            }, { merge: true });
            if (typeof token === 'string') {
                await sendExpoPushNotification([token], 'Check-in confirmado', `Sua presença em "${result.title}" foi confirmada.`, { path: `/event/${eventId}`, meetingId: eventId, notificationType: 'checkin_confirmed' });
            }
        }
        catch (_b) {
            console.error('[CheckIn] confirmation_notification_failed');
        }
    }
    console.info('[CheckIn] confirmation_processed', { confirmed: result.confirmed });
    return Object.assign({ ok: true }, result);
});
function completedEventDeliveries(eventId, result) {
    const body = result.noCheckIns
        ? `O evento "${result.title}" terminou sem check-ins. Cada inscrito perdeu somente 1 ponto.`
        : `O evento "${result.title}" foi encerrado. Obrigado por participar!`;
    return result.recipientUserIds.map((userId) => ({
        id: `event_completed_${eventId}_${userId}`,
        userId,
        type: 'event_completed',
        title: 'Evento encerrado',
        body,
        meetingId: eventId,
    }));
}
async function notifyCompletedEvent(eventId, result) {
    await deliverEventNotifications(completedEventDeliveries(eventId, result));
    console.info('[MeetingNotification] completion_delivered', { recipientCount: result.recipientUserIds.length, noCheckIns: result.noCheckIns });
}
async function completeEventTransaction(eventRef, expectedCreatorId) {
    return db.runTransaction(async (transaction) => {
        var _a;
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnap.data();
        if (expectedCreatorId && event.createdBy !== expectedCreatorId)
            throw new functions.https.HttpsError('permission-denied', 'Apenas o criador pode encerrar este evento.');
        if (event.status === 'completed')
            return { noShows: 0, becameFounder: false, alreadyCompleted: true, noCheckIns: false, recipientUserIds: [], title: '' };
        if (event.status === 'cancelled')
            throw new functions.https.HttpsError('failed-precondition', 'Um evento cancelado não pode ser encerrado.');
        const eventStart = getEventStartDate(event);
        if (!eventStart || new Date() < eventStart)
            throw new functions.https.HttpsError('failed-precondition', 'O evento só pode ser encerrado após o horário de início.');
        const creatorId = typeof event.createdBy === 'string' ? event.createdBy : '';
        const attendees = [...new Set(stringIds(event.attendees))];
        const checkedInUserIds = [...new Set(stringIds(event.checkedIn))];
        const checkedIn = new Set(checkedInUserIds);
        const noCheckIns = checkedInUserIds.length === 0;
        const allRegisteredUserIds = [...new Set([...attendees, ...(creatorId ? [creatorId] : [])])];
        const noShows = noCheckIns
            ? allRegisteredUserIds
            : attendees.filter((attendeeId) => attendeeId !== creatorId && !checkedIn.has(attendeeId));
        const noShowPenalty = noCheckIns ? -1 : -20;
        const placeRef = typeof event.placeId === 'string' && event.placeId ? db.collection('places').doc(event.placeId) : null;
        const placeSnap = placeRef ? await transaction.get(placeRef) : null;
        const becameFounder = Boolean(!noCheckIns && placeRef && (!(placeSnap === null || placeSnap === void 0 ? void 0 : placeSnap.exists) || !((_a = placeSnap.data()) === null || _a === void 0 ? void 0 : _a.founderId)));
        transaction.update(eventRef, { status: 'completed', pendingCheckIns: [] });
        noShows.forEach((attendeeId) => transaction.update(db.collection('users').doc(attendeeId), { reputation: admin.firestore.FieldValue.increment(noShowPenalty) }));
        if (becameFounder && placeRef && creatorId) {
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
            becameFounder,
            alreadyCompleted: false,
            noCheckIns,
            recipientUserIds: noCheckIns ? allRegisteredUserIds : checkedInUserIds,
            title: typeof event.title === 'string' ? event.title : 'este evento',
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
    return { noShows: result.noShows, becameFounder: result.becameFounder, alreadyCompleted: result.alreadyCompleted, noCheckIns: result.noCheckIns };
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
    const eventIds = oldEvents.docs.map((eventDocument) => eventDocument.id);
    const relatedDocuments = [];
    for (let index = 0; index < eventIds.length; index += 10) {
        const eventIdChunk = eventIds.slice(index, index + 10);
        const [invitations, notifications] = await Promise.all([
            db.collection('eventInvitations').where('eventId', 'in', eventIdChunk).get(),
            db.collection('notifications').where('meetingId', 'in', eventIdChunk).get(),
        ]);
        relatedDocuments.push(...invitations.docs, ...notifications.docs);
    }
    const documentsToDelete = [...oldEvents.docs, ...relatedDocuments];
    for (let index = 0; index < documentsToDelete.length; index += 400) {
        const batch = db.batch();
        documentsToDelete.slice(index, index + 400).forEach((document) => batch.delete(document.ref));
        await batch.commit();
    }
    return oldEvents.size;
}
// Uma única execução diária: consulta somente eventos ainda ativos de dias anteriores.
// O limite impede que um volume inesperado transforme a rotina em uma varredura cara.
exports.closeExpiredEventsDaily = dailyFunction.pubsub
    .schedule('10 0 * * *')
    .timeZone('America/Sao_Paulo')
    .onRun(async () => {
    const lastEligibleDate = dateInSaoPaulo(-1);
    const expiredEvents = await db.collection('meetings')
        .where('status', '==', 'active')
        .where('date', '<=', lastEligibleDate)
        .orderBy('date', 'asc')
        .limit(50)
        .get();
    let completed = 0;
    const completionDeliveries = [];
    for (const eventDocument of expiredEvents.docs) {
        try {
            const result = await completeEventTransaction(eventDocument.ref);
            if (!result.alreadyCompleted) {
                completed += 1;
                completionDeliveries.push(...completedEventDeliveries(eventDocument.id, result));
            }
        }
        catch (_a) {
            console.error('[EventAutoClose] completion_failed', { eventId: eventDocument.id });
        }
    }
    try {
        await deliverEventNotifications(completionDeliveries);
    }
    catch (_b) {
        console.error('[EventAutoClose] notification_delivery_failed', { recipientCount: completionDeliveries.length });
    }
    const cleaned = expiredEvents.size < 50 ? await cleanUpOldEventHistory() : 0;
    console.info('[EventAutoClose] daily_run_completed', { scanned: expiredEvents.size, completed, cleaned });
    return null;
});
exports.cancelEvent = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const userRef = db.collection('users').doc(uid);
    const result = await db.runTransaction(async (transaction) => {
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnap.data();
        if (event.createdBy !== uid)
            throw new functions.https.HttpsError('permission-denied', 'Apenas o criador pode cancelar.');
        if (event.status && event.status !== 'active')
            return { penalized: false, alreadyClosed: true, cancelledEvent: null };
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
        if (event.status === 'cancelled')
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
    }
    console.info('[Moderation] reported_event_removed', { removed: result.removed });
    return { ok: true, removed: result.removed };
});
exports.banUser = smallFunction.https.onCall(async (data, context) => {
    var _a;
    const moderatorId = await requireStaff(context);
    const targetUserId = (0, validation_1.requireDocumentIdField)(data, 'targetUserId', 128);
    if (targetUserId === moderatorId) {
        throw new functions.https.HttpsError('failed-precondition', 'VocÃª nÃ£o pode banir sua prÃ³pria conta.');
    }
    const targetUserRef = db.collection('users').doc(targetUserId);
    const targetProfile = await targetUserRef.get();
    if (!targetProfile.exists)
        throw new functions.https.HttpsError('not-found', 'UsuÃ¡rio nÃ£o encontrado.');
    const targetRole = (_a = targetProfile.data()) === null || _a === void 0 ? void 0 : _a.role;
    if (targetRole === 'admin' || targetRole === 'moderator') {
        throw new functions.https.HttpsError('permission-denied', 'Contas da moderaÃ§Ã£o nÃ£o podem ser banidas por esta ferramenta.');
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
    // A conta continua marcada como banida para impedir nova sessÃ£o; as demais
    // relaÃ§Ãµes do usuÃ¡rio saem do app por consultas limitadas e sob demanda.
    const createdEvents = await db.collection('meetings').where('createdBy', '==', targetUserId).limit(200).get();
    const eventsToCancel = createdEvents.docs.filter((eventDocument) => {
        const status = eventDocument.data().status;
        return !status || status === 'active';
    });
    if (eventsToCancel.length > 0) {
        const batch = db.batch();
        eventsToCancel.forEach((eventDocument) => batch.update(eventDocument.ref, { status: 'cancelled', moderationRemoved: true }));
        await batch.commit();
        try {
            await notifyCancelledEvents(eventsToCancel.map((eventDocument) => ({ eventId: eventDocument.id, event: eventDocument.data() })));
        }
        catch (_b) {
            console.error('[Moderation] banned_event_notifications_failed', { eventCount: eventsToCancel.length });
        }
    }
    await processQueryInBatches(db.collection('meetings').where('attendees', 'array-contains', targetUserId), (batch, document) => batch.update(document.ref, {
        attendees: admin.firestore.FieldValue.arrayRemove(targetUserId),
        checkedIn: admin.firestore.FieldValue.arrayRemove(targetUserId),
        pendingCheckIns: pendingCheckIns(document.data().pendingCheckIns).filter((request) => request.userId !== targetUserId),
    }));
    await processQueryInBatches(db.collection('conversations').where('participants', 'array-contains', targetUserId), (batch, document) => batch.update(document.ref, {
        participants: admin.firestore.FieldValue.arrayRemove(targetUserId),
        deletedBy: admin.firestore.FieldValue.arrayUnion(targetUserId),
        [`participantNames.${targetUserId}`]: 'UsuÃ¡rio banido',
        [`unreadCounts.${targetUserId}`]: admin.firestore.FieldValue.delete(),
    }));
    await processQueryInBatches(db.collectionGroup('messages').where('senderId', '==', targetUserId), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('eventInvitations').where('inviterId', '==', targetUserId), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('eventInvitations').where('inviteeId', '==', targetUserId), (batch, document) => batch.delete(document.ref));
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
    console.info('[Moderation] user_banned', { cancelledEvents: eventsToCancel.length });
    return { ok: true, cancelledEvents: eventsToCancel.length };
});
exports.deleteMyAccount = smallFunction.https.onCall(async (_data, context) => {
    const uid = requireAuthenticated(context);
    const userRef = db.collection('users').doc(uid);
    console.info('[AccountDeletion] started');
    // Cada atualização remove o documento do resultado da própria consulta. Isso evita
    // paginação frágil e mantém cada lote bem abaixo do limite de 500 operações.
    await processQueryInBatches(db.collection('meetings').where('createdBy', '==', uid), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('notifications').where('userId', '==', uid), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('reports').where('reportedBy', '==', uid), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('eventInvitations').where('inviterId', '==', uid), (batch, document) => batch.delete(document.ref));
    await processQueryInBatches(db.collection('eventInvitations').where('inviteeId', '==', uid), (batch, document) => batch.delete(document.ref));
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
    await processQueryInBatches(db.collection('conversations').where('participants', 'array-contains', uid), (batch, document) => batch.update(document.ref, {
        participants: admin.firestore.FieldValue.arrayRemove(uid),
        deletedBy: admin.firestore.FieldValue.arrayUnion(uid),
        [`participantNames.${uid}`]: 'Usuário excluído',
        [`unreadCounts.${uid}`]: admin.firestore.FieldValue.delete()
    }));
    await userRef.delete();
    await admin.storage().bucket().deleteFiles({ prefix: `avatars/${uid}_` }).catch(() => {
        console.warn('[AccountDeletion] avatar_cleanup_failed');
    });
    await admin.auth().deleteUser(uid);
    console.info('[AccountDeletion] completed');
    return { ok: true };
});
//# sourceMappingURL=index.js.map