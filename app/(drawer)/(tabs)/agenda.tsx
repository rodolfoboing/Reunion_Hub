import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../../../firebaseConfig';
import { collection, query, getDocs, orderBy, where, doc, getDoc } from 'firebase/firestore';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Calendar, LocaleConfig } from 'react-native-calendars';

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

export default function AgendaScreen() {
    // Top Section State: Discovery
    const [discoveryFilter, setDiscoveryFilter] = useState<'all' | 'recommended'>('all');
    const [discoveryEvents, setDiscoveryEvents] = useState<any[]>([]);

    // Bottom Section State: My History / Calendar
    const [selectedDate, setSelectedDate] = useState('');
    const [myEvents, setMyEvents] = useState<any[]>([]);
    const [markedDates, setMarkedDates] = useState<any>({});

    const [loading, setLoading] = useState(true);
    const [userInterests, setUserInterests] = useState<string[]>([]);

    useEffect(() => {
        if (auth.currentUser) {
            // Get User Interests
            getDoc(doc(db, 'users', auth.currentUser.uid)).then(snap => {
                if (snap.exists()) {
                    setUserInterests(snap.data().interests || []);
                }
            });
        }
    }, []);

    useEffect(() => {
        fetchEvents();
    }, [discoveryFilter, userInterests]);

    const fetchEvents = async () => {
        setLoading(true);
        // Mocking Data Fetch for Demo - In production, complex queries needed.
        // Fetch all meetings
        const q = query(collection(db, 'meetings'));
        const snap = await getDocs(q);
        const allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // 1. Discovery Logic ("Próximos ao usuário")
        let filteredDiscovery = allEvents;

        if (discoveryFilter === 'recommended') {
            // Filter by interest match - checking if any interest of the meeting matches user interests
            filteredDiscovery = allEvents.filter((e: any) => {
                const meetingInterests = e.interests || (e.theme ? [e.theme] : []);
                return meetingInterests.some((interest: string) => userInterests.includes(interest));
            });
        }

        setDiscoveryEvents(filteredDiscovery);

        // 2. My Events Logic - Populate Calendar
        // Show events where the user is the creator OR participating (logic for participation can be added later)
        const myEventsList = allEvents.filter((ev: any) => ev.createdBy === auth.currentUser?.uid);
        setMyEvents(myEventsList);

        const marks: any = {};
        myEventsList.forEach((ev: any) => {
            if (ev.date) {
                // Ensure date is in YYYY-MM-DD format for the calendar
                const dateKey = ev.date.trim();
                marks[dateKey] = { marked: true, dotColor: '#4F46E5', startingDay: true, endingDay: true, color: '#EEF2FF' };
            }
        });
        setMarkedDates(marks);

        setLoading(false);
    };

    const renderDiscoveryItem = ({ item }: { item: any }) => (
        <TouchableOpacity style={styles.discoveryCard} onPress={() => router.push(`/meeting/${item.id}`)}>
            <Image
                source={{ uri: 'https://images.unsplash.com/photo-1540575467063-178a50d2df87?w=500&auto=format&fit=crop' }}
                style={styles.cardImage}
            />
            <View style={styles.cardContent}>
                <Text style={styles.cardTheme}>{item.theme}</Text>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                <View style={styles.cardRow}>
                    <Ionicons name="location-outline" size={14} color="#6B7280" />
                    <Text style={styles.cardDetail}>{item.locationName || 'Local não definido'}</Text>
                </View>
                <View style={styles.cardRow}>
                    <Ionicons name="calendar-outline" size={14} color="#6B7280" />
                    <Text style={styles.cardDetail}>{item.date || 'Data a definir'}</Text>
                </View>
            </View>
        </TouchableOpacity>
    );

    const onDayPress = (day: any) => {
        setSelectedDate(day.dateString);
        // Filter events for this day if needed
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Minha Agenda</Text>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

                {/* Section 1: Discovery / Next Events */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Eventos Próximos</Text>

                    {/* Filter Tabs */}
                    <View style={styles.filterContainer}>
                        <TouchableOpacity
                            style={[styles.filterTab, discoveryFilter === 'all' && styles.filterTabActive]}
                            onPress={() => setDiscoveryFilter('all')}
                        >
                            <Text style={[styles.filterText, discoveryFilter === 'all' && styles.filterTextActive]}>Todos</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.filterTab, discoveryFilter === 'recommended' && styles.filterTabActive]}
                            onPress={() => setDiscoveryFilter('recommended')}
                        >
                            <Text style={[styles.filterText, discoveryFilter === 'recommended' && styles.filterTextActive]}>Recomendados</Text>
                        </TouchableOpacity>
                    </View>

                    <FlatList
                        horizontal
                        data={discoveryEvents}
                        renderItem={renderDiscoveryItem}
                        keyExtractor={item => item.id}
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.discoveryList}
                        ListEmptyComponent={<Text style={styles.emptyText}>Nenhum evento encontrado.</Text>}
                    />
                </View>

                {/* Section 2: Calendar / My Schedule */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Calendário</Text>

                    <View style={styles.calendarContainer}>
                        <Calendar
                            onDayPress={onDayPress}
                            markedDates={{
                                ...markedDates,
                                [selectedDate]: { selected: true, marked: markedDates[selectedDate]?.marked, selectedColor: '#4F46E5' }
                            }}
                            theme={{
                                backgroundColor: '#ffffff',
                                calendarBackground: '#ffffff',
                                textSectionTitleColor: '#b6c1cd',
                                selectedDayBackgroundColor: '#4F46E5',
                                selectedDayTextColor: '#ffffff',
                                todayTextColor: '#4F46E5',
                                dayTextColor: '#2d4150',
                                textDisabledColor: '#d9e1e8',
                                dotColor: '#4F46E5',
                                selectedDotColor: '#ffffff',
                                arrowColor: '#4F46E5',
                                monthTextColor: '#1E293B',
                                indicatorColor: '#4F46E5',
                                textDayFontWeight: '300',
                                textMonthFontWeight: 'bold',
                                textDayHeaderFontWeight: '300',
                                textDayFontSize: 16,
                                textMonthFontSize: 16,
                                textDayHeaderFontSize: 14
                            }}
                        />
                    </View>

                    <View style={styles.selectedDayEvents}>
                        <Text style={styles.subTitle}>Eventos do Dia: {selectedDate ? selectedDate.split('-').reverse().join('/') : 'Selecione um dia'}</Text>

                        {(() => {
                            const eventsOnThisDay = myEvents.filter(ev => ev.date === selectedDate);
                            if (eventsOnThisDay.length > 0) {
                                return eventsOnThisDay.map((event, index) => (
                                    <TouchableOpacity key={index} style={styles.miniEventCard} onPress={() => router.push(`/meeting/${event.id}`)}>
                                        <View style={[styles.miniEventDot, { backgroundColor: event.type === 'online' ? '#10B981' : '#4F46E5' }]} />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.miniEventTitle}>{event.title}</Text>
                                            <Text style={styles.miniEventLocation}>{event.locationName}</Text>
                                        </View>
                                        <Text style={styles.miniEventTime}>{event.time || 'Horário indefinido'}</Text>
                                    </TouchableOpacity>
                                ));
                            } else {
                                return <Text style={styles.emptyText}>Nenhum evento agendado para este dia.</Text>;
                            }
                        })()}
                    </View>
                </View>

            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8FAFC' },
    header: { padding: 24, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
    headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#0F172A' },
    scrollContent: { paddingBottom: 40 },

    section: { marginTop: 24 },
    sectionTitle: { fontSize: 18, fontWeight: '700', color: '#1E293B', paddingHorizontal: 24, marginBottom: 16 },
    subTitle: { fontSize: 14, fontWeight: '600', color: '#64748B', marginBottom: 12 },

    // Filters
    filterContainer: { flexDirection: 'row', paddingHorizontal: 24, marginBottom: 16 },
    filterTab: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#EFF6FF', marginRight: 12 },
    filterTabActive: { backgroundColor: '#4F46E5' },
    filterText: { color: '#64748B', fontWeight: '600', fontSize: 14 },
    filterTextActive: { color: '#fff' },

    // Discovery Cards
    discoveryList: { paddingHorizontal: 24, paddingRight: 8 },
    discoveryCard: { width: 220, backgroundColor: '#fff', borderRadius: 16, marginRight: 16, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, marginBottom: 8 },
    cardImage: { width: '100%', height: 120, backgroundColor: '#E2E8F0' },
    cardContent: { padding: 12 },
    cardTheme: { fontSize: 10, color: '#4F46E5', fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
    cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#1E293B', marginBottom: 8 },
    cardRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    cardDetail: { fontSize: 12, color: '#64748B', marginLeft: 6 },

    emptyText: { color: '#94A3B8', fontStyle: 'italic', paddingHorizontal: 24 },

    // Calendar & List
    calendarContainer: { paddingHorizontal: 24, marginBottom: 24 },
    selectedDayEvents: { paddingHorizontal: 24 },
    miniEventCard: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, padding: 12, backgroundColor: '#fff', borderRadius: 8 },
    miniEventDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4F46E5', marginRight: 12 },
    miniEventTitle: { fontSize: 14, fontWeight: '600', color: '#1E293B' },
    miniEventLocation: { fontSize: 12, color: '#64748B', marginTop: 2 },
    miniEventTime: { fontSize: 12, color: '#64748B', fontWeight: 'bold' },
});

