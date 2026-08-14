import { useLocalSearchParams, router, Stack } from 'expo-router';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    ActivityIndicator,
    Image,
    Alert,
} from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { collection, doc, documentId, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../src/services/firebaseConfig';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Attendee {
    id: string;
    displayName: string;
    nick?: string;
    photoURL?: string;
    bio?: string;
    reputation?: number;
}

const ATTENDEES_PAGE_SIZE = 20;

function attendeeFromData(id: string, data: Record<string, unknown> | undefined): Attendee {
    const displayName = typeof data?.nick === 'string' && data.nick
        ? data.nick
        : typeof data?.displayName === 'string' && data.displayName
            ? data.displayName
            : 'Usuário';
    return {
        id,
        displayName,
        nick: typeof data?.nick === 'string' ? data.nick : undefined,
        photoURL: typeof data?.photoURL === 'string' ? data.photoURL : undefined,
        bio: typeof data?.bio === 'string' ? data.bio : undefined,
        reputation: typeof data?.reputation === 'number' && Number.isFinite(data.reputation) ? data.reputation : 0,
    };
}

export default function AttendeesScreen() {
    const { meetingId, meetingTitle } = useLocalSearchParams<{ meetingId?: string; meetingTitle?: string }>();
    const [attendees, setAttendees] = useState<Attendee[]>([]);
    const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState(false);
    const [loadMoreError, setLoadMoreError] = useState(false);
    const requestVersion = useRef(0);

    useEffect(() => {
        fetchAttendees(false);
        return () => { requestVersion.current += 1; };
    }, [meetingId]);

    const fetchProfiles = async (ids: string[]): Promise<Attendee[]> => {
        if (ids.length === 0) return [];
        const snapshot = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', ids)));
        const profiles = new Map(snapshot.docs.map((profile) => [profile.id, profile.data()]));
        return ids.map((id) => attendeeFromData(id, profiles.get(id)));
    };

    const fetchAttendees = async (isRefresh: boolean) => {
        const eventId = typeof meetingId === 'string' ? meetingId : '';
        const requestId = requestVersion.current + 1;
        requestVersion.current = requestId;
        if (!eventId) {
            setError(true);
            setLoading(false);
            return;
        }
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        setLoadingMore(false);
        setLoadMoreError(false);
        setError(false);
        try {
            const meetingRef = doc(db, 'meetings', eventId);
            const meetingSnap = await getDoc(meetingRef);
            if (requestVersion.current !== requestId) return;
            if (!meetingSnap.exists()) throw new Error('meeting-not-found');

            const meetingData = meetingSnap.data();
            const ids = Array.isArray(meetingData.attendees)
                ? [...new Set(meetingData.attendees.filter((id): id is string => typeof id === 'string' && id.length > 0))]
                : [];
            const firstPage = await fetchProfiles(ids.slice(0, ATTENDEES_PAGE_SIZE));
            if (requestVersion.current !== requestId) return;
            setAttendeeIds(ids);
            setAttendees(firstPage);
            setLoadMoreError(false);
        } catch {
            if (requestVersion.current === requestId) setError(true);
        } finally {
            if (requestVersion.current === requestId) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    };

    const loadMore = async () => {
        if (loadingMore || attendees.length >= attendeeIds.length) return;
        setLoadingMore(true);
        setLoadMoreError(false);
        const requestId = requestVersion.current;
        try {
            const nextIds = attendeeIds.slice(attendees.length, attendees.length + ATTENDEES_PAGE_SIZE);
            const nextProfiles = await fetchProfiles(nextIds);
            if (requestVersion.current === requestId) setAttendees((current) => [...current, ...nextProfiles]);
        } catch {
            if (requestVersion.current === requestId) setLoadMoreError(true);
        } finally {
            if (requestVersion.current === requestId) setLoadingMore(false);
        }
    };

    const navigateToProfile = (userId: string) => {
        router.push({
            pathname: '/public-profile/[id]',
            params: { id: userId }
        });
    };

    const renderAttendee = ({ item }: { item: Attendee }) => (
        <TouchableOpacity
            style={styles.attendeeCard}
            onPress={() => navigateToProfile(item.id)}
            activeOpacity={0.7}
        >
            <View style={styles.avatarContainer}>
                {item.photoURL ? (
                    <Image source={{ uri: item.photoURL }} style={styles.avatar} />
                ) : (
                    <LinearGradient
                        colors={['#6366f1', '#8b5cf6']}
                        style={styles.avatarPlaceholder}
                    >
                        <Text style={styles.avatarText}>
                            {item.displayName?.charAt(0).toUpperCase() || 'U'}
                        </Text>
                    </LinearGradient>
                )}
            </View>

            <View style={styles.attendeeInfo}>
                <Text style={styles.attendeeName}>{item.displayName}</Text>
                {item.nick && (
                    <Text style={styles.attendeeNick}>@{item.nick}</Text>
                )}
                {item.bio && (
                    <Text style={styles.attendeeBio} numberOfLines={1}>
                        {item.bio}
                    </Text>
                )}
            </View>

            <View style={styles.reputationBadge}>
                <FontAwesome name="star" size={12} color="#fbbf24" />
                <Text style={styles.reputationText}>{item.reputation}</Text>
            </View>

            <FontAwesome name="chevron-right" size={16} color="#9ca3af" />
        </TouchableOpacity>
    );

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#6366f1" />
                <Text style={styles.loadingText}>Carregando participantes...</Text>
            </View>
        );
    }

    if (error) {
        return (
            <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={styles.center}>
                    <FontAwesome name="exclamation-circle" size={44} color="#DC2626" />
                    <Text style={styles.emptyText}>Não foi possível carregar os participantes</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={() => fetchAttendees(false)}>
                        <Text style={styles.retryButtonText}>Tentar novamente</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <Stack.Screen options={{ headerShown: false }} />
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <FontAwesome name="arrow-left" size={20} color="#1f2937" />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>Participantes</Text>
                    {meetingTitle && (
                        <Text style={styles.headerSubtitle} numberOfLines={1}>
                            {meetingTitle}
                        </Text>
                    )}
                </View>
                <View style={styles.countBadge}>
                    <Text style={styles.countText}>{attendeeIds.length}</Text>
                </View>
            </View>

            {/* Lista de participantes */}
            {attendees.length === 0 ? (
                <View style={styles.emptyContainer}>
                    <FontAwesome name="users" size={48} color="#d1d5db" />
                    <Text style={styles.emptyText}>Nenhum participante ainda</Text>
                    <Text style={styles.emptySubtext}>
                        Seja o primeiro a confirmar presença!
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={attendees}
                    keyExtractor={(item) => item.id}
                    renderItem={renderAttendee}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    ItemSeparatorComponent={() => <View style={styles.separator} />}
                    refreshing={refreshing}
                    onRefresh={() => fetchAttendees(true)}
                    onEndReached={loadMore}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={loadingMore
                        ? <ActivityIndicator style={styles.footerLoader} color="#6366f1" />
                        : loadMoreError
                            ? <TouchableOpacity style={styles.loadMoreButton} onPress={loadMore}><Text style={styles.loadMoreText}>Tentar carregar mais</Text></TouchableOpacity>
                            : null}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fff',
    },
    loadingText: {
        marginTop: 12,
        color: '#6b7280',
        fontSize: 14,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    backBtn: {
        padding: 8,
        marginRight: 12,
    },
    headerTitleContainer: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    headerSubtitle: {
        fontSize: 14,
        color: '#6b7280',
        marginTop: 2,
    },
    countBadge: {
        backgroundColor: '#6366f1',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
    },
    countText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 14,
    },
    listContent: {
        padding: 16,
    },
    attendeeCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#f9fafb',
        borderRadius: 16,
    },
    avatarContainer: {
        marginRight: 12,
    },
    avatar: {
        width: 50,
        height: 50,
        borderRadius: 25,
    },
    avatarPlaceholder: {
        width: 50,
        height: 50,
        borderRadius: 25,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarText: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#fff',
    },
    attendeeInfo: {
        flex: 1,
    },
    attendeeName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1f2937',
    },
    attendeeNick: {
        fontSize: 13,
        color: '#6366f1',
        marginTop: 2,
    },
    attendeeBio: {
        fontSize: 12,
        color: '#6b7280',
        marginTop: 4,
    },
    reputationBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fef3c7',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        marginRight: 8,
    },
    reputationText: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#b45309',
        marginLeft: 4,
    },
    separator: {
        height: 12,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#6b7280',
        marginTop: 16,
    },
    emptySubtext: {
        fontSize: 14,
        color: '#9ca3af',
        marginTop: 8,
        textAlign: 'center',
    },
    retryButton: { marginTop: 18, borderRadius: 12, backgroundColor: '#6366F1', paddingHorizontal: 18, paddingVertical: 12 },
    retryButtonText: { color: '#FFF', fontWeight: '800' },
    footerLoader: { marginVertical: 18 },
    loadMoreButton: { alignItems: 'center', paddingVertical: 16 },
    loadMoreText: { color: '#4F46E5', fontWeight: '700' },
});
