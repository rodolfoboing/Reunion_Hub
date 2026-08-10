import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();
// O app ainda é pequeno: limita concorrência e memória para evitar picos de custo.
// Todas as operações são curtas; 30 s e 128 MB são suficientes para estes fluxos.
const smallFunction = functions.runWith({
    memory: '128MB',
    timeoutSeconds: 30,
    maxInstances: 5,
});

// Helper: Envio de Push Notifications via API HTTP do Expo
async function sendExpoPushNotification(pushTokens: string[], title: string, body: string, data: Record<string, unknown> = {}) {
    if (!pushTokens || pushTokens.length === 0) return;
    
    const validTokens = pushTokens.filter(token => token && token.startsWith('ExponentPushToken'));
    if (validTokens.length === 0) {
        console.warn('[Push Notification] Nenhum token válido fornecido.');
        return;
    }

    const messages = validTokens.map(token => ({
        to: token,
        sound: 'default',
        title: title,
        body: body,
        data: data,
    }));

    try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Accept-encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(messages),
        });
        
        if (!response.ok) {
            console.warn('[PushNotification] request_rejected', { recipientCount: validTokens.length, status: response.status });
        }
    } catch {
        console.error('[PushNotification] request_failed');
    }
}

// 1. Notificação de Chat: Avisa participantes quando uma nova mensagem é enviada
export const onNewChatMessage = smallFunction.firestore
    .document('conversations/{conversationId}/messages/{messageId}')
    .onCreate(async (snap, context) => {
        const msgData = snap.data();
        if (!msgData || !msgData.senderId || !msgData.text) return;

        const conversationRef = db.collection('conversations').doc(context.params.conversationId);
        const conversationSnap = await conversationRef.get();
        if (!conversationSnap.exists) {
            console.warn('[ChatNotification] conversation_missing');
            return;
        }
        
        const conversationData = conversationSnap.data();
        const participants = conversationData?.participants || [];
        
        const recipientIds = participants.filter((id: string) => id !== msgData.senderId);
        if (recipientIds.length === 0) return;

        let senderName = 'Alguém';
        const senderSnap = await db.collection('users').doc(msgData.senderId).get();
        if (senderSnap.exists) {
            senderName = senderSnap.data()?.nick || senderSnap.data()?.displayName || senderName;
        }

        // Busca os tokens e registra uma notificação interna para cada destinatário.
        // O ID determinístico evita duplicação se o gatilho for reexecutado.
        const tokens: string[] = [];
        const notificationsBatch = db.batch();
        for (const uid of recipientIds) {
            const userSnap = await db.collection('users').doc(uid).get();
            if (userSnap.exists) {
                const token = userSnap.data()?.expoPushToken;
                if (token) tokens.push(token);
            }
            notificationsBatch.set(db.collection('notifications').doc(`chat_${context.params.messageId}_${uid}`), {
                userId: uid,
                type: 'chat',
                title: `Nova mensagem de ${senderName}`,
                body: msgData.text,
                conversationId: context.params.conversationId,
                fromUserId: msgData.senderId,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                read: false
            });
        }

        await Promise.all([
            notificationsBatch.commit(),
            sendExpoPushNotification(
                tokens,
                `Nova mensagem de ${senderName}`,
                msgData.text,
                { path: `/conversation/${context.params.conversationId}`, conversationId: context.params.conversationId }
            )
        ]);
    });

