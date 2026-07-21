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
