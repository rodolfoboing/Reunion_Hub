import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDoc, collection, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '@/src/services/firebaseConfig';
import { useEventClock } from '@/src/hooks/useEventClock';
import { STRINGS } from '@/src/constants/strings';
import { EVENT_CHAT_MESSAGE_MAX_LENGTH } from '@/src/constants/textLimits';
import type { Meeting, Message } from '@/src/types';
import { getFirebaseErrorCode } from '@/src/utils/authError';
import { setActiveNotificationTarget } from '@/src/utils/Notifications';

export default function EventChatScreen() {
    const { id } = useLocalSearchParams<{ id?: string }>();
    const eventId = typeof id === 'string' ? id : null;
    const router = useRouter();
    const now = useEventClock(15_000);
    const uid = auth.currentUser?.uid;
    const [meeting, setMeeting] = useState<Meeting | null>(null);
    const [eventLoading, setEventLoading] = useState(true);
    const [eventError, setEventError] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [messagesLoading, setMessagesLoading] = useState(true);
    const [messagesError, setMessagesError] = useState(false);
    const [names, setNames] = useState<Record<string, string>>({});
    const requestedNames = useRef(new Set<string>());
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [retryKey, setRetryKey] = useState(0);
    const [savingNotifications, setSavingNotifications] = useState(false);
    const [notificationsEnabled, setNotificationsEnabled] = useState(true);
    const [notificationsLoaded, setNotificationsLoaded] = useState(false);
    const [notificationsError, setNotificationsError] = useState(false);
    const [notificationRetryKey, setNotificationRetryKey] = useState(0);
    const sendingRef = useRef(false);
    const listRef = useRef<FlatList<Message>>(null);

    const isMember = Boolean(uid && meeting && (meeting.createdBy === uid || meeting.attendees?.includes(uid)));
    const hasEnded = Boolean(meeting?.endsAt && meeting.endsAt.toMillis() <= now.getTime());
    const isClosed = Boolean(meeting && (meeting.status === 'cancelled' || meeting.status === 'completed'
        || meeting.status === 'awaiting_review' || hasEnded));
    const canChat = Boolean(eventId && isMember && !isClosed && meeting?.endsAt);

    useFocusEffect(useCallback(() => {
        if (!eventId || !canChat) return;
        setActiveNotificationTarget({ eventChatId: eventId });
        let focused = true;
        const markRead = (loadPreference: boolean) => {
            void httpsCallable<{ eventId: string; markRead: true }, { enabled: boolean }>(functions, 'setEventChatNotifications')({ eventId, markRead: true })
                .then((result) => {
                    if (loadPreference && focused) {
                        setNotificationsEnabled(result.data.enabled);
                        setNotificationsLoaded(true);
                        setNotificationsError(false);
                    }
                })
                .catch(() => {
                    if (loadPreference && focused) setNotificationsError(true);
                    console.warn('[EventChat] mark_read_failed');
                });
        };
        setNotificationsLoaded(false);
        setNotificationsError(false);
        markRead(true);
        return () => {
            focused = false;
            setActiveNotificationTarget(null);
            markRead(false);
        };
    }, [eventId, canChat, notificationRetryKey]));

    useFocusEffect(useCallback(() => {
        if (!eventId) {
            setEventLoading(false);
            setEventError(true);
            return;
        }
        setEventLoading(true);
        setEventError(false);
        return onSnapshot(doc(db, 'meetings', eventId), (snapshot) => {
            setMeeting(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } as Meeting : null);
            setEventLoading(false);
            setEventError(!snapshot.exists());
        }, (error) => {
            console.warn('[EventChat] event_read_failed', { code: getFirebaseErrorCode(error) });
            setMeeting(null);
            setEventLoading(false);
            setEventError(true);
        });
    }, [eventId, retryKey]));

    useFocusEffect(useCallback(() => {
        if (!eventId || !canChat) {
            setMessages([]);
            setMessagesLoading(false);
            return;
        }
        setMessagesLoading(true);
        setMessagesError(false);
        const latestMessages = query(
            collection(db, 'meetings', eventId, 'chatMessages'),
            orderBy('createdAt', 'desc'),
            limit(40),
        );
        return onSnapshot(latestMessages, (snapshot) => {
            setMessages(snapshot.docs.map((message) => ({
                id: message.id,
                ...message.data() as Omit<Message, 'id'>,
            })).reverse());
            setMessagesLoading(false);
        }, (error) => {
            console.warn('[EventChat] messages_read_failed', { code: getFirebaseErrorCode(error) });
            setMessages([]);
            setMessagesLoading(false);
            setMessagesError(true);
        });
    }, [eventId, canChat, retryKey]));

    // Um perfil é lido no máximo uma vez por remetente enquanto esta tela vive.
    // A lista contém só as 40 mensagens recentes; chats vazios não leem perfis.
    useEffect(() => {
        if (!canChat) return;
        for (const message of messages) {
            const senderId = message.senderId;
            if (!senderId || senderId === uid || senderId === meeting?.createdBy || requestedNames.current.has(senderId)) continue;
            requestedNames.current.add(senderId);
            getDoc(doc(db, 'users', senderId)).then((snapshot) => {
                const profile = snapshot.data();
                const name = typeof profile?.nick === 'string' && profile.nick.trim()
                    ? profile.nick.trim()
                    : typeof profile?.displayName === 'string' && profile.displayName.trim()
                        ? profile.displayName.trim()
                        : STRINGS.EVENT_CHAT_PARTICIPANT;
                setNames((current) => ({ ...current, [senderId]: name }));
            }).catch(() => {
                setNames((current) => ({ ...current, [senderId]: STRINGS.EVENT_CHAT_PARTICIPANT }));
            });
        }
    }, [canChat, messages, uid, meeting?.createdBy]);

    const sendMessage = async () => {
        const text = draft.trim();
        if (!eventId || !uid || !canChat || !text || sendingRef.current) return;
        sendingRef.current = true;
        setSending(true);
        setDraft('');
        try {
            await addDoc(collection(db, 'meetings', eventId, 'chatMessages'), {
                senderId: uid,
                text,
                createdAt: serverTimestamp(),
            });
        } catch {
            setDraft((current) => current || text);
            Alert.alert(STRINGS.EVENT_CHAT_TITLE, STRINGS.EVENT_CHAT_SEND_ERROR);
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    };

    const toggleNotifications = async (enabled: boolean) => {
        if (!eventId || savingNotifications) return;
        setSavingNotifications(true);
        try {
            const result = await httpsCallable<{ eventId: string; enabled: boolean }, { enabled: boolean }>(functions, 'setEventChatNotifications')({ eventId, enabled });
            setNotificationsEnabled(result.data.enabled);
        } catch {
            Alert.alert(STRINGS.EVENT_CHAT_TITLE, STRINGS.EVENT_CHAT_NOTIFICATIONS_ERROR);
        } finally {
            setSavingNotifications(false);
        }
    };

    const senderName = (message: Message): string => {
        if (message.senderId === uid) return STRINGS.EVENT_CHAT_YOU;
        if (message.senderId === meeting?.createdBy) return meeting?.creatorName || STRINGS.EVENT_CHAT_ORGANIZER;
        return names[message.senderId] || STRINGS.EVENT_CHAT_PARTICIPANT;
    };

    return (
        <SafeAreaView style={styles.container} edges={['bottom']}>
            <Stack.Screen options={{ title: STRINGS.EVENT_CHAT_TITLE, headerBackTitle: STRINGS.BTN_BACK }} />
            {eventLoading ? (
                <View style={styles.center}><ActivityIndicator color="#4F46E5" /></View>
            ) : eventError || !meeting ? (
                <View style={styles.center}>
                    <Text style={styles.stateText}>{STRINGS.EVENT_CHAT_LOADING_ERROR}</Text>
                    <TouchableOpacity onPress={() => setRetryKey((current) => current + 1)}><Text style={styles.backText}>{STRINGS.EVENT_CHAT_RETRY}</Text></TouchableOpacity>
                </View>
            ) : !canChat ? (
                <View style={styles.center}>
                    <Ionicons name="lock-closed-outline" size={30} color="#6B7280" />
                    <Text style={styles.stateText}>{isClosed ? STRINGS.EVENT_CHAT_CLOSED : STRINGS.EVENT_CHAT_UNAVAILABLE}</Text>
                    <TouchableOpacity onPress={() => router.back()}><Text style={styles.backText}>{STRINGS.EVENT_CHAT_BACK}</Text></TouchableOpacity>
                </View>
            ) : (
                <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
                    <Text style={styles.hint}>{STRINGS.EVENT_CHAT_HINT}</Text>
                    <View style={styles.notificationRow}>
                        <View style={styles.notificationText}>
                            <Text style={styles.notificationLabel}>{STRINGS.EVENT_CHAT_NOTIFICATIONS_LABEL}</Text>
                            <Text style={styles.notificationHelp}>{STRINGS.EVENT_CHAT_NOTIFICATIONS_HELP}</Text>
                            {notificationsError && <TouchableOpacity onPress={() => setNotificationRetryKey((current) => current + 1)} accessibilityRole="button"><Text style={styles.notificationRetry}>{STRINGS.EVENT_CHAT_NOTIFICATIONS_RETRY}</Text></TouchableOpacity>}
                        </View>
                        <Switch value={notificationsEnabled} onValueChange={(enabled) => void toggleNotifications(enabled)} disabled={savingNotifications || !notificationsLoaded} accessibilityLabel={STRINGS.EVENT_CHAT_NOTIFICATIONS_LABEL} />
                    </View>
                    {messagesError ? (
                        <View style={styles.center}>
                            <Text style={styles.stateText}>{STRINGS.EVENT_CHAT_LOADING_ERROR}</Text>
                            <TouchableOpacity onPress={() => setRetryKey((current) => current + 1)}><Text style={styles.backText}>{STRINGS.EVENT_CHAT_RETRY}</Text></TouchableOpacity>
                        </View>
                    ) : messagesLoading ? (
                        <View style={styles.center}><ActivityIndicator color="#4F46E5" /></View>
                    ) : (
                        <FlatList
                            ref={listRef}
                            style={styles.flex}
                            data={messages}
                            keyExtractor={(message) => message.id}
                            contentContainerStyle={styles.messageList}
                            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
                            ListEmptyComponent={<Text style={styles.emptyText}>{STRINGS.EVENT_CHAT_EMPTY}</Text>}
                            renderItem={({ item }) => {
                                const mine = item.senderId === uid;
                                const sentAt = item.createdAt?.toDate();
                                return (
                                    <View style={[styles.messageRow, mine && styles.myRow]}>
                                        <View style={[styles.bubble, mine && styles.myBubble]}>
                                            {mine ? (
                                                <Text style={[styles.senderName, styles.myText]}>{senderName(item)}</Text>
                                            ) : (
                                                <TouchableOpacity onPress={() => router.push(`/public-profile/${item.senderId}` as never)} accessibilityRole="button">
                                                    <Text style={styles.senderName}>{senderName(item)}</Text>
                                                </TouchableOpacity>
                                            )}
                                            <Text style={[styles.messageText, mine && styles.myText]}>{item.text}</Text>
                                            {sentAt && <Text style={[styles.timeText, mine && styles.myTimeText]}>{sentAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</Text>}
                                        </View>
                                    </View>
                                );
                            }}
                        />
                    )}
                    <View style={styles.composer}>
                        <TextInput
                            style={styles.input}
                            placeholder={STRINGS.EVENT_CHAT_PLACEHOLDER}
                            placeholderTextColor="#9CA3AF"
                            value={draft}
                            onChangeText={setDraft}
                            maxLength={EVENT_CHAT_MESSAGE_MAX_LENGTH}
                            multiline
                            editable={!sending}
                        />
                        <TouchableOpacity
                            style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}
                            onPress={() => void sendMessage()}
                            disabled={!draft.trim() || sending}
                            accessibilityRole="button"
                            accessibilityLabel={STRINGS.EVENT_CHAT_SEND_ACCESSIBILITY}
                        >
                            <Ionicons name="send" size={19} color="#fff" />
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    flex: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
    stateText: { color: '#6B7280', textAlign: 'center', fontSize: 15 },
    backText: { color: '#4F46E5', fontWeight: '600', marginTop: 8 },
    hint: { backgroundColor: '#EEF2FF', color: '#4338CA', fontSize: 12, paddingHorizontal: 16, paddingVertical: 10 },
    notificationRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
    notificationText: { flex: 1, paddingRight: 12 },
    notificationLabel: { color: '#111827', fontSize: 14, fontWeight: '600' },
    notificationHelp: { color: '#6B7280', fontSize: 11, marginTop: 2 },
    notificationRetry: { color: '#4F46E5', fontSize: 12, fontWeight: '600', marginTop: 4 },
    messageList: { padding: 16, flexGrow: 1, justifyContent: 'flex-end', gap: 10 },
    emptyText: { color: '#6B7280', textAlign: 'center', marginVertical: 24 },
    messageRow: { flexDirection: 'row' },
    myRow: { justifyContent: 'flex-end' },
    bubble: { maxWidth: '84%', padding: 11, borderRadius: 14, backgroundColor: '#F3F4F6' },
    myBubble: { backgroundColor: '#4F46E5' },
    senderName: { color: '#4338CA', fontSize: 12, fontWeight: '700', marginBottom: 4 },
    messageText: { color: '#111827', fontSize: 15 },
    myText: { color: '#fff' },
    timeText: { color: '#6B7280', fontSize: 10, textAlign: 'right', marginTop: 5 },
    myTimeText: { color: '#E0E7FF' },
    composer: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
    input: { flex: 1, maxHeight: 100, minHeight: 44, padding: 10, borderRadius: 12, backgroundColor: '#F3F4F6', color: '#111827' },
    sendButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#4F46E5', alignItems: 'center', justifyContent: 'center' },
    sendButtonDisabled: { opacity: 0.45 },
});