// Notificações derivadas de uma alteração de evento ficam no mesmo gatilho para
// não cobrar duas invocações a cada RSVP, check-in ou encerramento.
export const onMeetingUpdated = smallFunction.firestore
    .document('meetings/{meetingId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();

        if (before.status !== 'cancelled' && after.status === 'cancelled') {
            console.info('[MeetingNotification] event_cancelled', { attendeeCount: after.attendees?.length || 0 });
            const attendees = after.attendees || [];
            if (attendees.length === 0) return;

            const tokens: string[] = [];
            const notificationsBatch = db.batch();
            for (const uid of attendees) {
                if (uid === after.createdBy) continue; // Não notificar o próprio criador
                
                const userSnap = await db.collection('users').doc(uid).get();
                if (userSnap.exists) {
                    const token = userSnap.data()?.expoPushToken;
                    if (token) tokens.push(token);
                }
                notificationsBatch.set(db.collection('notifications').doc(`event_cancelled_${context.params.meetingId}_${uid}`), {
                    userId: uid,
                    type: 'event_cancelled',
                    title: 'Evento cancelado',
                    body: `O evento "${after.title || 'sem título'}" foi cancelado pelo organizador.`,
                    meetingId: context.params.meetingId,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    read: false,
                });
            }

            await Promise.all([
                notificationsBatch.commit(),
                sendExpoPushNotification(
                tokens,
                'Evento cancelado',
                `O evento "${after.title}" foi cancelado pelo organizador.`,
                { path: `/event/${context.params.meetingId}`, meetingId: context.params.meetingId }
                ),
            ]);
        }

        if (before.status !== 'completed' && after.status === 'completed') {
            const checkedInUserIds = [...new Set(stringIds(after.checkedIn))];
            if (checkedInUserIds.length > 0) {
                const userSnapshots = await db.getAll(...checkedInUserIds.map((userId) => db.collection('users').doc(userId)));
                const tokens: string[] = [];
                const notificationsBatch = db.batch();
                userSnapshots.forEach((userSnap) => {
                    if (!userSnap.exists) return;
                    const token = userSnap.data()?.expoPushToken;
                    if (typeof token === 'string') tokens.push(token);
                    notificationsBatch.set(db.collection('notifications').doc(`event_completed_${context.params.meetingId}_${userSnap.id}`), {
                        userId: userSnap.id,
                        type: 'event_completed',
                        title: 'Evento encerrado',
                        body: `O evento "${after.title || 'sem título'}" foi encerrado. Obrigado por participar!`,
                        meetingId: context.params.meetingId,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        read: false,
                    }, { merge: true });
                });
                await Promise.all([
                    notificationsBatch.commit(),
                    sendExpoPushNotification(tokens, 'Evento encerrado', `"${after.title || 'Seu evento'}" foi encerrado. Obrigado por participar!`, { path: `/event/${context.params.meetingId}`, meetingId: context.params.meetingId, notificationType: 'event_completed' }),
                ]);
                console.info('[MeetingNotification] completion_delivered', { recipientCount: checkedInUserIds.length });
            }
        }

        const beforeCount = before.attendees?.length || 0;
        const afterCount = after.attendees?.length || 0;

        if (beforeCount === 1 && afterCount === 2) {
            console.info('[MeetingNotification] first_rsvp');
            const creatorId = after.createdBy;
            if (!creatorId) return;

            const creatorSnap = await db.collection('users').doc(creatorId).get();
            if (!creatorSnap.exists) return;

            const token = creatorSnap.data()?.expoPushToken;
            await db.collection('notifications').doc(`first_rsvp_${context.params.meetingId}_${creatorId}`).set({
                userId: creatorId,
                type: 'event_first_rsvp',
                title: 'Primeiro confirmado!',
                body: `Alguém acabou de confirmar presença no seu evento "${after.title || 'sem título'}".`,
                meetingId: context.params.meetingId,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                read: false,
            }, { merge: true });
            if (token) {
                await sendExpoPushNotification(
                    [token],
                    'Primeiro confirmado!',
                    `Alguém acabou de confirmar presença no seu evento "${after.title}".`,
                    { path: `/event/${context.params.meetingId}`, meetingId: context.params.meetingId }
                );
            }
        }
    });

function requireAuthenticated(context: functions.https.CallableContext): string {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Faça login para continuar.');
    }
    return context.auth.uid;
}

function requireEventId(data: unknown): string {
    if (!data || typeof data !== 'object' || typeof (data as { eventId?: unknown }).eventId !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'eventId é obrigatório.');
    }
    return (data as { eventId: string }).eventId;
}

function requireStringField(data: unknown, field: string): string {
    if (!data || typeof data !== 'object' || typeof (data as Record<string, unknown>)[field] !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', `${field} é obrigatório.`);
    }
    const value = ((data as Record<string, unknown>)[field] as string).trim();
    if (!value) throw new functions.https.HttpsError('invalid-argument', `${field} é inválido.`);
    return value;
}

function isBlockedBy(profile: FirebaseFirestore.DocumentData | undefined, userId: string): boolean {
    const blockedUsers = profile?.blockedUsers;
    return Array.isArray(blockedUsers) && blockedUsers.includes(userId);
}

function conversationIdFor(firstUserId: string, secondUserId: string): string {
    return [firstUserId, secondUserId].sort().join('_');
}

