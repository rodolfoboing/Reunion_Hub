import { ErrorState } from '@/src/components/ErrorState';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, limit, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../../../src/services/firebaseConfig';
import { Meeting } from '../../../src/types';
import { STRINGS } from '../../../src/constants/strings';
import { CONFIG } from '../../../src/constants/Config';
import { normalizeDate, getTodayStr, getDateAfterDays } from '../../../src/utils/dateUtils';
import { formatEventTimeRange, getEventJourneyState, hasEventEnded, isEventInProgress, isEventToday } from '../../../src/utils/eventSchedule';
import { useEventClock } from '../../../src/hooks/useEventClock';
import { ManualModal } from '../../../src/components/ManualModal';
import { ScreenTutorialModal } from '../../../src/components/ScreenTutorialModal';
import { useFirstVisitTutorial } from '../../../src/hooks/useFirstVisitTutorial';
import { normalizeInterests } from '../../../src/constants/Interests';
import { useUserProfile } from '@/src/hooks/useUserProfile';
import { updateRecommendationLocation } from '@/src/services/recommendationLocationService';
import { DISCOVERY_REASON_BADGE_LABELS, DiscoveryReason, getDiscoveryBadgeReason, getEventDiscovery, isMeetingNearby, isNewMeeting, shouldSuggestEvent } from '../../../src/utils/eventDiscovery';

import { getDistanceFromLatLonInKm } from '../../../src/utils/distance';

// Helper function para formatar a data do evento
const MONTH_NAMES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const DISCOVERY_REASON_COLORS: Record<DiscoveryReason, { background: string; text: string }> = {
  in_progress: { background: '#D1FAE5', text: '#047857' },
  interest: { background: '#EDE9FE', text: '#6D28D9' },
  history: { background: '#E0F2FE', text: '#0369A1' },
  popular: { background: '#FEF3C7', text: '#B45309' },
  nearby: { background: '#FCE7F3', text: '#BE185D' },
};

const formatEventDate = (dateString: string | undefined) => {
  const normalized = normalizeDate(dateString);
  if (!normalized) return { day: '--', month: '---' };

  try {
    const parts = normalized.split('-');
    if (parts.length === 3) {
      const monthIndex = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);

      return {
        day: day.toString().padStart(2, '0'),
        month: MONTH_NAMES[monthIndex] || '---'
      };
    }
  } catch {
    // Sem log: roda no caminho de render de cada card e já tem fallback seguro.
  }

  return { day: '--', month: '---' };
};

const belongsToUserAgenda = (meeting: Meeting, userId: string | undefined, agendaEventIds: Set<string>) => {
  if (!userId) return false;
  return agendaEventIds.has(meeting.id)
    || meeting.createdBy === userId
    || meeting.attendees?.includes(userId) === true;
};

