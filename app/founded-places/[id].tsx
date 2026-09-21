import { useLocalSearchParams, router, Stack } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { auth, db } from '@/src/services/firebaseConfig';
import { CONFIG } from '@/src/constants/Config';
import { ErrorState } from '@/src/components/ErrorState';
import { toUserProfile } from '@/src/utils/userProfile';
import type { Place } from '@/src/types';

type ScreenState = 'loading' | 'ready' | 'private' | 'not-found' | 'error';

/**
 * Lista os lugares que um usuário fundou — ou seja, onde ele realizou o primeiro
 * evento E compareceu (ver `becameFounder` em `functions/src/index.ts`).
 *
 * Público por padrão: a visibilidade só é negada quando o dono desligou
 * `showFoundedPlaces` no perfil, e nunca para ele mesmo.
 */
export default function FoundedPlacesScreen() {
    const { id } = useLocalSearchParams();
    const profileId = typeof id === 'string' ? id : null;

    const [state, setState] = useState<ScreenState>('loading');
    const [places, setPlaces] = useState<Place[]>([]);
    const [ownerName, setOwnerName] = useState('');
    // `auth.currentUser` é null enquanto a sessão rehidrata numa abertura fria por
    // link direto; lido só no render ele não reage quando a sessão chega.
    const [currentUserId, setCurrentUserId] = useState<string | null>(auth.currentUser?.uid ?? null);

    useEffect(() => onAuthStateChanged(auth, (user) => setCurrentUserId(user?.uid ?? null)), []);

    const isOwnProfile = Boolean(currentUserId) && currentUserId === profileId;

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            if (!profileId) {
                if (!cancelled) setState('not-found');
                return;
            }
            if (!cancelled) setState('loading');

            try {
                const userSnapshot = await getDoc(doc(db, 'users', profileId));
                if (cancelled) return;
                if (!userSnapshot.exists()) {
                    setState('not-found');
                    return;
                }

                const owner = toUserProfile(profileId, userSnapshot.data());
                setOwnerName(owner.nick || owner.displayName || 'Usuário');

                // A preferência controla a visibilidade pública, não a do dono.
                if (!isOwnProfile && owner.showFoundedPlaces === false) {
                    setPlaces([]);
                    setState('private');
                    return;
                }

                // Igualdade num único campo: o Firestore já mantém o índice
                // automático de `founderId`, então isto não exige índice composto.
                // Sem `orderBy` pelo mesmo motivo — a ordenação é feita em memória.
                const foundedQuery = query(
                    collection(db, 'places'),
                    where('founderId', '==', profileId),
                    limit(CONFIG.PROFILE_PLACES_LIMIT)
                );
                const snapshot = await getDocs(foundedQuery);
                if (cancelled) return;

                const foundedPlaces = snapshot.docs.map((placeDocument): Place => {
                    const data = placeDocument.data();
                    return {
                        id: placeDocument.id,
                        name: typeof data.name === 'string' ? data.name : 'Local sem nome',
                        latitude: Number(data.latitude),
                        longitude: Number(data.longitude),
                        vocations: Array.isArray(data.vocations)
                            ? data.vocations.filter((vocation: unknown): vocation is string => typeof vocation === 'string')
                            : [],
                        founderId: typeof data.founderId === 'string' ? data.founderId : undefined,
                        discovererId: typeof data.discovererId === 'string' ? data.discovererId : undefined,
                        frequenters: Array.isArray(data.frequenters)
                            ? data.frequenters.filter((uid: unknown): uid is string => typeof uid === 'string')
                            : [],
                    };
                });
                foundedPlaces.sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'));
                setPlaces(foundedPlaces);
                setState('ready');
            } catch {
                if (!cancelled) {
                    console.error('[FoundedPlaces] load_failed');
                    setState('error');
                }
            }
        };

        void load();
        return () => { cancelled = true; };
    }, [profileId, isOwnProfile]);

    const renderPlace = ({ item }: { item: Place }) => {
        const frequentersCount = item.frequenters?.length || 0;
        return (
            <View style={styles.card}>
                <View style={styles.cardIcon}>
                    <FontAwesome name="flag" size={18} color="#10B981" />
                </View>
                <View style={styles.cardContent}>
                    <Text style={styles.cardTitle} numberOfLines={2}>{item.name}</Text>
                    {item.vocations && item.vocations.length > 0 && (
                        <Text style={styles.cardVocations} numberOfLines={1}>{item.vocations.join(' · ')}</Text>
                    )}
                    <View style={styles.cardMetaRow}>
                        {/* Fundador e descobridor coincidem quando o lugar ainda não
                            existia no banco e o primeiro evento criou o documento. */}
                        {item.discovererId === profileId && (
                            <View style={styles.discovererChip}>
                                <Ionicons name="sparkles" size={10} color="#B45309" />
                                <Text style={styles.discovererChipText}>Também descobriu</Text>
                            </View>
                        )}
                        {frequentersCount > 0 && (
                            <View style={styles.metaItem}>
                                <Ionicons name="people-outline" size={12} color="#6B7280" />
                                <Text style={styles.metaText}>
                                    {frequentersCount === 1 ? '1 frequentador' : `${frequentersCount} frequentadores`}
                                </Text>
                            </View>
                        )}
                    </View>
                </View>
            </View>
        );
    };

    const headerSubtitle = isOwnProfile
        ? 'Lugares onde você realizou o primeiro evento'
        : `Lugares inaugurados por @${ownerName}`;

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <Stack.Screen options={{ headerShown: false }} />

            <LinearGradient colors={['#059669', '#10B981']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
                <View style={styles.headerTop}>
                    <TouchableOpacity
                        onPress={() => router.back()}
                        style={styles.backBtn}
                        accessibilityRole="button"
                        accessibilityLabel="Voltar"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <FontAwesome name="arrow-left" size={18} color="#FFF" />
                    </TouchableOpacity>
                </View>
                <FontAwesome name="flag" size={30} color="#FFF" />
                <Text style={styles.headerTitle}>Lugares fundados</Text>
                {state !== 'loading' && state !== 'not-found' && (
                    <Text style={styles.headerSubtitle}>{headerSubtitle}</Text>
                )}
            </LinearGradient>

            {state === 'loading' ? (
                <View style={styles.center}><ActivityIndicator size="large" color="#10B981" /></View>
            ) : state === 'not-found' ? (
                <View style={styles.center}>
                    <ErrorState title="Perfil não encontrado" message="Este usuário não existe mais." />
                </View>
            ) : state === 'error' ? (
                <View style={styles.center}>
                    <ErrorState title="Não foi possível carregar" message="Confira sua conexão e tente novamente." />
                </View>
            ) : state === 'private' ? (
                <View style={styles.center}>
                    <Ionicons name="lock-closed-outline" size={44} color="#9CA3AF" />
                    <Text style={styles.emptyTitle}>Lista privada</Text>
                    <Text style={styles.emptyText}>Esta pessoa escolheu não mostrar os lugares que fundou.</Text>
                </View>
            ) : (
                <FlatList
                    data={places}
                    renderItem={renderPlace}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    ListHeaderComponent={places.length > 0 ? (
                        <Text style={styles.listCount}>
                            {places.length === 1 ? '1 lugar fundado' : `${places.length} lugares fundados`}
                        </Text>
                    ) : null}
                    ListEmptyComponent={
                        <View style={styles.center}>
                            <Ionicons name="flag-outline" size={44} color="#9CA3AF" />
                            <Text style={styles.emptyTitle}>Nenhum lugar fundado</Text>
                            <Text style={styles.emptyText}>
                                {isOwnProfile
                                    ? 'Realize o primeiro evento de um local e faça check-in para se tornar Fundador dele.'
                                    : 'Esta pessoa ainda não inaugurou nenhum local.'}
                            </Text>
                        </View>
                    }
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F3F4F6' },
    header: { paddingHorizontal: 20, paddingBottom: 22, alignItems: 'center' },
    headerTop: { alignSelf: 'stretch', paddingTop: 8, paddingBottom: 10 },
    backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { marginTop: 10, color: '#FFF', fontSize: 22, fontWeight: '900' },
    headerSubtitle: { marginTop: 4, color: '#D1FAE5', fontSize: 13, textAlign: 'center' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, paddingTop: 60 },
    emptyTitle: { marginTop: 14, fontSize: 16, fontWeight: '800', color: '#374151' },
    emptyText: { marginTop: 6, fontSize: 14, lineHeight: 20, color: '#6B7280', textAlign: 'center' },
    listContent: { padding: 16, paddingBottom: 28, flexGrow: 1 },
    listCount: { fontSize: 12, fontWeight: '800', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, marginLeft: 4 },
    card: {
        flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 16, padding: 14, marginBottom: 10,
        shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
    },
    cardIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#ECFDF5', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    cardContent: { flex: 1, justifyContent: 'center' },
    cardTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
    cardVocations: { marginTop: 2, fontSize: 12, color: '#6B7280' },
    cardMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 6 },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metaText: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
    discovererChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FEF3C7', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2 },
    discovererChipText: { fontSize: 10, fontWeight: '800', color: '#B45309' },
});
