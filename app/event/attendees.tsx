import { useLocalSearchParams, router } from 'expo-router';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    ActivityIndicator,
    Image,
} from 'react-native';
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../src/services/firebaseConfig';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

interface Attendee {
    id: string;
    displayName: string;
    nick?: string;
    photoURL?: string;
    bio?: string;
    reputation?: number;
}

export default function AttendeesScreen() {
    const { meetingId, meetingTitle } = useLocalSearchParams();
    const [attendees, setAttendees] = useState<Attendee[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAttendees();
    }, [meetingId]);

    const fetchAttendees = async () => {
        try {
            // Buscar dados do meeting para obter IDs dos attendees
            const meetingRef = doc(db, 'meetings', meetingId as string);
            const meetingSnap = await getDoc(meetingRef);

            if (!meetingSnap.exists()) {
                setLoading(false);
                return;
            }

            const meetingData = meetingSnap.data();
            const attendeeIds: string[] = meetingData.attendees || [];

            // Buscar dados de todos os participantes em paralelo para maior performance
            const attendeesData = await Promise.all(attendeeIds.map(async (uid) => {
                try {
                    const userRef = doc(db, 'users', uid);
                    const userSnap = await getDoc(userRef);

                    if (userSnap.exists()) {
                        const userData = userSnap.data();
                        return {
                            id: uid,
                            displayName: userData.displayName || userData.nick || 'Usuário',
                            nick: userData.nick,
                            photoURL: userData.photoURL,
                            bio: userData.bio,
                            reputation: userData.reputation || 0,
                        };
                    }
                    return { id: uid, displayName: 'Usuário', reputation: 0 };
                } catch (e) {
                    console.log('Error fetching user:', uid, e);
                    return { id: uid, displayName: 'Usuário', reputation: 0 };
                }
            }));

            setAttendees(attendeesData as Attendee[]);
        } catch (error) {
            console.error('Error fetching attendees:', error);
        } finally {
            setLoading(false);
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

    return (
        <View style={styles.container}>
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
                    <Text style={styles.countText}>{attendees.length}</Text>
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
                />
            )}
        </View>
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
        paddingTop: 48,
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
});
