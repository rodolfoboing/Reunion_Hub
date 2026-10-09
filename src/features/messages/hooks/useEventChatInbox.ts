import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { collection, limit, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { db } from '@/src/services/firebaseConfig';
import type { Meeting } from '@/src/types';
import { getFirebaseErrorCode } from '@/src/utils/authError';

const EVENT_CHAT_LIST_LIMIT = 40;

/** Consulta apenas os eventos ativos da pessoa; nunca lê mensagens dos grupos. */
export function useEventChatInbox(userId: string | undefined) {
    const [events, setEvents] = useState<Meeting[]>([]);
    const [unreadEventIds, setUnreadEventIds] = useState<Set<string>>(new Set());
    const [nowMs, setNowMs] = useState(Date.now);
    const [loading, setLoading] = useState(true);
    const [eventsError, setEventsError] = useState(false);
    const [notificationsError, setNotificationsError] = useState(false);
    const [retryKey, setRetryKey] = useState(0);

    useFocusEffect(useCallback(() => {
        if (!userId) {
            setEvents([]);
            setUnreadEventIds(new Set());
            setLoading(false);
            return;
        }

        const currentTime = Date.now();
        setNowMs(currentTime);
        const clock = setInterval(() => setNowMs(Date.now()), 30_000);
        const eventsQuery = query(
            collection(db, 'meetings'),
            where('attendees', 'array-contains', userId),
            where('status', '==', 'active'),
            where('endsAt', '>', Timestamp.fromMillis(currentTime)),
            orderBy('endsAt', 'asc'),
            limit(EVENT_CHAT_LIST_LIMIT),
        );
        const notificationsQuery = query(
            collection(db, 'notifications'),
            where('userId', '==', userId),
            where('type', '==', 'event_chat'),
            where('read', '==', false),
            limit(EVENT_CHAT_LIST_LIMIT),
        );
        const unsubscribeEvents = onSnapshot(eventsQuery, (snapshot) => {
            setEvents(snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as Meeting)));
            setEventsError(false);
            setLoading(false);
        }, (error) => {
            console.warn('[EventChatInbox] events_read_failed', { code: getFirebaseErrorCode(error) });
            setEvents([]);
            setEventsError(true);
            setLoading(false);
        });
        const unsubscribeNotifications = onSnapshot(notificationsQuery, (snapshot) => {
            setUnreadEventIds(new Set(snapshot.docs.flatMap((document) => {
                const eventId = document.data().eventChatId;
                return typeof eventId === 'string' ? [eventId] : [];
            })));
            setNotificationsError(false);
        }, (error) => {
            console.warn('[EventChatInbox] notifications_read_failed', { code: getFirebaseErrorCode(error) });
            setUnreadEventIds(new Set());
            setNotificationsError(true);
        });
        return () => {
            clearInterval(clock);
            unsubscribeEvents();
            unsubscribeNotifications();
        };
    }, [userId, retryKey]));

    const activeEvents = events.filter((event) => event.endsAt && event.endsAt.toMillis() > nowMs);
    return {
        eventChats: activeEvents,
        unreadEventIds,
        loading,
        error: eventsError || notificationsError,
        retry: () => setRetryKey((current) => current + 1),
    };
}
