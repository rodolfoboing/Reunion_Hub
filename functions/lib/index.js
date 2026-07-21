"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventReminderCron = exports.onNewEventCreated = exports.onFirstRSVP = exports.onEventCancelled = exports.onNewChatMessage = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
// Helper to send push notifications via Expo HTTP API
async function sendExpoPushNotification(pushTokens, title, body, data = {}) {
    if (!pushTokens || pushTokens.length === 0)
        return;
    // Filter out invalid tokens
    const validTokens = pushTokens.filter(token => token && token.startsWith('ExponentPushToken'));
    if (validTokens.length === 0)
        return;
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
        console.log('Push sent result:', JSON.stringify(result));
    }
    catch (error) {
        console.error('Error sending push notification:', error);
    }
}
// 1. Chat Notification: Notify participants when a new message is sent
exports.onNewChatMessage = functions.firestore
    .document('conversations/{conversationId}/messages/{messageId}')
    .onCreate(async (snap, context) => {
    var _a, _b, _c;
    const msgData = snap.data();
    if (!msgData || !msgData.senderId || !msgData.text)
        return;
    const conversationRef = db.collection('conversations').doc(context.params.conversationId);
    const conversationSnap = await conversationRef.get();
    if (!conversationSnap.exists)
        return;
    const conversationData = conversationSnap.data();
    const participants = (conversationData === null || conversationData === void 0 ? void 0 : conversationData.participants) || [];
    // Find recipient(s)
    const recipientIds = participants.filter((id) => id !== msgData.senderId);
    if (recipientIds.length === 0)
        return;
    // Fetch sender details
    let senderName = 'Alguém';
    const senderSnap = await db.collection('users').doc(msgData.senderId).get();
    if (senderSnap.exists) {
        senderName = ((_a = senderSnap.data()) === null || _a === void 0 ? void 0 : _a.nick) || ((_b = senderSnap.data()) === null || _b === void 0 ? void 0 : _b.displayName) || senderName;
    }
    // Fetch recipient tokens
    const tokens = [];
    for (const uid of recipientIds) {
        const userSnap = await db.collection('users').doc(uid).get();
        if (userSnap.exists) {
            const token = (_c = userSnap.data()) === null || _c === void 0 ? void 0 : _c.expoPushToken;
            if (token)
                tokens.push(token);
        }
    }
    await sendExpoPushNotification(tokens, `Nova mensagem de ${senderName}`, msgData.text, { url: `/conversation/${context.params.conversationId}` });
});
// 2. Event Cancelled Notification
exports.onEventCancelled = functions.firestore
    .document('meetings/{meetingId}')
    .onUpdate(async (change, context) => {
    var _a;
    const before = change.before.data();
    const after = change.after.data();
    // Check if status changed to cancelled
    if (before.status !== 'cancelled' && after.status === 'cancelled') {
        const attendees = after.attendees || [];
        if (attendees.length === 0)
            return;
        const tokens = [];
        for (const uid of attendees) {
            // Don't notify the creator
            if (uid === after.creatorId)
                continue;
            const userSnap = await db.collection('users').doc(uid).get();
            if (userSnap.exists) {
                const token = (_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.expoPushToken;
                if (token)
                    tokens.push(token);
            }
        }
        await sendExpoPushNotification(tokens, 'Evento Cancelado 😔', `O evento "${after.title}" foi cancelado pelo organizador.`, { url: `/event/${context.params.meetingId}` });
    }
});
// 3. First RSVP Notification (First attendee confirmed)
exports.onFirstRSVP = functions.firestore
    .document('meetings/{meetingId}')
    .onUpdate(async (change, context) => {
    var _a, _b, _c;
    const before = change.before.data();
    const after = change.after.data();
    // If attendees went from 0 to 1 (excluding the creator if they auto-join)
    const beforeCount = ((_a = before.attendees) === null || _a === void 0 ? void 0 : _a.length) || 0;
    const afterCount = ((_b = after.attendees) === null || _b === void 0 ? void 0 : _b.length) || 0;
    // If it's the very first confirmation (besides the creator)
    // Usually attendees array includes the creator. If creator is the only one, count is 1.
    // Let's notify the creator when a NEW person joins, but just for the "first" guest.
    if (beforeCount === 1 && afterCount === 2) {
        const creatorId = after.creatorId;
        if (!creatorId)
            return;
        const creatorSnap = await db.collection('users').doc(creatorId).get();
        if (!creatorSnap.exists)
            return;
        const token = (_c = creatorSnap.data()) === null || _c === void 0 ? void 0 : _c.expoPushToken;
        if (token) {
            await sendExpoPushNotification([token], 'Primeiro Confirmado! 🎉', `Alguém acabou de confirmar presença no seu evento "${after.title}".`, { url: `/event/${context.params.meetingId}` });
        }
    }
});
// 4. New Event Nearby / Matching Interests Notification
exports.onNewEventCreated = functions.firestore
    .document('meetings/{meetingId}')
    .onCreate(async (snap, context) => {
    const eventData = snap.data();
    if (!eventData || eventData.type === 'online')
        return; // For now, only location-based
    const eventLat = eventData.lat;
    const eventLng = eventData.lng;
    if (!eventLat || !eventLng)
        return;
    // Naive approach: Fetch all users (in a real production app with millions of users, use GeoHashes)
    // Here we just fetch a limited set or all for MVP
    const usersSnap = await db.collection('users').limit(500).get();
    const tokens = [];
    usersSnap.forEach(doc => {
        const userData = doc.data();
        if (doc.id === eventData.creatorId)
            return; // Don't notify creator
        // Simple distance check (Haversine roughly) or just notify based on interests
        // Here we prioritize interests match:
        let match = false;
        if (userData.interests && eventData.interests) {
            match = eventData.interests.some((i) => userData.interests.includes(i));
        }
        if (match && userData.expoPushToken) {
            tokens.push(userData.expoPushToken);
        }
    });
    // Limit to max 100 notifications at once for this trigger
    const finalTokens = tokens.slice(0, 100);
    if (finalTokens.length > 0) {
        await sendExpoPushNotification(finalTokens, 'Novo evento do seu interesse! 🔥', `O evento "${eventData.title}" acabou de ser criado e combina com você.`, { url: `/event/${context.params.meetingId}` });
    }
});
// 5. Event Reminder / Check-in Prompt (Runs every 1 hour)
exports.eventReminderCron = functions.pubsub.schedule('0 * * * *').onRun(async (context) => {
    var _a;
    // 0 * * * * means it runs exactly at minute 0 of every hour
    const now = new Date();
    // Look for events that happen today
    const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD format (adjust timezone if needed)
    const meetingsSnap = await db.collection('meetings')
        .where('date', '==', todayStr)
        .where('status', '==', 'active')
        .get();
    if (meetingsSnap.empty)
        return;
    for (const doc of meetingsSnap.docs) {
        const meetingData = doc.data();
        const attendees = meetingData.attendees || [];
        if (attendees.length === 0)
            continue;
        // Check if event is within the next 2 hours
        if (meetingData.time) {
            const [hours, minutes] = meetingData.time.split(':').map(Number);
            const eventDate = new Date();
            eventDate.setHours(hours, minutes, 0, 0);
            const diffMs = eventDate.getTime() - now.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);
            // If event is starting in between 1 and 2 hours
            if (diffHours > 1 && diffHours <= 2) {
                const tokens = [];
                for (const uid of attendees) {
                    const userSnap = await db.collection('users').doc(uid).get();
                    if (userSnap.exists) {
                        const token = (_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.expoPushToken;
                        if (token)
                            tokens.push(token);
                    }
                }
                await sendExpoPushNotification(tokens, 'Seu evento é hoje! ⏰', `Lembre-se: "${meetingData.title}" começa em breve. Não esqueça de fazer Check-in para ganhar reputação!`, { url: `/event/${doc.id}` });
            }
        }
    }
});
//# sourceMappingURL=index.js.map