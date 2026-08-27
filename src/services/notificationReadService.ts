import { collection, doc, getDocs, limit, query, where, writeBatch } from 'firebase/firestore';
import { auth, db } from '@/src/services/firebaseConfig';
import { NotificationTarget } from '@/src/utils/Notifications';

const NOTIFICATION_UPDATE_BATCH_SIZE = 200;

async function markQueryAsRead(createQuery: () => ReturnType<typeof query>): Promise<number> {
    let updated = 0;
    while (true) {
        const snapshot = await getDocs(createQuery());
        if (snapshot.empty) return updated;

        const batch = writeBatch(db);
        snapshot.docs.forEach((notification) => batch.update(doc(db, 'notifications', notification.id), { read: true }));
        await batch.commit();
        updated += snapshot.size;
        if (snapshot.size < NOTIFICATION_UPDATE_BATCH_SIZE) return updated;
    }
}

export async function markRelatedNotificationsAsRead(target: NotificationTarget): Promise<void> {
    const userId = auth.currentUser?.uid;
    const targetField = target.conversationId
        ? 'conversationId'
        : target.meetingId
            ? 'meetingId'
            : target.notificationType
                ? 'type'
                : null;
    const targetId = target.conversationId ?? target.meetingId ?? target.notificationType;
    if (!userId || !targetField || !targetId) return;

    const updated = await markQueryAsRead(() => query(
        collection(db, 'notifications'),
        where('userId', '==', userId),
        where(targetField, '==', targetId),
        where('read', '==', false),
        limit(NOTIFICATION_UPDATE_BATCH_SIZE)
    ));
    if (__DEV__ && updated > 0) console.info('[Notifications] related_marked_read', { count: updated, targetField });
}

export async function markAllNotificationsAsRead(): Promise<number> {
    const userId = auth.currentUser?.uid;
    if (!userId) return 0;
    return markQueryAsRead(() => query(
        collection(db, 'notifications'),
        where('userId', '==', userId),
        where('read', '==', false),
        limit(NOTIFICATION_UPDATE_BATCH_SIZE)
    ));
}