export default function HomeScreen() {
  const eventClock = useEventClock();
  const userProfile = useUserProfile();
  const [highlights, setHighlights] = useState<Meeting[]>([]);
  const [allUpcomingEvents, setAllUpcomingEvents] = useState<Meeting[]>([]);
  const [myEvents, setMyEvents] = useState<Meeting[]>([]);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [nearbyEvents, setNearbyEvents] = useState<Meeting[]>([]);
  const [refreshingNearby, setRefreshingNearby] = useState(false);

  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showManualModal, setShowManualModal] = useState(false);

  const isMounted = useRef(true);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !location) return;
    updateRecommendationLocation(uid, location.coords).catch(() =>
      console.warn('[Index] recommendation_location_sync_failed'));
  }, [location?.coords.latitude, location?.coords.longitude]);

  // A primeira execução abria o manual completo, de 12 passos. Quem acaba de
  // instalar não lê isso — e, com o tutorial curto em cada tela, o Início
  // mostraria dois popups em sequência. Agora o manual fica a um toque, pelo
  // botão secundário do tutorial, e também pela reputação em Perfil.
  const { visible: showTutorial, dismiss: dismissTutorial } = useFirstVisitTutorial('inicio');

  const openManualFromTutorial = () => {
    void dismissTutorial();
    setShowManualModal(true);
  };

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        let lastLoc = await Location.getLastKnownPositionAsync();
        if (lastLoc && isMounted.current) setLocation(lastLoc);
        
        let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (isMounted.current) setLocation(loc);
      }
    })();
  }, []);

  useEffect(() => {
    if (location && allUpcomingEvents.length > 0) {
      const highlightedIds = new Set(highlights.map(({ id }) => id));
      const currentUid = auth.currentUser?.uid;
      const withDistance = allUpcomingEvents
        .filter((meeting) => {
          const isOnlineEvent = meeting.type === 'online';
          const hasValidCoordinates = Number.isFinite(meeting.lat) && Number.isFinite(meeting.lng);
          const isConfirmed = Boolean(currentUid && meeting.attendees?.includes(currentUid));
          return !isOnlineEvent && hasValidCoordinates && !isConfirmed && !highlightedIds.has(meeting.id);
        })
        .map(m => {
          const dist = getDistanceFromLatLonInKm(location.coords.latitude, location.coords.longitude, m.lat!, m.lng!);
          return { ...m, distance: dist };
        })
        .filter(m => m.distance <= CONFIG.NEARBY_RADIUS_KM);
      withDistance.sort((a, b) => a.distance - b.distance);
      setNearbyEvents(withDistance.slice(0, 5));
      return;
    }
    setNearbyEvents([]);
  }, [location, allUpcomingEvents, highlights]);

  const handleRefreshNearby = async () => {
    setRefreshingNearby(true);
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      const status = permission.status === 'granted' ? permission.status : (await Location.requestForegroundPermissionsAsync()).status;
      if (status !== 'granted') {
        Alert.alert('Localização necessária', 'Permita a localização para atualizar os eventos perto de você.');
        return;
      }
      const currentLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (isMounted.current) setLocation(currentLocation);
    } catch (error) {
      console.warn('[Index] Não foi possível atualizar a localização:', error);
      Alert.alert('Não foi possível atualizar', 'Tente novamente quando sua localização estiver disponível.');
    } finally {
      if (isMounted.current) setRefreshingNearby(false);
    }
  };

  useEffect(() => {
    isMounted.current = true;
    let unsubConversations: any;
    let unsubNotifications: any;
    let unsubHighlights: (() => void) | undefined;
    let unsubMyEvents: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        if (unsubConversations) unsubConversations();
        if (unsubNotifications) unsubNotifications();
        if (unsubHighlights) unsubHighlights();
        if (unsubMyEvents) unsubMyEvents();
        return;
      }

      const currentUid = user.uid;

      // O perfil vem do Context (`userProfile` abaixo). Esta tela mantinha o
      // próprio `onSnapshot` em `users/{uid}` — e, por usar `as User` sobre o dado
      // cru, aceitava qualquer forma do documento sem validar. O Context entrega
      // o perfil já passado por `toUserProfile`.

      const qConversations = query(
        collection(db, 'conversations'),
        where('participants', 'array-contains', currentUid),
        limit(20)
      );

      const qNotifications = query(
        collection(db, 'notifications'),
        where('userId', '==', currentUid),
        where('read', '==', false),
        limit(20)
      );

      let msgCount = 0;
      let noteCount = 0;
      const updateTotal = () => { if (isMounted.current) setUnreadCount(msgCount + noteCount) };

      unsubConversations = onSnapshot(qConversations, (snapshot) => {
        let count = 0;
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          if (data.unreadCounts && data.unreadCounts[currentUid]) {
            count += data.unreadCounts[currentUid];
          }
        });
        msgCount = count;
        updateTotal();
      }, (error) => {
        console.warn('[Index] Erro no listener de conversas:', error);
      });

      unsubNotifications = onSnapshot(qNotifications, (snapshot) => {
        // Mensagens já são contabilizadas por unreadCounts nas conversas.
        // Ignorar a notificação agregada de chat evita contar a mesma conversa duas vezes no sino.
        noteCount = snapshot.docs.filter((notification) => notification.data().type !== 'chat').length;
        updateTotal();
      }, (error) => {
        console.warn('[Index] Erro no listener de notificações:', error);
      });

      const todayStr = getTodayStr();
      const discoveryStartDate = getDateAfterDays(-1);
      const maxDiscoveryDate = getDateAfterDays(CONFIG.AGENDA_DISCOVERY_DAYS);

      const qMyEvents = query(
        collection(db, 'meetings'),
        where('attendees', 'array-contains', currentUid),
        limit(30)
      );

      unsubMyEvents = onSnapshot(qMyEvents, (snap) => {
        const myEventsData = snap.docs.map(d => ({ id: d.id, ...d.data() } as Meeting));
        const futureMyEvents = myEventsData.filter((m) => {
          if (m.status === 'cancelled' || m.status === 'completed') return false;
          if (hasEventEnded(m)) return false;
          const normalizedDate = normalizeDate(m.date);
          if (!normalizedDate) return false;
          return normalizedDate >= todayStr || isEventInProgress(m);
        });
        futureMyEvents.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        if (isMounted.current) setMyEvents(futureMyEvents.slice(0, 5));
      }, (err) => {
        console.warn('[Index] Erro no listener de eventos do usuário:', err);
      });

      const qHighlights = query(
        collection(db, 'meetings'),
        where('date', '>=', discoveryStartDate),
        where('date', '<=', maxDiscoveryDate),
        orderBy('date'),
        limit(30)
      );

      unsubHighlights = onSnapshot(qHighlights, (snap) => {
        const highlightsData = snap.docs.map(d => ({ id: d.id, ...d.data() } as Meeting));
        const userInterests = normalizeInterests(userProfile?.interests);
        const userCoordinates = location
          ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
          : null;

        const upcomingHighlights = highlightsData.filter((m) => {
          if (m.status === 'cancelled' || m.status === 'completed') return false;
          if (hasEventEnded(m)) return false;
          const normalizedDate = normalizeDate(m.date);
          if (!normalizedDate) return false;
          if ((normalizedDate < todayStr && !isEventInProgress(m)) || normalizedDate > maxDiscoveryDate) return false;

          const isOwn = m.createdBy === currentUid || (m.attendees && currentUid ? m.attendees.includes(currentUid) : false);
          if (isOwn) return false;
          if (m.type === 'online') return true;
          return isMeetingNearby(m, userCoordinates);
        });

        if (isMounted.current) setAllUpcomingEvents(upcomingHighlights);

        // Uma única lista de descoberta: primeiro correspondências de interesse e,
        // se o usuário permitiu, populares fora das tags. O rótulo deixa clara a origem.
        // A regra vem de shouldSuggestEvent — a mesma usada pela Agenda e pelo Explorar.
        const highlightsForProfile = upcomingHighlights.filter((meeting) => shouldSuggestEvent(
          getEventDiscovery(meeting, { userCoordinates, userInterests }),
          userProfile?.showPopularOutsideInterests !== false,
        ));

        const sortedHighlights = [...highlightsForProfile].sort((a, b) => {
          const matchA = getEventDiscovery(a, { userCoordinates, userInterests }).reasons.includes('interest') ? 1 : 0;
          const matchB = getEventDiscovery(b, { userCoordinates, userInterests }).reasons.includes('interest') ? 1 : 0;
          if (matchA !== matchB) return matchB - matchA;
          return (b.attendees?.length || 0) - (a.attendees?.length || 0);
        });

        if (isMounted.current) setHighlights(sortedHighlights.slice(0, 5));
        if (isMounted.current) {
          setError(false);
          setLoading(false);
        }
      }, (err) => {
        console.error(`${STRINGS.LOG_DB_READ} [Index] Error listening to events:`, err.code, err.message);
        if (isMounted.current) {
          setError(true);
          setLoading(false);
        }
      });

    });

    return () => {
      isMounted.current = false;
      unsubscribeAuth();
      if (unsubConversations) unsubConversations();
      if (unsubNotifications) unsubNotifications();
      if (unsubHighlights) unsubHighlights();
      if (unsubMyEvents) unsubMyEvents();
    };
  }, [userProfile?.interests?.join(','), userProfile?.showPopularOutsideInterests, location?.coords.latitude, location?.coords.longitude]);

  const renderEventCard = ({ item, distance }: { item: Meeting; distance?: number }) => {
    const discovery = getEventDiscovery(item, {
      userCoordinates: location
        ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
        : null,
      userInterests: normalizeInterests(userProfile?.interests),
      now: eventClock,
    });
    const eventIsInProgress = discovery.reasons.includes('in_progress');
    const isNearbyCard = typeof distance === 'number';
    // Cada seção já declara por que o evento está ali: "Eventos do seu interesse"
    // diz `interest`/`history`, "Eventos perto de você" diz `nearby`. Repetir isso
    // no selo não informava nada e ocupava o espaço do estado temporal — o card
    // dizia "Seu interesse" em vez de "HOJE".
    const impliedReasons: DiscoveryReason[] = isNearbyCard ? ['nearby'] : ['interest', 'history'];
    const badgeReason = getDiscoveryBadgeReason(discovery, impliedReasons);
    // O selo temporal agora vale para as duas seções, com o mesmo vocabulário de
    // "Seus Próximos Eventos" e da Agenda.
    const journeyState = eventIsInProgress ? null : getEventJourneyState(item, eventClock);
    const { day, month } = formatEventDate(item.date);
    return (
      <TouchableOpacity style={[styles.eventCard, eventIsInProgress && styles.eventCardInProgress]} onPress={() => router.push(`/event/${item.id}` as never)}>
        {/* Linha 1 = contexto (quando/onde) + POR QUE. Linha 2 = título + QUANDO.
            Um eixo por linha: no card de 220px os dois selos juntos não cabiam. */}
        <View style={styles.eventHeader}>
          {/* O ícone indica o TIPO do evento, não a seção. Antes era calendário ou
              alfinete conforme a lista em que o card estava, então um evento online
              aparecia com ícone de calendário e nada dizia que era online — só
              abrindo o evento dava para saber. */}
          <FontAwesome
            name={item.type === 'online' ? 'video-camera' : 'map-marker'}
            size={14}
            color={eventIsInProgress ? '#059669' : isNearbyCard ? '#ec4899' : '#6366f1'}
          />
          <Text style={[styles.eventDate, isNearbyCard && styles.nearbyEventDate, eventIsInProgress && styles.eventDateInProgress]} numberOfLines={1}>
            {item.date ? `${day} ${month}` : 'Data a definir'}
          </Text>
          {badgeReason && (
            <View style={[styles.discoveryTag, { backgroundColor: DISCOVERY_REASON_COLORS[badgeReason].background }]}>
              <Text style={[styles.discoveryTagText, { color: DISCOVERY_REASON_COLORS[badgeReason].text }]} numberOfLines={1}>
                {DISCOVERY_REASON_BADGE_LABELS[badgeReason]}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.eventTitleRow}>
          <Text style={styles.eventTitle} numberOfLines={1}>{item.title}</Text>
          {eventIsInProgress ? (
            <View style={styles.inProgressBadge}><Text style={styles.inProgressBadgeText} numberOfLines={1}>EM ANDAMENTO</Text></View>
          ) : journeyState ? (
            <View style={styles.journeyBadge}><Text style={styles.journeyBadgeText} numberOfLines={1}>{journeyState.compactLabel}</Text></View>
          ) : null}
        </View>
        {/* A distância saiu do cabeçalho para cá: lá ela ocupava o lugar da data,
            e o card da seção "perto de você" nunca dizia QUANDO o evento era. */}
        <View style={styles.eventMetaRow}>
          <FontAwesome name="users" size={11} color="#6b7280" />
          <Text style={styles.eventMetaText}>{item.attendees?.length || 0}</Text>
          {isNearbyCard && (
            <Text style={styles.eventMetaText}>{`· a ${distance.toFixed(1)} km`}</Text>
          )}
          {isNewMeeting(item, eventClock) && (
            <View style={styles.newBadge}><Text style={styles.newBadgeText}>NOVO</Text></View>
          )}
        </View>
        <Text style={styles.eventLoc} numberOfLines={1}>{item.locationName || 'Local a definir'}</Text>
      </TouchableOpacity>
    );
  };

  // Composição final defensiva: mesmo durante a atualização independente dos
  // listeners, um evento do usuário nunca reaparece nas listas de descoberta.
  // Interesses têm prioridade sobre proximidade para evitar cards repetidos.
  const currentUid = auth.currentUser?.uid;
  const myEventIds = new Set(myEvents.map(({ id }) => id));
  const visibleMyEvents = myEvents.filter((meeting) => !hasEventEnded(meeting, eventClock));
  const visibleHighlights = highlights.filter((meeting) =>
    !hasEventEnded(meeting, eventClock)
    && !belongsToUserAgenda(meeting, currentUid, myEventIds)
  );
  const visibleHighlightIds = new Set(visibleHighlights.map(({ id }) => id));
  const visibleNearbyEvents = nearbyEvents.filter((meeting) =>
    !hasEventEnded(meeting, eventClock)
    && !belongsToUserAgenda(meeting, currentUid, myEventIds)
    && !visibleHighlightIds.has(meeting.id)
  );

  return (
    <>
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <LinearGradient
        colors={['#6366F1', '#8B5CF6']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerWrapper}
      >
        <View style={styles.blobOne} />
        <View style={styles.blobTwo} />
        <View style={styles.headerTop}>
          <View style={styles.logoContainer}>
            <Image
              source={require('../../../assets/images/Whisk_Reunion_Hub_Logo.png')}
              style={styles.headerLogo}
              resizeMode="cover"
            />
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => router.push('/notifications')}
            >
              <FontAwesome
                name={unreadCount > 0 ? "bell" : "bell-o"}
                size={22}
                color={unreadCount > 0 ? "#ef4444" : "#fff"}
              />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.profileBtn} onPress={() => router.push('/profile')}>
              {auth.currentUser?.photoURL ? (
                <Image source={{ uri: auth.currentUser.photoURL || '' }} style={styles.profileImg} />
              ) : (
                <Text style={styles.profileInitial}>{auth.currentUser?.displayName?.charAt(0) || 'U'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.greetingContainer}>
          <Text style={styles.greetingText}>
            Olá, <Text style={styles.userName}>{auth.currentUser?.displayName?.split(' ')[0] || 'Visitante'}</Text>
          </Text>
          <Text style={styles.subGreeting}>O que vamos fazer hoje?</Text>
        </View>
      </LinearGradient>

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#6366F1" />
          <Text style={styles.loadingText}>Buscando eventos para você...</Text>
        </View>
      ) : error ? (
        <View style={{ marginTop: 40, marginBottom: 40 }}>
          <ErrorState title="Sem conexão" message="Não foi possível buscar seus eventos recentes." />
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Seus Próximos Eventos</Text>
            {visibleMyEvents.length === 0 ? (
              <View style={styles.emptyStateContainer}>
                <Text style={styles.emptyText}>Você ainda não confirmou presença em nenhum evento.</Text>
              </View>
            ) : (
              /* Rolagem horizontal como as outras duas seções: empilhada, com
                 muitos compromissos ela crescia sem limite e empurrava
                 "Eventos do seu interesse" e "perto de você" para fora da tela.
                 A caixa de data continua, porque é o sinal visual que diferencia
                 compromisso seu de sugestão — só passou a ficar no topo do card. */
              <FlatList
                horizontal
                data={visibleMyEvents}
                keyExtractor={event => event.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
                renderItem={({ item: event }) => {
                  const { day, month } = formatEventDate(event.date);
                  const eventIsToday = isEventToday(event, eventClock);
                  const eventIsInProgress = isEventInProgress(event, eventClock);
                  const eventJourney = getEventJourneyState(event, eventClock, {
                    isAttending: Boolean(currentUid && event.attendees?.includes(currentUid)),
                    isCreator: event.createdBy === currentUid,
                    hasCheckedIn: Boolean(currentUid && event.checkedIn?.includes(currentUid)),
                    hasPendingCheckIn: Boolean(currentUid && event.pendingCheckIns?.some(({ userId }) => userId === currentUid)),
                  });
                  return (
                    <TouchableOpacity
                      style={[styles.upcomingCard, eventIsToday && styles.listCardToday, eventIsInProgress && styles.listCardInProgress]}
                      onPress={() => router.push(`/event/${event.id}` as any)}
                    >
                      <View style={styles.upcomingHeader}>
                        <View style={[styles.dateBox, styles.dateBoxStacked, eventIsToday && styles.dateBoxToday, eventIsInProgress && styles.dateBoxInProgress]}>
                          <Text style={styles.dateDay}>{day}</Text>
                          <Text style={styles.dateMonth}>{month}</Text>
                        </View>
                        {eventIsInProgress ? (
                          <View style={styles.inProgressBadge}><Text style={styles.inProgressBadgeText} numberOfLines={1}>EM ANDAMENTO</Text></View>
                        ) : (
                          <View style={styles.journeyBadge}><Text style={styles.journeyBadgeText} numberOfLines={1}>{eventJourney.compactLabel}</Text></View>
                        )}
                      </View>
                      <Text style={styles.listTitle} numberOfLines={2}>{event.title}</Text>
                      {/* Confirmados na MESMA linha do horário: uma linha própria
                          devolveria ao card a altura que acabamos de tirar dele. */}
                      <View style={styles.upcomingTimeRow}>
                        <Text style={[styles.listTime, styles.upcomingTimeText]} numberOfLines={1}>{formatEventTimeRange(event)}</Text>
                        <View style={styles.upcomingAttendees}>
                          <FontAwesome name="users" size={11} color="#6b7280" />
                          <Text style={styles.eventMetaText}>{event.attendees?.length || 0}</Text>
                        </View>
                      </View>
                      <Text style={styles.listTime} numberOfLines={1}>{event.locationName || 'Local a definir'}</Text>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Eventos do seu interesse</Text>
            </View>
            {userProfile?.interests && userProfile.interests.length > 0 ? (
              <Text style={styles.interestTag}>Selecionados pelas suas tags: {userProfile.interests.join(', ')}</Text>
            ) : (
              <TouchableOpacity style={styles.addInterestBtn} onPress={() => router.push('/profile')}>
                <Text style={styles.addInterestText}>+ Adicionar Interesses</Text>
              </TouchableOpacity>
            )}
            <FlatList
              horizontal
              data={visibleHighlights}
              renderItem={renderEventCard}
              keyExtractor={item => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {userProfile?.interests?.length
                    ? 'Nenhum evento das suas tags foi encontrado nos próximos dias.'
                    : 'Adicione interesses ao perfil para receber recomendações personalizadas.'}
                </Text>
              }
            />
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Eventos perto de você (até 10 km)</Text>
              <TouchableOpacity style={styles.refreshNearbyButton} onPress={handleRefreshNearby} disabled={refreshingNearby}>
                <FontAwesome name="refresh" size={13} color="#4F46E5" />
                <Text style={styles.refreshNearbyText}>{refreshingNearby ? 'Atualizando...' : 'Atualizar'}</Text>
              </TouchableOpacity>
            </View>
            {!location ? (
              <Text style={styles.emptyText}>Permita o acesso à localização para ver eventos próximos.</Text>
            ) : visibleNearbyEvents.length === 0 ? (
              <Text style={styles.emptyText}>Nenhum evento presencial em um raio de 10 km encontrado no momento.</Text>
            ) : (
              <FlatList
                horizontal
                data={visibleNearbyEvents}
                keyExtractor={item => item.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
                renderItem={({ item }) => renderEventCard({ item, distance: item.distance ?? 0 })}
              />
            )}
          </View>
        </>
      )}
    </ScrollView>
    <ScreenTutorialModal
        screen="inicio"
        visible={showTutorial}
        onClose={() => void dismissTutorial()}
        secondaryActionLabel="Ver o manual completo"
        onSecondaryAction={openManualFromTutorial}
    />
    <ManualModal
        visible={showManualModal}
        onClose={() => setShowManualModal(false)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  loadingState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 56, gap: 12 },
  loadingText: { color: '#64748B', fontSize: 14, fontWeight: '600' },
  scrollContent: { paddingBottom: 40 },
  // Header Styles
  headerWrapper: {
    paddingTop: 50, // SafeArea padding
    paddingBottom: 30,
    paddingHorizontal: 24,
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
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: -5,
  },
  // A imagem em si. Pode ser gigante agora.
  headerLogo: {
    width: 100, // Bem maior que o container (dá o efeito de zoom)
    height: 95,
    // Brinque com estas margens para escolher QUAL parte vai aparecer
    marginLeft: 0, // Puxa para a esquerda para centralizar
    marginTop: -0,  // Sobe ou desce a imagem dentro do corte
  },
  // Define o espaço "seguro" no header. Nada invade esse espaço.
  logoContainer: {
    width: 115,
    height: 70,
    borderRadius: 16,
    overflow: 'hidden', // O SEGREDO: Corta tudo que passar desse tamanho
    justifyContent: 'center', // Centraliza a imagem no corte
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16, // Espaçamento moderno entre ícones
  },
  iconBtn: {
    padding: 4,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ef4444',
    borderWidth: 1,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 2
  },
  profileBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e0e7ff',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  profileImg: {
    width: '100%',
    height: '100%',
  },
  profileInitial: {
    color: '#4f46e5',
    fontWeight: 'bold',
    fontSize: 18
  },
  greetingContainer: {
    marginTop: 10,
    marginBottom: -10,
  },
  greetingText: {
    fontSize: 28,
    fontWeight: '300',
    color: '#ffffff',
    marginBottom: 4,
  },
  userName: {
    fontWeight: '800',
    color: '#ffffff',
  },
  subGreeting: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.85)',
  },

  // Body Styles (Destaques e Lista)
  section: { padding: 24, paddingBottom: 0 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#1f2937' },
  refreshNearbyButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: '#EEF2FF' },
  refreshNearbyText: { color: '#4F46E5', fontSize: 12, fontWeight: '700' },
  interestTag: { fontSize: 12, color: '#6b7280', marginBottom: 12, fontStyle: 'italic' },
  addInterestBtn: { padding: 8, backgroundColor: '#eff6ff', borderRadius: 8, alignSelf: 'flex-start', marginBottom: 12 },
  addInterestText: { color: '#2563eb', fontSize: 12, fontWeight: 'bold' },
  horizontalList: { paddingRight: 24 },

  // Cards
  eventCard: {
    width: 220, backgroundColor: '#fff', borderRadius: 16, padding: 16, marginRight: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 3, marginBottom: 10
  },
  eventCardInProgress: { borderWidth: 1, borderColor: '#34D399', backgroundColor: '#ECFDF5' },
  eventHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  eventDate: { flex: 1, marginLeft: 6, color: '#6366f1', fontSize: 12, fontWeight: 'bold' },
  nearbyEventDate: { color: '#ec4899' },
  eventDateInProgress: { color: '#047857' },
  eventTitle: { flex: 1, fontSize: 16, fontWeight: 'bold', color: '#1f2937', marginBottom: 4 },
  eventTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  discoveryTag: { flexShrink: 0, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#EEF2FF' },
  discoveryTagText: { color: '#4F46E5', fontSize: 9, fontWeight: '800' },
  eventLoc: { fontSize: 12, color: '#6b7280' },
  eventMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, marginBottom: 2 },
  eventMetaText: { fontSize: 11, color: '#6b7280', fontWeight: '600' },
  newBadge: { backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, marginLeft: 2 },
  newBadgeText: { fontSize: 9, fontWeight: '800', color: '#B45309', letterSpacing: 0.5 },
  journeyBadge: { flexShrink: 0, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: '#EEF2FF' },
  journeyBadgeText: { color: '#4338CA', fontSize: 9, lineHeight: 12, fontWeight: '900' },

  emptyText: { color: '#6b7280', fontSize: 14, fontStyle: 'italic', textAlign: 'center', marginTop: 10 },
  emptyStateContainer: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#4b4b76',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },

  // Mesma largura e margem do `eventCard` das outras duas seções, para as três
  // rolarem no mesmo ritmo. `minHeight` mantém os cards alinhados quando um
  // título ocupa duas linhas e o vizinho ocupa uma.
  // Sem `minHeight`: ele forçava 150px e, com título de uma linha, sobrava espaço
  // vazio embaixo — o que dava o aspecto estufado. O card agora acompanha o
  // conteúdo, como já faziam os das outras duas seções.
  upcomingCard: {
    width: 220, backgroundColor: '#fff', borderRadius: 16, padding: 13, marginRight: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 3, marginBottom: 10,
  },
  upcomingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  upcomingTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // `flexShrink` no horário: quando a faixa é longa, ela encolhe e trunca em vez
  // de empurrar a contagem para fora dos 220px do card.
  upcomingTimeText: { flexShrink: 1 },
  upcomingAttendees: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 0 },
  // A caixa de data deixa de ter margem à direita: no card vertical ela divide a
  // linha com o selo de estado, não precede um bloco de texto ao lado.
  dateBoxStacked: { marginRight: 0 },
  // `listCard`, `listContent` e `listTitleRow` saíram junto com a lista vertical
  // que a seção usava; estes dois continuam, aplicados ao card horizontal.
  listCardToday: { borderWidth: 1, borderColor: '#FBBF24', backgroundColor: '#FFFBEB' },
  listCardInProgress: { borderColor: '#34D399', backgroundColor: '#ECFDF5' },
  // Caixa de data compacta: ela sozinha ocupava ~48px de altura (10 de padding
  // em cima e embaixo mais duas linhas grandes), e era a maior parte do excesso.
  dateBox: {
    backgroundColor: '#f3f4f6', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9,
    alignItems: 'center', justifyContent: 'center', marginRight: 16, minWidth: 46
  },
  dateBoxToday: { backgroundColor: '#FEF3C7' },
  dateBoxInProgress: { backgroundColor: '#D1FAE5' },
  dateDay: { fontSize: 16, lineHeight: 19, fontWeight: 'bold', color: '#1f2937' },
  dateMonth: { fontSize: 9, lineHeight: 12, color: '#6b7280', fontWeight: 'bold', textTransform: 'uppercase' },
  // lineHeight explícito nas três: sem ele o Android reserva folga extra por
  // linha, e com quatro linhas empilhadas isso somava vários pixels invisíveis.
  listTitle: { fontSize: 15, lineHeight: 19, fontWeight: 'bold', color: '#1f2937', marginBottom: 3 },
  listTime: { fontSize: 12, lineHeight: 16, color: '#6b7280' },
  inProgressBadge: { flexShrink: 0, backgroundColor: '#059669', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  inProgressBadgeText: { color: '#FFFFFF', fontSize: 9, lineHeight: 12, fontWeight: '800' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
});
