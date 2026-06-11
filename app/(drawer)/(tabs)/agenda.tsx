import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, Image, ActivityIndicator, Modal, Alert, LayoutAnimation, UIManager, Platform, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../../../src/services/firebaseConfig';
import { collection, query, getDocs, orderBy, where, doc, getDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, deleteDoc } from 'firebase/firestore';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { useFocusEffect } from 'expo-router';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
    // Tab State: 'upcoming' | 'history' | 'favorites'
    const [activeTab, setActiveTab] = useState<'upcoming' | 'history' | 'favorites'>('upcoming');

    // Data State
    const [allEvents, setAllEvents] = useState<any[]>([]);
    const [filteredEvents, setFilteredEvents] = useState<any[]>([]);
    const [favorites, setFavorites] = useState<string[]>([]);
    const [markedDates, setMarkedDates] = useState<any>({});
    const [selectedDate, setSelectedDate] = useState('');

    const [loading, setLoading] = useState(true);
    const [selectedEvent, setSelectedEvent] = useState<any>(null);
    const [recommendations, setRecommendations] = useState<any[]>([]);

    // Initial Fetch (User Favorites & Profile)
    useFocusEffect(
        useCallback(() => {
            let unsubProfile: any;
            const unsubscribeAuth = auth.onAuthStateChanged((user) => {
                if (user) {
                    unsubProfile = onSnapshot(doc(db, 'users', user.uid), (snap) => {
                        if (snap.exists()) {
                            setFavorites(snap.data().favorites || []);
                        }
                    });
                }
            });

            return () => {
                unsubscribeAuth();
                if (unsubProfile) unsubProfile();
            };
        }, [])
    );

    useEffect(() => {
        fetchEvents();
    }, [activeTab, favorites.length, selectedDate]);

    const fetchEvents = async () => {
        const currentUid = auth.currentUser?.uid;
        if (!currentUid) return;

        setLoading(true);
        try {
            const now = new Date();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

            if (activeTab === 'favorites') {
                if (favorites.length === 0) {
                    setFilteredEvents([]);
                    setMarkedDates({});
                    setLoading(false);
                    return;
                }
                
                // Firestore 'in' query supports max 10 items.
                const chunks = [];
                for (let i = 0; i < favorites.length; i += 10) {
                    chunks.push(favorites.slice(i, i + 10));
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
                        date: d.data().date?.trim().replace(/\//g, '-') 
                    }));
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
                    date: data.date?.trim().replace(/\//g, '-')
                };
            });

            // Local filter for Upcoming vs History
            let results: any[] = [];
            let historyEvents: any[] = [];

            if (activeTab === 'upcoming') {
                results = events.filter((ev: any) => ev.date >= todayStr);
                historyEvents = events.filter((ev: any) => ev.date < todayStr);
                
                // Set marks for calendar with contextual colors
                const marks: any = {};
                results.forEach((ev: any) => {
                    const isPopular = ev.attendees && ev.attendees.length >= 3;
                    let dColor = ev.type === 'online' ? '#10B981' : '#4F46E5';
                    if (isPopular) dColor = '#F59E0B'; // Laranja para eventos cheios

                    if (ev.date) marks[ev.date] = { marked: true, dotColor: dColor };
                });
                setMarkedDates(marks);
                
                // Sort nearest first
                results.sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''));

                // Calculando Recomendações Baseadas em Títulos do Histórico
                const historyTitles = [...new Set(historyEvents.map((e: any) => e.title))];
                if (historyTitles.length > 0) {
                    const qRec = query(collection(db, 'meetings'), where('date', '>=', todayStr));
                    const snapRec = await getDocs(qRec);
                    const recs = snapRec.docs
                        .map(d => ({ id: d.id, ...d.data() }))
                        .filter((e: any) => historyTitles.includes(e.title) && !e.attendees?.includes(currentUid));
                    setRecommendations(recs);
                } else {
                    setRecommendations([]);
                }

            } else if (activeTab === 'history') {
                results = events.filter((ev: any) => ev.date < todayStr);
                setMarkedDates({});
                // Sort most recent past first
                results.sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
            }

            setFilteredEvents(results);

        } catch (error) {
            console.error("Error fetching agenda events:", error);
        } finally {
            setLoading(false);
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
            console.error("Fav error", err);
        }
    };

    const onDayPress = (day: any) => {
        setSelectedDate(day.dateString);
    };

    const handleCancelRSVP = async (event: any) => {
        if (!auth.currentUser) return;
        Alert.alert('Cancelar Presença', `Tem certeza que deseja cancelar sua presença em "${event.title}"?`, [
            { text: 'Não', style: 'cancel' },
            { text: 'Sim, Cancelar', style: 'destructive', onPress: async () => {
                try {
                    const docRef = doc(db, 'meetings', event.id);
                    await updateDoc(docRef, { attendees: arrayRemove(auth.currentUser?.uid) });
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setFilteredEvents(prev => prev.filter(e => e.id !== event.id));
                    setSelectedEvent(null);
                } catch (e) {
                    Alert.alert('Erro', 'Falha ao cancelar presença.');
                }
            }}
        ]);
    };

    const handleDeleteEvent = async (event: any) => {
        Alert.alert('Excluir Evento', `Atenção: Isso excluirá o evento "${event.title}" permanentemente para todos. Deseja continuar?`, [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Excluir Definitivamente', style: 'destructive', onPress: async () => {
                try {
                    const docRef = doc(db, 'meetings', event.id);
                    await deleteDoc(docRef);
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setFilteredEvents(prev => prev.filter(e => e.id !== event.id));
                    setSelectedEvent(null);
                } catch (e) {
                    Alert.alert('Erro', 'Falha ao excluir evento.');
                }
            }}
        ]);
    };

    const AnimatedEventCard = ({ item, onPress }: { item: any, onPress: () => void }) => {
        const pulseAnim = useRef(new Animated.Value(1)).current;

        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        now.setDate(now.getDate() + 1);
        const tomorrowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        
        const isVerySoon = item.date === todayStr || item.date === tomorrowStr;
        const isPopular = item.attendees && item.attendees.length >= 3; // +3 pessoas = Popular

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

        let indicatorColor = item.type === 'online' ? '#10B981' : '#4F46E5';
        if (isPopular) indicatorColor = '#F59E0B'; // Fogo / Laranja

        return (
            <TouchableOpacity style={[styles.eventCard, isVerySoon && { borderColor: '#E0E7FF', borderWidth: 1 }]} onPress={onPress}>
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
                            <Ionicons name="ellipsis-vertical" size={20} color="#CBD5E1" />
                        </View>
                    </View>
                    <View style={styles.eventMeta}>
                        <Ionicons name="calendar-outline" size={14} color="#64748B" />
                        <Text style={styles.eventMetaText}>
                            {item.date ? item.date.split('-').reverse().join('/') : 'Data a definir'}
                        </Text>
                        <View style={styles.metaSeparator} />
                        <Ionicons name="time-outline" size={14} color="#64748B" />
                        <Text style={styles.eventMetaText}>{item.time || '--:--'}</Text>
                        <View style={styles.metaSeparator} />
                        <Ionicons name="people-outline" size={14} color="#64748B" />
                        <Text style={styles.eventMetaText}>{item.attendees?.length || 1}</Text>
                    </View>
                    <View style={[styles.eventMeta, { marginTop: 4 }]}>
                        <Ionicons name="location-outline" size={14} color="#64748B" />
                        <Text style={styles.eventMetaText} numberOfLines={1}>{item.locationName || 'Local não definido'}</Text>
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    const renderEventCard = ({ item }: { item: any }) => (
        <AnimatedEventCard item={item} onPress={() => setSelectedEvent(item)} />
    );

    const renderRecommendationCard = ({ item }: { item: any }) => (
        <TouchableOpacity style={styles.recCard} onPress={() => router.push(`/event/${item.id}` as any)}>
            <View style={styles.recHeader}>
                <Text style={styles.recDate}>{item.date?.split('-').reverse().join('/')}</Text>
                <TouchableOpacity onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setRecommendations(prev => prev.filter(e => e.id !== item.id));
                }}>
                    <Ionicons name="close" size={18} color="#94A3B8" />
                </TouchableOpacity>
            </View>
            <Text style={styles.recTitle} numberOfLines={2}>{item.title}</Text>
            <View style={styles.recFooter}>
                <Text style={styles.recType}>{item.type === 'online' ? 'Online' : 'Presencial'}</Text>
                <Ionicons name="chevron-forward" size={16} color="#4F46E5" />
            </View>
        </TouchableOpacity>
    );

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Agenda de Eventos</Text>

                {/* Tabs */}
                <View style={styles.tabContainer}>
                    <TouchableOpacity
                        style={[styles.tabBtn, activeTab === 'upcoming' && styles.tabBtnActive]}
                        onPress={() => { setActiveTab('upcoming'); setSelectedDate(''); }}
                    >
                        <Text style={[styles.tabText, activeTab === 'upcoming' && styles.tabTextActive]}>Próximos</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.tabBtn, activeTab === 'history' && styles.tabBtnActive]}
                        onPress={() => setActiveTab('history')}
                    >
                        <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>Histórico</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.tabBtn, activeTab === 'favorites' && styles.tabBtnActive]}
                        onPress={() => setActiveTab('favorites')}
                    >
                        <Text style={[styles.tabText, activeTab === 'favorites' && styles.tabTextActive]}>Favoritos</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

                {activeTab === 'upcoming' && (
                    <View style={styles.calendarWrapper}>
                        <Calendar
                            onDayPress={onDayPress}
                            markedDates={{
                                ...markedDates,
                                [selectedDate]: {
                                    ...markedDates[selectedDate],
                                    selected: true,
                                    selectedColor: '#4F46E5',
                                    selectedTextColor: '#ffffff'
                                }
                            }}
                            theme={{
                                backgroundColor: '#ffffff',
                                calendarBackground: '#ffffff',
                                textSectionTitleColor: '#94A3B8',
                                selectedDayBackgroundColor: '#4F46E5',
                                selectedDayTextColor: '#ffffff',
                                todayTextColor: '#4F46E5',
                                dayTextColor: '#1E293B',
                                textDisabledColor: '#CBD5E1',
                                dotColor: '#4F46E5',
                                selectedDotColor: '#ffffff',
                                arrowColor: '#4F46E5',
                                monthTextColor: '#0F172A',
                                indicatorColor: '#4F46E5',
                                textDayFontWeight: '500',
                                textMonthFontWeight: 'bold',
                                textDayHeaderFontWeight: '600',
                                textDayFontSize: 16,
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
                    </View>
                )}

                <View style={styles.detailsSection}>
                    {activeTab === 'upcoming' && selectedDate ? (
                        <>
                            <View style={styles.detailsHeader}>
                                <Ionicons name="calendar" size={20} color="#4F46E5" />
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
                                <Text style={styles.emptyText}>Nenhum evento neste dia.</Text>
                            )}
                        </>
                    ) : activeTab === 'upcoming' && !selectedDate ? (
                        <View style={styles.instructionState}>
                            {recommendations.length > 0 ? (
                                <View style={styles.recommendationsContainer}>
                                    <View style={styles.recTitleRow}>
                                        <Ionicons name="sparkles" size={18} color="#F59E0B" />
                                        <Text style={styles.recMainTitle}>Recomendado: Mesmos Eventos</Text>
                                    </View>
                                    <Text style={styles.recSubtitle}>Eventos futuros idênticos aos que você já foi</Text>
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

                            <Ionicons name="calendar-outline" size={48} color="#E2E8F0" style={{ marginTop: recommendations.length > 0 ? 20 : 60 }} />
                            <Text style={styles.instructionText}>Selecione uma data no calendário para ver seus eventos futuros.</Text>
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
                            ) : (
                                <View style={styles.emptyState}>
                                    <Ionicons name="folder-open-outline" size={48} color="#E2E8F0" />
                                    <Text style={styles.emptyText}>
                                        {activeTab === 'favorites' ? 'Nenhum favorito encontrado.' : 'Nenhum histórico encontrado.'}
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}
                </View>

            </ScrollView>

            {/* Modal de Ações da Agenda */}
            <Modal visible={!!selectedEvent} animationType="slide" transparent={true} onRequestClose={() => setSelectedEvent(null)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>{selectedEvent?.title}</Text>
                        <TouchableOpacity style={styles.modalOption} onPress={() => { router.push(`/event/${selectedEvent.id}` as any); setSelectedEvent(null); }}>
                            <Ionicons name="eye-outline" size={20} color="#4F46E5" />
                            <Text style={styles.modalOptionText}>Ver Detalhes do Evento</Text>
                        </TouchableOpacity>

                        {selectedEvent?.createdBy === auth.currentUser?.uid ? (
                            <TouchableOpacity style={[styles.modalOption, { borderTopWidth: 1, borderColor: '#F1F5F9' }]} onPress={() => handleDeleteEvent(selectedEvent)}>
                                <Ionicons name="trash-outline" size={20} color="#EF4444" />
                                <Text style={[styles.modalOptionText, { color: '#EF4444' }]}>Excluir Evento Definitivamente</Text>
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity style={[styles.modalOption, { borderTopWidth: 1, borderColor: '#F1F5F9' }]} onPress={() => handleCancelRSVP(selectedEvent)}>
                                <Ionicons name="close-circle-outline" size={20} color="#EF4444" />
                                <Text style={[styles.modalOptionText, { color: '#EF4444' }]}>Cancelar Presença (Sair)</Text>
                            </TouchableOpacity>
                        )}
                        
                        <TouchableOpacity style={styles.modalCancel} onPress={() => setSelectedEvent(null)}>
                            <Text style={styles.modalCancelText}>Fechar Menu</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8FAFC' },
    header: { padding: 24, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
    headerTitle: { fontSize: 28, fontWeight: '800', color: '#0F172A', marginBottom: 16 },

    tabContainer: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 12, padding: 4 },
    tabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
    tabBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
    tabText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
    tabTextActive: { color: '#0F172A' },

    scrollContent: { paddingBottom: 40 },
    calendarWrapper: {
        backgroundColor: '#fff',
        borderRadius: 20,
        margin: 16,
        padding: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 12,
        elevation: 3,
    },
    detailsSection: { marginTop: 8, paddingHorizontal: 16 },
    detailsHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, paddingLeft: 8 },
    detailsDate: { fontSize: 18, fontWeight: '700', color: '#1E293B', marginLeft: 10 },

    // Cards
    eventCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.03,
        shadowRadius: 8,
        elevation: 2,
        borderWidth: 1,
        borderColor: 'transparent'
    },
    eventTypeIndicator: { width: 4, height: 40, borderRadius: 2, marginRight: 16 },
    eventInfo: { flex: 1 },
    eventTitle: { fontSize: 16, fontWeight: '700', color: '#0F172A', marginBottom: 4 },
    eventMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
    eventMetaText: { fontSize: 13, color: '#64748B', marginLeft: 4, marginRight: 12 },
    metaSeparator: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', marginRight: 12 },

    badgePopular: { backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
    badgePopularText: { fontSize: 10, fontWeight: 'bold', color: '#D97706' },
    badgeSoon: { backgroundColor: '#EEF2FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
    badgeSoonText: { fontSize: 10, fontWeight: 'bold', color: '#4F46E5' },

    emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: '#E2E8F0' },
    emptyText: { marginTop: 12, color: '#94A3B8', fontSize: 14, fontStyle: 'italic' },
    instructionState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
    instructionText: { marginTop: 16, color: '#94A3B8', fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },

    // Modal
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
    modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#0F172A', marginBottom: 16 },
    modalOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16 },
    modalOptionText: { fontSize: 16, fontWeight: '600', color: '#1E293B', marginLeft: 12 },
    modalCancel: { marginTop: 16, backgroundColor: '#F1F5F9', padding: 14, borderRadius: 12, alignItems: 'center' },
    modalCancelText: { fontSize: 16, fontWeight: 'bold', color: '#64748B' },

    // Recommendations
    recommendationsContainer: { width: '100%', marginBottom: 20 },
    recTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    recMainTitle: { fontSize: 16, fontWeight: 'bold', color: '#1E293B', marginLeft: 6 },
    recSubtitle: { fontSize: 13, color: '#64748B', marginBottom: 12, marginLeft: 24 },
    recCard: { backgroundColor: '#EEF2FF', width: 200, padding: 16, borderRadius: 16, marginRight: 12, borderWidth: 1, borderColor: '#E0E7FF' },
    recHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    recDate: { fontSize: 12, fontWeight: 'bold', color: '#4F46E5' },
    recTitle: { fontSize: 14, fontWeight: 'bold', color: '#1E293B', marginBottom: 12 },
    recFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    recType: { fontSize: 12, color: '#64748B' },
});
