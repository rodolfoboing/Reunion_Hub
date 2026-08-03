import { ErrorState } from '@/src/components/ErrorState';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { arrayRemove, arrayUnion, collection, deleteDoc, doc, getDocs, onSnapshot, query, updateDoc, where, limit, orderBy } from 'firebase/firestore';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, FlatList, LayoutAnimation, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, UIManager, View } from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Meeting } from '../../../src/types';
import { STRINGS } from '../../../src/constants/strings';
import { CONFIG } from '../../../src/constants/Config';
import { normalizeDate, getTodayStr } from '../../../src/utils/dateUtils';
import { auth, db } from '../../../src/services/firebaseConfig';
import { hasMatchingInterest, normalizeInterests } from '../../../src/constants/Interests';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

import { getDistanceFromLatLonInKm } from '../../../src/utils/distance';

const getDateAfterDays = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const matchesUserInterest = (event: Pick<Meeting, 'interests' | 'theme'>, interests: string[]) => {
    if (interests.length === 0) return false;
    return hasMatchingInterest([...(event.interests || []), event.theme], interests);
};

// Configure Locale for Calendar
LocaleConfig.locales['pt-br'] = {
    monthNames: [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ],
    monthNamesShort: ['Jan.', 'Fev.', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul.', 'Ago', 'Set.', 'Out.', 'Nov.', 'Dez.'],
    dayNames: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
    dayNamesShort: ['Dom.', 'Seg.', 'Ter.', 'Qua.', 'Qui.', 'Sex.', 'Sáb.'],
    today: "Hoje"
};
LocaleConfig.defaultLocale = 'pt-br';

// Célula customizada do calendário: em vez de pontinhos minúsculos (multi-dot),
// usa sinalizações maiores e distintas para cada tipo de evento:
// - Criado por você -> preenchimento roxo suave atrás do número
// - Recorrente -> selo azul com ícone de repetição no canto superior esquerdo
// - Popular (+3 pessoas) -> selo laranja com 🔥 no canto superior direito
// - Passado / Próximo -> barrinha colorida abaixo do número (cinza / verde)
const CalendarDayCell = ({ date, state, marking, onPress }: any) => {
    if (!date) return <View style={styles.dayCell} />;

    const isSelected = !!marking?.selected;
    const isToday = state === 'today';
    const isDisabled = state === 'disabled';
    const isMine = !!marking?.mine;
    const isRecurring = !!marking?.recurring;
    const isPopular = !!marking?.popular;
    const isPast = !!marking?.past;
    const hasEvent = !!marking?.hasEvent;
    const isRecommended = !!marking?.recommended;

    return (
        <Pressable
            onPress={() => onPress(date)}
            disabled={isDisabled}
            style={styles.dayCell}
            hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
        >
            <View
                style={[
                    styles.dayCircle,
                    isMine && !isSelected && styles.dayCircleMine,
                    isToday && !isSelected && styles.dayCircleToday,
                    isSelected && styles.dayCircleSelected,
                ]}
            >
                <Text
                    style={[
                        styles.dayText,
                        isDisabled && styles.dayTextDisabled,
                        isToday && !isSelected && styles.dayTextToday,
                        isSelected && styles.dayTextSelected,
                    ]}
                >
                    {date.day}
                </Text>

                {isRecurring && (
                    <View style={styles.dayBadgeRecurring}>
                        <Ionicons name="repeat" size={7} color="#fff" />
                    </View>
                )}
                {isPopular && (
                    <View style={styles.dayBadgePopular}>
                        <Text style={styles.dayBadgePopularEmoji}>🔥</Text>
                    </View>
                )}
                {isRecommended && !isPopular && (
                    <View style={[styles.dayBadgePopular, { backgroundColor: '#8B5CF6' }]}>
                        <Text style={styles.dayBadgePopularEmoji}>⭐</Text>
                    </View>
                )}
            </View>

            {hasEvent && (
                <View
                    style={[
                        styles.dayBar,
                        { backgroundColor: isPast ? '#CBD5E1' : '#10B981' },
                    ]}
                />
            )}
        </Pressable>
    );
};

export default function AgendaScreen() {
    // Tab State: 'upcoming' | 'history' | 'favorites'
    const [activeTab, setActiveTab] = useState<'upcoming' | 'history' | 'favorites'>('upcoming');

    // Data State
    const [allEvents, setAllEvents] = useState<any[]>([]);
    const [filteredEvents, setFilteredEvents] = useState<any[]>([]);
    const [favorites, setFavorites] = useState<string[]>([]);
    const [userInterests, setUserInterests] = useState<string[]>([]);
    const [showPopularOutsideInterests, setShowPopularOutsideInterests] = useState(true);
    const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
    const [markedDates, setMarkedDates] = useState<any>({});
    const [selectedDate, setSelectedDate] = useState('');

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState<any>(null);
    const [recommendations, setRecommendations] = useState<any[]>([]);
    const [allRecs, setAllRecs] = useState<any[]>([]);
    const [historyTitles, setHistoryTitles] = useState<string[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);

    const isMounted = useRef(true);

    // Initial Fetch (User Favorites & Profile)
    useFocusEffect(
        useCallback(() => {
            isMounted.current = true;
            setRefreshKey((current) => current + 1);
            let unsubProfile: any;
            const unsubscribeAuth = auth.onAuthStateChanged((user) => {
                if (user && isMounted.current) {
                    unsubProfile = onSnapshot(doc(db, 'users', user.uid), (snap) => {
                        if (snap.exists() && isMounted.current) {
                            setFavorites(snap.data().favorites || []);
                            setUserInterests(normalizeInterests(snap.data().interests));
                            setShowPopularOutsideInterests(snap.data().showPopularOutsideInterests !== false);
                        }
                    });
                }
            });

            (async () => {
                let { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    let lastLoc = await Location.getLastKnownPositionAsync();
                    if (lastLoc && isMounted.current) setUserLocation(lastLoc);
                    
                    let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                    if (isMounted.current) setUserLocation(loc);
                }
            })();

            return () => {
                isMounted.current = false;
                unsubscribeAuth();
                if (unsubProfile) unsubProfile();
            };
        }, [])
    );

    useEffect(() => {
        fetchEvents();
    }, [activeTab, favorites.length, selectedDate, userLocation, userInterests.join(','), showPopularOutsideInterests, refreshKey]);

    useEffect(() => {
        if (allRecs.length === 0) return;

        const todayStr = getTodayStr();
        const maxDateStr = getDateAfterDays(CONFIG.AGENDA_DISCOVERY_DAYS);
        
        let finalRecs = allRecs.filter((e: any) => {
            if (!e.date) return false;
            // Futuros em até 30 dias
            if (e.date < todayStr || e.date > maxDateStr) return false;
            return true;
        });

        // Baseado em histórico ou categoria de interesse
        if (userInterests.length > 0 || historyTitles.length > 0) {
            finalRecs = finalRecs.filter((e: any) => {
                const matchesInterest = matchesUserInterest(e, userInterests);
                const matchesHistory = historyTitles.includes(e.title);
                const isPopular = (e.attendees?.length || 0) >= CONFIG.POPULAR_ATTENDEES_COUNT;
                return matchesInterest || matchesHistory || (showPopularOutsideInterests && isPopular);
            });
        }

        // Próximos (<= CONFIG.NEARBY_RADIUS_KM) ou Online
        if (userLocation && finalRecs.length > 0) {
            const withDistance = finalRecs
                .map((m: any) => {
                    if (m.type === 'online') return { ...m, distance: 0 };
                    if (!m.lat || !m.lng) return { ...m, distance: 9999 };
                    const dist = getDistanceFromLatLonInKm(userLocation.coords.latitude, userLocation.coords.longitude, m.lat, m.lng);
                    return { ...m, distance: dist };
                })
                .filter((m: any) => m.type === 'online' || m.distance <= CONFIG.NEARBY_RADIUS_KM);
            withDistance.sort((a: any, b: any) => a.distance - b.distance);
            finalRecs = withDistance;
        }

        setRecommendations(finalRecs.slice(0, 10));
    }, [allRecs, userInterests, historyTitles, userLocation, showPopularOutsideInterests]);

    const fetchEvents = async () => {
        const currentUid = auth.currentUser?.uid;
        if (!currentUid || !isMounted.current) return;

        setLoading(true);
        setError(false);
        try {
            const todayStr = getTodayStr();

            if (activeTab === 'favorites') {
                if (favorites.length === 0) {
                    setFilteredEvents([]);
                    setMarkedDates({});
                    setLoading(false);
                    return;
                }

                // Firestore 'in' query supports max 10 items.
                const chunks = [];
                const favoriteIds = favorites.slice(0, CONFIG.AGENDA_FAVORITES_LIMIT);
                for (let i = 0; i < favoriteIds.length; i += 10) {
                    chunks.push(favoriteIds.slice(i, i + 10));
                }

                const promises = chunks.map(chunk =>
                    getDocs(query(collection(db, 'meetings'), where('__name__', 'in', chunk)))
                );

                const snaps = await Promise.all(promises);
                let events: any[] = [];
                snaps.forEach(snap => {
                    const mapped = snap.docs.map(d => ({
                        id: d.id,
                        ...d.data(),
                        date: normalizeDate(d.data().date)
                    })).filter((e: any) => e.status !== 'cancelled');
                    events = [...events, ...mapped];
                });

                events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
                setFilteredEvents(events);
                setMarkedDates({});
                setLoading(false);
                return;
            }

            // For Upcoming and History
            // Query where user is attendee OR creator to prevent downloading the whole DB
            // 'or' requires import from firebase/firestore
            // Since 'or' might not be imported, we will query attendees and filter locally for creator 
            // to keep it simple and avoid missing indexes if 'or' triggers composite index issues.
            const q = query(
                collection(db, 'meetings'),
                where('attendees', 'array-contains', currentUid)
            );

            const snap = await getDocs(q);
            let events = snap.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    ...data,
                    date: normalizeDate(data.date)
                };
            }).filter((e: any) => e.date !== null && e.status !== 'cancelled' && e.status !== 'completed');

            // Local filter for Upcoming vs History
            let results: any[] = [];
            let historyEvents: any[] = [];

            if (activeTab === 'upcoming') {
                results = events.filter((ev: any) => ev.date >= todayStr);
                historyEvents = events.filter((ev: any) => ev.date < todayStr);

                // Marcações do calendário: cada dia recebe um objeto com as flags de
                // sinalização (criado por você, recorrente, popular, passado/próximo).
                // Usamos TODOS os eventos (passados e futuros) para que o calendário
                // mostre o histórico completo, não só os próximos.
                const marks: any = {};
                events.forEach((ev: any) => {
                    if (!ev.date) return;
                    const isMine = ev.createdBy === currentUid;
                    const isPopular = ev.attendees && ev.attendees.length >= CONFIG.POPULAR_ATTENDEES_COUNT;
                    const isPast = ev.date.localeCompare(todayStr) < 0;

                    if (!marks[ev.date]) {
                        marks[ev.date] = { mine: false, recurring: false, popular: false, past: isPast, hasEvent: true };
                    }
                    if (isMine) marks[ev.date].mine = true;
                    if (ev.isRepeated) marks[ev.date].recurring = true;
                    if (isPopular) marks[ev.date].popular = true;
                });
                setMarkedDates(marks);

                // Sort nearest first
                results.sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''));

                // Calculando Recomendações Baseadas em Histórico, Interesses ou Proximidade (Cold Start)
                const hTitles = [...new Set(historyEvents.map((e: any) => e.title))];
                setHistoryTitles(hTitles);

                const maxDiscoveryDate = getDateAfterDays(CONFIG.AGENDA_DISCOVERY_DAYS);
                const qRec = query(
                    collection(db, 'meetings'),
                    where('date', '>=', todayStr),
                    where('date', '<=', maxDiscoveryDate),
                    orderBy('date'),
                    limit(CONFIG.AGENDA_DISCOVERY_LIMIT)
                );
                const snapRec = await getDocs(qRec);
                let fetchedRecs = snapRec.docs
                    .map(d => ({ 
                        id: d.id, 
                        ...d.data(),
                        date: normalizeDate(d.data().date) || d.data().date
                    }))
                    .filter((e: any) => {
                        if (!e.date) return false;
                        if (e.status === 'cancelled' || e.status === 'completed') return false;
                        if (e.date < todayStr) return false;
                        if (e.date > maxDiscoveryDate) return false;
                        if (e.attendees?.includes(currentUid)) return false;
                        return true;
                    });
                
                setAllRecs(fetchedRecs);
                fetchedRecs.forEach((event: any) => {
                    const matchesInterest = matchesUserInterest(event, userInterests);
                    const hasCoordinates = Number.isFinite(Number(event.lat)) && Number.isFinite(Number(event.lng));
                    const isNearby = event.type === 'in-person' && !!userLocation && hasCoordinates
                        && getDistanceFromLatLonInKm(userLocation.coords.latitude, userLocation.coords.longitude, Number(event.lat), Number(event.lng)) <= CONFIG.NEARBY_RADIUS_KM;
                    const isPopular = isNearby && (event.attendees?.length || 0) >= CONFIG.POPULAR_ATTENDEES_COUNT;
                    const isRecommended = !!matchesInterest;
                    if (!isPopular && !isRecommended) return;
                    if (!marks[event.date]) marks[event.date] = { mine: false, recurring: false, popular: false, recommended: false, past: false, hasEvent: true };
                    if (isPopular && (showPopularOutsideInterests || matchesInterest)) marks[event.date].popular = true;
                    if (isRecommended) marks[event.date].recommended = true;
                });
                setMarkedDates(marks);

                // Combina passados e futuros para permitir tocar em qualquer dia
                // marcado no calendário (inclusive datas passadas) e ver os eventos dele.
                setFilteredEvents([...results, ...historyEvents, ...fetchedRecs]);
                setLoading(false);
                return;

            } else if (activeTab === 'history') {
                results = events.filter((ev: any) => ev.date < todayStr);
                setMarkedDates({});
                // Sort most recent past first
                results.sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
            }

            setFilteredEvents(results);

        } catch (error: any) {
            console.error(`${STRINGS.LOG_DB_READ} [Agenda] Erro ao buscar eventos da agenda:`, error.code, error.message);
            if (isMounted.current) setError(true);
        } finally {
            if (isMounted.current) setLoading(false);
        }
    };

    const toggleFavorite = async (eventId: string) => {
        if (!auth.currentUser) return;
        const userRef = doc(db, 'users', auth.currentUser.uid);

        try {
            if (favorites.includes(eventId)) {
                await updateDoc(userRef, { favorites: arrayRemove(eventId) });
            } else {
                await updateDoc(userRef, { favorites: arrayUnion(eventId) });
            }
        } catch (err) {
            console.error("[Agenda] Erro ao adicionar aos favoritos", err);
        }
    };

    const onDayPress = (day: any) => {
        setSelectedDate(day.dateString);
    };

    const handleCancelRSVP = async (event: any) => {
        if (!auth.currentUser) return;
        Alert.alert('Cancelar Presença', `Tem certeza que deseja cancelar sua presença em "${event.title}"?`, [
            { text: 'Não', style: 'cancel' },
            {
                text: 'Sim, Cancelar', style: 'destructive', onPress: async () => {
                    try {
                        const docRef = doc(db, 'meetings', event.id);
                        await updateDoc(docRef, { attendees: arrayRemove(auth.currentUser?.uid) });
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setFilteredEvents(prev => prev.filter(e => e.id !== event.id));
                        setSelectedEvent(null);
                    } catch (e) {
                        Alert.alert('Erro', 'Falha ao cancelar presença.');
                    }
                }
            }
        ]);
    };

    const handleDeleteEvent = async (event: any) => {
        Alert.alert('Excluir Evento', `Atenção: Isso excluirá o evento "${event.title}" permanentemente para todos. Deseja continuar?`, [
            { text: 'Cancelar', style: 'cancel' },
            {
                text: 'Excluir Definitivamente', style: 'destructive', onPress: async () => {
                    try {
                        const docRef = doc(db, 'meetings', event.id);
                        await deleteDoc(docRef);
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setFilteredEvents(prev => prev.filter(e => e.id !== event.id));
                        setSelectedEvent(null);
                    } catch (e) {
                        Alert.alert('Erro', 'Falha ao excluir evento.');
                    }
                }
            }
        ]);
    };

    const AnimatedEventCard = ({ item, onPress }: { item: any, onPress: () => void }) => {
        const pulseAnim = useRef(new Animated.Value(1)).current;

        const todayStr = getTodayStr();
        const now = new Date();
        now.setDate(now.getDate() + 1);
        const tomorrowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const isVerySoon = item.date === todayStr || item.date === tomorrowStr;
        const isPopular = item.attendees && item.attendees.length >= CONFIG.POPULAR_ATTENDEES_COUNT; // +3 pessoas = Popular

        useEffect(() => {
            if (isVerySoon) {
                Animated.loop(
                    Animated.sequence([
                        Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
                        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
                    ])
                ).start();
            }
        }, [isVerySoon]);

        let indicatorColor = item.type === 'online' ? '#10B981' : '#6366F1';
        if (isPopular) indicatorColor = '#F59E0B'; // Fogo / Laranja

        return (
            <Pressable
                style={({ pressed }) => [
                    styles.eventCard,
                    isVerySoon && styles.eventCardSoon,
                    pressed && styles.cardPressed,
                ]}
                onPress={onPress}
            >
                <Animated.View style={[
                    styles.eventTypeIndicator,
                    { backgroundColor: indicatorColor, opacity: isVerySoon ? pulseAnim : 1 }
                ]} />
                <View style={styles.eventInfo}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <View style={{ flex: 1, marginRight: 8, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                            <Text style={styles.eventTitle}>{item.title}</Text>
                            {isPopular && <View style={styles.badgePopular}><Text style={styles.badgePopularText}>🔥 Pop</Text></View>}
                            {isVerySoon && <View style={styles.badgeSoon}><Text style={styles.badgeSoonText}>⏳ Em Breve</Text></View>}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            {activeTab === 'favorites' && (
                                <TouchableOpacity onPress={() => toggleFavorite(item.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                    <Ionicons name="heart" size={20} color="#EF4444" />
                                </TouchableOpacity>
                            )}
                            <Ionicons name="ellipsis-vertical" size={18} color="#CBD5E1" />
                        </View>
                    </View>
                    <View style={styles.eventMeta}>
                        <View style={[styles.metaIconChip, { backgroundColor: '#EEF2FF' }]}>
                            <Ionicons name="calendar-outline" size={11} color="#6366F1" />
                        </View>
                        <Text style={styles.eventMetaText}>
                            {item.date ? item.date.split('-').reverse().join('/') : 'Data a definir'}
                        </Text>
                        <View style={[styles.metaIconChip, { backgroundColor: '#F5F3FF' }]}>
                            <Ionicons name="time-outline" size={11} color="#8B5CF6" />
                        </View>
                        <Text style={styles.eventMetaText}>{item.time || '--:--'}</Text>
                        <View style={[styles.metaIconChip, { backgroundColor: '#ECFDF5' }]}>
                            <Ionicons name="people-outline" size={11} color="#10B981" />
                        </View>
                        <Text style={styles.eventMetaText}>{item.attendees?.length || 1}</Text>
                    </View>
                    <View style={[styles.eventMeta, { marginTop: 8 }]}>
                        <View style={[styles.metaIconChip, { backgroundColor: '#FDF2F8' }]}>
                            <Ionicons name="location-outline" size={11} color="#EC4899" />
                        </View>
                        <Text style={styles.eventMetaText} numberOfLines={1}>{item.locationName || 'Local não definido'}</Text>
                    </View>
                </View>
            </Pressable>
        );
    };

    const renderEventCard = ({ item }: { item: any }) => (
        <AnimatedEventCard item={item} onPress={() => setSelectedEvent(item)} />
    );

    const renderRecommendationCard = ({ item }: { item: any }) => (
        <Pressable
            style={({ pressed }) => [styles.recCard, pressed && styles.cardPressed]}
            onPress={() => router.push(`/event/${item.id}` as any)}
        >
            <View style={styles.recAccentBar} />
            <View style={styles.recHeader}>
                <Text style={styles.recDate}>{item.date?.split('-').reverse().join('/')}</Text>
                <TouchableOpacity onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setRecommendations(prev => prev.filter(e => e.id !== item.id));
                }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={16} color="#94A3B8" />
                </TouchableOpacity>
            </View>
            <Text style={styles.recTitle} numberOfLines={2}>{item.title}</Text>
            <View style={styles.recFooter}>
                <View style={[styles.recTypeChip, { backgroundColor: item.type === 'online' ? '#ECFDF5' : '#EEF2FF' }]}>
                    <Ionicons name={item.type === 'online' ? 'videocam-outline' : 'location-outline'} size={11} color={item.type === 'online' ? '#10B981' : '#6366F1'} />
                    <Text style={[styles.recTypeText, { color: item.type === 'online' ? '#10B981' : '#6366F1' }]}>{item.type === 'online' ? 'Online' : 'Presencial'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#6366F1" />
            </View>
        </Pressable>
    );

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <LinearGradient
                colors={['#6366F1', '#8B5CF6']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.header}
            >
                <View style={styles.blobOne} />
                <View style={styles.blobTwo} />

                <View style={styles.headerTopRow}>
                    <View>
                        <Text style={styles.headerTitle}>Agenda de Eventos</Text>
                    </View>
                    <View style={styles.headerIconChip}>
                        <Ionicons name="calendar" size={20} color="#fff" />
                    </View>
                </View>

                {/* Tabs */}
                <View style={styles.tabContainer}>
                    <Pressable
                        style={({ pressed }) => [styles.tabBtn, activeTab === 'upcoming' && styles.tabBtnActive, pressed && { opacity: 0.85 }]}
                        onPress={() => { setActiveTab('upcoming'); setSelectedDate(''); }}
                    >
                        <Text style={[styles.tabText, activeTab === 'upcoming' && styles.tabTextActive]}>Próximos</Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.tabBtn, activeTab === 'history' && styles.tabBtnActive, pressed && { opacity: 0.85 }]}
                        onPress={() => setActiveTab('history')}
                    >
                        <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>Histórico</Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.tabBtn, activeTab === 'favorites' && styles.tabBtnActive, pressed && { opacity: 0.85 }]}
                        onPress={() => setActiveTab('favorites')}
                    >
                        <Text style={[styles.tabText, activeTab === 'favorites' && styles.tabTextActive]}>Favoritos</Text>
                        {favorites.length > 0 && (
                            <View style={styles.tabBadge}>
                                <Text style={styles.tabBadgeText}>{favorites.length}</Text>
                            </View>
                        )}
                    </Pressable>
                </View>
            </LinearGradient>


            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

                {error ? (
                    <View style={{ marginTop: 40 }}>
                        <ErrorState
                            title="Ops, erro ao carregar"
                            message="Não conseguimos acessar sua agenda. Verifique sua internet."
                            onRetry={fetchEvents}
                        />
                    </View>
                ) : activeTab === 'upcoming' && (
                    <View style={[styles.calendarWrapper, styles.calendarOverlap]}>
                        <Calendar
                            markingType={'custom'}
                            dayComponent={(props: any) => <CalendarDayCell {...props} />}
                            onDayPress={onDayPress}
                            markedDates={{
                                ...markedDates,
                                ...recommendations.reduce((acc, rec) => {
                                    if (!rec.date) return acc;
                                    const existing = markedDates[rec.date] || { past: rec.date < getTodayStr(), hasEvent: false };
                                    if (!existing.mine) {
                                        acc[rec.date] = { ...existing, recommended: true, hasEvent: true };
                                    }
                                    return acc;
                                }, {}),
                                [selectedDate]: {
                                    ...markedDates[selectedDate],
                                    ...(recommendations.find(r => r.date === selectedDate) && !markedDates[selectedDate]?.mine ? { recommended: true, hasEvent: true } : {}),
                                    selected: true,
                                }
                            }}
                            theme={{
                                backgroundColor: '#ffffff',
                                calendarBackground: '#ffffff',
                                textSectionTitleColor: '#94A3B8',
                                arrowColor: '#6366F1',
                                monthTextColor: '#0F172A',
                                indicatorColor: '#6366F1',
                                textMonthFontWeight: 'bold',
                                textDayHeaderFontWeight: '600',
                                textMonthFontSize: 18,
                                textDayHeaderFontSize: 13,
                                // @ts-ignore
                                'stylesheet.calendar.header': {
                                    week: {
                                        marginTop: 5,
                                        flexDirection: 'row',
                                        justifyContent: 'space-between'
                                    }
                                }
                            }}
                        />

                        {/* Legenda do Calendário */}
                        <View style={styles.legendCard}>
                            <Text style={styles.legendTitle}>Legenda</Text>
                            <View style={styles.legendGrid}>
                                <View style={styles.legendItem}>
                                    <View style={styles.legendSwatchCircle} />
                                    <Text style={styles.legendText}>Seus Eventos</Text>
                                </View>
                                <View style={styles.legendItem}>
                                    <View style={[styles.legendSwatchIcon, { backgroundColor: '#3B82F6' }]}>
                                        <Ionicons name="repeat" size={9} color="#fff" />
                                    </View>
                                    <Text style={styles.legendText}>Recorrentes</Text>
                                </View>
                                <View style={styles.legendItem}>
                                    <View style={[styles.legendSwatchIcon, { backgroundColor: '#FEF3C7' }]}>
                                        <Text style={{ fontSize: 9 }}>🔥</Text>
                                    </View>
                                    <Text style={styles.legendText}>Populares (+3)</Text>
                                </View>
                                <View style={styles.legendItem}>
                                    <View style={[styles.legendSwatchIcon, { backgroundColor: '#8B5CF6' }]}>
                                        <Text style={{ fontSize: 9 }}>⭐</Text>
                                    </View>
                                    <Text style={styles.legendText}>Recomendados</Text>
                                </View>
                                <View style={styles.legendItem}>
                                    <View style={[styles.legendBar, { backgroundColor: '#10B981' }]} />
                                    <Text style={styles.legendText}>Próximos</Text>
                                </View>
                                <View style={styles.legendItem}>
                                    <View style={[styles.legendBar, { backgroundColor: '#CBD5E1' }]} />
                                    <Text style={styles.legendText}>Passados</Text>
                                </View>
                            </View>
                        </View>
                    </View>
                )}

                <View style={styles.detailsSection}>
                    {activeTab === 'upcoming' && selectedDate ? (
                        <>
                            <View style={styles.detailsHeader}>
                                <View style={styles.detailsIconChip}>
                                    <Ionicons name="calendar" size={16} color="#6366F1" />
                                </View>
                                <Text style={styles.detailsDate}>
                                    {selectedDate.split('-').reverse().join('/')}
                                </Text>
                            </View>
                            {filteredEvents.filter(e => e.date === selectedDate).length > 0 ? (
                                filteredEvents.filter(e => e.date === selectedDate).map(item => (
                                    <View key={item.id} style={{ marginBottom: 10 }}>
                                        {renderEventCard({ item })}
                                    </View>
                                ))
                            ) : (
                                <View style={styles.emptyState}>
                                    <View style={[styles.emptyIconChip, { backgroundColor: '#EEF2FF' }]}>
                                        <Ionicons name="calendar-outline" size={24} color="#6366F1" />
                                    </View>
                                    <Text style={styles.emptyText}>Nenhum evento neste dia.</Text>
                                </View>
                            )}
                        </>
                    ) : activeTab === 'upcoming' && !selectedDate ? (
                        <View style={styles.instructionState}>
                            <View style={styles.instructionInner}>
                                <View style={[styles.emptyIconChip, { backgroundColor: '#EEF2FF' }]}>
                                    <Ionicons name="calendar-outline" size={26} color="#6366F1" />
                                </View>
                                <Text style={styles.instructionText}>
                                    {filteredEvents.length === 0
                                        ? "Você ainda não confirmou presença em eventos futuros. Abaixo estão algumas sugestões para começar:"
                                        : "Selecione uma data no calendário para ver seus eventos."}
                                </Text>
                            </View>

                            {recommendations.length > 0 ? (
                                <View style={styles.recommendationsContainer}>
                                    <View style={styles.recTitleRow}>
                                        <View style={styles.recTitleIconChip}>
                                            <Ionicons name="sparkles" size={14} color="#F59E0B" />
                                        </View>
                                        <Text style={styles.recMainTitle}>Recomendado para você</Text>
                                    </View>
                                    <Text style={styles.recSubtitle}>
                                        {historyTitles.length > 0 
                                            ? 'Baseado no seu histórico, interesses ou localização' 
                                            : 'Baseado nos seus interesses e localização'}
                                    </Text>
                                    <FlatList
                                        horizontal
                                        showsHorizontalScrollIndicator={false}
                                        data={recommendations}
                                        keyExtractor={item => item.id}
                                        renderItem={renderRecommendationCard}
                                        contentContainerStyle={{ paddingRight: 16 }}
                                    />
                                </View>
                            ) : null}
                        </View>
                    ) : (
                        // List View for History & Favorites (No Calendar selection needed)
                        <View>
                            {filteredEvents.length > 0 ? (
                                filteredEvents.map(item => (
                                    <View key={item.id} style={{ marginBottom: 10 }}>
                                        {renderEventCard({ item })}
                                    </View>
                                ))
                            ) : !error && !loading ? (
                                <View style={{ marginTop: 40 }}>
                                    <ErrorState
                                        title={activeTab === 'favorites' ? 'Nenhum favorito' : 'Nenhum histórico'}
                                        message={activeTab === 'favorites' ? 'Você ainda não curtiu nenhum evento.' : 'Você não possui histórico de eventos.'}
                                    />
                                </View>
                            ) : null}
                        </View>
                    )}
                </View>

            </ScrollView>

            {/* Modal de Ações da Agenda */}
            <Modal visible={!!selectedEvent} animationType="slide" transparent={true} onRequestClose={() => setSelectedEvent(null)}>
                <SafeAreaView style={styles.modalOverlay} edges={['bottom']}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHandle} />
                        <Text style={styles.modalTitle} numberOfLines={2}>{selectedEvent?.title}</Text>

                        <Pressable
                            style={({ pressed }) => [styles.modalOption, pressed && styles.modalOptionPressed]}
                            onPress={() => { router.push(`/event/${selectedEvent.id}` as any); setSelectedEvent(null); }}
                        >
                            <View style={[styles.modalIconChip, { backgroundColor: '#EEF2FF' }]}>
                                <Ionicons name="eye-outline" size={18} color="#6366F1" />
                            </View>
                            <Text style={styles.modalOptionText}>Ver Detalhes do Evento</Text>
                            <Ionicons name="chevron-forward" size={16} color="#CBD5E1" style={{ marginLeft: 'auto' }} />
                        </Pressable>

                        {selectedEvent?.createdBy === auth.currentUser?.uid ? (
                            <Pressable
                                style={({ pressed }) => [styles.modalOption, styles.modalOptionDivider, pressed && styles.modalOptionPressed]}
                                onPress={() => handleDeleteEvent(selectedEvent)}
                            >
                                <View style={[styles.modalIconChip, { backgroundColor: '#FEF2F2' }]}>
                                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                                </View>
                                <Text style={[styles.modalOptionText, { color: '#EF4444' }]}>Excluir Evento Definitivamente</Text>
                            </Pressable>
                        ) : (
                            <Pressable
                                style={({ pressed }) => [styles.modalOption, styles.modalOptionDivider, pressed && styles.modalOptionPressed]}
                                onPress={() => handleCancelRSVP(selectedEvent)}
                            >
                                <View style={[styles.modalIconChip, { backgroundColor: '#FEF2F2' }]}>
                                    <Ionicons name="close-circle-outline" size={18} color="#EF4444" />
                                </View>
                                <Text style={[styles.modalOptionText, { color: '#EF4444' }]}>Cancelar Presença (Sair)</Text>
                            </Pressable>
                        )}

                        <Pressable
                            style={({ pressed }) => [styles.modalCancel, pressed && { backgroundColor: '#E2E8F0' }]}
                            onPress={() => setSelectedEvent(null)}
                        >
                            <Text style={styles.modalCancelText}>Fechar Menu</Text>
                        </Pressable>
                    </View>
                </SafeAreaView>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8FAFC' },

    // Header
    header: {
        paddingTop: 16,
        paddingHorizontal: 24,
        paddingBottom: 30,
        borderBottomLeftRadius: 32,
        borderBottomRightRadius: 32,
        overflow: 'hidden',
        position: 'relative',
        shadowColor: '#4f46e5',
        shadowOpacity: 0.3,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
    },
    blobOne: { position: 'absolute', top: -60, right: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.08)' },
    blobTwo: { position: 'absolute', bottom: -70, left: -50, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(255,255,255,0.06)' },

    headerTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
    headerTitle: { fontSize: 24, fontWeight: '800', color: '#fff' },
    headerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4, maxWidth: 230 },
    pulseRing: { position: 'absolute', width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(239,68,68,0.2)', top: -10, left: -10 },

    headerIconChip: { width: 42, height: 42, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.18)', justifyContent: 'center', alignItems: 'center' },

    tabContainer: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 14, padding: 4, gap: 4, marginBottom: -10 },
    tabBtn: { flex: 1, flexDirection: 'row', paddingVertical: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 10, position: 'relative' },
    tabBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
    tabText: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
    tabTextActive: { color: '#6366F1' },
    tabBadge: { position: 'absolute', top: -6, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#EF4444', borderWidth: 1.5, borderColor: '#fff', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 2 },
    tabBadgeText: { color: '#fff', fontSize: 9, fontWeight: 'bold' },

    scrollContent: { paddingBottom: 40 },
    calendarWrapper: {
        backgroundColor: '#fff',
        borderRadius: 22,
        marginHorizontal: 16,
        padding: 10,
        shadowColor: '#4b4b76',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.08,
        shadowRadius: 16,
        elevation: 4,
    },
    calendarOverlap: { marginTop: -24 },
    detailsSection: { marginTop: 8, paddingHorizontal: 16 },
    detailsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, paddingLeft: 4 },
    detailsIconChip: { width: 30, height: 30, borderRadius: 11, backgroundColor: '#EEF2FF', justifyContent: 'center', alignItems: 'center' },
    detailsDate: { fontSize: 17, fontWeight: '800', color: '#1E293B' },

    // Calendar Day Cell (sinalizações customizadas)
    dayCell: { alignItems: 'center', justifyContent: 'flex-start', paddingTop: 2, paddingBottom: 4 },
    dayCircle: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    dayCircleMine: { backgroundColor: 'rgba(139,92,246,0.16)' },
    dayCircleToday: { borderWidth: 1.5, borderColor: '#6366F1' },
    dayCircleSelected: { backgroundColor: '#6366F1' },
    dayText: { fontSize: 14, fontWeight: '600', color: '#1E293B' },
    dayTextDisabled: { color: '#CBD5E1' },
    dayTextToday: { color: '#6366F1', fontWeight: '800' },
    dayTextSelected: { color: '#fff', fontWeight: '800' },
    dayBadgeRecurring: {
        position: 'absolute', top: -3, left: -4, width: 13, height: 13, borderRadius: 6.5,
        backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center',
        borderWidth: 1.5, borderColor: '#fff',
    },
    dayBadgePopular: {
        position: 'absolute', top: -3, right: -4, width: 13, height: 13, borderRadius: 6.5,
        backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center',
        borderWidth: 1.5, borderColor: '#fff',
    },
    dayBadgePopularEmoji: { fontSize: 7 },
    dayBar: { width: 14, height: 3, borderRadius: 2, marginTop: 3 },

    // Legenda do Calendário
    legendCard: { marginTop: 12, paddingTop: 12, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
    legendTitle: { fontSize: 11, fontWeight: '800', color: '#94A3B8', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.6 },
    legendGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, columnGap: 16 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendSwatchCircle: { width: 14, height: 14, borderRadius: 7, backgroundColor: 'rgba(139,92,246,0.16)', borderWidth: 1.5, borderColor: '#8B5CF6' },
    legendSwatchIcon: { width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
    legendBar: { width: 14, height: 4, borderRadius: 2 },
    legendText: { fontSize: 12, color: '#64748B', fontWeight: '500' },

    // Cards
    eventCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 18,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#4b4b76',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 2,
        borderWidth: 1,
        borderColor: '#F1F3FA'
    },
    eventCardSoon: { borderColor: '#E0E7FF', backgroundColor: '#FAFAFF' },
    cardPressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
    eventTypeIndicator: { width: 4, height: 40, borderRadius: 2, marginRight: 16 },
    eventInfo: { flex: 1 },
    eventTitle: { fontSize: 16, fontWeight: '700', color: '#0F172A', marginBottom: 4 },
    eventMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap', rowGap: 6 },
    eventMetaText: { fontSize: 12, color: '#64748B', marginRight: 12, fontWeight: '500' },
    metaIconChip: { width: 20, height: 20, borderRadius: 7, justifyContent: 'center', alignItems: 'center', marginRight: 5 },

    badgePopular: { backgroundColor: '#FEF3C7', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
    badgePopularText: { fontSize: 10, fontWeight: 'bold', color: '#D97706' },
    badgeSoon: { backgroundColor: '#EEF2FF', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
    badgeSoonText: { fontSize: 10, fontWeight: 'bold', color: '#6366F1' },

    emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#F0F1F8', gap: 12 },
    emptyIconChip: { width: 56, height: 56, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
    emptyText: { color: '#94A3B8', fontSize: 14, fontWeight: '500' },
    instructionState: { alignItems: 'center', justifyContent: 'center' },
    instructionInner: { alignItems: 'center', justifyContent: 'center', paddingVertical: 30, gap: 14 },
    instructionText: { color: '#94A3B8', fontSize: 14, textAlign: 'center', paddingHorizontal: 40, fontWeight: '500' },

    // Modal
    modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
    modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 32 },
    modalHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 18 },
    modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#0F172A', marginBottom: 12 },
    modalOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderRadius: 14 },
    modalOptionDivider: { borderTopWidth: 1, borderColor: '#F1F5F9', marginTop: 4, paddingTop: 16 },
    modalOptionPressed: { backgroundColor: '#F8FAFC' },
    modalIconChip: { width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    modalOptionText: { fontSize: 15, fontWeight: '600', color: '#1E293B' },
    modalCancel: { marginTop: 14, backgroundColor: '#F1F5F9', padding: 14, borderRadius: 14, alignItems: 'center' },
    modalCancelText: { fontSize: 15, fontWeight: 'bold', color: '#64748B' },

    // Recommendations
    recommendationsContainer: { width: '100%', marginBottom: 8 },
    recTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    recTitleIconChip: { width: 26, height: 26, borderRadius: 9, backgroundColor: '#FFFBEB', justifyContent: 'center', alignItems: 'center' },
    recMainTitle: { fontSize: 16, fontWeight: 'bold', color: '#1E293B' },
    recSubtitle: { fontSize: 13, color: '#64748B', marginBottom: 14, marginLeft: 34 },
    recCard: {
        backgroundColor: '#fff', width: 200, padding: 16, paddingTop: 20, borderRadius: 18, marginRight: 12,
        borderWidth: 1, borderColor: '#F1F3FA', overflow: 'hidden',
        shadowColor: '#4b4b76', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
    },
    recAccentBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 4, backgroundColor: '#F59E0B' },
    recHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    recDate: { fontSize: 12, fontWeight: 'bold', color: '#6366F1' },
    recTitle: { fontSize: 14, fontWeight: 'bold', color: '#1E293B', marginBottom: 14 },
    recFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    recTypeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    recTypeText: { fontSize: 11, fontWeight: '700' },
});
