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

        // Fetch recipient tokens
        const tokens: string[] = [];
        for (const uid of recipientIds) {
            const userSnap = await db.collection('users').doc(uid).get();
            if (userSnap.exists) {
                const token = userSnap.data()?.expoPushToken;
                if (token) tokens.push(token);
            }
        }

        await sendExpoPushNotification(
            tokens, 
            `Nova mensagem de ${senderName}`, 
            msgData.text,
            { url: `/conversation/${context.params.conversationId}` }
        );
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
                if (uid === after.creatorId) continue; // Não notificar o próprio criador
                
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
            const creatorId = after.creatorId;
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

// 4. Novo Evento (Match de Interesses)
export const onNewEventCreated = functions.firestore
    .document('meetings/{meetingId}')
    .onCreate(async (snap, context) => {
        const eventData = snap.data();
        if (!eventData || eventData.type === 'online') return;

        const eventLat = eventData.lat;
        const eventLng = eventData.lng;
        if (!eventLat || !eventLng) return;

        console.log(`[onNewEventCreated] Analisando match de interesses para o novo evento: ${eventData.title}`);

        const usersSnap = await db.collection('users').limit(500).get();
        const tokens: string[] = [];

        usersSnap.forEach(doc => {
            const userData = doc.data();
            if (doc.id === eventData.creatorId) return;

            let match = false;
            if (userData.interests && eventData.interests) {
                match = eventData.interests.some((i: string) => userData.interests.includes(i));
            }

            if (match && userData.expoPushToken) {
                tokens.push(userData.expoPushToken);
            }
        });

        const finalTokens = tokens.slice(0, 100);
        
        if (finalTokens.length > 0) {
            await sendExpoPushNotification(
                finalTokens,
                'Novo evento do seu interesse! 🔥',
                `O evento "${eventData.title}" acabou de ser criado e combina com você.`,
                { url: `/event/${context.params.meetingId}` }
            );
        }
    });

// 5. Lembrete de Evento (Cron Job diário a cada hora)
export const eventReminderCron = functions.pubsub.schedule('0 * * * *').onRun(async (context) => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    
    console.log(`[eventReminderCron] Rodando verificação para a data: ${todayStr}`);
    
    const meetingsSnap = await db.collection('meetings')
        .where('date', '==', todayStr)
        .where('status', '==', 'active')
        .get();

    if (meetingsSnap.empty) return;

    for (const doc of meetingsSnap.docs) {
        const meetingData = doc.data();
        const attendees = meetingData.attendees || [];
        if (attendees.length === 0) continue;

        if (meetingData.time) {
            const [hours, minutes] = meetingData.time.split(':').map(Number);
            const eventDate = new Date();
            eventDate.setHours(hours, minutes, 0, 0);

            const diffMs = eventDate.getTime() - now.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);

            // Avisa se faltam entre 1 e 2 horas
            if (diffHours > 1 && diffHours <= 2) {
                console.log(`[eventReminderCron] Evento "${meetingData.title}" começa em breve. Disparando lembretes para ${attendees.length} pessoas.`);
                const tokens: string[] = [];
                for (const uid of attendees) {
                    const userSnap = await db.collection('users').doc(uid).get();
                    if (userSnap.exists) {
                        const token = userSnap.data()?.expoPushToken;
                        if (token) tokens.push(token);
                    }
                }

                await sendExpoPushNotification(
                    tokens,
                    'Seu evento é hoje! ⏰',
                    `Lembre-se: "${meetingData.title}" começa em breve. Não esqueça de fazer Check-in para ganhar reputação!`,
                    { url: `/event/${doc.id}` }
                );
            }
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

export const completeEvent = functions.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const eventId = requireEventId(data);
    const eventRef = db.collection('meetings').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) throw new functions.https.HttpsError('not-found', 'Evento não encontrado.');

    const event = eventSnap.data()!;
    if (event.createdBy !== uid) throw new functions.https.HttpsError('permission-denied', 'Apenas o criador pode encerrar.');
    if (event.status === 'completed') return { ok: true, noShows: 0 };

    const attendees: string[] = event.attendees || [];
    if (attendees.length > 100) throw new functions.https.HttpsError('resource-exhausted', 'Evento excede o limite de participantes.');
    const checkedIn = new Set<string>(event.checkedIn || []);
    const noShows = attendees.filter(attendee => attendee !== uid && !checkedIn.has(attendee));
    const batch = db.batch();
    batch.update(eventRef, { status: 'completed' });
    noShows.forEach(attendee => {
        batch.update(db.collection('users').doc(attendee), { reputation: admin.firestore.FieldValue.increment(-20) });
    });
    await batch.commit();
    return { ok: true, noShows: noShows.length };
});

