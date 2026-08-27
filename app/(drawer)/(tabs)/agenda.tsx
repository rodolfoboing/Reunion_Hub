import { ErrorState } from '@/src/components/ErrorState';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDocs, onSnapshot, query, where, limit, orderBy } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, LayoutAnimation, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, TouchableOpacity, UIManager, View } from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Meeting } from '../../../src/types';
import { STRINGS } from '../../../src/constants/strings';
import { CONFIG } from '../../../src/constants/Config';
import { normalizeDate, getTodayStr, getDateAfterDays } from '../../../src/utils/dateUtils';
import { canCancelActiveEvent, canFavoriteAttendedEvent, canLeaveActiveEvent, canRequestFavoriteAttendedEvent, formatEventTimeRange, getEventInterval, getEventJourneyState, hasEventEnded } from '../../../src/utils/eventSchedule';
import { useEventClock } from '../../../src/hooks/useEventClock';
import { auth, db, functions } from '../../../src/services/firebaseConfig';
import { normalizeInterests } from '../../../src/constants/Interests';
import { cancelEventReminder, scheduleEventReminders, syncEventReminders } from '../../../src/utils/Notifications';
import { DISCOVERY_REASON_LABELS, getEventDiscovery } from '../../../src/utils/eventDiscovery';
import { ReputationFeedbackModal } from '../../../src/components/ReputationFeedbackModal';

type FavoriteActionState = 'idle' | 'saving' | 'added' | 'removed';
type PendingRepeatRequest = { sourceEventId: string; date: string; requestId: string };

function eventScheduleMillis(event: Pick<Meeting, 'date' | 'time' | 'endDate' | 'endTime'>, boundary: 'start' | 'end'): number {
    const interval = getEventInterval(event);
    return interval?.[boundary].getTime() ?? 0;
}

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

