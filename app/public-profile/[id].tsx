import { useLocalSearchParams, router, Stack } from 'expo-router';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Alert,
    TouchableOpacity,
    Image,
} from 'react-native';
import { useEffect, useState } from 'react';
import { addDoc, collection, doc, getDoc, limit, query, serverTimestamp, where, getDocs } from 'firebase/firestore';
import { db, auth, functions } from '../../src/services/firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyledButton } from '@/src/components/StyledButton';
import { normalizeInterests } from '@/src/constants/Interests';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Place, User } from '@/src/types';
import { CONFIG } from '@/src/constants/Config';
import { toUserProfile } from '@/src/utils/userProfile';
import { ReportReasonModal } from '@/src/components/ReportReasonModal';

function publicProfileLog(event: string, context: Record<string, boolean | number> = {}) {
    if (__DEV__) console.info(`[PublicProfile] ${event}`, context);
}

export default function UserProfileScreen() {
    const { id } = useLocalSearchParams();
    const profileId = typeof id === 'string' ? id : null;
    const [profile, setProfile] = useState<User | null>(null);
    const [frequentedPlaces, setFrequentedPlaces] = useState<Place[]>([]);
    const [loading, setLoading] = useState(true);
    const [startingConversation, setStartingConversation] = useState(false);
    const [showReportReasonModal, setShowReportReasonModal] = useState(false);

    const isOwnProfile = auth.currentUser?.uid === profileId;
    const joinedYear = profile?.createdAt ? new Date(profile.createdAt).getFullYear() : undefined;

    useEffect(() => {
        let cancelled = false;

        const loadProfile = async () => {
            if (!profileId) {
                if (!cancelled) {
                    setProfile(null);
                    setFrequentedPlaces([]);
                    setLoading(false);
                }
                return;
            }

            setLoading(true);
            try {
                const userSnap = await getDoc(doc(db, 'users', profileId));
                if (!userSnap.exists()) {
                    publicProfileLog('profile_not_found');
                    if (!cancelled) {
                        setProfile(null);
                        setFrequentedPlaces([]);
                    }
                    return;
                }

                const userData = toUserProfile(profileId, userSnap.data());
                if (!cancelled) setProfile({ ...userData, interests: normalizeInterests(userData.interests) });

                // A preferência controla a visibilidade pública, não a do próprio dono.
                if (!isOwnProfile && userData.shareFrequentedPlaces !== true) {
                    if (!cancelled) setFrequentedPlaces([]);
                    return;
                }

                const placesQuery = query(
                    collection(db, 'places'),
                    where('frequenters', 'array-contains', profileId),
                    limit(CONFIG.PROFILE_PLACES_LIMIT)
                );
                const placesSnap = await getDocs(placesQuery);
                if (!cancelled) {
                    setFrequentedPlaces(placesSnap.docs.map((place) => ({
                        id: place.id,
                        ...(place.data() as Omit<Place, 'id'>),
                    })));
                }
            } catch (error) {
                console.error('[PublicProfile] profile_load_failed');
                if (!cancelled) {
                    setProfile(null);
                    setFrequentedPlaces([]);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadProfile();
        return () => { cancelled = true; };
    }, [isOwnProfile, profileId]);

    const handleSendMessage = async () => {
        if (!auth.currentUser || !profile || !profileId) return;
        setStartingConversation(true);
        publicProfileLog('conversation_start_requested');

        try {
            const getOrCreateConversation = httpsCallable<
                { targetUserId: string },
                { conversationId: string; participantName: string }
            >(functions, 'getOrCreateConversation');
            const result = await getOrCreateConversation({ targetUserId: profileId });
            publicProfileLog('conversation_opened');
            router.push({
                pathname: '/conversation/[id]',
                params: { id: result.data.conversationId, name: result.data.participantName }
            });
        } catch (error) {
            console.error('[PublicProfile] conversation_start_failed');
            Alert.alert('Conversa indisponível', 'Não foi possível iniciar uma conversa com esta pessoa. Ela pode ter bloqueado contatos ou não estar mais disponível.');
        } finally {
            setStartingConversation(false);
        }
    };

    const submitUserReport = async (reason: string) => {
        if (!auth.currentUser || !profileId || isOwnProfile) return;
        try {
            await addDoc(collection(db, 'reports'), {
                type: 'user',
                targetId: profileId,
                reportedBy: auth.currentUser.uid,
                reason,
                createdAt: serverTimestamp(),
            });
            setShowReportReasonModal(false);
            Alert.alert('Denúncia enviada', 'Obrigado. A denúncia será analisada pela moderação.');
        } catch {
            console.error('[PublicProfile] report_submit_failed');
            Alert.alert('Não foi possível enviar', 'Tente novamente em instantes.');
        }
    };

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#6366f1" />
                <Text style={styles.loadingText}>Carregando perfil...</Text>
            </View>
        );
    }

    if (!profile) {
        return (
            <View style={styles.center}>
                <FontAwesome name="user-times" size={48} color="#d1d5db" />
                <Text style={styles.errorText}>Perfil não encontrado</Text>
                <StyledButton
                    title="Voltar"
                    onPress={() => router.back()}
                    colors={['#6b7280', '#9ca3af']}
                />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <Stack.Screen options={{ headerShown: false }} />
            {/* Header com ação de voltar */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <FontAwesome name="arrow-left" size={20} color="#fff" />
                </TouchableOpacity>
                {isOwnProfile && (
                    <TouchableOpacity
                        onPress={() => router.push('/profile')}
                        style={styles.editBtn}
                    >
                        <FontAwesome name="pencil" size={16} color="#fff" />
                    </TouchableOpacity>
                )}
            </View>

            {/* Gradient Background */}
            <LinearGradient
                colors={['#6366f1', '#8b5cf6', '#a855f7']}
                style={styles.gradientHeader}
            >
                {/* Avatar */}
                <View style={styles.avatarContainer}>
                    {profile.photoURL ? (
                        <Image source={{ uri: profile.photoURL }} style={styles.avatar} />
                    ) : (
                        <View style={styles.avatarPlaceholder}>
                            <Text style={styles.avatarText}>
                                {profile.displayName?.charAt(0).toUpperCase() || 'U'}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Nome e Nick */}
                <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center'}}>
                    <Text style={styles.displayName}>{profile.displayName}</Text>
                </View>
                {profile.nick && (
                    <Text style={styles.nick}>@{profile.nick}</Text>
                )}
                {joinedYear && Number.isFinite(joinedYear) && (
                    <Text style={{color: '#E0E7FF', fontSize: 12, marginTop: 4}}>
                        No app desde {joinedYear}
                    </Text>
                )}
            </LinearGradient>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Estatísticas */}
                <View style={styles.statsCard}>
                    <View style={styles.statItem}>
                        <FontAwesome name="star" size={24} color="#fbbf24" />
                        <Text style={styles.statValue}>{profile.reputation || 0}</Text>
                        <Text style={styles.statLabel}>Reputação</Text>
                    </View>
                    <View style={styles.divider} />
                    <View style={styles.statItem}>
                        <FontAwesome name="calendar-check-o" size={24} color="#6366f1" />
                        <Text style={styles.statValue}>{profile.eventsAttended || 0}</Text>
                        <Text style={styles.statLabel}>Participações</Text>
                    </View>
                    <View style={styles.divider} />
                    <View style={styles.statItem}>
                        <FontAwesome name="flag" size={24} color="#10b981" />
                        <Text style={styles.statValue}>{profile.foundedPlacesCount || 0}</Text>
                        <Text style={styles.statLabel}>Fundador</Text>
                    </View>
                </View>

                {/* Bio */}
                {profile.bio ? (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>
                            <FontAwesome name="quote-left" size={14} color="#6366f1" /> Sobre
                        </Text>
                        <Text style={styles.bioText}>{profile.bio}</Text>
                    </View>
                ) : null}

                {/* Interesses */}
                {profile.interests && profile.interests.length > 0 ? (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>
                            <FontAwesome name="heart" size={14} color="#ef4444" /> Interesses
                        </Text>
                        <View style={styles.tagsContainer}>
                            {profile.interests.map((interest, index) => (
                                <View key={index} style={styles.tag}>
                                    <Text style={styles.tagText}>{interest}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                ) : null}

                {/* Lugares que Frequenta */}
                {frequentedPlaces.length > 0 ? (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>
                            <FontAwesome name="map-marker" size={14} color="#059669" /> Lugares que Frequenta
                        </Text>
                        <View style={styles.tagsContainer}>
                            {frequentedPlaces.map((place, index) => (
                                <View key={index} style={[styles.tag, { backgroundColor: '#ECFDF5' }]}>
                                    <Text style={[styles.tagText, { color: '#059669' }]}>{place.name || 'Local'}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                ) : null}

                {/* Ações */}
                {!isOwnProfile && (
                    <View style={styles.actionsContainer}>
                        <StyledButton
                            title="Enviar Mensagem"
                            onPress={handleSendMessage}
                            isLoading={startingConversation}
                            colors={['#6366f1', '#8b5cf6']}
                        />
                        <TouchableOpacity style={styles.reportButton} onPress={() => setShowReportReasonModal(true)}>
                            <FontAwesome name="flag" size={15} color="#DC2626" />
                            <Text style={styles.reportButtonText}>Denunciar usuário</Text>
                        </TouchableOpacity>
                    </View>
                )}

                <View style={{ height: 40 }} />
            </ScrollView>
            <ReportReasonModal
                visible={showReportReasonModal}
                targetType="user"
                onClose={() => setShowReportReasonModal(false)}
                onSelectReason={submitUserReport}
            />
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
        padding: 24,
    },
    loadingText: {
        marginTop: 12,
        color: '#6b7280',
        fontSize: 14,
    },
    errorText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#6b7280',
        marginTop: 16,
        marginBottom: 24,
    },
    header: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingTop: 48,
        paddingHorizontal: 16,
    },
    backBtn: {
        padding: 10,
        backgroundColor: 'rgba(0,0,0,0.2)',
        borderRadius: 20,
    },
    editBtn: {
        padding: 10,
        backgroundColor: 'rgba(0,0,0,0.2)',
        borderRadius: 20,
    },
    gradientHeader: {
        paddingTop: 100,
        paddingBottom: 40,
        alignItems: 'center',
    },
    avatarContainer: {
        marginBottom: 16,
    },
    avatar: {
        width: 120,
        height: 120,
        borderRadius: 60,
        borderWidth: 4,
        borderColor: '#fff',
    },
    avatarPlaceholder: {
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: 'rgba(255,255,255,0.3)',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 4,
        borderColor: '#fff',
    },
    avatarText: {
        fontSize: 48,
        fontWeight: 'bold',
        color: '#fff',
    },
    displayName: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#fff',
        textAlign: 'center',
    },
    nick: {
        fontSize: 16,
        color: 'rgba(255,255,255,0.85)',
        marginTop: 4,
    },
    content: {
        flex: 1,
        backgroundColor: '#fff',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        marginTop: -24,
        paddingTop: 24,
        paddingHorizontal: 24,
    },
    statsCard: {
        flexDirection: 'row',
        backgroundColor: '#f9fafb',
        borderRadius: 16,
        padding: 24,
        marginBottom: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
    },
    statItem: {
        flex: 1,
        alignItems: 'center',
    },
    divider: {
        width: 1,
        backgroundColor: '#e5e7eb',
    },
    statValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#1f2937',
        marginTop: 8,
    },
    statLabel: {
        fontSize: 14,
        color: '#6b7280',
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 12,
    },
    bioText: {
        fontSize: 15,
        color: '#4b5563',
        lineHeight: 22,
        backgroundColor: '#f9fafb',
        padding: 16,
        borderRadius: 12,
    },
    tagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    tag: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#e0e7ff',
        marginRight: 8,
        marginBottom: 8,
    },
    tagText: {
        color: '#4338ca',
        fontSize: 13,
        fontWeight: '500',
    },
    actionsContainer: {
        marginTop: 8,
    },
    reportButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingVertical: 16 },
    reportButtonText: { color: '#DC2626', fontWeight: '700', fontSize: 14 },
});
