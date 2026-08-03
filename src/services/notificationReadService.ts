import { collection, doc, getDocs, limit, query, where, writeBatch } from 'firebase/firestore';
import { auth, db } from '@/src/services/firebaseConfig';
import { NotificationTarget } from '@/src/utils/Notifications';

const RELATED_NOTIFICATIONS_LIMIT = 20;

export async function markRelatedNotificationsAsRead(target: NotificationTarget): Promise<void> {
    const userId = auth.currentUser?.uid;
    const targetField = target.conversationId ? 'conversationId' : target.meetingId ? 'meetingId' : null;
    const targetId = target.conversationId ?? target.meetingId;
    if (!userId || !targetField || !targetId) return;

    const notificationsQuery = query(
        collection(db, 'notifications'),
        where('userId', '==', userId),
        where(targetField, '==', targetId),
        where('read', '==', false),
        limit(RELATED_NOTIFICATIONS_LIMIT)
    );
    const snapshot = await getDocs(notificationsQuery);
    if (snapshot.empty) return;

    const batch = writeBatch(db);
    snapshot.docs.forEach((notification) => batch.update(doc(db, 'notifications', notification.id), { read: true }));
    await batch.commit();
    console.log(`[Notifications] ${snapshot.size} notificação(ões) marcada(s) como lida(s) para ${targetField}.`);
}
