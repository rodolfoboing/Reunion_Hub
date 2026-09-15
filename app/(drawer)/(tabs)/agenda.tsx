import { ErrorState } from '@/src/components/ErrorState';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDocs, onSnapshot, query, where, limit, orderBy } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, LayoutAnimation, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, TouchableOpacity, View } from 'react-native';
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
import { DISCOVERY_REASON_BADGE_LABELS, getDiscoveryBadgeReason, getEventDiscovery, isNewMeeting, shouldSuggestEvent, type EventDiscovery } from '../../../src/utils/eventDiscovery';
import { ReputationFeedbackModal } from '../../../src/components/ReputationFeedbackModal';

type FavoriteActionState = 'idle' | 'saving' | 'added' | 'removed';
type PendingRepeatRequest = { sourceEventId: string; date: string; requestId: string };

function eventScheduleMillis(event: Pick<Meeting, 'date' | 'time' | 'endDate' | 'endTime'>, boundary: 'start' | 'end'): number {
    const interval = getEventInterval(event);
    return interval?.[boundary].getTime() ?? 0;
}

// Sem setLayoutAnimationEnabledExperimental: na New Architecture (Fabric) esse
// setter é um no-op que só emitia warning no boot (BridgelessUIManager). As
// LayoutAnimations continuam ativas — no Fabric elas já vêm habilitadas no
// Android, então os LayoutAnimation.configureNext abaixo seguem funcionando.

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

/** Sugestão vinda da descoberta (Explorar), não um compromisso do usuário. */
type DaySuggestion = 'personalized' | 'popular';

type DayMarking = {
    /** Você criou o evento (não apenas confirmou presença). */
    mine: boolean;
    recurring: boolean;
    /** Só true quando TODOS os seus eventos do dia já terminaram. */
    past: boolean;
    /** Você tem compromisso neste dia (criado ou confirmado). */
    hasEvent: boolean;
    /** Há evento recomendado/popular neste dia do qual você NÃO participa. */
    suggestion?: DaySuggestion;
    selected?: boolean;
};

/**
 * `upcoming` é a aba do CALENDÁRIO (rotulada "Agenda"); `next` é a lista simples
 * dos seus próximos eventos (rotulada "Próximos"). As duas leem exatamente os
 * mesmos dados — por isso `fetchScope` abaixo trata as duas como um só escopo e
 * alternar entre elas não gera nenhuma leitura nova no Firestore.
 */
type AgendaTab = 'upcoming' | 'next' | 'history' | 'favorites';

/** Guarda para o parâmetro de rota, que chega como string livre. */
function isAgendaTab(value: unknown): value is AgendaTab {
    return value === 'upcoming' || value === 'next' || value === 'history' || value === 'favorites';
}

const SUGGESTION_DOT_COLOR: Record<DaySuggestion, string> = {
    personalized: '#8B5CF6',
    popular: '#F59E0B',
};