import { getDistanceFromLatLonInKm } from '../../../src/utils/distance';

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
    const eventClock = useEventClock();
    const { tab: requestedTab } = useLocalSearchParams<{ tab?: string }>();
    // Tab State: 'upcoming' | 'history' | 'favorites'
    const [activeTab, setActiveTab] = useState<'upcoming' | 'history' | 'favorites'>('upcoming');

    useEffect(() => {
        if (requestedTab === 'history' || requestedTab === 'favorites' || requestedTab === 'upcoming') {
            setSelectedDate('');
            setSelectedEvent(null);
            setActiveTab(requestedTab);
        }
    }, [requestedTab]);

    // Data State
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
    const [cancellationPenalty, setCancellationPenalty] = useState(false);
    const [showFavoriteRepeatDatePicker, setShowFavoriteRepeatDatePicker] = useState(false);
    const [recommendations, setRecommendations] = useState<any[]>([]);
    const [allRecs, setAllRecs] = useState<any[]>([]);
    const [historyTitles, setHistoryTitles] = useState<string[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);
    const [favoriteActionState, setFavoriteActionState] = useState<FavoriteActionState>('idle');
    const favoriteHeartScale = useRef(new Animated.Value(1)).current;
    const favoriteFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRepeatRequestRef = useRef<PendingRepeatRequest | null>(null);
    const fetchRequestId = useRef(0);
    const settlementAttemptedEventIds = useRef(new Set<string>());

    const isMounted = useRef(true);
    const getAgendaDiscovery = (meeting: Meeting) => getEventDiscovery(meeting, {
        userCoordinates: userLocation
            ? { latitude: userLocation.coords.latitude, longitude: userLocation.coords.longitude }
            : null,
        userInterests,
        historyTitles,
        now: eventClock,
    });

    useEffect(() => {
        if (favoriteFeedbackTimer.current) {
            clearTimeout(favoriteFeedbackTimer.current);
            favoriteFeedbackTimer.current = null;
        }
        setFavoriteActionState('idle');
        favoriteHeartScale.setValue(1);
        return () => {
            if (favoriteFeedbackTimer.current) clearTimeout(favoriteFeedbackTimer.current);
        };
    }, [selectedEvent?.id, favoriteHeartScale]);

    // Initial Fetch (User Favorites & Profile)
    useFocusEffect(
        useCallback(() => {
            isMounted.current = true;
            settlementAttemptedEventIds.current.clear();
            setRefreshKey((current) => current + 1);
            let unsubProfile: any;
            const unsubscribeAuth = auth.onAuthStateChanged((user) => {
                if (user && isMounted.current) {
                    setRefreshKey((current) => current + 1);
                    if (unsubProfile) unsubProfile();
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
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    const lastLoc = await Location.getLastKnownPositionAsync();
                    if (lastLoc && isMounted.current) setUserLocation(lastLoc);
                    
                    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                    if (isMounted.current) setUserLocation(loc);
                }
            })().catch((locationError: unknown) => {
                if (__DEV__) console.warn('[Agenda] location_unavailable', locationError instanceof Error ? locationError.message : 'unknown');
            });

            return () => {
                isMounted.current = false;
                fetchRequestId.current += 1;
                unsubscribeAuth();
                if (unsubProfile) unsubProfile();
            };
        }, [])
    );

    useEffect(() => {
        fetchEvents();
    }, [activeTab, favorites.join(','), selectedDate, userLocation, userInterests.join(','), showPopularOutsideInterests, refreshKey]);

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

        // Recomendado é uma classificação local: interesse/histórico ou,
        // quando permitido no perfil, popularidade contextual.
        finalRecs = finalRecs.filter((event: Meeting) => {
            const discovery = getAgendaDiscovery(event);
            const personalized = discovery.reasons.includes('interest') || discovery.reasons.includes('history');
            return discovery.isRecommended
                && (personalized || (showPopularOutsideInterests && discovery.reasons.includes('popular')));
        });

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
    }, [allRecs, userInterests, historyTitles, userLocation, showPopularOutsideInterests, eventClock]);

    const fetchEvents = async () => {
        const requestId = ++fetchRequestId.current;
        const isLatestRequest = () => isMounted.current && requestId === fetchRequestId.current;
        const currentUid = auth.currentUser?.uid;
        if (!currentUid || !isMounted.current) {
            if (isLatestRequest()) setLoading(false);
            return;
        }

        setLoading(true);
        setError(false);
        try {
            const todayStr = getTodayStr();

            if (activeTab === 'favorites') {
                const favoritesSnapshot = await getDocs(query(
                    collection(db, 'users', currentUid, 'favoriteEvents'),
                    orderBy('favoritedAt', 'desc'),
                    limit(CONFIG.AGENDA_FAVORITES_LIMIT),
                ));
                const events = favoritesSnapshot.docs.map((favorite) => ({
                    id: favorite.id,
                    ...favorite.data(),
                    date: normalizeDate(favorite.data().date) || undefined,
                    isFavoriteSnapshot: true,
                }));

                if (!isLatestRequest()) return;
                const favoriteIds = events.map((event) => event.id);
                setFavorites((current) => current.join('|') === favoriteIds.join('|') ? current : favoriteIds);
                events.sort((a, b) => eventScheduleMillis(b, 'end') - eventScheduleMillis(a, 'end'));
                setFilteredEvents(events);
                setMarkedDates({});
                setLoading(false);
                return;
            }

            // Firestore não permite combinar array-contains e createdBy sem uma consulta OR.
            // Duas leituras pequenas cobrem eventos confirmados e eventos criados, inclusive os legados
            // em que o criador não foi salvo no array de participantes.
            const [attendingSnapshot, createdSnapshot] = await Promise.all([
                getDocs(query(
                    collection(db, 'meetings'),
                    where('attendees', 'array-contains', currentUid),
                    limit(CONFIG.AGENDA_MY_EVENTS_LIMIT)
                )),
                getDocs(query(
                    collection(db, 'meetings'),
                    where('createdBy', '==', currentUid),
                    limit(CONFIG.AGENDA_MY_EVENTS_LIMIT)
                )),
            ]);
            const eventDocuments = new Map<string, typeof attendingSnapshot.docs[number]>();
            attendingSnapshot.docs.forEach((eventDocument) => eventDocuments.set(eventDocument.id, eventDocument));
            createdSnapshot.docs.forEach((eventDocument) => eventDocuments.set(eventDocument.id, eventDocument));
            const events = [...eventDocuments.values()].map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    ...data,
                    date: normalizeDate(data.date)
                };
            }).filter((e: any) => e.date !== null && e.status !== 'cancelled');
            if (!isLatestRequest()) return;

            // Local filter for Upcoming vs History
            let results: any[] = [];
            let historyEvents: any[] = [];

            if (activeTab === 'upcoming') {
                results = events.filter((ev: any) => ev.status !== 'completed' && ev.date >= todayStr && !hasEventEnded(ev, eventClock));
                historyEvents = events.filter((ev: any) => ev.date < todayStr || ev.status === 'completed' || hasEventEnded(ev, eventClock));

                // Marcações do calendário: cada dia recebe um objeto com as flags de
                // sinalização (criado por você, recorrente, popular, passado/próximo).
                // Usamos TODOS os eventos (passados e futuros) para que o calendário
                // mostre o histórico completo, não só os próximos.
                const marks: any = {};
                events.forEach((ev: any) => {
                    if (!ev.date) return;
                    const isMine = ev.createdBy === currentUid;
                    const isPopular = getAgendaDiscovery(ev).reasons.includes('popular');
                    const isPast = ev.date.localeCompare(todayStr) < 0 || hasEventEnded(ev, eventClock);

                    if (!marks[ev.date]) {
                        marks[ev.date] = { mine: false, recurring: false, popular: false, past: isPast, hasEvent: true };
                    }
                    if (isMine) marks[ev.date].mine = true;
                    if (ev.isRepeated) marks[ev.date].recurring = true;
                    if (isPopular) marks[ev.date].popular = true;
                });
                setMarkedDates(marks);

                // Sort nearest first
                results.sort((a: Meeting, b: Meeting) => eventScheduleMillis(a, 'start') - eventScheduleMillis(b, 'start'));

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
                if (!isLatestRequest()) return;
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
                    const discovery = getAgendaDiscovery(event);
                    const isPopular = discovery.reasons.includes('popular');
                    const isRecommended = discovery.reasons.includes('interest') || discovery.reasons.includes('history');
                    if (!isPopular && !isRecommended) return;
                    if (!marks[event.date]) marks[event.date] = { mine: false, recurring: false, popular: false, recommended: false, past: false, hasEvent: true };
                    if (isPopular && (showPopularOutsideInterests || isRecommended)) marks[event.date].popular = true;
                    if (isRecommended) marks[event.date].recommended = true;
                });
                setMarkedDates(marks);

                // Combina passados e futuros para permitir tocar em qualquer dia
                // marcado no calendário (inclusive datas passadas) e ver os eventos dele.
                setFilteredEvents([...results, ...historyEvents, ...fetchedRecs]);
                syncEventReminders(results.map((event) => ({
                    id: event.id,
                    title: event.title || 'Evento',
                    date: event.date,
                    time: event.time,
                    endDate: event.endDate,
                    endTime: event.endTime,
                    type: event.type,
                    isOrganizer: event.createdBy === currentUid,
                })), currentUid).catch(() => undefined);
                setLoading(false);
                return;

            } else if (activeTab === 'history') {
                results = events.filter((ev: any) => ev.date < todayStr || ev.status === 'completed' || hasEventEnded(ev, eventClock));
                setMarkedDates({});
                // Sort most recent past first
                results.sort((a: Meeting, b: Meeting) => eventScheduleMillis(b, 'end') - eventScheduleMillis(a, 'end'));

                // Recupera em um único lote curto eventos de dias anteriores que
                // ficaram ativos (inclusive legados sem `status`). O servidor
                // valida vínculo, horário e idempotência antes de calcular pontos.
                const staleEventIds = results
                    .filter((event: Meeting) => {
                        const interval = getEventInterval(event);
                        return event.status !== 'completed'
                            && event.status !== 'cancelled'
                            && Boolean(interval && getTodayStr(interval.end) < todayStr)
                            && !settlementAttemptedEventIds.current.has(event.id);
                    })
                    .slice(0, 10)
                    .map((event: Meeting) => event.id);
                if (staleEventIds.length > 0) {
                    staleEventIds.forEach((eventId) => settlementAttemptedEventIds.current.add(eventId));
                    void httpsCallable<
                        { eventIds: string[] },
                        { completed: number; alreadySettled: number; skipped: number; failed: number }
                    >(functions, 'settleMyExpiredEvents')({ eventIds: staleEventIds })
                        .then((settlement) => {
                            if (isMounted.current && settlement.data.completed > 0) {
                                setRefreshKey((current) => current + 1);
                            }
                            if (__DEV__ && settlement.data.failed > 0) {
                                console.warn('[Agenda] history_settlement_partial_failure', { failed: settlement.data.failed });
                            }
                        })
                        .catch((settlementError: unknown) => {
                            if (__DEV__) console.warn(
                                '[Agenda] history_settlement_failed',
                                settlementError instanceof Error ? settlementError.message : 'unknown',
                            );
                        });
                }
            }

            setFilteredEvents(results);

        } catch (error: any) {
            console.error(`${STRINGS.LOG_DB_READ} [Agenda] Erro ao buscar eventos da agenda:`, error.code, error.message);
            if (isLatestRequest()) setError(true);
        } finally {
            if (isLatestRequest()) setLoading(false);
        }
    };

    const toggleFavorite = async (eventId: string, showConfirmation = false): Promise<boolean | null> => {
        if (!auth.currentUser) return null;

        if (showConfirmation) setFavoriteActionState('saving');
        try {
            const result = await httpsCallable<{ eventId: string }, { favorited: boolean }>(functions, 'toggleEventFavorite')({ eventId });
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setFavorites((currentFavorites) => result.data.favorited
                ? [...new Set([...currentFavorites, eventId])]
                : currentFavorites.filter((favoriteId) => favoriteId !== eventId));

            if (!result.data.favorited && activeTab === 'favorites') {
                setFilteredEvents((currentEvents) => currentEvents.filter((event) => event.id !== eventId));
            }

            if (showConfirmation) {
                setFavoriteActionState(result.data.favorited ? 'added' : 'removed');
                const animation = result.data.favorited
                    ? [
                        Animated.spring(favoriteHeartScale, { toValue: 1.45, useNativeDriver: true }),
                        Animated.spring(favoriteHeartScale, { toValue: 1, useNativeDriver: true }),
                    ]
                    : [
                        Animated.timing(favoriteHeartScale, { toValue: 0.65, duration: 140, useNativeDriver: true }),
                        Animated.spring(favoriteHeartScale, { toValue: 1, useNativeDriver: true }),
                    ];
                Animated.sequence(animation).start();
                if (favoriteFeedbackTimer.current) clearTimeout(favoriteFeedbackTimer.current);
                favoriteFeedbackTimer.current = setTimeout(() => {
                    setFavoriteActionState('idle');
                    favoriteFeedbackTimer.current = null;
                }, 1600);
            }
            return result.data.favorited;
        } catch (err) {
            console.error('[Agenda] favorite_toggle_failed', err);
            if (showConfirmation) setFavoriteActionState('idle');
            Alert.alert('Não foi possível atualizar os favoritos', 'Confira sua conexão e tente novamente.');
            return null;
        }
    };

    const onDayPress = (day: any) => {
        setSelectedDate(day.dateString);
    };

    const handleCancelRSVP = async (event: any) => {
        if (!auth.currentUser) return;
        if (!canLeaveActiveEvent(event, eventClock)) {
            setSelectedEvent(null);
            Alert.alert('Presença não pode ser cancelada', 'A saída fica disponível somente antes do horário de início do evento.');
            return;
        }
        const currentUid = auth.currentUser.uid;
        Alert.alert('Cancelar Presença', `Tem certeza que deseja cancelar sua presença em "${event.title}"?`, [
            { text: 'Não', style: 'cancel' },
            {
                text: 'Sim, Cancelar', style: 'destructive', onPress: async () => {
                    try {
                        await httpsCallable(functions, 'leaveEvent')({ eventId: event.id });
                        await cancelEventReminder(event.id, currentUid).catch(() => undefined);
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
        if (!canCancelActiveEvent(event, eventClock)) {
            setSelectedEvent(null);
            Alert.alert('Evento já encerrado', 'Eventos que já terminaram não podem ser cancelados. Consulte o histórico para acompanhar o processamento.');
            return;
        }
        const hasOtherAttendees = (event.attendees || []).some((attendeeId: string) => attendeeId !== auth.currentUser?.uid);
        Alert.alert('Cancelar Evento', hasOtherAttendees
            ? `Cancelar "${event.title}" avisará os participantes e reduzirá sua reputação.`
            : `Cancelar "${event.title}" não reduz sua reputação, pois não há outros participantes.`, [
            { text: 'Cancelar', style: 'cancel' },
            {
                text: 'Cancelar Evento', style: 'destructive', onPress: async () => {
                    try {
                        const cancelEvent = httpsCallable<{ eventId: string }, { penalized: boolean }>(functions, 'cancelEvent');
                        const result = await cancelEvent({ eventId: event.id });
                        const currentUid = auth.currentUser?.uid;
                        if (currentUid) {
                            await cancelEventReminder(event.id, currentUid).catch(() => undefined);
                        }
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setFilteredEvents(prev => prev.filter(e => e.id !== event.id));
                        setSelectedEvent(null);
                        if (result.data.penalized) {
                            setCancellationPenalty(true);
                        } else {
                            Alert.alert('Evento cancelado', 'Como não havia outros participantes, sua reputação não foi alterada.');
                        }
                    } catch (e) {
                        Alert.alert('Erro', 'Falha ao excluir evento.');
                    }
                }
            }
        ]);
    };

    const handleRepeatFavorite = async (selectedDate: Date) => {
        if (!selectedEvent?.isFavoriteSnapshot) return;
        const date = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
        const sourceEventId = selectedEvent.sourceEventId || selectedEvent.id;
        const currentPendingRequest = pendingRepeatRequestRef.current;
        let pendingRequest: PendingRepeatRequest;
        if (currentPendingRequest && currentPendingRequest.sourceEventId === sourceEventId && currentPendingRequest.date === date) {
            pendingRequest = currentPendingRequest;
        } else {
            pendingRequest = {
                sourceEventId,
                date,
                requestId: doc(collection(db, 'operationIds')).id,
            };
        }
        pendingRepeatRequestRef.current = pendingRequest;
        try {
            const recreateEvent = httpsCallable<{ eventId: string; date: string; requestId: string }, { eventId: string; alreadyCreated: boolean }>(functions, 'recreateFavoriteEvent');
            const result = await recreateEvent({ eventId: sourceEventId, date, requestId: pendingRequest.requestId });
            pendingRepeatRequestRef.current = null;
            const currentUid = auth.currentUser?.uid;
            if (currentUid) scheduleEventReminders([{
                id: result.data.eventId,
                title: selectedEvent.title || 'Evento',
                date,
                time: selectedEvent.time,
                endDate: date,
                endTime: selectedEvent.endTime,
                type: selectedEvent.type,
                isOrganizer: true,
            }], currentUid).catch(() => undefined);
            setShowFavoriteRepeatDatePicker(false);
            setSelectedEvent(null);
            Alert.alert(result.data.alreadyCreated ? 'Evento já existente' : 'Evento repetido', result.data.alreadyCreated
                ? 'Este evento já havia sido repetido para a data escolhida. Abrimos a edição existente.'
                : 'O novo evento foi criado. Abra-o para convidar participantes de edições anteriores.');
            router.push(`/event/${result.data.eventId}` as any);
        } catch (error) {
            console.error('[Agenda] favorite_recreation_failed');
            Alert.alert('Não foi possível repetir', 'Escolha uma data futura e tente novamente.');
        }
    };

    const handleProposeFavoriteRepeat = async () => {
        if (!selectedEvent?.isFavoriteSnapshot) return;
        try {
            const result = await httpsCallable<{ eventId: string }, { ok: boolean; alreadyProposed: boolean }>(functions, 'proposeFavoriteEventRepeat')({
                eventId: selectedEvent.sourceEventId || selectedEvent.id,
            });
            setSelectedEvent(null);
            Alert.alert(result.data.alreadyProposed ? 'Proposta já enviada' : 'Proposta enviada', result.data.alreadyProposed
                ? 'Você já havia pedido uma nova edição deste evento. Nenhuma notificação repetida foi enviada.'
                : 'O criador foi avisado de que você gostaria de uma nova edição.');
        } catch (error) {
            console.error('[Agenda] favorite_repeat_proposal_failed');
            Alert.alert('Não foi possível enviar', 'Tente novamente em instantes.');
        }
    };

    const AnimatedEventCard = ({ item, onPress }: { item: any, onPress: () => void }) => {
        const pulseAnim = useRef(new Animated.Value(1)).current;
        const favoriteCardScale = useRef(new Animated.Value(1)).current;
        const [removingFavorite, setRemovingFavorite] = useState(false);
        const [updatingHistoryFavorite, setUpdatingHistoryFavorite] = useState(false);

        const todayStr = getTodayStr();
        const tomorrowStr = getDateAfterDays(1);

        const discovery = getAgendaDiscovery(item);
        const isInProgress = discovery.reasons.includes('in_progress');
        const isVerySoon = !isInProgress && (item.date === todayStr || item.date === tomorrowStr);
        const isPopular = discovery.reasons.includes('popular');
        const viewerUid = auth.currentUser?.uid;
        const isUserEvent = item.createdBy === viewerUid || item.attendees?.includes(viewerUid);
        const hasConfirmedCheckIn = Boolean(viewerUid && item.checkedIn?.includes(viewerUid));
        const hasPendingCheckIn = Boolean(viewerUid && item.pendingCheckIns?.some(
            ({ userId }: { userId: string }) => userId === viewerUid
        ));
        const canToggleHistoryFavorite = activeTab === 'history' && canRequestFavoriteAttendedEvent(
            item,
            hasConfirmedCheckIn,
            hasPendingCheckIn,
            eventClock,
        );
        const isHistoryFavorite = favorites.includes(item.id);
        const journeyState = getEventJourneyState(item, eventClock, {
            isAttending: Boolean(viewerUid && item.attendees?.includes(viewerUid)),
            isCreator: item.createdBy === viewerUid,
            hasCheckedIn: hasConfirmedCheckIn,
            hasPendingCheckIn,
        });
        const personalizedReason = !isUserEvent
            ? discovery.reasons.find((reason) => reason === 'interest' || reason === 'history')
            : undefined;

        useEffect(() => {
            if (isVerySoon) {
                const pulseLoop = Animated.loop(
                    Animated.sequence([
                        Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
                        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
                    ])
                );
                pulseLoop.start();
                return () => pulseLoop.stop();
            }
            pulseAnim.setValue(1);
        }, [isVerySoon, pulseAnim]);

        const handleRemoveFavorite = () => {
            if (removingFavorite) return;
            setRemovingFavorite(true);
            Animated.sequence([
                Animated.spring(favoriteCardScale, { toValue: 1.3, useNativeDriver: true }),
                Animated.timing(favoriteCardScale, { toValue: 0.7, duration: 150, useNativeDriver: true }),
            ]).start(async () => {
                const favorited = await toggleFavorite(item.id);
                if (favorited === null || favorited) {
                    favoriteCardScale.setValue(1);
                    setRemovingFavorite(false);
                }
            });
        };

        const handleHistoryFavorite = async () => {
            if (updatingHistoryFavorite) return;
            setUpdatingHistoryFavorite(true);
            Animated.sequence([
                Animated.spring(favoriteCardScale, { toValue: 1.35, useNativeDriver: true }),
                Animated.spring(favoriteCardScale, { toValue: 1, useNativeDriver: true }),
            ]).start();
            const favorited = await toggleFavorite(item.id);
            setUpdatingHistoryFavorite(false);
            if (favorited === null) return;
            const message = favorited ? 'Evento adicionado aos favoritos.' : 'Evento removido dos favoritos.';
            if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
            else Alert.alert(favorited ? 'Adicionado aos favoritos' : 'Removido dos favoritos', message);
        };

        let indicatorColor = item.type === 'online' ? '#10B981' : '#6366F1';
        if (isPopular) indicatorColor = '#F59E0B'; // Fogo / Laranja
        if (isInProgress) indicatorColor = '#059669';

        return (
            <Pressable
                style={({ pressed }) => [
                    styles.eventCard,
                    isVerySoon && styles.eventCardSoon,
                    isInProgress && styles.eventCardInProgress,
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
                            {isInProgress && <View style={styles.badgeInProgress}><Text style={styles.badgeInProgressText} numberOfLines={1}>EM ANDAMENTO</Text></View>}
                            {isUserEvent && !isInProgress && <View style={styles.badgeJourney}><Text style={styles.badgeJourneyText} numberOfLines={1}>{journeyState.compactLabel}</Text></View>}
                            {isPopular && <View style={styles.badgePopular}><Text style={styles.badgePopularText}>🔥 Pop</Text></View>}
                            {personalizedReason && <View style={styles.badgeRecommended}><Text style={styles.badgeRecommendedText}>{DISCOVERY_REASON_LABELS[personalizedReason]}</Text></View>}
                            {isVerySoon && !isUserEvent && <View style={styles.badgeSoon}><Text style={styles.badgeSoonText}>⏳ Em Breve</Text></View>}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            {canToggleHistoryFavorite && (
                                <TouchableOpacity
                                    onPress={(event) => {
                                        event.stopPropagation();
                                        void handleHistoryFavorite();
                                    }}
                                    disabled={updatingHistoryFavorite}
                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                    accessibilityRole="button"
                                    accessibilityLabel={isHistoryFavorite ? 'Remover evento dos favoritos' : 'Adicionar evento aos favoritos'}
                                >
                                    <Animated.View style={{ transform: [{ scale: favoriteCardScale }] }}>
                                        {updatingHistoryFavorite
                                            ? <ActivityIndicator size="small" color="#EF4444" />
                                            : <Ionicons name={isHistoryFavorite ? 'heart' : 'heart-outline'} size={21} color="#EF4444" />}
                                    </Animated.View>
                                </TouchableOpacity>
                            )}
                            {activeTab === 'favorites' && (
                                <TouchableOpacity
                                    onPress={(event) => {
                                        event.stopPropagation();
                                        handleRemoveFavorite();
                                    }}
                                    disabled={removingFavorite}
                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                >
                                    <Animated.View style={{ transform: [{ scale: favoriteCardScale }] }}>
                                        <Ionicons name="heart" size={20} color="#EF4444" />
                                    </Animated.View>
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
                        <Text style={styles.eventMetaText}>{formatEventTimeRange(item)}</Text>
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
                    {isUserEvent && <Text style={styles.eventJourneyHint} numberOfLines={2}>{journeyState.message}</Text>}
                </View>
            </Pressable>
        );
    };

    const renderEventCard = ({ item }: { item: any }) => (
        <AnimatedEventCard item={item} onPress={() => setSelectedEvent(item)} />
    );

    const renderRecommendationCard = ({ item }: { item: any }) => {
        const discovery = getAgendaDiscovery(item);
        const reason = discovery.primaryReason;
        return (
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
            {reason && (
                <View style={styles.recReasonBadge}>
                    <Text style={styles.recReasonText}>{DISCOVERY_REASON_LABELS[reason]}</Text>
                </View>
            )}
            <View style={styles.recFooter}>
                <View style={[styles.recTypeChip, { backgroundColor: item.type === 'online' ? '#ECFDF5' : '#EEF2FF' }]}>
                    <Ionicons name={item.type === 'online' ? 'videocam-outline' : 'location-outline'} size={11} color={item.type === 'online' ? '#10B981' : '#6366F1'} />
                    <Text style={[styles.recTypeText, { color: item.type === 'online' ? '#10B981' : '#6366F1' }]}>{item.type === 'online' ? 'Online' : 'Presencial'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#6366F1" />
            </View>
        </Pressable>
        );
    };

    const selectedEventSourceId = selectedEvent?.sourceEventId || selectedEvent?.id;
    const selectedEventIsFavorite = Boolean(selectedEvent?.isFavoriteSnapshot || (selectedEventSourceId && favorites.includes(selectedEventSourceId)));
    const selectedEventHasConfirmedCheckIn = Boolean(selectedEvent?.checkedIn?.includes(auth.currentUser?.uid));
    const selectedEventHasPendingCheckIn = Boolean(selectedEvent?.pendingCheckIns?.some(
        ({ userId }: { userId: string }) => userId === auth.currentUser?.uid
    ));
    const selectedEventCanBeFavorited = Boolean(
        selectedEvent
        && !selectedEvent.isFavoriteSnapshot
        && canRequestFavoriteAttendedEvent(
            selectedEvent,
            selectedEventHasConfirmedCheckIn,
            selectedEventHasPendingCheckIn,
            eventClock,
        )
    );
    const selectedEventCanBeCancelled = Boolean(
        selectedEvent
        && !selectedEvent.isFavoriteSnapshot
        && selectedEvent.createdBy === auth.currentUser?.uid
        && canCancelActiveEvent(selectedEvent, eventClock)
    );
    const selectedEventCanBeLeft = Boolean(
        selectedEvent
        && !selectedEvent.isFavoriteSnapshot
        && selectedEvent.createdBy !== auth.currentUser?.uid
        && selectedEvent.attendees?.includes(auth.currentUser?.uid)
        && canLeaveActiveEvent(selectedEvent, eventClock)
    );
    const favoriteWasJustAdded = favoriteActionState === 'added';
    const favoriteWasJustRemoved = favoriteActionState === 'removed';
    const recommendationMarks = recommendations.reduce<Record<string, Record<string, boolean>>>((marks, recommendation) => {
        if (!recommendation.date) return marks;
        const existing = markedDates[recommendation.date] || { past: recommendation.date < getTodayStr(), hasEvent: false };
        if (existing.mine) return marks;

        const discovery = getAgendaDiscovery(recommendation);
        const personalized = discovery.reasons.includes('interest') || discovery.reasons.includes('history');
        const popular = discovery.reasons.includes('popular') && (showPopularOutsideInterests || personalized);
        marks[recommendation.date] = {
            ...existing,
            popular: Boolean(existing.popular) || popular,
            recommended: Boolean(existing.recommended) || personalized,
            hasEvent: true,
        };
        return marks;
    }, {});
    const selectedRecommendation = recommendations.find((recommendation) => recommendation.date === selectedDate);
    const selectedRecommendationDiscovery = selectedRecommendation
        ? getAgendaDiscovery(selectedRecommendation)
        : null;
    const selectedRecommendationIsPersonalized = selectedRecommendationDiscovery
        ? selectedRecommendationDiscovery.reasons.includes('interest') || selectedRecommendationDiscovery.reasons.includes('history')
        : false;
    const selectedRecommendationIsPopular = selectedRecommendationDiscovery?.reasons.includes('popular') === true
        && (showPopularOutsideInterests || selectedRecommendationIsPersonalized);

    return (
        <View style={styles.container}>
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
                        onPress={() => { setSelectedDate(''); setSelectedEvent(null); setActiveTab('upcoming'); }}
                    >
                        <Text style={[styles.tabText, activeTab === 'upcoming' && styles.tabTextActive]}>Próximos</Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.tabBtn, activeTab === 'history' && styles.tabBtnActive, pressed && { opacity: 0.85 }]}
                        onPress={() => { setSelectedDate(''); setSelectedEvent(null); setActiveTab('history'); }}
                    >
                        <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>Histórico</Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.tabBtn, activeTab === 'favorites' && styles.tabBtnActive, pressed && { opacity: 0.85 }]}
                        onPress={() => { setSelectedDate(''); setSelectedEvent(null); setActiveTab('favorites'); }}
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


            <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

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
                                ...recommendationMarks,
                                [selectedDate]: {
                                    ...markedDates[selectedDate],
                                    ...(selectedRecommendation && !markedDates[selectedDate]?.mine ? {
                                        popular: selectedRecommendationIsPopular,
                                        recommended: selectedRecommendationIsPersonalized,
                                        hasEvent: true,
                                    } : {}),
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
                    {loading ? (
                        <View style={styles.loadingState}>
                            <ActivityIndicator size="large" color="#6366F1" />
                            <Text style={styles.loadingText}>Carregando sua agenda...</Text>
                        </View>
                    ) : activeTab === 'upcoming' && selectedDate ? (
                        <>
                            <View style={styles.detailsHeader}>
                                <View style={styles.detailsIconChip}>
                                    <Ionicons name="calendar" size={16} color="#6366F1" />
                                </View>
                                <Text style={styles.detailsDate}>
                                    {selectedDate.split('-').reverse().join('/')}
                                </Text>
                                {selectedDate > getTodayStr() && (
                                    <TouchableOpacity
                                        style={styles.createOnDateButton}
                                        onPress={() => router.push({
                                            pathname: '/(drawer)/(tabs)/explore',
                                            params: {
                                                createEvent: '1',
                                                date: selectedDate,
                                                requestKey: String(Date.now()),
                                            },
                                        } as never)}
                                        activeOpacity={0.78}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Criar evento em ${selectedDate.split('-').reverse().join('/')}`}
                                    >
                                        <Ionicons name="add" size={19} color="#FFF" />
                                    </TouchableOpacity>
                                )}
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

                        {!selectedEvent?.isFavoriteSnapshot && <Pressable
                            style={({ pressed }) => [styles.modalOption, pressed && styles.modalOptionPressed]}
                            onPress={() => { router.push(`/event/${selectedEvent.id}` as any); setSelectedEvent(null); }}
                        >
                            <View style={[styles.modalIconChip, { backgroundColor: '#EEF2FF' }]}>
                                <Ionicons name="eye-outline" size={18} color="#6366F1" />
                            </View>
                            <Text style={styles.modalOptionText}>Ver Detalhes do Evento</Text>
                            <Ionicons name="chevron-forward" size={16} color="#CBD5E1" style={{ marginLeft: 'auto' }} />
                        </Pressable>}

                        {selectedEventCanBeFavorited && (
                            <Pressable
                                style={({ pressed }) => [
                                    styles.modalOption,
                                    styles.modalOptionDivider,
                                    (selectedEventIsFavorite || favoriteWasJustAdded || favoriteWasJustRemoved) && styles.modalOptionSuccess,
                                    pressed && favoriteActionState !== 'saving' && styles.modalOptionPressed,
                                ]}
                                onPress={() => toggleFavorite(selectedEvent.id, true)}
                                disabled={favoriteActionState === 'saving'}
                            >
                                <View style={[styles.modalIconChip, { backgroundColor: '#FFF1F2' }]}>
                                    {favoriteActionState === 'saving' ? (
                                        <ActivityIndicator size="small" color="#E11D48" />
                                    ) : (
                                        <Animated.View style={{ transform: [{ scale: favoriteHeartScale }] }}>
                                            <Ionicons name={selectedEventIsFavorite || favoriteWasJustAdded ? 'heart' : 'heart-outline'} size={20} color="#E11D48" />
                                        </Animated.View>
                                    )}
                                </View>
                                <Text style={[styles.modalOptionText, { color: '#E11D48' }]}>
                                    {favoriteActionState === 'saving'
                                        ? selectedEventIsFavorite ? 'Removendo...' : 'Adicionando...'
                                        : favoriteWasJustAdded
                                            ? 'Adicionado aos favoritos!'
                                            : favoriteWasJustRemoved
                                                ? 'Removido dos favoritos!'
                                                : selectedEventIsFavorite
                                                ? 'Remover dos favoritos'
                                                : 'Adicionar aos favoritos'}
                                </Text>
                                {(favoriteWasJustAdded || favoriteWasJustRemoved) && <Ionicons name="checkmark-circle" size={20} color="#16A34A" style={{ marginLeft: 'auto' }} />}
                            </Pressable>
                        )}

                        {selectedEvent?.isFavoriteSnapshot && (
                            <Pressable
                                style={({ pressed }) => [styles.modalOption, styles.modalOptionDivider, pressed && favoriteActionState !== 'saving' && styles.modalOptionPressed]}
                                onPress={async () => {
                                    const favorited = await toggleFavorite(selectedEventSourceId, true);
                                    if (favorited === false) setSelectedEvent(null);
                                }}
                                disabled={favoriteActionState === 'saving'}
                            >
                                <View style={[styles.modalIconChip, { backgroundColor: '#FFF1F2' }]}>
                                    {favoriteActionState === 'saving'
                                        ? <ActivityIndicator size="small" color="#E11D48" />
                                        : <Ionicons name="heart-dislike-outline" size={20} color="#E11D48" />}
                                </View>
                                <Text style={[styles.modalOptionText, { color: '#E11D48' }]}>Remover dos favoritos</Text>
                            </Pressable>
                        )}

                        {selectedEvent?.isFavoriteSnapshot && selectedEvent?.createdBy === auth.currentUser?.uid && (
                            <Pressable
                                style={({ pressed }) => [styles.modalOption, styles.modalOptionDivider, pressed && styles.modalOptionPressed]}
                                onPress={() => setShowFavoriteRepeatDatePicker(true)}
                            >
                                <View style={[styles.modalIconChip, { backgroundColor: '#ECFDF5' }]}>
                                    <Ionicons name="repeat-outline" size={18} color="#059669" />
                                </View>
                                <Text style={[styles.modalOptionText, { color: '#047857' }]}>Repetir este evento</Text>
                            </Pressable>
                        )}

                        {selectedEvent?.isFavoriteSnapshot && selectedEvent?.createdBy !== auth.currentUser?.uid && (
                            <Pressable
                                style={({ pressed }) => [styles.modalOption, styles.modalOptionDivider, pressed && styles.modalOptionPressed]}
                                onPress={handleProposeFavoriteRepeat}
                            >
                                <View style={[styles.modalIconChip, { backgroundColor: '#EEF2FF' }]}>
                                    <Ionicons name="paper-plane-outline" size={18} color="#4F46E5" />
                                </View>
                                <Text style={styles.modalOptionText}>Pedir nova edição ao criador</Text>
                            </Pressable>
                        )}

                        {selectedEventCanBeCancelled ? (
                            <Pressable
                                style={({ pressed }) => [styles.modalOption, styles.modalOptionDivider, pressed && styles.modalOptionPressed]}
                                onPress={() => handleDeleteEvent(selectedEvent)}
                            >
                                <View style={[styles.modalIconChip, { backgroundColor: '#FEF2F2' }]}>
                                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                                </View>
                                <Text style={[styles.modalOptionText, { color: '#EF4444' }]}>Cancelar Evento</Text>
                            </Pressable>
                        ) : selectedEventCanBeLeft ? (
                            <Pressable
                                style={({ pressed }) => [styles.modalOption, styles.modalOptionDivider, pressed && styles.modalOptionPressed]}
                                onPress={() => handleCancelRSVP(selectedEvent)}
                            >
                                <View style={[styles.modalIconChip, { backgroundColor: '#FEF2F2' }]}>
                                    <Ionicons name="close-circle-outline" size={18} color="#EF4444" />
                                </View>
                                <Text style={[styles.modalOptionText, { color: '#EF4444' }]}>Cancelar Presença (Sair)</Text>
                            </Pressable>
                        ) : null}

                        <Pressable
                            style={({ pressed }) => [styles.modalCancel, pressed && { backgroundColor: '#E2E8F0' }]}
                            onPress={() => setSelectedEvent(null)}
                        >
                            <Text style={styles.modalCancelText}>Fechar Menu</Text>
                        </Pressable>
                    </View>
                </SafeAreaView>
            </Modal>
            <ReputationFeedbackModal
                visible={cancellationPenalty}
                delta={-15}
                title="Evento cancelado"
                body="O evento foi cancelado e os participantes foram avisados. Como outras pessoas já haviam confirmado presença, sua reputação foi reduzida em 15 pontos."
                onClose={() => setCancellationPenalty(false)}
            />
            {showFavoriteRepeatDatePicker && (
                <DateTimePicker
                    value={new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    minimumDate={new Date(Date.now() + 24 * 60 * 60 * 1000)}
                    onChange={(_event, date) => {
                        if (!date) {
                            setShowFavoriteRepeatDatePicker(false);
                            return;
                        }
                        handleRepeatFavorite(date);
                    }}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8FAFC' },
    content: { flex: 1, backgroundColor: '#F8FAFC' },

    // Header
    header: {
        paddingTop: 50,
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
    createOnDateButton: { width: 34, height: 34, marginLeft: 'auto', borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#6366F1', elevation: 2, shadowColor: '#312E81', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },

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
    eventCardInProgress: { borderColor: '#6EE7B7', backgroundColor: '#ECFDF5' },
    cardPressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
    eventTypeIndicator: { width: 4, height: 40, borderRadius: 2, marginRight: 16 },
    eventInfo: { flex: 1 },
    eventTitle: { fontSize: 16, fontWeight: '700', color: '#0F172A', marginBottom: 4 },
    eventMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap', rowGap: 6 },
    eventMetaText: { fontSize: 12, color: '#64748B', marginRight: 12, fontWeight: '500' },
    metaIconChip: { width: 20, height: 20, borderRadius: 7, justifyContent: 'center', alignItems: 'center', marginRight: 5 },

    badgePopular: { backgroundColor: '#FEF3C7', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
    badgePopularText: { fontSize: 10, fontWeight: 'bold', color: '#D97706' },
    badgeRecommended: { backgroundColor: '#EDE9FE', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
    badgeRecommendedText: { fontSize: 10, fontWeight: 'bold', color: '#6D28D9' },
    badgeSoon: { backgroundColor: '#EEF2FF', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
    badgeSoonText: { fontSize: 10, fontWeight: 'bold', color: '#6366F1' },
    badgeInProgress: { flexShrink: 0, backgroundColor: '#D1FAE5', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
    badgeInProgressText: { fontSize: 10, lineHeight: 13, fontWeight: 'bold', color: '#047857' },
    badgeJourney: { flexShrink: 0, backgroundColor: '#EEF2FF', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
    badgeJourneyText: { fontSize: 9, lineHeight: 12, fontWeight: '900', color: '#4338CA' },
    eventJourneyHint: { marginTop: 9, color: '#64748B', fontSize: 11, lineHeight: 16 },

    emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#F0F1F8', gap: 12 },
    emptyIconChip: { width: 56, height: 56, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
    emptyText: { color: '#94A3B8', fontSize: 14, fontWeight: '500' },
    instructionState: { alignItems: 'center', justifyContent: 'center' },
    instructionInner: { alignItems: 'center', justifyContent: 'center', paddingVertical: 30, gap: 14 },
    instructionText: { color: '#94A3B8', fontSize: 14, textAlign: 'center', paddingHorizontal: 40, fontWeight: '500' },
    loadingState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 12 },
    loadingText: { color: '#64748B', fontSize: 14, fontWeight: '600' },

    // Modal
    modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
    modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 32 },
    modalHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 18 },
    modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#0F172A', marginBottom: 12 },
    modalOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderRadius: 14 },
    modalOptionDivider: { borderTopWidth: 1, borderColor: '#F1F5F9', marginTop: 4, paddingTop: 16 },
    modalOptionPressed: { backgroundColor: '#F8FAFC' },
    modalOptionSuccess: { backgroundColor: '#FFF7F8', paddingHorizontal: 8 },
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
    recReasonBadge: { alignSelf: 'flex-start', backgroundColor: '#F5F3FF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginBottom: 10 },
    recReasonText: { color: '#6D28D9', fontSize: 10, fontWeight: '800' },
    recFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    recTypeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    recTypeText: { fontSize: 11, fontWeight: '700' },
});
