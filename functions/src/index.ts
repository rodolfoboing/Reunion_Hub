import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

// Helper: Envio de Push Notifications via API HTTP do Expo
async function sendExpoPushNotification(pushTokens: string[], title: string, body: string, data: any = {}) {
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
        
        const result = await response.json();
        console.log(`[Push Notification] Sucesso. Título: "${title}". Resultado:`, JSON.stringify(result));
    } catch (error) {
        console.error('[Push Notification] Falha ao enviar requisição HTTP para o Expo:', error);
    }
}

// 1. Notificação de Chat: Avisa participantes quando uma nova mensagem é enviada
export const onNewChatMessage = functions.firestore
    .document('conversations/{conversationId}/messages/{messageId}')
    .onCreate(async (snap, context) => {
        const msgData = snap.data();
        if (!msgData || !msgData.senderId || !msgData.text) return;

        const conversationRef = db.collection('conversations').doc(context.params.conversationId);
        const conversationSnap = await conversationRef.get();
        if (!conversationSnap.exists) {
            console.warn(`[onNewChatMessage] Conversa ${context.params.conversationId} não encontrada.`);
            return;
        }
        
        const conversationData = conversationSnap.data();
        const participants = conversationData?.participants || [];
        
        const recipientIds = participants.filter((id: string) => id !== msgData.senderId);
        if (recipientIds.length === 0) return;

        console.log(`[onNewChatMessage] Processando mensagem de ${msgData.senderId} para ${recipientIds.length} recebedores.`);

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

// 2. Notificação de Evento Cancelado
export const onEventCancelled = functions.firestore
    .document('meetings/{meetingId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();

        if (before.status !== 'cancelled' && after.status === 'cancelled') {
            console.log(`[onEventCancelled] Evento ${context.params.meetingId} foi cancelado. Buscando inscritos...`);
            const attendees = after.attendees || [];
            if (attendees.length === 0) return;

            const tokens: string[] = [];
            for (const uid of attendees) {
                if (uid === after.createdBy) continue; // Não notificar o próprio criador
                
                const userSnap = await db.collection('users').doc(uid).get();
                if (userSnap.exists) {
                    const token = userSnap.data()?.expoPushToken;
                    if (token) tokens.push(token);
                }
            }

            await sendExpoPushNotification(
                tokens,
                'Evento Cancelado 😔',
                `O evento "${after.title}" foi cancelado pelo organizador.`,
                { url: `/event/${context.params.meetingId}` }
            );
        }
    });

// 3. Notificação do Primeiro Inscrito
export const onFirstRSVP = functions.firestore
    .document('meetings/{meetingId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();

        const beforeCount = before.attendees?.length || 0;
        const afterCount = after.attendees?.length || 0;

        if (beforeCount === 1 && afterCount === 2) {
            console.log(`[onFirstRSVP] Evento ${context.params.meetingId} recebeu o primeiro convidado!`);
            const creatorId = after.createdBy;
            if (!creatorId) return;

            const creatorSnap = await db.collection('users').doc(creatorId).get();
            if (!creatorSnap.exists) return;

            const token = creatorSnap.data()?.expoPushToken;
            if (token) {
                await sendExpoPushNotification(
                    [token],
                    'Primeiro Confirmado! 🎉',
                    `Alguém acabou de confirmar presença no seu evento "${after.title}".`,
                    { url: `/event/${context.params.meetingId}` }
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

// Mutations that change attendance, reputation or event status run in trusted code.
// They read only the event and the requesting user's profile; no collection scan is used.
export const rsvpToEvent = functions.https.onCall(async (data, context) => {
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

export const checkInToEvent = functions.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const userRef = db.collection('users').doc(uid);
    const today = new Date().toISOString().slice(0, 10);

    await db.runTransaction(async (transaction) => {
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists) throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');
        const event = eventSnap.data()!;
        if (event.date !== today || !(event.attendees || []).includes(uid)) {
            throw new functions.https.HttpsError('failed-precondition', 'Check-in indisponível para este evento.');
        }
        if ((event.checkedIn || []).includes(uid)) return;

        transaction.update(eventRef, { checkedIn: admin.firestore.FieldValue.arrayUnion(uid) });
        transaction.update(userRef, {
            reputation: admin.firestore.FieldValue.increment(10),
            eventsAttended: admin.firestore.FieldValue.increment(1)
        });
    });

    return { ok: true };
});

type CompleteEventResult = {
    noShows: number;
    becameFounder: boolean;
    alreadyCompleted: boolean;
};

// Completion is a single trusted transaction so status, penalties and pioneer data
// cannot be partially applied or race with another event at the same place.
export const completeEvent = functions.https.onCall(async (data, context): Promise<CompleteEventResult> => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const creatorRef = db.collection('users').doc(uid);

    return db.runTransaction(async (transaction) => {
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists) throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');

        const event = eventSnap.data()!;
        if (event.createdBy !== uid) {
            throw new functions.https.HttpsError('permission-denied', 'Apenas o criador pode encerrar este evento.');
        }
        if (event.status === 'completed') {
            return { noShows: 0, becameFounder: false, alreadyCompleted: true };
        }
        if (event.status === 'cancelled') {
            throw new functions.https.HttpsError('failed-precondition', 'Um evento cancelado não pode ser encerrado.');
        }

        const attendees = Array.isArray(event.attendees) ? event.attendees : [];
        const checkedIn = new Set(Array.isArray(event.checkedIn) ? event.checkedIn : []);
        const noShows = [...new Set(attendees)].filter((attendeeId) => attendeeId !== uid && !checkedIn.has(attendeeId));

        const placeRef = typeof event.placeId === 'string' && event.placeId
            ? db.collection('places').doc(event.placeId)
            : null;
        const placeSnap = placeRef ? await transaction.get(placeRef) : null;
        const becameFounder = Boolean(placeRef && placeSnap?.exists && !placeSnap.data()?.founderId);

        transaction.update(eventRef, { status: 'completed' });
        noShows.forEach((attendeeId) => {
            transaction.update(db.collection('users').doc(attendeeId), {
                reputation: admin.firestore.FieldValue.increment(-20),
            });
        });

        if (becameFounder && placeRef) {
            transaction.update(placeRef, {
                founderId: uid,
                founderName: typeof event.creatorName === 'string' ? event.creatorName : 'Fundador',
            });
            transaction.update(creatorRef, {
                foundedPlacesCount: admin.firestore.FieldValue.increment(1),
            });
        }

        return { noShows: noShows.length, becameFounder, alreadyCompleted: false };
    });
});

export const cancelEvent = functions.https.onCall(async (data, context) => {
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

export const deleteMyAccount = functions.https.onCall(async (_data, context) => {
    const uid = requireAuthenticated(context);
    const userRef = db.collection('users').doc(uid);
    const [createdEvents, notifications, reports, places, conversations, messages] = await Promise.all([
        db.collection('meetings').where('createdBy', '==', uid).limit(60).get(),
        db.collection('notifications').where('userId', '==', uid).limit(60).get(),
        db.collection('reports').where('reportedBy', '==', uid).limit(60).get(),
        db.collection('places').where('frequenters', 'array-contains', uid).limit(60).get(),
        db.collection('conversations').where('participants', 'array-contains', uid).limit(60).get(),
        db.collectionGroup('messages').where('senderId', '==', uid).limit(60).get()
    ]);

    const batch = db.batch();
    createdEvents.docs.forEach(snapshot => batch.delete(snapshot.ref));
    notifications.docs.forEach(snapshot => batch.delete(snapshot.ref));
    reports.docs.forEach(snapshot => batch.delete(snapshot.ref));
    messages.docs.forEach(snapshot => batch.delete(snapshot.ref));
    places.docs.forEach(snapshot => batch.update(snapshot.ref, {
        frequenters: admin.firestore.FieldValue.arrayRemove(uid),
        [`habits.${uid}`]: admin.firestore.FieldValue.delete()
    }));
    conversations.docs.forEach(snapshot => batch.update(snapshot.ref, {
        deletedBy: admin.firestore.FieldValue.arrayUnion(uid),
        [`participantNames.${uid}`]: 'Usuário excluído'
    }));
    batch.delete(userRef);
    await batch.commit();

    await admin.storage().bucket().deleteFiles({ prefix: `avatars/${uid}_` });
    await admin.auth().deleteUser(uid);
    return { ok: true };
});
