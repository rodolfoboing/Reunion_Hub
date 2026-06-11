import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, Image } from 'react-native';
import { useEffect, useState, useRef } from 'react';
import { sendLocalNotification } from '../../../src/utils/Notifications';
import { auth, db } from '../../../src/services/firebaseConfig';
import { doc, getDoc, collection, getDocs, onSnapshot, query, where, limit, or } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { FontAwesome } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { User, Meeting, Notification } from '../../../src/types';

const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
  return R * c; // Distance in km
};

// Helper function para formatar a data do evento
const MONTH_NAMES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const formatEventDate = (dateString: string | undefined) => {
  if (!dateString) return { day: '--', month: '---' };

  try {
    // Normaliza a data: substitui / por - e faz trim
    const normalized = dateString.trim().replace(/\//g, '-');
    const parts = normalized.split('-');

    if (parts.length === 3) {
      // Formato YYYY-MM-DD
      const monthIndex = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);

      return {
        day: day.toString().padStart(2, '0'),
        month: MONTH_NAMES[monthIndex] || '---'
      };
    }
  } catch (e) {
    console.warn('Error parsing date:', dateString, e);
  }

  return { day: '--', month: '---' };
};

export default function HomeScreen() {
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [highlights, setHighlights] = useState<Meeting[]>([]);
  const [allUpcomingEvents, setAllUpcomingEvents] = useState<Meeting[]>([]);
  const [myEvents, setMyEvents] = useState<Meeting[]>([]);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [nearbyEvents, setNearbyEvents] = useState<Meeting[]>([]);

  const [unreadCount, setUnreadCount] = useState(0);

  // Ref to track first load and prevent notification spam
  const isFirstNotificationLoad = useRef(true);

  // Solicitar localização
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        let loc = await Location.getCurrentPositionAsync({});
        setLocation(loc);
      }
    })();
  }, []);

  // Calcular Eventos Próximos de forma independente dos destaques
  useEffect(() => {
    if (location && allUpcomingEvents.length > 0) {
      const withDistance = allUpcomingEvents
        .filter(m => m.lat && m.lng && m.type !== 'online')
        .map(m => {
          const dist = getDistanceFromLatLonInKm(location.coords.latitude, location.coords.longitude, m.lat!, m.lng!);
          return { ...m, distance: dist };
        });
      withDistance.sort((a, b) => a.distance - b.distance);
      setNearbyEvents(withDistance.slice(0, 5));
    }
  }, [location, allUpcomingEvents]);

  useEffect(() => {
    let unsubConversations: any;
    let unsubNotifications: any;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        if (unsubConversations) unsubConversations();
        if (unsubNotifications) unsubNotifications();
        return;
      }
      
      const currentUid = user.uid;

      getDoc(doc(db, 'users', currentUid)).then(snap => {
        if (snap.exists()) {
          setUserProfile({ uid: snap.id, ...snap.data() } as User);
        }
      });

      // Listen for Unread Messages & Notifications
      const qConversations = query(
        collection(db, 'conversations'),
        where('participants', 'array-contains', currentUid),
        limit(20)
      );

      const qNotifications = query(
        collection(db, 'notifications'),
        where('userId', '==', currentUid),
        where('read', '==', false),
        limit(50)
      );

      let msgCount = 0;
      let noteCount = 0;
      const updateTotal = () => setUnreadCount(msgCount + noteCount);

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
        console.warn('Error in conversations listener:', error);
      });

      unsubNotifications = onSnapshot(qNotifications, (snapshot) => {
        noteCount = snapshot.size;
        updateTotal();

        // Handle local notifications for new items (skipping first load)
        if (isFirstNotificationLoad.current) {
          isFirstNotificationLoad.current = false;
          return;
        }

        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const data = change.doc.data();
            const notificationTitle = data.title || 'Nova Notificação';
            const notificationBody = data.message || data.body || 'Você tem uma nova interação no Reunion Hub.';
            sendLocalNotification(notificationTitle, notificationBody);
          }
        });
      }, (error) => {
        console.warn('Error in notifications listener:', error);
      });

      // Fetch and Filter Meetings Scalably
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      // 1. Meus Eventos: Buscar de forma limitada onde sou participante
      const qMyEvents = query(
        collection(db, 'meetings'),
        where('attendees', 'array-contains', currentUid),
        limit(30)
      );
      
      getDocs(qMyEvents).then(snap => {
         const myEventsData = snap.docs.map(d => ({ id: d.id, ...d.data() } as Meeting));
         const futureMyEvents = myEventsData.filter((m) => {
            if (!m.date) return false;
            return m.date.replace(/\//g, '-') >= todayStr;
         });
         futureMyEvents.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
         setMyEvents(futureMyEvents.slice(0, 5));
      });

      // 2. Destaques: Buscar eventos futuros gerais (limite para não travar o banco)
      const qHighlights = query(
        collection(db, 'meetings'),
        where('date', '>=', todayStr),
        limit(20) // Proteção anti-faturamento
      );

      getDocs(qHighlights).then(snap => {
         const highlightsData = snap.docs.map(d => ({ id: d.id, ...d.data() } as Meeting));
         const userInterests = userProfile?.interests || [];
         
         const upcomingHighlights = highlightsData.filter((m) => {
           const isOwn = m.createdBy === currentUid || (m.attendees && currentUid ? m.attendees.includes(currentUid) : false);
           return !isOwn; // Não destaca meus próprios eventos
         });

         // Guarda todos para calcular a distância depois
         setAllUpcomingEvents(upcomingHighlights);

         // Ordenar por relevância (match de interesses) para os destaques
         const sortedHighlights = [...upcomingHighlights].sort((a, b) => {
           const matchA = (a.interests || []).filter((i: string) => userInterests.includes(i)).length;
           const matchB = (b.interests || []).filter((i: string) => userInterests.includes(i)).length;
           if (matchA !== matchB) return matchB - matchA;
           return (b.attendees?.length || 0) - (a.attendees?.length || 0);
         });

         setHighlights(sortedHighlights.slice(0, 5));
      });

    });

    return () => {
      unsubscribeAuth();
      if (unsubConversations) unsubConversations();
      if (unsubNotifications) unsubNotifications();
    };
  }, [userProfile?.interests]);

  const renderEventCard = ({ item }: { item: Meeting }) => (
    <TouchableOpacity style={styles.eventCard} onPress={() => router.push(`/event/${item.id}` as never)}>
      <View style={styles.eventHeader}>
        <FontAwesome name="calendar" size={14} color="#6366f1" />
        <Text style={styles.eventDate}>{item.date || 'Data a definir'}</Text>
      </View>
      <Text style={styles.eventTitle} numberOfLines={1}>{item.title}</Text>
      <Text style={styles.eventLoc} numberOfLines={1}>{item.locationName || 'Local a definir'}</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header Otimizado */}
      <View style={styles.headerWrapper}>

        {/* Top Row: Logo e Ações */}
        <View style={styles.headerTop}>
          {/* MOLDURA: Segura o espaço no layout */}
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
                color={unreadCount > 0 ? "#ef4444" : "#6b7280"}
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

        {/* Bottom Row: Saudação */}
        <View style={styles.greetingContainer}>
          <Text style={styles.greetingText}>
            Olá, <Text style={styles.userName}>{auth.currentUser?.displayName?.split(' ')[0] || 'Visitante'}</Text>
          </Text>
          <Text style={styles.subGreeting}>O que vamos fazer hoje?</Text>
        </View>
      </View>

      {/* Highlights Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Destaques para você</Text>
        </View>

        {userProfile?.interests && userProfile.interests.length > 0 ? (
          <Text style={styles.interestTag}>Baseado em: {userProfile.interests.join(', ')}</Text>
        ) : (
          <TouchableOpacity style={styles.addInterestBtn} onPress={() => router.push('/profile')}>
            <Text style={styles.addInterestText}>+ Adicionar Interesses</Text>
          </TouchableOpacity>
        )}

        <FlatList
          horizontal
          data={highlights}
          renderItem={renderEventCard}
          keyExtractor={item => item.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
        />
      </View>

      {/* My Meetings Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Seus Próximos Eventos</Text>
        {myEvents.length === 0 ? (
          <Text style={styles.emptyText}>Você não tem eventos próximos.</Text>
        ) : (
          myEvents.map(event => {
            const { day, month } = formatEventDate(event.date);
            return (
              <TouchableOpacity key={event.id} style={styles.listCard} onPress={() => router.push(`/event/${event.id}` as any)}>
                <View style={styles.dateBox}>
                  <Text style={styles.dateDay}>{day}</Text>
                  <Text style={styles.dateMonth}>{month}</Text>
                </View>
                <View style={styles.listContent}>
                  <Text style={styles.listTitle}>{event.title}</Text>
                  <Text style={styles.listTime}>{event.time || 'Horário a definir'} • {event.locationName || 'Local a definir'}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      {/* Nearby Events Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Eventos Próximos a Você</Text>
        </View>
        {!location ? (
          <Text style={styles.emptyText}>Permita o acesso à localização para ver eventos próximos.</Text>
        ) : nearbyEvents.length === 0 ? (
          <Text style={styles.emptyText}>Nenhum evento presencial próximo encontrado no momento.</Text>
        ) : (
          <FlatList
            horizontal
            data={nearbyEvents}
            keyExtractor={item => item.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.eventCard} onPress={() => router.push(`/event/${item.id}` as any)}>
                <View style={styles.eventHeader}>
                  <FontAwesome name="map-marker" size={14} color="#ec4899" />
                  <Text style={[styles.eventDate, { color: '#ec4899' }]}>
                    A {(item.distance ?? 0).toFixed(1)} km daqui
                  </Text>
                </View>
                <Text style={styles.eventTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.eventLoc} numberOfLines={1}>{item.locationName || 'Local a definir'}</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },

  // Header Styles
  headerWrapper: {
    backgroundColor: '#fff',
    paddingTop: 50, // SafeArea padding
    paddingBottom: 20,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  // A imagem em si. Pode ser gigante agora.
  headerLogo: {
    width: 100, // Bem maior que o container (dá o efeito de zoom)
    height: 100,
    // Brinque com estas margens para escolher QUAL parte vai aparecer
    marginLeft: 0, // Puxa para a esquerda para centralizar
    marginTop: -0,  // Sobe ou desce a imagem dentro do corte
  },
  // Define o espaço "seguro" no header. Nada invade esse espaço.
  logoContainer: {
    width: 140,
    height: 70, // Aumentei um pouco a altura da área
    overflow: 'hidden', // O SEGREDO: Corta tudo que passar desse tamanho
    justifyContent: 'center', // Centraliza a imagem no corte
    // backgroundColor: 'red', // Descomente essa linha para ver a área de corte se precisar debugar
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
    marginTop: 4,
  },
  greetingText: {
    fontSize: 22,
    color: '#1f2937',
    fontWeight: '400',
  },
  userName: {
    fontWeight: 'bold',
  },
  subGreeting: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },

  // Body Styles (Destaques e Lista)
  section: { padding: 24, paddingBottom: 0 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#1f2937' },
  seeAll: { color: '#4f46e5', fontSize: 14, fontWeight: '600' },
  interestTag: { fontSize: 12, color: '#6b7280', marginBottom: 12, fontStyle: 'italic' },
  addInterestBtn: { padding: 8, backgroundColor: '#eff6ff', borderRadius: 8, alignSelf: 'flex-start', marginBottom: 12 },
  addInterestText: { color: '#2563eb', fontSize: 12, fontWeight: 'bold' },
  horizontalList: { paddingRight: 24 },

  // Cards
  eventCard: {
    width: 220, backgroundColor: '#fff', borderRadius: 16, padding: 16, marginRight: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 3, marginBottom: 10
  },
  eventHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  eventDate: { marginLeft: 6, color: '#6366f1', fontSize: 12, fontWeight: 'bold' },
  eventTitle: { fontSize: 16, fontWeight: 'bold', color: '#1f2937', marginBottom: 4 },
  eventLoc: { fontSize: 12, color: '#6b7280' },

  emptyText: { color: '#9ca3af', fontStyle: 'italic', marginTop: 8 },

  listCard: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, elevation: 1, alignItems: 'center'
  },
  dateBox: {
    backgroundColor: '#f3f4f6', borderRadius: 8, padding: 10, alignItems: 'center', justifyContent: 'center',
    marginRight: 16, minWidth: 55
  },
  dateDay: { fontSize: 18, fontWeight: 'bold', color: '#1f2937' },
  dateMonth: { fontSize: 10, color: '#6b7280', fontWeight: 'bold', textTransform: 'uppercase' },
  listContent: { flex: 1 },
  listTitle: { fontSize: 16, fontWeight: 'bold', color: '#1f2937', marginBottom: 2 },
  listTime: { fontSize: 12, color: '#6b7280' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
});