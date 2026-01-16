import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, Image } from 'react-native';
import { useEffect, useState } from 'react';
import { auth, db } from '../../../firebaseConfig';
import { doc, getDoc, collection, query, limit, getDocs, onSnapshot, where } from 'firebase/firestore';
import { FontAwesome } from '@expo/vector-icons';
import { router } from 'expo-router';

export default function HomeScreen() {
  const [userProfile, setUserProfile] = useState<any>(null);
  const [highlights, setHighlights] = useState<any[]>([]);
  const [myEvents, setMyEvents] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (auth.currentUser) {
      // Fetch Profile
      getDoc(doc(db, 'users', auth.currentUser.uid)).then(snap => {
        if (snap.exists()) setUserProfile(snap.data());
      });

      // Listen for Unread Messages
      const qUnread = query(
        collection(db, 'conversations'),
        where('participants', 'array-contains', auth.currentUser.uid)
      );

      const unsubscribe = onSnapshot(qUnread, (snapshot) => {
        let count = 0;
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          // Check if unreadCounts exists and has count for me
          if (data.unreadCounts && data.unreadCounts[auth.currentUser!.uid]) {
            count += data.unreadCounts[auth.currentUser!.uid];
          }
        });
        setUnreadCount(count);
      });

      // Fetch My Joined Events (Placeholder logic)
      const qEvents = query(collection(db, 'meetings'), limit(3));
      getDocs(qEvents).then(snap => {
        setMyEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });

      // Fetch Highlights (Placeholder logic)
      getDocs(qEvents).then(snap => {
        setHighlights(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });

      return () => unsubscribe();
    }
  }, []);

  const renderEventCard = ({ item }: { item: any }) => (
    <TouchableOpacity style={styles.eventCard} onPress={() => router.push(`/meeting/${item.id}`)}>
      <View style={styles.eventHeader}>
        <FontAwesome name="calendar" size={14} color="#6366f1" />
        <Text style={styles.eventDate}>{item.date}</Text>
      </View>
      <Text style={styles.eventTitle} numberOfLines={1}>{item.title}</Text>
      <Text style={styles.eventLoc} numberOfLines={1}>{item.locationName}</Text>
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
              onPress={() => router.push('/(drawer)/notifications')}
            >
              <FontAwesome
                name="bell-o" // Always outline unless we want to change it
                size={22}
                color={unreadCount > 0 ? "#ef4444" : "#6b7280"}
              />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.profileBtn} onPress={() => router.push('/(drawer)/(tabs)/profile')}>
              {auth.currentUser?.photoURL ? (
                <Image source={{ uri: auth.currentUser.photoURL }} style={styles.profileImg} />
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
          <TouchableOpacity><Text style={styles.seeAll}>Ver todos</Text></TouchableOpacity>
        </View>

        {userProfile?.interests && userProfile.interests.length > 0 ? (
          <Text style={styles.interestTag}>Baseado em: {userProfile.interests.join(', ')}</Text>
        ) : (
          <TouchableOpacity style={styles.addInterestBtn} onPress={() => router.push('/(drawer)/(tabs)/profile')}>
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
          myEvents.map(event => (
            <TouchableOpacity key={event.id} style={styles.listCard} onPress={() => router.push(`/meeting/${event.id}`)}>
              <View style={styles.dateBox}>
                <Text style={styles.dateDay}>19</Text>
                <Text style={styles.dateMonth}>DEZ</Text>
              </View>
              <View style={styles.listContent}>
                <Text style={styles.listTitle}>{event.title}</Text>
                <Text style={styles.listTime}>{event.time || '14:00'} • {event.locationName}</Text>
              </View>
            </TouchableOpacity>
          ))
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