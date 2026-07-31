import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../../src/services/firebaseConfig';
import { Notification } from '../../src/types';

const getIconName = (type: string): keyof typeof Ionicons.glyphMap => {
    if (type === 'chat') return 'chatbubble-outline';
    if (type === 'online_access_issue') return 'link-outline';
    if (type.includes('event')) return 'calendar-outline';
    return 'notifications-outline';
};

const formatTime = (value: Notification['createdAt']) => {
    if (!value || typeof value.toDate !== 'function') return 'Agora';
    const date = value.toDate() as Date;
    const diffMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (diffMinutes < 1) return 'Agora';
    if (diffMinutes < 60) return `Há ${diffMinutes} min`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `Há ${diffHours} h`;
    return date.toLocaleDateString('pt-BR');
};

export default function NotificationsScreen() {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        let unsubscribeNotifications: (() => void) | undefined;
        const unsubscribeAuth = auth.onAuthStateChanged((user) => {
            if (unsubscribeNotifications) {
                unsubscribeNotifications();
                unsubscribeNotifications = undefined;
            }
            if (!user) {
                setNotifications([]);
                setLoading(false);
                return;
            }

            const notificationsQuery = query(
                collection(db, 'notifications'),
                where('userId', '==', user.uid),
                orderBy('createdAt', 'desc'),
                limit(50)
            );
            unsubscribeNotifications = onSnapshot(notificationsQuery, (snapshot) => {
                setNotifications(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Notification)));
                setError(false);
                setLoading(false);
            }, (listenerError) => {
                console.error('[Notifications] Erro ao carregar notificações:', listenerError);
                setError(true);
                setLoading(false);
            });
        });

        return () => {
            unsubscribeAuth();
            if (unsubscribeNotifications) unsubscribeNotifications();
        };
    }, []);

    const unreadNotifications = useMemo(() => notifications.filter((notification) => !notification.read), [notifications]);

    const openNotification = async (notification: Notification) => {
        if (!notification.read) {
            try {
                await updateDoc(doc(db, 'notifications', notification.id), { read: true });
            } catch (updateError) {
                console.error('[Notifications] Erro ao marcar notificação como lida:', updateError);
            }
        }

        if (notification.conversationId) {
            router.push(`/conversation/${notification.conversationId}` as never);
            return;
        }
        if (notification.meetingId) router.push(`/event/${notification.meetingId}` as never);
    };

    const markAllAsRead = async () => {
        if (unreadNotifications.length === 0) return;
        try {
            const batch = writeBatch(db);
            unreadNotifications.forEach((notification) => batch.update(doc(db, 'notifications', notification.id), { read: true }));
            await batch.commit();
        } catch (batchError) {
            console.error('[Notifications] Erro ao marcar todas como lidas:', batchError);
        }
    };

    const renderItem = ({ item }: { item: Notification }) => (
        <TouchableOpacity style={[styles.card, !item.read && styles.unreadCard]} onPress={() => openNotification(item)} activeOpacity={0.75}>
            <View style={[styles.iconContainer, !item.read && styles.unreadIconContainer]}>
                <Ionicons name={getIconName(item.type)} size={22} color={item.read ? '#6B7280' : '#4F46E5'} />
            </View>
            <View style={styles.contentContainer}>
                <View style={styles.headerRow}>
                    <Text style={[styles.cardTitle, !item.read && styles.unreadText]} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.timeText}>{formatTime(item.createdAt)}</Text>
                </View>
                <Text style={styles.cardBody} numberOfLines={2}>{item.body}</Text>
            </View>
            {!item.read && <View style={styles.dot} />}
        </TouchableOpacity>
    );

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <View style={styles.header}>
                <View>
                    <Text style={styles.headerTitle}>Notificações</Text>
                    {unreadNotifications.length > 0 && <Text style={styles.headerSubtitle}>{unreadNotifications.length} não lida(s)</Text>}
                </View>
                <TouchableOpacity disabled={unreadNotifications.length === 0} onPress={markAllAsRead} style={styles.readAllButton}>
                    <Text style={[styles.readAllText, unreadNotifications.length === 0 && styles.readAllTextDisabled]}>Ler todas</Text>
                </TouchableOpacity>
            </View>

            {loading ? (
                <View style={styles.center}><ActivityIndicator size="large" color="#4F46E5" /></View>
            ) : error ? (
                <View style={styles.center}><Text style={styles.emptyText}>Não foi possível carregar as notificações.</Text></View>
            ) : (
                <FlatList
                    data={notifications}
                    renderItem={renderItem}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={<View style={styles.emptyContainer}><Ionicons name="notifications-off-outline" size={48} color="#9CA3AF" /><Text style={styles.emptyText}>Nenhuma notificação por enquanto</Text></View>}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F3F4F6' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
    headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#111827' },
    headerSubtitle: { marginTop: 2, fontSize: 12, fontWeight: '600', color: '#6366F1' },
    readAllButton: { paddingVertical: 8, paddingHorizontal: 10 },
    readAllText: { color: '#4F46E5', fontSize: 14, fontWeight: '700' },
    readAllTextDisabled: { color: '#9CA3AF' },
    listContent: { padding: 16, paddingBottom: 24 },
    card: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 12, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, borderLeftWidth: 4, borderLeftColor: 'transparent' },
    unreadCard: { borderLeftColor: '#4F46E5', backgroundColor: '#EEF2FF' },
    iconContainer: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
    unreadIconContainer: { backgroundColor: '#E0E7FF' },
    contentContainer: { flex: 1 },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    cardTitle: { fontSize: 15, fontWeight: '600', color: '#374151', flex: 1, marginRight: 8 },
    unreadText: { color: '#111827', fontWeight: '800' },
    cardBody: { fontSize: 13, color: '#6B7280', lineHeight: 19 },
    timeText: { fontSize: 11, color: '#9CA3AF' },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4F46E5', marginLeft: 8 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
    emptyText: { marginTop: 16, fontSize: 15, textAlign: 'center', color: '#6B7280' },
});
