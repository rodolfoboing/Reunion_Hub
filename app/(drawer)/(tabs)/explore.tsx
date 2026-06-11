import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image, FlatList, Dimensions, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import MapView, { Marker } from '../../../src/components/MapView';

import { useExploreData } from './_hooks/useExploreData';
import { CreateEventModal } from './_components/explore/CreateEventModal';
import { PlaceModal } from './_components/explore/PlaceModal';
import { LocationPickerModal } from './_components/explore/LocationPickerModal';
import { Place, User } from '../../../src/types';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../src/services/firebaseConfig';

const { width } = Dimensions.get('window');

const isEventLive = (dateStr?: string, timeStr?: string) => {
    if (!dateStr || !timeStr) return false;
    try {
        const eventDateTime = new Date(`${dateStr}T${timeStr}:00`);
        const now = new Date();
        const diffMs = now.getTime() - eventDateTime.getTime();
        const diffMinutes = diffMs / (1000 * 60);
        return diffMinutes >= -30 && diffMinutes <= 180;
    } catch (e) {
        return false;
    }
};

const PulsingMarker = () => {
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const opacityAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        Animated.loop(
            Animated.parallel([
                Animated.timing(scaleAnim, { toValue: 2, duration: 1500, useNativeDriver: true }),
                Animated.timing(opacityAnim, { toValue: 0, duration: 1500, useNativeDriver: true })
            ])
        ).start();
    }, []);

    return (
        <View style={styles.markerContainer}>
            <Animated.View style={[styles.pulseRing, { transform: [{ scale: scaleAnim }], opacity: opacityAnim }]} />
            <View style={styles.markerBubble}>
                <Ionicons name="flame" size={16} color="#EF4444" />
            </View>
            <View style={[styles.markerArrow, { borderTopColor: '#EF4444' }]} />
        </View>
    );
};

