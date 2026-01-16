import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform, TouchableOpacity, FlatList, ActivityIndicator, Alert, Modal, TextInput, ScrollView, KeyboardAvoidingView } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { collection, onSnapshot, query, addDoc } from 'firebase/firestore';
import { db, auth } from '../../../firebaseConfig';
import { FontAwesome, Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { INTERESTS_OPTIONS } from '../../../constants/Interests';

export default function ExploreScreen() {
    const [eventType, setEventType] = useState<'in-person' | 'online'>('in-person');
    const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [meetings, setMeetings] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalVisible, setModalVisible] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [newMeeting, setNewMeeting] = useState({
        title: '',
        interests: [] as string[],
        description: '',
        locationName: '',
        date: '', // YYYY-MM-DD
        time: '', // HH:mm
        lat: 0,
        lng: 0,
        type: 'in-person' as 'in-person' | 'online',
    });
    const [pickingLocation, setPickingLocation] = useState(false);

    // Initial Data Fetch & Location
    useEffect(() => {
        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
                let loc = await Location.getCurrentPositionAsync({});
                setLocation(loc);
                // Pre-fill coordinates
                setNewMeeting(prev => ({ ...prev, lat: loc.coords.latitude, lng: loc.coords.longitude }));
            }
        })();

        const q = query(collection(db, 'meetings'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                // Safeguard coordinates
                lat: doc.data().lat || -23.5505,
                lng: doc.data().lng || -46.6333,
                locationName: doc.data().locationName || 'Local a definir'
            }));
            setMeetings(data);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const filteredMeetings = meetings.filter(m => {
        if (eventType === 'online') return m.type === 'online';
        return m.type !== 'online'; // in-person defaults
    });

    const handleCreateEvent = async () => {
        if (!newMeeting.title.trim() || newMeeting.interests.length === 0 || !newMeeting.locationName.trim() || !newMeeting.description.trim() || !newMeeting.date || !newMeeting.time) {
            Alert.alert('Atenção', 'Por favor, preencha todos os campos obrigatórios (incluindo data e hora).');
            return;
        }

        setSubmitting(true);
        try {
            await addDoc(collection(db, 'meetings'), {
                ...newMeeting,
                theme: newMeeting.interests[0], // Compatibilidade
                type: eventType,
                createdBy: auth.currentUser?.uid || 'anonymous',
                createdAt: new Date().toISOString(),
            });
            Alert.alert('Sucesso', 'Seu evento foi criado e já está disponível para a comunidade!');
            setModalVisible(false);
            setNewMeeting({
                title: '',
                interests: [],
                description: '',
                locationName: '',
                date: '',
                time: '',
                lat: location?.coords.latitude || -23.5505,
                lng: location?.coords.longitude || -46.6333,
                type: 'in-person',
            });
        } catch (error) {
            console.error('Error adding document: ', error);
            Alert.alert('Erro', 'Ocorreu um problema ao criar seu evento. Tente novamente.');
        } finally {
            setSubmitting(false);
        }
    };

    const toggleInterest = (interest: string) => {
        setNewMeeting(prev => {
            const interests = prev.interests.includes(interest)
                ? prev.interests.filter(i => i !== interest)
                : [...prev.interests, interest];
            return { ...prev, interests };
        });
    };

    const renderMap = () => (
        <View style={styles.mapContainer}>
            <MapView
                style={styles.map}
                region={location ? {
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                } : {
                    latitude: -23.5505,
                    longitude: -46.6333,
                    latitudeDelta: 0.0922,
                    longitudeDelta: 0.0421,
                }}
                provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
                showsUserLocation={true}
                showsMyLocationButton={false}
            >
                {filteredMeetings.map((meeting) => (
                    <Marker
                        key={meeting.id}
                        coordinate={{ latitude: meeting.lat, longitude: meeting.lng }}
                        title={meeting.title}
                        description={meeting.theme}
                        onCalloutPress={() => router.push(`/meeting/${meeting.id}` as any)}
                    >
                        <View style={styles.markerContainer}>
                            <View style={[styles.markerBubble, { borderColor: '#4F46E5' }]}>
                                <MaterialIcons name="event" size={20} color="#4F46E5" />
                            </View>
                            <View style={[styles.markerArrow, { borderTopColor: '#4F46E5' }]} />
                        </View>
                    </Marker>
                ))}
            </MapView>

            {/* Floating Action Buttons for Map */}
            <View style={styles.mapActions}>
                <TouchableOpacity style={styles.fab} onPress={() => {
                    // Logic to recenter map would go here
                }}>
                    <Ionicons name="locate" size={24} color="#374151" />
                </TouchableOpacity>
            </View>
        </View>
    );

    const renderList = () => (
        <FlatList
            data={filteredMeetings}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
                <View style={styles.emptyContainer}>
                    <Ionicons name={eventType === 'online' ? "wifi-outline" : "map-outline"} size={48} color="#9CA3AF" />
                    <Text style={styles.emptyText}>
                        {eventType === 'online' ? 'Nenhum evento online encontrado.' : 'Nenhum evento presencial encontrado.'}
                    </Text>
                </View>
            }
            renderItem={({ item }) => (
                <TouchableOpacity style={styles.card} onPress={() => router.push(`/meeting/${item.id}` as any)}>
                    <View style={styles.cardHeader}>
                        <View style={styles.tagContainer}>
                            <Text style={styles.tagText}>{item.interests?.[0] || item.theme || 'Evento'}</Text>
                        </View>
                        <Text style={styles.dateText}>{item.date ? `${item.date.split('-').reverse().join('/')} às ${item.time || '00:00'}` : 'Data a definir'}</Text>
                    </View>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <View style={styles.cardFooter}>
                        <View style={styles.locationRow}>
                            <Ionicons name={item.type === 'online' ? "laptop-outline" : "location-outline"} size={16} color="#6B7280" />
                            <Text style={styles.locationText} numberOfLines={1}>
                                {item.type === 'online' ? (item.locationName || 'Link para o evento') : (item.locationName || 'Local a definir')}
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color="#D1D5DB" />
                    </View>
                </TouchableOpacity>
            )}
        />
    );

    return (
        <View style={styles.container}>
            {/* Custom Header Area within the screen */}
            <SafeAreaView edges={['top']} style={styles.headerContainer}>
                <View style={styles.headerTop}>
                    <Text style={styles.headerTitle}>Explorar</Text>
                </View>

                {/* Toggle Event Type */}
                <View style={styles.segmentContainer}>
                    <TouchableOpacity
                        style={[styles.segmentButton, eventType === 'in-person' && styles.segmentButtonActive]}
                        onPress={() => setEventType('in-person')}
                    >
                        <Text style={[styles.segmentText, eventType === 'in-person' && styles.segmentTextActive]}>Presenciais</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.segmentButton, eventType === 'online' && styles.segmentButtonActive]}
                        onPress={() => setEventType('online')}
                    >
                        <Text style={[styles.segmentText, eventType === 'online' && styles.segmentTextActive]}>Online</Text>
                    </TouchableOpacity>
                </View>

                {/* View Mode Toggle (Only for In-Person) */}
                {eventType === 'in-person' && (
                    <View style={styles.viewToggleContainer}>
                        <TouchableOpacity onPress={() => setViewMode('map')} style={[styles.toggleIcon, viewMode === 'map' && styles.toggleIconActive]}>
                            <Ionicons name="map" size={20} color={viewMode === 'map' ? '#4F46E5' : '#6B7280'} />
                            <Text style={[styles.toggleText, viewMode === 'map' && styles.toggleTextActive]}>Mapa</Text>
                        </TouchableOpacity>
                        <View style={styles.divider} />
                        <TouchableOpacity onPress={() => setViewMode('list')} style={[styles.toggleIcon, viewMode === 'list' && styles.toggleIconActive]}>
                            <Ionicons name="list" size={20} color={viewMode === 'list' ? '#4F46E5' : '#6B7280'} />
                            <Text style={[styles.toggleText, viewMode === 'list' && styles.toggleTextActive]}>Lista</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </SafeAreaView>

            {/* Main Content */}
            <View style={styles.content}>
                {loading ? (
                    <View style={styles.center}>
                        <ActivityIndicator size="large" color="#4F46E5" />
                    </View>
                ) : (
                    <>
                        {eventType === 'online' ? renderList() : (viewMode === 'map' ? renderMap() : renderList())}
                    </>
                )}
            </View>

            {/* Global FAB for Creating Event */}
            <View style={styles.actions}>
                <TouchableOpacity style={styles.createButton} onPress={() => setModalVisible(true)}>
                    <LinearGradient
                        colors={['#4F46E5', '#4338CA']}
                        style={styles.gradientButton}
                    >
                        <Ionicons name="add" size={24} color="#fff" />
                        <Text style={styles.createButtonText}>Criar</Text>
                    </LinearGradient>
                </TouchableOpacity>
            </View>

            {/* Create Event Modal */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={modalVisible}
                onRequestClose={() => setModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                        style={styles.modalContent}
                    >
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Criar Novo Evento</Text>
                            <TouchableOpacity onPress={() => setModalVisible(false)}>
                                <Ionicons name="close" size={24} color="#6B7280" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false}>
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Nome do Evento</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Ex: Café com Tecnologia"
                                    value={newMeeting.title}
                                    onChangeText={(text) => setNewMeeting({ ...newMeeting, title: text })}
                                />
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Interesses Envolvidos</Text>
                                <View style={styles.interestsContainer}>
                                    {INTERESTS_OPTIONS.map(interest => (
                                        <TouchableOpacity
                                            key={interest}
                                            style={[
                                                styles.interestChip,
                                                newMeeting.interests.includes(interest) && styles.interestChipSelected
                                            ]}
                                            onPress={() => toggleInterest(interest)}
                                        >
                                            <Text style={[
                                                styles.interestChipText,
                                                newMeeting.interests.includes(interest) && styles.interestChipTextSelected
                                            ]}>
                                                {interest}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Data e Horário</Text>
                                <View style={styles.row}>
                                    <TextInput
                                        style={[styles.input, { flex: 1, marginRight: 8 }]}
                                        placeholder="AAAA-MM-DD"
                                        value={newMeeting.date}
                                        onChangeText={(text) => setNewMeeting({ ...newMeeting, date: text })}
                                    />
                                    <TextInput
                                        style={[styles.input, { flex: 1 }]}
                                        placeholder="HH:MM"
                                        value={newMeeting.time}
                                        onChangeText={(text) => setNewMeeting({ ...newMeeting, time: text })}
                                    />
                                </View>
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>{eventType === 'online' ? 'Link ou Plataforma' : 'Nome do Local'}</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder={eventType === 'online' ? "Ex: Google Meet, Zoom..." : "Ex: Parque do Ibirapuera, SP"}
                                    value={newMeeting.locationName}
                                    onChangeText={(text) => setNewMeeting({ ...newMeeting, locationName: text })}
                                />
                            </View>

                            {eventType === 'in-person' && (
                                <View style={styles.inputGroup}>
                                    <Text style={styles.inputLabel}>Localização Geográfica</Text>
                                    <TouchableOpacity
                                        style={styles.mapPickerButton}
                                        onPress={() => setPickingLocation(true)}
                                    >
                                        <Ionicons name="location" size={20} color="#4F46E5" />
                                        <Text style={styles.mapPickerText}>
                                            {newMeeting.lat !== 0 ? 'Localização definida no mapa' : 'Selecionar no Mapa'}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            )}

                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Descrição Detalhada</Text>
                                <TextInput
                                    style={[styles.input, styles.textArea]}
                                    placeholder="Conte mais sobre o que vai acontecer no evento..."
                                    multiline
                                    numberOfLines={4}
                                    textAlignVertical="top"
                                    value={newMeeting.description}
                                    onChangeText={(text) => setNewMeeting({ ...newMeeting, description: text })}
                                />
                            </View>

                            <View style={styles.modalFooter}>
                                <TouchableOpacity
                                    style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
                                    onPress={handleCreateEvent}
                                    disabled={submitting}
                                >
                                    {submitting ? (
                                        <ActivityIndicator color="#fff" />
                                    ) : (
                                        <>
                                            <Ionicons name="checkmark-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
                                            <Text style={styles.submitButtonText}>Confirmar Criação</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </ScrollView>
                    </KeyboardAvoidingView>
                </View>
            </Modal>

            {/* Map Location Picker */}
            <Modal visible={pickingLocation} animationType="fade">
                <SafeAreaView style={{ flex: 1 }}>
                    <View style={styles.mapPickerHeader}>
                        <TouchableOpacity onPress={() => setPickingLocation(false)}>
                            <Ionicons name="arrow-back" size={24} color="#111827" />
                        </TouchableOpacity>
                        <Text style={styles.mapPickerTitle}>Arraste o marcador até o local</Text>
                        <TouchableOpacity onPress={() => setPickingLocation(false)} style={styles.confirmPin}>
                            <Text style={styles.confirmPinText}>Confirmar</Text>
                        </TouchableOpacity>
                    </View>
                    <MapView
                        style={{ flex: 1 }}
                        initialRegion={location ? {
                            latitude: location.coords.latitude,
                            longitude: location.coords.longitude,
                            latitudeDelta: 0.01,
                            longitudeDelta: 0.01,
                        } : {
                            latitude: -23.5505,
                            longitude: -46.6333,
                            latitudeDelta: 0.01,
                            longitudeDelta: 0.01,
                        }}
                        onPress={(e) => {
                            setNewMeeting({ ...newMeeting, lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude });
                        }}
                    >
                        <Marker
                            draggable
                            coordinate={{
                                latitude: newMeeting.lat || (location?.coords.latitude || -23.5505),
                                longitude: newMeeting.lng || (location?.coords.longitude || -46.6333)
                            }}
                            onDragEnd={(e) => {
                                setNewMeeting({ ...newMeeting, lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude });
                            }}
                        />
                    </MapView>
                </SafeAreaView>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F9FAFB' },
    headerContainer: { backgroundColor: '#fff', paddingBottom: 10, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 5, zIndex: 10 },
    headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
    headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827' },

    segmentContainer: { flexDirection: 'row', marginHorizontal: 20, backgroundColor: '#F3F4F6', borderRadius: 12, padding: 4, marginBottom: 10 },
    segmentButton: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
    segmentButtonActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
    segmentText: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
    segmentTextActive: { color: '#111827' },

    viewToggleContainer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 5 },
    toggleIcon: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 },
    toggleIconActive: { backgroundColor: '#EEF2FF', borderRadius: 20 },
    toggleText: { marginLeft: 6, fontSize: 13, fontWeight: '600', color: '#6B7280' },
    toggleTextActive: { color: '#4F46E5' },
    divider: { width: 1, height: 16, backgroundColor: '#E5E7EB', marginHorizontal: 8 },

    content: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    // Map Styles
    mapContainer: { flex: 1, width: '100%', height: '100%' },
    map: { width: '100%', height: '100%' },
    mapActions: { position: 'absolute', bottom: 100, right: 20, alignItems: 'center' },
    fab: { backgroundColor: '#fff', width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 4, elevation: 4 },

    // List Styles
    listContent: { padding: 16, paddingBottom: 100 },
    card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    tagContainer: { backgroundColor: '#EEF2FF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
    tagText: { fontSize: 11, color: '#4F46E5', fontWeight: '700', textTransform: 'uppercase' },
    dateText: { fontSize: 12, color: '#6B7280' },
    cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#1F2937', marginBottom: 8 },
    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    locationRow: { flexDirection: 'row', alignItems: 'center' },
    locationText: { marginLeft: 6, fontSize: 13, color: '#4B5563' },

    // Create Button
    actions: { position: 'absolute', bottom: 20, right: 20, alignItems: 'center' },
    createButton: { borderRadius: 30, shadowColor: "#4F46E5", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
    gradientButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 30 },
    createButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16, marginLeft: 8 },

    // Custom Marker
    markerContainer: { alignItems: 'center' },
    markerBubble: { backgroundColor: '#fff', padding: 6, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    markerArrow: { backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 6, alignSelf: 'center', marginTop: -2 },

    emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
    emptyText: { marginTop: 16, color: '#9CA3AF' },

    // Modal Styles
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '90%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#111827' },
    inputGroup: { marginBottom: 20 },
    inputLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
    input: { backgroundColor: '#F3F4F6', borderRadius: 12, padding: 12, fontSize: 16, color: '#111827', borderWidth: 1, borderColor: '#E5E7EB' },
    textArea: { height: 120, paddingTop: 12 },
    modalFooter: { marginTop: 12, marginBottom: 24 },
    submitButton: { backgroundColor: '#4F46E5', borderRadius: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    submitButtonDisabled: { opacity: 0.7 },
    submitButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

    interestsContainer: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
    interestChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F3F4F6', marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: '#E5E7EB' },
    interestChipSelected: { backgroundColor: '#EEF2FF', borderColor: '#4F46E5' },
    interestChipText: { fontSize: 13, color: '#6B7280' },
    interestChipTextSelected: { color: '#4F46E5', fontWeight: 'bold' },

    row: { flexDirection: 'row', alignItems: 'center' },
    mapPickerButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', borderStyle: 'dashed' },
    mapPickerText: { marginLeft: 8, color: '#4F46E5', fontWeight: '600' },
    mapPickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
    mapPickerTitle: { fontSize: 16, fontWeight: 'bold', color: '#111827' },
    confirmPin: { backgroundColor: '#4F46E5', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
    confirmPinText: { color: '#fff', fontWeight: 'bold' }
});
