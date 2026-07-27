import { useLocalSearchParams, router, Stack } from 'expo-router';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    TouchableOpacity,
    Image,
} from 'react-native';
import { useEffect, useState } from 'react';
import { doc, getDoc, collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../src/services/firebaseConfig';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyledButton } from '@/src/components/StyledButton';

interface UserProfile {
    displayName: string;
    nick?: string;
    email?: string;
    photoURL?: string;
    bio?: string;
    interests?: string[];
    eventTypes?: string[];
    emailVerified?: boolean;
    reputation?: number;
    eventsAttended?: number;
    foundedPlacesCount?: number;
    createdAt?: any;
}

export default function UserProfileScreen() {
    const { id } = useLocalSearchParams();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [frequentedPlaces, setFrequentedPlaces] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const isOwnProfile = auth.currentUser?.uid === id;

    useEffect(() => {
        fetchUserProfile();
    }, [id]);

    const fetchUserProfile = async () => {
        try {
            const userRef = doc(db, 'users', id as string);
            const userSnap = await getDoc(userRef);

            if (userSnap.exists()) {
                setProfile(userSnap.data() as UserProfile);
            }

            // Busca os lugares que o usuário frequenta
            const placesRef = collection(db, 'places');
            const placesQuery = query(placesRef, where('frequenters', 'array-contains', id as string));
            const placesSnap = await getDocs(placesQuery);
            const places = placesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setFrequentedPlaces(places);
        } catch (error) {
            console.error('Error fetching user profile:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSendMessage = async () => {
        if (!auth.currentUser || !profile) return;
        setLoading(true);

        try {
            const conversationsRef = collection(db, 'conversations');
            
            // Check if conversation already exists where both users are participants
            // Firestore doesn't support 'contains-all' on arrays easily without ordering trick or double query.
            // A common pattern: query where array-contains currentUid, then filter locally for targetUid.
            const q = query(conversationsRef, where('participants', 'array-contains', auth.currentUser.uid));
            const querySnapshot = await getDocs(q);
            
            let existingConversationId = null;
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                if (data.participants && data.participants.includes(id as string)) {
                    existingConversationId = docSnap.id;
                }
            });

            if (existingConversationId) {
                router.push({
                    pathname: '/conversation/[id]',
                    params: {
                        id: existingConversationId,
                        name: profile.displayName
                    }
                });
            } else {
                // Create new conversation
                const newConvRef = await addDoc(conversationsRef, {
                    participants: [auth.currentUser.uid, id],
                    participantNames: {
                        [auth.currentUser.uid]: auth.currentUser.displayName || 'Usuário',
                        [id as string]: profile.displayName || 'Usuário'
                    },
                    lastMessage: '',
                    updatedAt: serverTimestamp(),
                    createdAt: serverTimestamp(),
                    unreadCounts: {
                        [auth.currentUser.uid]: 0,
                        [id as string]: 0
                    }
                });

                router.push({
                    pathname: '/conversation/[id]',
                    params: {
                        id: newConvRef.id,
                        name: profile.displayName
                    }
                });
            }
        } catch (error) {
            console.error('Error starting conversation:', error);
        } finally {
            setLoading(false);
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
        <View style={styles.container}>
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
                    {profile.emailVerified && (
                        <FontAwesome name="check-circle" size={18} color="#10B981" style={{marginLeft: 8}} />
                    )}
                </View>
                {profile.nick && (
                    <Text style={styles.nick}>@{profile.nick}</Text>
                )}
                {profile.createdAt && (
                    <Text style={{color: '#E0E7FF', fontSize: 12, marginTop: 4}}>
                        No app desde {new Date(profile.createdAt).getFullYear()}
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
                        <Text style={styles.statLabel}>Eventos</Text>
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

                {/* Tipos de Eventos Preferidos */}
                {profile.eventTypes && profile.eventTypes.length > 0 ? (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>
                            <FontAwesome name="calendar" size={14} color="#10b981" /> Eventos Preferidos
                        </Text>
                        <View style={styles.tagsContainer}>
                            {profile.eventTypes.map((type, index) => (
                                <View key={index} style={[styles.tag, styles.eventTag]}>
                                    <Text style={[styles.tagText, styles.eventTagText]}>{type}</Text>
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
                            colors={['#6366f1', '#8b5cf6']}
                        />
                    </View>
                )}

                <View style={{ height: 40 }} />
            </ScrollView>
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
    eventTag: {
        backgroundColor: '#d1fae5',
    },
    eventTagText: {
        color: '#047857',
    },
    actionsContainer: {
        marginTop: 8,
    },
});