export default function ExploreScreen() {
    const { location, meetings, places, loading } = useExploreData();

    const [eventType, setEventType] = useState<'in-person' | 'online'>('in-person');
    const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
    
    // Create Event state
    const [modalVisible, setModalVisible] = useState(false);
    const [repeatCount, setRepeatCount] = useState(0); 
    const [pickingLocation, setPickingLocation] = useState(false);
    const [habitDays, setHabitDays] = useState<string[]>([]);
    const [newMeeting, setNewMeeting] = useState({
        title: '', interests: [] as string[], description: '', locationName: '', date: '', time: '',
        lat: 0, lng: 0, type: 'in-person', meetingLink: '', placeId: '',
    });

    // Place Modal state
    const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
    const [showPlaceModal, setShowPlaceModal] = useState(false);
    const [frequentersProfiles, setFrequentersProfiles] = useState<User[]>([]);
    const [loadingProfiles, setLoadingProfiles] = useState(false);

    const mapRef = useRef<any>(null);

    useEffect(() => {
        if (location && newMeeting.lat === 0) {
            setNewMeeting(prev => ({ ...prev, lat: location.coords.latitude, lng: location.coords.longitude }));
        }
    }, [location]);

    const handleOpenPlaceModal = async (place: Place) => {
        setSelectedPlace(place);
        setShowPlaceModal(true);
        setLoadingProfiles(true);
        setFrequentersProfiles([]);
        
        try {
            if (place.founderId && !place.founderName) {
                const founderDoc = await getDoc(doc(db, 'users', place.founderId));
                if (founderDoc.exists()) place.founderName = founderDoc.data().nick || founderDoc.data().displayName;
            }

            if (place.frequenters && place.frequenters.length > 0) {
                const chunks = [];
                for (let i = 0; i < place.frequenters.length; i += 10) {
                    chunks.push(place.frequenters.slice(i, i + 10));
                }
                let profiles: User[] = [];
                for (const chunk of chunks) {
                    const qProfiles = query(collection(db, 'users'), where('__name__', 'in', chunk));
                    const snapProfiles = await getDocs(qProfiles);
                    profiles = [...profiles, ...snapProfiles.docs.map(d => ({uid: d.id, ...d.data()} as User))];
                }
                setFrequentersProfiles(profiles);
            }
        } catch (error) {
            console.error("Erro ao buscar frequentadores:", error);
        } finally {
            setLoadingProfiles(false);
        }
    };

    const toggleHabitDay = (day: string) => {
        setHabitDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
    };

    const filteredMeetings = meetings.filter(m => m.type === eventType);

    const renderMeetingCard = ({ item }: { item: any }) => (
        <TouchableOpacity style={styles.card} onPress={() => router.push(`/event/${item.id}` as any)}>
            <View style={styles.cardHeader}>
                <View style={styles.tagContainer}><Text style={styles.tagText}>{item.theme}</Text></View>
                <Text style={styles.dateText}>{item.date ? item.date.split('-').reverse().join('/') : ''} • {item.time}</Text>
            </View>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <View style={styles.cardFooter}>
                <View style={styles.locationRow}>
                    <Ionicons name={eventType === 'online' ? "videocam-outline" : "location-outline"} size={16} color="#6B7280" />
                    <Text style={styles.locationText}>{item.locationName}</Text>
                </View>
                {isEventLive(item.date, item.time) && (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444', marginRight: 4 }} />
                        <Text style={{ fontSize: 12, color: '#EF4444', fontWeight: 'bold' }}>Live</Text>
                    </View>
                )}
            </View>
        </TouchableOpacity>
    );

    if (loading) {
        return (
            <SafeAreaView style={[styles.container, styles.center]}>
                <ActivityIndicator size="large" color="#4F46E5" />
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.headerContainer}>
                <View style={styles.headerTop}>
                    <Text style={styles.headerTitle}>Explorar</Text>
                </View>
                <View style={styles.segmentContainer}>
                    <TouchableOpacity style={[styles.segmentButton, eventType === 'in-person' && styles.segmentButtonActive]} onPress={() => setEventType('in-person')}>
                        <Text style={[styles.segmentText, eventType === 'in-person' && styles.segmentTextActive]}>Presencial</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.segmentButton, eventType === 'online' && styles.segmentButtonActive]} onPress={() => setEventType('online')}>
                        <Text style={[styles.segmentText, eventType === 'online' && styles.segmentTextActive]}>Online</Text>
                    </TouchableOpacity>
                </View>
                {eventType === 'in-person' && (
                    <View style={styles.viewToggleContainer}>
                        <TouchableOpacity style={[styles.toggleIcon, viewMode === 'map' && styles.toggleIconActive]} onPress={() => setViewMode('map')}>
                            <Ionicons name="map" size={18} color={viewMode === 'map' ? '#4F46E5' : '#9CA3AF'} />
                            <Text style={[styles.toggleText, viewMode === 'map' && styles.toggleTextActive]}>Mapa</Text>
                        </TouchableOpacity>
                        <View style={styles.divider} />
                        <TouchableOpacity style={[styles.toggleIcon, viewMode === 'list' && styles.toggleIconActive]} onPress={() => setViewMode('list')}>
                            <Ionicons name="list" size={18} color={viewMode === 'list' ? '#4F46E5' : '#9CA3AF'} />
                            <Text style={[styles.toggleText, viewMode === 'list' && styles.toggleTextActive]}>Lista</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>

            <View style={styles.content}>
                {eventType === 'online' || viewMode === 'list' ? (
                    <FlatList
                        data={filteredMeetings}
                        keyExtractor={(item) => item.id}
                        renderItem={renderMeetingCard}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={
                            <View style={styles.emptyContainer}>
                                <Ionicons name="calendar-outline" size={48} color="#D1D5DB" />
                                <Text style={styles.emptyText}>Nenhum evento encontrado.</Text>
                            </View>
                        }
                    />
                ) : (
                    <View style={styles.mapContainer}>
                        <MapView
                            ref={mapRef}
                            style={styles.map}
                            initialRegion={location ? {
                                latitude: location.coords.latitude,
                                longitude: location.coords.longitude,
                                latitudeDelta: 0.05,
                                longitudeDelta: 0.05,
                            } : {
                                latitude: -23.5505,
                                longitude: -46.6333,
                                latitudeDelta: 0.05,
                                longitudeDelta: 0.05,
                            }}
                            showsUserLocation={true}
                            onPoiClick={(e) => {
                                const { coordinate, placeId, name } = e.nativeEvent;
                                const poiPlace: import('@/src/types').Place = {
                                    id: `google_${placeId}`,
                                    name: name,
                                    latitude: coordinate.latitude,
                                    longitude: coordinate.longitude,
                                    vocations: ['Ponto de Interesse'],
                                    frequenters: []
                                };
                                handleOpenPlaceModal(poiPlace);
                            }}
                        >
                            {places.map((place) => (
                                <Marker
                                    key={place.id}
                                    coordinate={{ latitude: place.latitude, longitude: place.longitude }}
                                    onPress={() => handleOpenPlaceModal(place)}
                                    title={place.name}
                                >
                                    <View style={styles.markerContainer}>
                                        <View style={[styles.markerBubble, { borderColor: '#8B5CF6' }]}>
                                            <Ionicons name={place.vocations && place.vocations.length > 0 ? "beer" : "pin"} size={16} color="#8B5CF6" />
                                        </View>
                                        <View style={[styles.markerArrow, { borderTopColor: '#8B5CF6' }]} />
                                    </View>
                                </Marker>
                            ))}
                            {filteredMeetings.map((meeting) => (
                                <Marker
                                    key={meeting.id}
                                    coordinate={{ latitude: meeting.lat!, longitude: meeting.lng! }}
                                    onPress={() => router.push(`/event/${meeting.id}` as any)}
                                    title={meeting.title}
                                    zIndex={isEventLive(meeting.date, meeting.time) ? 100 : 1}
                                >
                                    {isEventLive(meeting.date, meeting.time) ? <PulsingMarker /> : (
                                        <View style={styles.markerContainer}>
                                            <View style={[styles.markerBubble, { borderColor: '#4F46E5' }]}>
                                                <Ionicons name="people" size={16} color="#4F46E5" />
                                            </View>
                                            <View style={[styles.markerArrow, { borderTopColor: '#4F46E5' }]} />
                                        </View>
                                    )}
                                </Marker>
                            ))}
                        </MapView>
                        <View style={styles.mapActions}>
                            <TouchableOpacity style={styles.fab} onPress={() => {
                                if (location && mapRef.current) {
                                    mapRef.current.animateToRegion({
                                        latitude: location.coords.latitude,
                                        longitude: location.coords.longitude,
                                        latitudeDelta: 0.01,
                                        longitudeDelta: 0.01,
                                    }, 1000);
                                }
                            }}>
                                <Ionicons name="navigate" size={24} color="#4F46E5" />
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
            </View>

            <View style={styles.actions}>
                <TouchableOpacity style={styles.createButton} onPress={() => setModalVisible(true)}>
                    <View style={[styles.gradientButton, { backgroundColor: '#4F46E5' }]}>
                        <Ionicons name="add" size={24} color="#fff" />
                        <Text style={styles.createButtonText}>Criar Evento</Text>
                    </View>
                </TouchableOpacity>
            </View>

            <CreateEventModal 
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
                eventType={eventType}
                newMeeting={newMeeting}
                setNewMeeting={setNewMeeting}
                habitDays={habitDays}
                toggleHabitDay={toggleHabitDay}
                onOpenLocationPicker={() => { setModalVisible(false); setPickingLocation(true); }}
                repeatCount={repeatCount}
                setRepeatCount={setRepeatCount}
                selectedPlace={selectedPlace}
                places={places}
            />

            <PlaceModal 
                visible={showPlaceModal}
                onClose={() => setShowPlaceModal(false)}
                place={selectedPlace}
                loadingProfiles={loadingProfiles}
                frequentersProfiles={frequentersProfiles}
                onCreateEventPress={() => {
                    if(selectedPlace) {
                        setNewMeeting({
                            ...newMeeting,
                            locationName: selectedPlace.name,
                            lat: selectedPlace.latitude,
                            lng: selectedPlace.longitude,
                            type: 'in-person',
                            placeId: selectedPlace.id
                        });
                        setModalVisible(true);
                    }
                }}
            />

            <LocationPickerModal 
                visible={pickingLocation}
                onClose={() => {
                    setPickingLocation(false);
                    setModalVisible(true);
                }}
                location={location}
                currentLat={newMeeting.lat}
                currentLng={newMeeting.lng}
                onLocationChange={(lat, lng) => setNewMeeting({...newMeeting, lat, lng})}
            />

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F9FAFB' },
    center: { alignItems: 'center', justifyContent: 'center' },
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
    mapContainer: { flex: 1, width: '100%', height: '100%' },
    map: { width: '100%', height: '100%' },
    mapActions: { position: 'absolute', bottom: 100, right: 20, alignItems: 'center' },
    fab: { backgroundColor: '#fff', width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 4, elevation: 4 },
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
    actions: { position: 'absolute', bottom: 20, right: 20, alignItems: 'center' },
    createButton: { borderRadius: 30, shadowColor: "#4F46E5", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
    gradientButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 30 },
    createButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16, marginLeft: 8 },
    markerContainer: { alignItems: 'center', justifyContent: 'center' },
    markerBubble: { backgroundColor: '#fff', padding: 6, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
    markerArrow: { backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 6, alignSelf: 'center', marginTop: -2, zIndex: 2 },
    pulseRing: { position: 'absolute', width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(239, 68, 68, 0.4)', borderWidth: 2, borderColor: 'rgba(239, 68, 68, 0.8)', top: 0, zIndex: 1 },
    emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
    emptyText: { marginTop: 16, color: '#9CA3AF' }
});