function getEventStartDate(event: FirebaseFirestore.DocumentData): Date | null {
    if (typeof event.date !== 'string' || typeof event.time !== 'string') return null;
    // Eventos do produto são registrados no horário de São Paulo. Sem o offset,
    // o runtime das Functions (UTC) adiantaria a janela de check-in em três horas.
    const date = new Date(`${event.date}T${event.time}:00-03:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getEventEndDate(event: FirebaseFirestore.DocumentData): Date | null {
    if (typeof event.date !== 'string' || typeof event.time !== 'string') return null;
    const endTime = typeof event.endTime === 'string' ? event.endTime : '';
    const end = endTime ? new Date(`${event.date}T${endTime}:00-03:00`) : null;
    if (end && !Number.isNaN(end.getTime())) return end;

    const start = getEventStartDate(event);
    return start ? new Date(start.getTime() + 3 * 60 * 60 * 1000) : null;
}

function isCheckInWindowOpen(event: FirebaseFirestore.DocumentData, now: Date): boolean {
    const start = getEventStartDate(event);
    const end = getEventEndDate(event);
    return Boolean(start && end && now >= start && now <= end);
}

type PendingCheckIn = { userId: string; displayName: string };

function pendingCheckIns(value: unknown): PendingCheckIn[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): PendingCheckIn[] => {
        if (!isRecord(item) || typeof item.userId !== 'string' || !item.userId) return [];
        return [{
            userId: item.userId,
            displayName: typeof item.displayName === 'string' && item.displayName ? item.displayName : 'Usuário',
        }];
    });
}

const HABIT_WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

function requireHabitWeekday(data: Record<string, unknown>): typeof HABIT_WEEKDAYS[number] {
    const weekday = data.weekday;
    const matchedWeekday = typeof weekday === 'string' ? HABIT_WEEKDAYS.find((day) => day === weekday) : undefined;
    if (!matchedWeekday) {
        throw new functions.https.HttpsError('invalid-argument', 'Dia da semana inválido.');
    }
    return matchedWeekday;
}

function stringIds(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function eventInviteCount(event: FirebaseFirestore.DocumentData, userId: string): number {
    const counts = event.inviteCounts;
    if (!isRecord(counts)) return 0;
    const count = counts[userId];
    return typeof count === 'number' && Number.isFinite(count) ? count : 0;
}

function displayNameFor(profile: FirebaseFirestore.DocumentData | undefined): string {
    return typeof profile?.nick === 'string'
        ? profile.nick
        : typeof profile?.displayName === 'string'
            ? profile.displayName
            : 'Usuário';
}

type InviteTarget = { targetUserId?: string; targetNick?: string };

function getInviteTarget(data: unknown): InviteTarget {
    if (!isRecord(data)) {
        throw new functions.https.HttpsError('invalid-argument', 'Destino do convite é obrigatório.');
    }
    const targetUserId = typeof data.targetUserId === 'string' ? data.targetUserId.trim() : '';
    const targetNick = typeof data.targetNick === 'string' ? data.targetNick.trim().toLowerCase().replace(/\s+/g, '') : '';
    if (Boolean(targetUserId) === Boolean(targetNick)) {
        throw new functions.https.HttpsError('invalid-argument', 'Informe apenas um destino para o convite.');
    }
    return targetUserId ? { targetUserId } : { targetNick };
}

// Mutations that change attendance, reputation or event status run in trusted code.
// They read only the event and the requesting user's profile; no collection scan is used.
export const rsvpToEvent = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const userRef = db.collection('users').doc(uid);

    await db.runTransaction(async (transaction) => {
        const [eventSnap, userSnap] = await Promise.all([transaction.get(eventRef), transaction.get(userRef)]);
        if (!eventSnap.exists) throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');

        const event = eventSnap.data()!;
        if (event.status && event.status !== 'active') {
            throw new functions.https.HttpsError('failed-precondition', 'Este evento não está disponível.');
        }
        if (event.createdBy === uid) return;
        if ((event.attendees || []).includes(uid)) return;
        if ((userSnap.data()?.reputation || 0) <= -50) {
            throw new functions.https.HttpsError('permission-denied', 'Sua reputação não permite novas confirmações.');
        }

        transaction.update(eventRef, { attendees: admin.firestore.FieldValue.arrayUnion(uid) });
    });

    return { ok: true };
});

export const leaveEvent = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);

    await db.runTransaction(async (transaction) => {
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists) throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnap.data()!;
        if (event.createdBy === uid) {
            throw new functions.https.HttpsError('failed-precondition', 'O criador deve cancelar o evento em vez de sair.');
        }
        if (event.status && event.status !== 'active') {
            throw new functions.https.HttpsError('failed-precondition', 'Este evento não está mais ativo.');
        }
        transaction.update(eventRef, {
            attendees: admin.firestore.FieldValue.arrayRemove(uid),
            checkedIn: admin.firestore.FieldValue.arrayRemove(uid),
        });
    });

    return { ok: true };
});

type InviteCandidate = {
    uid: string;
    displayName: string;
    nick?: string;
    photoURL?: string;
    sharedEventsCount: number;
};

export const getEventInviteCandidates = smallFunction.https.onCall(async (data, context): Promise<{ candidates: InviteCandidate[] }> => {
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
    if (!eventSnap.exists) throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');

    const event = eventSnap.data()!;
    if (!stringIds(event.attendees).includes(uid)) {
        throw new functions.https.HttpsError('permission-denied', 'Confirme presença no evento para convidar pessoas.');
    }
    if (event.status && event.status !== 'active') {
        throw new functions.https.HttpsError('failed-precondition', 'Este evento não aceita convites.');
    }

    const currentAttendees = new Set(stringIds(event.attendees));
    const candidates = new Map<string, number>();
    const now = new Date();
    for (const historyDocument of historySnap.docs) {
        if (historyDocument.id === eventId) continue;
        const historyEvent = historyDocument.data();
        const eventStart = getEventStartDate(historyEvent);
        if (!eventStart || eventStart >= now || historyEvent.status === 'cancelled') continue;

        const checkedIn = stringIds(historyEvent.checkedIn);
        if (!checkedIn.includes(uid)) continue;
        checkedIn.forEach((candidateId) => {
            if (candidateId === uid || currentAttendees.has(candidateId)) return;
            candidates.set(candidateId, (candidates.get(candidateId) || 0) + 1);
        });
    }

    const candidateIds = [...candidates.keys()].slice(0, 12);
    if (candidateIds.length === 0) return { candidates: [] };

    const candidateProfiles = await db.getAll(...candidateIds.map((candidateId) => db.collection('users').doc(candidateId)));
    const callerProfile = callerSnap.data();
    const result = candidateProfiles.flatMap((candidateProfile): InviteCandidate[] => {
        if (!candidateProfile.exists || isBlockedBy(callerProfile, candidateProfile.id) || isBlockedBy(candidateProfile.data(), uid)) return [];
        const profile = candidateProfile.data();
        return [{
            uid: candidateProfile.id,
            displayName: displayNameFor(profile),
            nick: typeof profile?.nick === 'string' ? profile.nick : undefined,
            photoURL: typeof profile?.photoURL === 'string' ? profile.photoURL : undefined,
            sharedEventsCount: candidates.get(candidateProfile.id) || 1,
        }];
    });

    console.info('[EventInvite] candidates_loaded', { count: result.length });
    return { candidates: result };
});

export const inviteUserToEvent = smallFunction.https.onCall(async (data, context): Promise<{ ok: boolean; alreadyInvited: boolean }> => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const target = getInviteTarget(data);
    let targetRef: FirebaseFirestore.DocumentReference;

    if (target.targetUserId) {
        targetRef = db.collection('users').doc(target.targetUserId);
    } else {
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
        const [eventSnap, inviterSnap, inviteeSnap, existingInvitation] = await Promise.all([
            transaction.get(eventRef),
            transaction.get(inviterRef),
            transaction.get(targetRef),
            transaction.get(invitationRef),
        ]);
        if (!eventSnap.exists) throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        if (!inviteeSnap.exists) throw new functions.https.HttpsError('not-found', 'Usuário não encontrado.');
        if (existingInvitation.exists) return { alreadyInvited: true, inviteeToken: undefined, eventTitle: '' };

        const event = eventSnap.data()!;
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
            inviteeToken: typeof inviteeSnap.data()?.expoPushToken === 'string' ? inviteeSnap.data()?.expoPushToken : undefined,
            eventTitle: typeof event.title === 'string' ? event.title : 'um evento',
        };
    });

    if (result.alreadyInvited) {
        console.info('[EventInvite] duplicate_ignored');
        return { ok: true, alreadyInvited: true };
    }
    if (result.inviteeToken) {
        await sendExpoPushNotification(
            [result.inviteeToken],
            'Você recebeu um convite',
            `Abra o Reunion Hub para ver o convite para "${result.eventTitle}".`,
            { path: `/event/${eventId}`, meetingId: eventId, notificationType: 'event_invitation' }
        );
    }
    console.info('[EventInvite] invitation_created', { pushSent: Boolean(result.inviteeToken) });
    return { ok: true, alreadyInvited: false };
});

export const getOrCreateConversation = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const targetUserId = requireStringField(data, 'targetUserId');
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
        if (!targetSnap.exists) throw new functions.https.HttpsError('not-found', 'Usuário não encontrado.');
        if (isBlockedBy(callerSnap.data(), targetUserId) || isBlockedBy(targetSnap.data(), uid)) {
            throw new functions.https.HttpsError('permission-denied', 'Uma das pessoas bloqueou esta conversa.');
        }

        const target = targetSnap.data();
        const participantName = target?.nick || target?.displayName || 'Usuário';
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
                [uid]: caller?.nick || caller?.displayName || 'Usuário',
                [targetUserId]: target?.nick || target?.displayName || 'Usuário',
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

export const sendChatMessage = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const conversationId = requireStringField(data, 'conversationId');
    const text = requireStringField(data, 'text');
    if (text.length > 2000) {
        throw new functions.https.HttpsError('invalid-argument', 'A mensagem é muito longa.');
    }

    const conversationRef = db.collection('conversations').doc(conversationId);
    await db.runTransaction(async (transaction) => {
        const conversationSnap = await transaction.get(conversationRef);
        if (!conversationSnap.exists) throw new functions.https.HttpsError('not-found', 'Conversa não encontrada.');
        const conversation = conversationSnap.data()!;
        const participants = Array.isArray(conversation.participants) ? conversation.participants : [];
        if (participants.length !== 2 || !participants.includes(uid)) {
            throw new functions.https.HttpsError('permission-denied', 'Você não participa desta conversa.');
        }
        const otherUserId = participants.find((participantId: string) => participantId !== uid) as string;
        const [senderSnap, recipientSnap] = await Promise.all([
            transaction.get(db.collection('users').doc(uid)),
            transaction.get(db.collection('users').doc(otherUserId)),
        ]);
        if (!recipientSnap.exists) throw new functions.https.HttpsError('failed-precondition', 'Este usuário não está mais disponível.');
        if (isBlockedBy(senderSnap.data(), otherUserId) || isBlockedBy(recipientSnap.data(), uid)) {
            throw new functions.https.HttpsError('permission-denied', 'Não é possível enviar mensagens nesta conversa.');
        }

        const messageRef = conversationRef.collection('messages').doc();
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
    });

    return { ok: true };
});

export const savePlaceHabit = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    if (!data || typeof data !== 'object') throw new functions.https.HttpsError('invalid-argument', 'Dados do local são obrigatórios.');
    const payload = data as Record<string, unknown>;
    const placeId = requireStringField(data, 'placeId');
    const name = requireStringField(data, 'name');
    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    const weekday = requireHabitWeekday(payload);
    const periods = Array.isArray(payload.periods) && payload.periods.every((period) => typeof period === 'string')
        ? [...new Set(payload.periods.map((period) => period.trim()).filter(Boolean))].slice(0, 3)
        : [];
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new functions.https.HttpsError('invalid-argument', 'Coordenadas inválidas.');
    }
    const vocations = Array.isArray(payload.vocations)
        ? payload.vocations.filter((vocation): vocation is string => typeof vocation === 'string').slice(0, 10)
        : [];
    const placeRef = db.collection('places').doc(placeId);

    await db.runTransaction(async (transaction) => {
        const placeSnap = await transaction.get(placeRef);
        if (periods.length === 0) throw new functions.https.HttpsError('invalid-argument', 'Selecione ao menos um período.');
        if (!placeSnap.exists) {
            transaction.create(placeRef, {
                id: placeId,
                name,
                latitude,
                longitude,
                vocations,
                frequenters: [uid],
                habitSchedules: { [uid]: { [weekday]: periods } },
            });
            return;
        }
        transaction.set(placeRef, {
            frequenters: admin.firestore.FieldValue.arrayUnion(uid),
            habitSchedules: { [uid]: { [weekday]: periods } },
        }, { merge: true });
    });

    console.info('[PlaceHabit] saved', { weekday, periodsCount: periods.length });
    return { ok: true };
});

export const reportOnlineAccessIssue = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventSnap = await db.collection('meetings').doc(eventId).get();
    if (!eventSnap.exists) throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
    const event = eventSnap.data()!;
    if (event.type !== 'online' || !event.createdBy || event.createdBy === uid || !(event.attendees || []).includes(uid)) {
        throw new functions.https.HttpsError('permission-denied', 'Este aviso não está disponível.');
    }

    const notificationRef = db.collection('notifications').doc(`online_access_${eventId}_${uid}`);
    const created = await db.runTransaction(async (transaction) => {
        const existing = await transaction.get(notificationRef);
        if (existing.exists) return false;
        transaction.create(notificationRef, {
            userId: event.createdBy,
            type: 'online_access_issue',
            title: 'Possível problema no link do evento',
            body: `Um participante informou dificuldade para acessar "${event.title || 'este evento'}".`,
            meetingId: eventId,
            fromUserId: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            read: false,
        });
        return true;
    });
    if (!created) {
        console.info('[OnlineAccessIssue] duplicate_report_ignored');
        return { ok: true, alreadyReported: true };
    }

    const creatorSnap = await db.collection('users').doc(event.createdBy).get();
    const token = creatorSnap.data()?.expoPushToken;
    if (typeof token === 'string') {
        await sendExpoPushNotification([token], 'Possível problema no link', `Um participante relatou dificuldade em "${event.title || 'seu evento'}".`, {
            path: `/event/${eventId}`,
            meetingId: eventId,
            notificationType: 'online_access_issue',
        });
    }

    console.info('[OnlineAccessIssue] report_delivered', { pushSent: typeof token === 'string' });
    return { ok: true, alreadyReported: false };
});

export const checkInToEvent = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const userRef = db.collection('users').doc(uid);

    const result = await db.runTransaction(async (transaction) => {
        const [eventSnap, userSnap] = await Promise.all([transaction.get(eventRef), transaction.get(userRef)]);
        if (!eventSnap.exists) throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnap.data()!;
        if ((event.status && event.status !== 'active') || !stringIds(event.attendees).includes(uid) || !isCheckInWindowOpen(event, new Date())) {
            throw new functions.https.HttpsError('failed-precondition', 'O check-in só pode ser solicitado entre o início e o término do evento ativo.');
        }
        if (stringIds(event.checkedIn).includes(uid)) return { requested: false, alreadyConfirmed: true, creatorId: '' };

        const requests = pendingCheckIns(event.pendingCheckIns);
        if (requests.some((request) => request.userId === uid)) return { requested: false, alreadyConfirmed: false, creatorId: '' };

        const requesterName = displayNameFor(userSnap.data());
        transaction.update(eventRef, {
            pendingCheckIns: [...requests, { userId: uid, displayName: requesterName }],
        });
        return { requested: true, alreadyConfirmed: false, creatorId: typeof event.createdBy === 'string' ? event.createdBy : '', eventTitle: typeof event.title === 'string' ? event.title : 'este evento' };
    });

    if (result.requested && result.creatorId && result.creatorId !== uid) {
        try {
            const creatorSnap = await db.collection('users').doc(result.creatorId).get();
            const token = creatorSnap.data()?.expoPushToken;
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
        } catch {
            console.error('[CheckIn] request_notification_failed');
        }
    }

    console.info('[CheckIn] request_processed', { requested: result.requested, alreadyConfirmed: result.alreadyConfirmed });
    return { ok: true, ...result };
});

export const confirmEventCheckIn = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const targetUserId = requireStringField(data, 'targetUserId');
    if (targetUserId === uid) throw new functions.https.HttpsError('permission-denied', 'Outra pessoa deve confirmar seu check-in.');

    const eventRef = db.collection('meetings').doc(eventId);
    const targetUserRef = db.collection('users').doc(targetUserId);
    const result = await db.runTransaction(async (transaction) => {
        const [eventSnap, targetUserSnap] = await Promise.all([transaction.get(eventRef), transaction.get(targetUserRef)]);
        if (!eventSnap.exists) throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        if (!targetUserSnap.exists) throw new functions.https.HttpsError('not-found', 'Participante não encontrado.');
        const event = eventSnap.data()!;
        const attendees = stringIds(event.attendees);
        if (!attendees.includes(uid) || !attendees.includes(targetUserId) || !isCheckInWindowOpen(event, new Date())) {
            throw new functions.https.HttpsError('failed-precondition', 'Esta confirmação não está disponível.');
        }
        if (event.status && event.status !== 'active') throw new functions.https.HttpsError('failed-precondition', 'Este evento não está ativo.');
        if (stringIds(event.checkedIn).includes(targetUserId)) return { confirmed: false, title: '' };

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
            const token = targetSnap.data()?.expoPushToken;
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
        } catch {
            console.error('[CheckIn] confirmation_notification_failed');
        }
    }
    console.info('[CheckIn] confirmation_processed', { confirmed: result.confirmed });
    return { ok: true, ...result };
});

type CompleteEventResult = {
    noShows: number;
    becameFounder: boolean;
    alreadyCompleted: boolean;
};

type CompletedEventDetails = CompleteEventResult & { checkedInUserIds: string[]; title: string };

async function completeEventTransaction(eventRef: FirebaseFirestore.DocumentReference, expectedCreatorId?: string): Promise<CompletedEventDetails> {
    return db.runTransaction(async (transaction) => {
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists) throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnap.data()!;
        if (expectedCreatorId && event.createdBy !== expectedCreatorId) throw new functions.https.HttpsError('permission-denied', 'Apenas o criador pode encerrar este evento.');
        if (event.status === 'completed') return { noShows: 0, becameFounder: false, alreadyCompleted: true, checkedInUserIds: [], title: '' };
        if (event.status === 'cancelled') throw new functions.https.HttpsError('failed-precondition', 'Um evento cancelado não pode ser encerrado.');

        const eventStart = getEventStartDate(event);
        if (!eventStart || new Date() < eventStart) throw new functions.https.HttpsError('failed-precondition', 'O evento só pode ser encerrado após o horário de início.');

        const creatorId = typeof event.createdBy === 'string' ? event.createdBy : '';
        const attendees = [...new Set(stringIds(event.attendees))];
        const checkedInUserIds = [...new Set(stringIds(event.checkedIn))];
        const checkedIn = new Set(checkedInUserIds);
        const noShows = attendees.filter((attendeeId) => attendeeId !== creatorId && !checkedIn.has(attendeeId));
        const placeRef = typeof event.placeId === 'string' && event.placeId ? db.collection('places').doc(event.placeId) : null;
        const placeSnap = placeRef ? await transaction.get(placeRef) : null;
        const becameFounder = Boolean(placeRef && placeSnap?.exists && !placeSnap.data()?.founderId);

        transaction.update(eventRef, { status: 'completed', pendingCheckIns: [] });
        noShows.forEach((attendeeId) => transaction.update(db.collection('users').doc(attendeeId), { reputation: admin.firestore.FieldValue.increment(-20) }));
        if (becameFounder && placeRef && creatorId) {
            transaction.update(placeRef, { founderId: creatorId, founderName: typeof event.creatorName === 'string' ? event.creatorName : 'Fundador' });
            transaction.update(db.collection('users').doc(creatorId), { foundedPlacesCount: admin.firestore.FieldValue.increment(1) });
        }
        return { noShows: noShows.length, becameFounder, alreadyCompleted: false, checkedInUserIds, title: typeof event.title === 'string' ? event.title : 'este evento' };
    });
}

// Completion is a single trusted transaction so status, penalties and pioneer data
// cannot be partially applied or race with another event at the same place.
export const completeEvent = smallFunction.https.onCall(async (data, context): Promise<CompleteEventResult> => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const result = await completeEventTransaction(eventRef, uid);
    return { noShows: result.noShows, becameFounder: result.becameFounder, alreadyCompleted: result.alreadyCompleted };
});

function dateInSaoPaulo(daysOffset = 0): string {
    const target = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(target);
    const valueFor = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
    return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
}

// Uma única execução diária: consulta somente eventos ainda ativos de dias anteriores.
// O limite impede que um volume inesperado transforme a rotina em uma varredura cara.
export const closeExpiredEventsDaily = smallFunction.pubsub
    .schedule('10 0 * * *')
    .timeZone('America/Sao_Paulo')
    .onRun(async () => {
        const lastEligibleDate = dateInSaoPaulo(-1);
        const expiredEvents = await db.collection('meetings')
            .where('status', '==', 'active')
            .where('date', '<=', lastEligibleDate)
            .orderBy('date', 'asc')
            .limit(100)
            .get();

        let completed = 0;
        for (const eventDocument of expiredEvents.docs) {
            try {
                const result = await completeEventTransaction(eventDocument.ref);
                if (!result.alreadyCompleted) completed += 1;
            } catch {
                console.error('[EventAutoClose] completion_failed', { eventId: eventDocument.id });
            }
        }
        console.info('[EventAutoClose] daily_run_completed', { scanned: expiredEvents.size, completed });
        return null;
    });

export const cancelEvent = smallFunction.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const userRef = db.collection('users').doc(uid);

    await db.runTransaction(async (transaction) => {
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists) throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnap.data()!;
        if (event.createdBy !== uid) throw new functions.https.HttpsError('permission-denied', 'Apenas o criador pode cancelar.');
        if (event.status && event.status !== 'active') return;

        transaction.update(eventRef, { status: 'cancelled' });
        transaction.update(userRef, { reputation: admin.firestore.FieldValue.increment(-15) });
    });

    return { ok: true };
});

async function processQueryInBatches(
    query: FirebaseFirestore.Query,
    apply: (batch: FirebaseFirestore.WriteBatch, snapshot: FirebaseFirestore.QueryDocumentSnapshot) => void
) {
    const batchSize = 200;
    while (true) {
        const snapshot = await query.limit(batchSize).get();
        if (snapshot.empty) return;

        const batch = db.batch();
        snapshot.docs.forEach((document) => apply(batch, document));
        await batch.commit();

        if (snapshot.size < batchSize) return;
    }
}

export const deleteMyAccount = smallFunction.https.onCall(async (_data, context) => {
    const uid = requireAuthenticated(context);
    const userRef = db.collection('users').doc(uid);
    console.info('[AccountDeletion] started');

    // Cada atualização remove o documento do resultado da própria consulta. Isso evita
    // paginação frágil e mantém cada lote bem abaixo do limite de 500 operações.
    await processQueryInBatches(
        db.collection('meetings').where('createdBy', '==', uid),
        (batch, document) => batch.delete(document.ref)
    );
    await processQueryInBatches(
        db.collection('notifications').where('userId', '==', uid),
        (batch, document) => batch.delete(document.ref)
    );
    await processQueryInBatches(
        db.collection('reports').where('reportedBy', '==', uid),
        (batch, document) => batch.delete(document.ref)
    );
    await processQueryInBatches(
        db.collection('eventInvitations').where('inviterId', '==', uid),
        (batch, document) => batch.delete(document.ref)
    );
    await processQueryInBatches(
        db.collection('eventInvitations').where('inviteeId', '==', uid),
        (batch, document) => batch.delete(document.ref)
    );
    await processQueryInBatches(
        db.collectionGroup('messages').where('senderId', '==', uid),
        (batch, document) => batch.delete(document.ref)
    );
    await processQueryInBatches(
        db.collection('places').where('frequenters', 'array-contains', uid),
        (batch, document) => batch.update(document.ref, {
            frequenters: admin.firestore.FieldValue.arrayRemove(uid),
            [`habits.${uid}`]: admin.firestore.FieldValue.delete(),
            [`habitSchedules.${uid}`]: admin.firestore.FieldValue.delete()
        })
    );
    await processQueryInBatches(
        db.collection('meetings').where('attendees', 'array-contains', uid),
        (batch, document) => batch.update(document.ref, {
            attendees: admin.firestore.FieldValue.arrayRemove(uid),
            checkedIn: admin.firestore.FieldValue.arrayRemove(uid),
            pendingCheckIns: pendingCheckIns(document.data().pendingCheckIns).filter((request) => request.userId !== uid)
        })
    );
    await processQueryInBatches(
        db.collection('conversations').where('participants', 'array-contains', uid),
        (batch, document) => batch.update(document.ref, {
            participants: admin.firestore.FieldValue.arrayRemove(uid),
            deletedBy: admin.firestore.FieldValue.arrayUnion(uid),
            [`participantNames.${uid}`]: 'Usuário excluído',
            [`unreadCounts.${uid}`]: admin.firestore.FieldValue.delete()
        })
    );

    await userRef.delete();
    await admin.storage().bucket().deleteFiles({ prefix: `avatars/${uid}_` }).catch(() => {
        console.warn('[AccountDeletion] avatar_cleanup_failed');
    });
    await admin.auth().deleteUser(uid);
    console.info('[AccountDeletion] completed');
    return { ok: true };
});