// Célula do calendário. Duas linguagens visuais separadas, para nunca confundir
// compromisso com sugestão:
//   BARRA sob o número = evento SEU (verde: ainda vai acontecer / cinza: já foi)
//   PONTO discreto     = sugestão do Explorar (roxo: combina com você / âmbar: popular)
// Mais: círculo roxo = criado por você · selo = recorrente.
const CalendarDayCell = ({ date, state, marking, onPress }: any) => {
    if (!date) return <View style={styles.dayCell} />;

    const isSelected = !!marking?.selected;
    const isToday = state === 'today';
    const isDisabled = state === 'disabled';
    const isMine = !!marking?.mine;
    const isRecurring = !!marking?.recurring;
    const isPast = !!marking?.past;
    const hasEvent = !!marking?.hasEvent;
    const suggestion: DaySuggestion | undefined = marking?.suggestion;

    return (
        <Pressable
            onPress={() => onPress(date)}
            disabled={isDisabled}
            style={styles.dayCell}
            hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
        >
            {/* Invólucro SEM borderRadius. O ponto e o selo ficavam dentro do
                círculo, que é arredondado, e no Android um pai com borderRadius
                recorta filho absoluto que transborda: sobrava um resto do ponto
                com a borda branca aparecendo, que lia como cinza apagado em vez
                da cor da legenda. Aqui eles transbordam sem ser cortados. */}
            <View style={styles.dayCircleWrapper}>
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
                </View>

                {isRecurring && (
                    <View style={styles.dayBadgeRecurring}>
                        <Ionicons name="repeat" size={7} color="#fff" />
                    </View>
                )}
                {suggestion && !isSelected && (
                    <View style={[styles.daySuggestionDot, { backgroundColor: SUGGESTION_DOT_COLOR[suggestion] }]} />
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

type AgendaEventCardProps = {
    item: any;
    onPress: () => void;
    discovery: EventDiscovery;
    activeTab: AgendaTab;
    eventClock: Date;
    isFavorite: boolean;
    onToggleFavorite: (eventId: string, showConfirmation?: boolean) => Promise<boolean | null>;
};

// Declarado no módulo, e não dentro de AgendaScreen: definido lá dentro, o React
// via um TIPO de componente novo a cada render do pai e desmontava/remontava
// todos os cards — a animação de pulso reiniciava sem parar e os estados locais
// (removendo/atualizando favorito) eram zerados no meio da ação.
const AgendaEventCard = ({
    item,
    onPress,
    discovery,
    activeTab,
    eventClock,
    isFavorite,
    onToggleFavorite,
}: AgendaEventCardProps) => {
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const favoriteCardScale = useRef(new Animated.Value(1)).current;
    const [removingFavorite, setRemovingFavorite] = useState(false);
    const [updatingHistoryFavorite, setUpdatingHistoryFavorite] = useState(false);

    const todayStr = getTodayStr();
    const tomorrowStr = getDateAfterDays(1);

    const isInProgress = discovery.reasons.includes('in_progress');
    const isVerySoon = !isInProgress && (item.date === todayStr || item.date === tomorrowStr);
    const isPopular = discovery.reasons.includes('popular');
    const viewerUid = auth.currentUser?.uid;
    const isUserEvent = item.createdBy === viewerUid || item.attendees?.includes(viewerUid);
    const hasConfirmedCheckIn = Boolean(viewerUid && item.checkedIn?.includes(viewerUid));
    const hasPendingCheckIn = Boolean(viewerUid && item.pendingCheckIns?.some(
        ({ userId }: { userId: string }) => userId === viewerUid
    ));
    // Mesma regra usada pelo modal de ações: antes o card exigia a aba Histórico
    // e o modal não, então o coração sumia do card mas a opção aparecia no menu.
    const canToggleFavorite = !item.isFavoriteSnapshot && canRequestFavoriteAttendedEvent(
        item,
        hasConfirmedCheckIn,
        hasPendingCheckIn,
        eventClock,
    );
    const journeyState = getEventJourneyState(item, eventClock, {
        isAttending: Boolean(viewerUid && item.attendees?.includes(viewerUid)),
        isCreator: item.createdBy === viewerUid,
        hasCheckedIn: hasConfirmedCheckIn,
        hasPendingCheckIn,
    });
    // Evento seu não é sugestão: não faz sentido explicar por que ele "apareceu".
    // Nos demais, um único selo de motivo, pela mesma prioridade das outras telas
    // (antes "Popular" e "Seu interesse" podiam aparecer juntos no mesmo card).
    const badgeReason = isUserEvent ? null : getDiscoveryBadgeReason(discovery);

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
            const favorited = await onToggleFavorite(item.id);
            if (favorited === null || favorited) {
                favoriteCardScale.setValue(1);
                setRemovingFavorite(false);
            }
        });
    };

    const handleToggleFavorite = async () => {
        if (updatingHistoryFavorite) return;
        setUpdatingHistoryFavorite(true);
        Animated.sequence([
            Animated.spring(favoriteCardScale, { toValue: 1.35, useNativeDriver: true }),
            Animated.spring(favoriteCardScale, { toValue: 1, useNativeDriver: true }),
        ]).start();
        const favorited = await onToggleFavorite(item.id);
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
                        {/* QUANDO: um selo, para TODO card. Antes só evento seu
                            recebia o selo de jornada, e a sugestão caía num
                            "⏳ Em Breve" próprio que dizia a mesma coisa para hoje
                            e para amanhã — um evento de hoje não era anunciado
                            como hoje. */}
                        {isInProgress
                            ? <View style={styles.badgeInProgress}><Text style={styles.badgeInProgressText} numberOfLines={1}>EM ANDAMENTO</Text></View>
                            : <View style={styles.badgeJourney}><Text style={styles.badgeJourneyText} numberOfLines={1}>{journeyState.compactLabel}</Text></View>}
                        {/* POR QUE: no máximo um selo. */}
                        {badgeReason && <View style={styles.badgeRecommended}><Text style={styles.badgeRecommendedText} numberOfLines={1}>{DISCOVERY_REASON_BADGE_LABELS[badgeReason]}</Text></View>}
                        {/* "NOVO" só em sugestão: no seu próprio evento você já sabe
                            que acabou de criar, e o selo só ocuparia espaço. */}
                        {!isUserEvent && isNewMeeting(item, eventClock) && (
                            <View style={styles.badgeNew}><Text style={styles.badgeNewText}>NOVO</Text></View>
                        )}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        {canToggleFavorite && (
                            <TouchableOpacity
                                onPress={(event) => {
                                    event.stopPropagation();
                                    void handleToggleFavorite();
                                }}
                                disabled={updatingHistoryFavorite}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                accessibilityRole="button"
                                accessibilityLabel={isFavorite ? 'Remover evento dos favoritos' : 'Adicionar evento aos favoritos'}
                            >
                                <Animated.View style={{ transform: [{ scale: favoriteCardScale }] }}>
                                    {updatingHistoryFavorite
                                        ? <ActivityIndicator size="small" color="#EF4444" />
                                        : <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={21} color="#EF4444" />}
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

export default function AgendaScreen() {
    const eventClock = useEventClock();
    const { tab: requestedTab } = useLocalSearchParams<{ tab?: string }>();
    // Tab State: 'upcoming' | 'history' | 'favorites'
    const [activeTab, setActiveTab] = useState<AgendaTab>('upcoming');
    // Agenda e Próximos compartilham a mesma busca: só o escopo entra nas deps do
    // efeito, então trocar entre as duas não refaz consulta nenhuma.
    const fetchScope = activeTab === 'next' ? 'upcoming' : activeTab;

    useEffect(() => {
        if (isAgendaTab(requestedTab)) {
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
    // Mesma armadilha do CreateEventModal: `new Date(...)` inline muda de identidade
    // a cada render (aqui o useEventClock tica a cada 60s) e o DateTimePicker
    // reposiciona o seletor. Recalcula só quando o seletor abre.
    const repeatFavoriteDefaultDate = useMemo(
        () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        [showFavoriteRepeatDatePicker],
    );
    const repeatFavoriteMinimumDate = useMemo(
        () => new Date(Date.now() + 24 * 60 * 60 * 1000),
        [showFavoriteRepeatDatePicker],
    );
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
            // Não limpamos settlementAttemptedEventIds aqui: limpar a cada foco fazia
            // a Agenda re-disparar settleMyExpiredEvents para os mesmos eventos toda
            // vez que a aba era aberta. A Function é idempotente, mas eram invocações
            // e leituras repetidas sem necessidade.
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
        // Sem `selectedDate`: o filtro por dia é local (filteredEvents.filter), então
        // tocar numa data refazia as 3 consultas à toa. Sem `favorites`: fetchEvents
        // não lê esse estado — só o escreve na aba Favoritos, o que causava um
        // segundo fetch redundante a cada abertura da aba.
    }, [fetchScope, userLocation, userInterests.join(','), showPopularOutsideInterests, refreshKey]);

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
        // quando permitido no perfil, popularidade contextual. Mesma regra do
        // Início e do Explorar (shouldSuggestEvent).
        finalRecs = finalRecs.filter((event: Meeting) => shouldSuggestEvent(
            getAgendaDiscovery(event),
            showPopularOutsideInterests,
        ));

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

        setRecommendations(finalRecs.slice(0, CONFIG.AGENDA_RECOMMENDATIONS_LIMIT));
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

            if (fetchScope === 'favorites') {
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

            if (fetchScope === 'upcoming') {
                results = events.filter((ev: any) => ev.status !== 'completed' && ev.date >= todayStr && !hasEventEnded(ev, eventClock));
                historyEvents = events.filter((ev: any) => ev.date < todayStr || ev.status === 'completed' || hasEventEnded(ev, eventClock));

                // Marcações do calendário: só os SEUS eventos (criados ou confirmados),
                // passados e futuros. `past` agrega o dia inteiro — antes era gravado
                // apenas na criação do objeto, então num dia com um evento encerrado e
                // outro ainda por vir a cor da barra dependia da ordem de iteração.
                const marks: Record<string, DayMarking> = {};
                events.forEach((ev: any) => {
                    if (!ev.date) return;
                    const eventIsPast = ev.date.localeCompare(todayStr) < 0 || hasEventEnded(ev, eventClock);
                    const current = marks[ev.date] ?? { mine: false, recurring: false, past: true, hasEvent: true };
                    marks[ev.date] = {
                        mine: current.mine || ev.createdBy === currentUid,
                        recurring: current.recurring || ev.isRepeated === true,
                        past: current.past && eventIsPast,
                        hasEvent: true,
                    };
                });

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
                        // Evento seu não é sugestão. `attendees` sozinho não basta:
                        // eventos legados não gravaram o criador no array (mesmo motivo
                        // da consulta dupla acima), então eles voltavam como
                        // "recomendado" e apareciam duas vezes no dia selecionado —
                        // uma como compromisso seu, outra como sugestão, com selos
                        // diferentes no mesmo evento.
                        if (e.createdBy === currentUid) return false;
                        if (e.attendees?.includes(currentUid)) return false;
                        return true;
                    });
                
                setAllRecs(fetchedRecs);
                // Um único setMarkedDates, com o objeto já completo. Antes eram duas
                // chamadas com a MESMA referência (mutada no meio): o React descartava
                // a segunda por Object.is e só funcionava graças a outros setState.
                setMarkedDates(marks);

                // Passados + futuros SEUS, para poder tocar em qualquer dia marcado.
                // As recomendações não entram aqui: elas não são marcadas no calendário,
                // então apareceriam num dia sem marca. Ficam no carrossel abaixo.
                setFilteredEvents([...results, ...historyEvents]);
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

            } else if (fetchScope === 'history') {
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
            // Fecha também no erro: antes o seletor ficava aberto/reabrindo.
            setShowFavoriteRepeatDatePicker(false);
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

    const renderEventCard = ({ item }: { item: any }) => (
        <AgendaEventCard
            item={item}
            onPress={() => setSelectedEvent(item)}
            discovery={getAgendaDiscovery(item)}
            activeTab={activeTab}
            eventClock={eventClock}
            isFavorite={favorites.includes(item.id)}
            onToggleFavorite={toggleFavorite}
        />
    );

    const renderRecommendationCard = ({ item }: { item: any }) => {
        const discovery = getAgendaDiscovery(item);
        const isInProgress = discovery.reasons.includes('in_progress');
        // Este era o único card que usava `primaryReason` cru: mostrava
        // "Em andamento" como se fosse motivo de descoberta e repetia
        // "Seu interesse" dentro de "Recomendado para você", que já diz isso no
        // subtítulo. Agora passa pela mesma função das outras telas, declarando o
        // que a seção já comunica — sobra `popular`, a única informação nova.
        const reason = getDiscoveryBadgeReason(discovery, ['interest', 'history', 'nearby']);
        const journeyState = isInProgress ? null : getEventJourneyState(item, eventClock);
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
            {/* Os DOIS eixos no mesmo card, como no Início, no Explorar e no card
                de evento da Agenda: QUANDO sempre, POR QUE só quando acrescenta. */}
            <View style={styles.recBadgeRow}>
                {isInProgress ? (
                    <View style={styles.badgeInProgress}><Text style={styles.badgeInProgressText} numberOfLines={1}>EM ANDAMENTO</Text></View>
                ) : journeyState ? (
                    <View style={styles.badgeJourney}><Text style={styles.badgeJourneyText} numberOfLines={1}>{journeyState.compactLabel}</Text></View>
                ) : null}
                {reason && (
                    <View style={styles.recReasonBadge}>
                        <Text style={styles.recReasonText}>{DISCOVERY_REASON_BADGE_LABELS[reason]}</Text>
                    </View>
                )}
                {isNewMeeting(item, eventClock) && (
                    <View style={styles.badgeNew}><Text style={styles.badgeNewText}>NOVO</Text></View>
                )}
            </View>
            <View style={styles.recFooter}>
                <View style={[styles.recTypeChip, { backgroundColor: item.type === 'online' ? '#ECFDF5' : '#EEF2FF' }]}>
                    <Ionicons name={item.type === 'online' ? 'videocam-outline' : 'location-outline'} size={11} color={item.type === 'online' ? '#10B981' : '#6366F1'} />
                    <Text style={[styles.recTypeText, { color: item.type === 'online' ? '#10B981' : '#6366F1' }]}>{item.type === 'online' ? 'Online' : 'Presencial'}</Text>
                </View>
                <View style={styles.recAttendees}>
                    <Ionicons name="people-outline" size={12} color="#64748B" />
                    <Text style={styles.recAttendeesText}>{item.attendees?.length || 0}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#6366F1" />
            </View>
        </Pressable>
        );
    };

    // Marcas de sugestão derivadas em render a partir do MESMO `recommendations`
    // que alimenta o carrossel — assim calendário, lista do dia e carrossel nunca
    // divergem, e não há estado extra para sincronizar. Custo zero de banco:
    // `recommendations` já está em memória.
    // Segunda barreira contra o mesmo evento aparecer duas vezes no dia: a lista
    // do dia vem de `filteredEvents` e as sugestões daqui. Se um evento entrasse
    // nos dois, o usuário via dois cards do mesmo evento com selos diferentes.
    /**
     * Seus compromissos que ainda vão acontecer. Derivado do MESMO
     * `filteredEvents` da aba Agenda — a aba "Próximos" não faz consulta própria.
     * Na aba Agenda `filteredEvents` traz futuros e passados juntos (o calendário
     * precisa marcar os dois); aqui sobra só o futuro, já em ordem cronológica,
     * porque o fetch ordena antes de concatenar.
     *
     * Vazio fora do escopo `upcoming`: nas abas Histórico e Favoritos
     * `filteredEvents` guarda outra coisa, e contar aquilo daria um número errado
     * no selo da aba.
     */
    const upcomingEvents = fetchScope === 'upcoming'
        ? filteredEvents.filter((event: Meeting) => event.status !== 'completed'
            && !!event.date
            && event.date >= getTodayStr()
            && !hasEventEnded(event, eventClock))
        : [];

    const ownEventIds = new Set(filteredEvents.map(({ id }) => id));
    const suggestionsByDate = new Map<string, { events: Meeting[]; kind: DaySuggestion }>();
    recommendations.forEach((recommendation) => {
        const date = normalizeDate(recommendation.date);
        if (!date || ownEventIds.has(recommendation.id)) return;
        const discovery = getAgendaDiscovery(recommendation);
        if (!shouldSuggestEvent(discovery, showPopularOutsideInterests)) return;
        const personalized = discovery.reasons.includes('interest') || discovery.reasons.includes('history');

        const current = suggestionsByDate.get(date);
        suggestionsByDate.set(date, {
            events: [...(current?.events ?? []), recommendation],
            // Personalizado tem prioridade no ponto: diz mais sobre você que "popular".
            kind: current?.kind === 'personalized' || personalized ? 'personalized' : 'popular',
        });
    });

    // Une os dias dos seus eventos com os dias que só têm sugestão.
    const calendarMarks: Record<string, DayMarking> = { ...markedDates };
    suggestionsByDate.forEach((suggestion, date) => {
        calendarMarks[date] = {
            ...(calendarMarks[date] ?? { mine: false, recurring: false, past: false, hasEvent: false }),
            suggestion: suggestion.kind,
        };
    });

    const selectedDaySuggestions = selectedDate ? suggestionsByDate.get(selectedDate)?.events ?? [] : [];

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
                        <Text style={[styles.tabText, activeTab === 'upcoming' && styles.tabTextActive]} numberOfLines={1}>Agenda</Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.tabBtn, activeTab === 'next' && styles.tabBtnActive, pressed && { opacity: 0.85 }]}
                        onPress={() => { setSelectedDate(''); setSelectedEvent(null); setActiveTab('next'); }}
                    >
                        <Text style={[styles.tabText, activeTab === 'next' && styles.tabTextActive]} numberOfLines={1}>Próximos</Text>
                        {upcomingEvents.length > 0 && (
                            <View style={[styles.tabBadge, styles.tabBadgeNeutral]}>
                                <Text style={styles.tabBadgeText}>{upcomingEvents.length}</Text>
                            </View>
                        )}
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.tabBtn, activeTab === 'history' && styles.tabBtnActive, pressed && { opacity: 0.85 }]}
                        onPress={() => { setSelectedDate(''); setSelectedEvent(null); setActiveTab('history'); }}
                    >
                        <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]} numberOfLines={1}>Histórico</Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.tabBtn, activeTab === 'favorites' && styles.tabBtnActive, pressed && { opacity: 0.85 }]}
                        onPress={() => { setSelectedDate(''); setSelectedEvent(null); setActiveTab('favorites'); }}
                    >
                        <Text style={[styles.tabText, activeTab === 'favorites' && styles.tabTextActive]} numberOfLines={1}>Favoritos</Text>
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
                                ...calendarMarks,
                                [selectedDate]: {
                                    ...calendarMarks[selectedDate],
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
                            <Text style={styles.legendHint}>
                                Barra = compromisso seu · Ponto = sugestão dos próximos {CONFIG.AGENDA_DISCOVERY_DAYS} dias
                            </Text>
                            <View style={styles.legendGrid}>
                                <View style={styles.legendItem}>
                                    <View style={[styles.legendBar, { backgroundColor: '#10B981' }]} />
                                    <Text style={styles.legendText}>Ainda vai acontecer</Text>
                                </View>
                                <View style={styles.legendItem}>
                                    <View style={[styles.legendBar, { backgroundColor: '#CBD5E1' }]} />
                                    <Text style={styles.legendText}>Já aconteceu</Text>
                                </View>
                                <View style={styles.legendItem}>
                                    <View style={styles.legendSwatchCircle} />
                                    <Text style={styles.legendText}>Criado por você</Text>
                                </View>
                                <View style={styles.legendItem}>
                                    <View style={[styles.legendSwatchIcon, { backgroundColor: '#3B82F6' }]}>
                                        <Ionicons name="repeat" size={9} color="#fff" />
                                    </View>
                                    <Text style={styles.legendText}>Recorrente</Text>
                                </View>
                                <View style={styles.legendItem}>
                                    <View style={[styles.legendSwatchDot, { backgroundColor: SUGGESTION_DOT_COLOR.personalized }]} />
                                    <Text style={styles.legendText}>Combina com você</Text>
                                </View>
                                <View style={styles.legendItem}>
                                    <View style={[styles.legendSwatchDot, { backgroundColor: SUGGESTION_DOT_COLOR.popular }]} />
                                    <Text style={styles.legendText}>Popular por perto</Text>
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
                            {(() => {
                                const dayEvents = filteredEvents.filter(e => e.date === selectedDate);
                                if (dayEvents.length === 0 && selectedDaySuggestions.length === 0) {
                                    return (
                                        <View style={styles.emptyState}>
                                            <View style={[styles.emptyIconChip, { backgroundColor: '#EEF2FF' }]}>
                                                <Ionicons name="calendar-outline" size={24} color="#6366F1" />
                                            </View>
                                            <Text style={styles.emptyText}>Nenhum evento neste dia.</Text>
                                        </View>
                                    );
                                }
                                return (
                                    <>
                                        {dayEvents.map(item => (
                                            <View key={item.id} style={{ marginBottom: 10 }}>
                                                {renderEventCard({ item })}
                                            </View>
                                        ))}
                                        {/* Grupo separado e rotulado: o ponto no calendário levava a
                                            este bloco, então marca e lista contam a mesma história. */}
                                        {selectedDaySuggestions.length > 0 && (
                                            <>
                                                <Text style={styles.daySectionLabel}>
                                                    {dayEvents.length > 0 ? 'Também neste dia, do Explorar' : 'Sugestões do Explorar'}
                                                </Text>
                                                {selectedDaySuggestions.map(item => (
                                                    <View key={item.id} style={{ marginBottom: 10 }}>
                                                        {renderEventCard({ item })}
                                                    </View>
                                                ))}
                                            </>
                                        )}
                                    </>
                                );
                            })()}
                        </>
                    ) : activeTab === 'upcoming' && !selectedDate ? (
                        <View style={styles.instructionState}>
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

                            {/* A instrução fecha o bloco, depois das sugestões. O texto
                                acompanha a posição: apontar "abaixo" aqui indicaria o
                                nada, e prometer sugestões quando não há nenhuma seria
                                pior ainda. */}
                            <View style={styles.instructionInner}>
                                <View style={[styles.emptyIconChip, { backgroundColor: '#EEF2FF' }]}>
                                    <Ionicons name="calendar-outline" size={26} color="#6366F1" />
                                </View>
                                <Text style={styles.instructionText}>
                                    {filteredEvents.length > 0
                                        ? 'Selecione uma data no calendário para ver seus eventos.'
                                        : recommendations.length > 0
                                            ? 'Você ainda não confirmou presença em eventos futuros. As sugestões acima são um bom ponto de partida.'
                                            : 'Você ainda não confirmou presença em eventos futuros.'}
                                </Text>
                            </View>
                        </View>
                    ) : (
                        // Lista simples: Próximos, Histórico e Favoritos. Nenhuma
                        // delas usa o calendário, só muda a origem dos itens.
                        <View>
                            {(() => {
                                const listEvents = activeTab === 'next' ? upcomingEvents : filteredEvents;
                                return listEvents.length > 0 ? (
                                    listEvents.map(item => (
                                        <View key={item.id} style={{ marginBottom: 10 }}>
                                            {renderEventCard({ item })}
                                        </View>
                                    ))
                                ) : !error && !loading ? (
                                <View style={{ marginTop: 40 }}>
                                    <ErrorState
                                        title={activeTab === 'favorites' ? 'Nenhum favorito' : activeTab === 'next' ? 'Nenhum evento à vista' : 'Nenhum histórico'}
                                        message={activeTab === 'favorites'
                                            ? 'Você ainda não curtiu nenhum evento.'
                                            : activeTab === 'next'
                                                ? 'Você não tem eventos confirmados pela frente. Veja as sugestões na aba Agenda ou procure no Explorar.'
                                                : 'Você não possui histórico de eventos.'}
                                    />
                                </View>
                                ) : null;
                            })()}
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

                        {/* Também disponível para favoritos: o evento original costuma
                            existir, e quando não existe mais (limpeza de 90 dias) a
                            própria tela de evento já mostra o ErrorState. Bloquear
                            todos impedia abrir favoritos recentes sem motivo. */}
                        <Pressable
                            style={({ pressed }) => [styles.modalOption, pressed && styles.modalOptionPressed]}
                            onPress={() => { router.push(`/event/${selectedEventSourceId}` as any); setSelectedEvent(null); }}
                        >
                            <View style={[styles.modalIconChip, { backgroundColor: '#EEF2FF' }]}>
                                <Ionicons name="eye-outline" size={18} color="#6366F1" />
                            </View>
                            <Text style={styles.modalOptionText}>Ver Detalhes do Evento</Text>
                            <Ionicons name="chevron-forward" size={16} color="#CBD5E1" style={{ marginLeft: 'auto' }} />
                        </Pressable>

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
                    value={repeatFavoriteDefaultDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    minimumDate={repeatFavoriteMinimumDate}
                    onChange={(event, date) => {
                        // Checa o tipo: no Android, dispensar o seletor também dispara
                        // onChange e podia cair no caminho de sucesso, criando um
                        // evento repetido sem o usuário confirmar nada.
                        if (event.type !== 'set' || !date) {
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
    // 12px em vez de 13: com a quarta aba cada botão perdeu largura e "Histórico"
    // e "Favoritos" ficavam no limite de cortar.
    tabText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
    // Contagem informativa, não alerta: o vermelho de `tabBadge` é dos favoritos.
    tabBadgeNeutral: { backgroundColor: '#6366F1' },
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
    daySectionLabel: { fontSize: 12, fontWeight: '800', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6, marginBottom: 10 },
    createOnDateButton: { width: 34, height: 34, marginLeft: 'auto', borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#6366F1', elevation: 2, shadowColor: '#312E81', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },

    // Calendar Day Cell (sinalizações customizadas)
    dayCell: { alignItems: 'center', justifyContent: 'flex-start', paddingTop: 2, paddingBottom: 4 },
    // Mesmo tamanho do círculo, sem raio: é ele que hospeda o ponto e o selo,
    // para que o recorte do canto arredondado não os coma.
    dayCircleWrapper: { width: 30, height: 30, position: 'relative' },
    dayCircle: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
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
    dayBar: { width: 14, height: 3, borderRadius: 2, marginTop: 3 },
    // Ponto discreto no canto superior direito: sinaliza sugestão sem competir
    // com a barra (que é o compromisso do usuário).
    // 10px com anel de 1,5px deixa 7px de cor real. Antes eram 6px com anel de
    // 1px: sobravam 4px de cor, e nesse tamanho o branco em volta lavava o
    // laranja a ponto de ele ler como cinza, sem relação com a legenda.
    // O anel continua, porque é ele que separa o ponto do círculo do dia.
    daySuggestionDot: {
        position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: 5,
        borderWidth: 1.5, borderColor: '#fff',
        // Android empilha por elevation, não pela ordem do JSX: sem isto o ponto
        // pode ficar atrás do círculo do dia quando ele tem fundo próprio.
        elevation: 3, zIndex: 3,
    },

    // Legenda do Calendário
    legendCard: { marginTop: 12, paddingTop: 12, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
    legendTitle: { fontSize: 11, fontWeight: '800', color: '#94A3B8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
    legendHint: { fontSize: 12, color: '#64748B', marginBottom: 10 },
    legendGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, columnGap: 16 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendSwatchCircle: { width: 14, height: 14, borderRadius: 7, backgroundColor: 'rgba(139,92,246,0.16)', borderWidth: 1.5, borderColor: '#8B5CF6' },
    legendSwatchIcon: { width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
    legendBar: { width: 14, height: 4, borderRadius: 2 },
    // 7px para igualar o miolo colorido do ponto do calendário (10px menos o
    // anel de 1,5px de cada lado): legenda e calendário passam a mostrar
    // exatamente a mesma quantidade de cor.
    legendSwatchDot: { width: 7, height: 7, borderRadius: 3.5 },
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

    badgeRecommended: { flexShrink: 0, backgroundColor: '#EDE9FE', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
    badgeRecommendedText: { fontSize: 10, fontWeight: 'bold', color: '#6D28D9' },
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
    recBadgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
    recAttendees: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto', marginRight: 8 },
    recAttendeesText: { fontSize: 11, fontWeight: '700', color: '#64748B' },
    badgeNew: { backgroundColor: '#FEF3C7', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
    badgeNewText: { fontSize: 9, fontWeight: '800', color: '#B45309', letterSpacing: 0.5 },
    // `marginBottom` saiu para a linha acima: com dois selos lado a lado, a
    // margem individual empilhava e desalinhava a base do cartão.
    recReasonBadge: { backgroundColor: '#F5F3FF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    recReasonText: { color: '#6D28D9', fontSize: 10, fontWeight: '800' },
    recFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    recTypeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    recTypeText: { fontSize: 11, fontWeight: '700' },
});