function requireString(data: unknown, key: string, maxLength = 2000): string {
    const value = data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : null;
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
        throw new functions.https.HttpsError('invalid-argument', `${key} inválido.`);
    }
    return value.trim();
}

function isBlocked(user: FirebaseFirestore.DocumentSnapshot, otherUid: string): boolean {
    return (user.data()?.blockedUsers || []).includes(otherUid);
}

export const startDirectConversation = functions.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const targetUid = requireString(data, 'targetUid', 128);
    if (uid === targetUid) throw new functions.https.HttpsError('invalid-argument', 'Você não pode iniciar uma conversa consigo mesmo.');
    const [currentUser, targetUser] = await Promise.all([
        db.collection('users').doc(uid).get(), db.collection('users').doc(targetUid).get()
    ]);
    if (!targetUser.exists) throw new functions.https.HttpsError('not-found', 'Usuário não encontrado.');
    if (isBlocked(currentUser, targetUid) || isBlocked(targetUser, uid)) {
        throw new functions.https.HttpsError('permission-denied', 'Esta conversa não está disponível.');
    }
    const participants = [uid, targetUid].sort();
    const conversationRef = db.collection('conversations').doc(`${participants[0]}_${participants[1]}`);
    await conversationRef.set({
        participants,
        participantNames: {
            [uid]: currentUser.data()?.nick || currentUser.data()?.displayName || 'Usuário',
            [targetUid]: targetUser.data()?.nick || targetUser.data()?.displayName || 'Usuário'
        },
        lastMessage: '',
        lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        unreadCounts: { [uid]: 0, [targetUid]: 0 }
    }, { merge: true });
    return { conversationId: conversationRef.id, name: targetUser.data()?.nick || targetUser.data()?.displayName || 'Usuário' };
});

export const sendDirectMessage = functions.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const conversationId = requireString(data, 'conversationId', 256);
    const text = requireString(data, 'text');
    const conversationRef = db.collection('conversations').doc(conversationId);
    const conversationSnap = await conversationRef.get();
    if (!conversationSnap.exists) throw new functions.https.HttpsError('not-found', 'Conversa não encontrada.');
    const participants: string[] = conversationSnap.data()!.participants || [];
    const otherUid = participants.find(participant => participant !== uid);
    if (!otherUid || !participants.includes(uid)) throw new functions.https.HttpsError('permission-denied', 'Sem acesso a esta conversa.');
    const [currentUser, otherUser] = await Promise.all([
        db.collection('users').doc(uid).get(), db.collection('users').doc(otherUid).get()
    ]);
    if (!otherUser.exists || isBlocked(currentUser, otherUid) || isBlocked(otherUser, uid)) {
        throw new functions.https.HttpsError('permission-denied', 'Esta conversa não está disponível.');
    }
    const batch = db.batch();
    batch.create(conversationRef.collection('messages').doc(), { text, senderId: uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    batch.update(conversationRef, {
        lastMessage: text,
        lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        lastSenderId: uid,
        deletedBy: [],
        [`unreadCounts.${otherUid}`]: admin.firestore.FieldValue.increment(1)
    });
    await batch.commit();
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
