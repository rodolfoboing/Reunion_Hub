import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image, FlatList, Dimensions, ActivityIndicator, Platform, ScrollView, Switch, Pressable, Modal, Alert, InteractionManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import MapView, { Marker, PROVIDER_GOOGLE, PROVIDER_DEFAULT } from '../../../src/components/MapView';

import { useExploreData } from '@/src/features/explore/hooks/useExploreData';
import { CreateEventModal } from '@/src/features/explore/components/CreateEventModal';
import { PlaceModal } from '@/src/features/explore/components/PlaceModal';
import { LocationPickerModal } from '@/src/features/explore/components/LocationPickerModal';
import { Place, User } from '../../../src/types';
import { doc, getDoc, collection, query, where, getDocs, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../../../src/services/firebaseConfig';
import { hasMatchingInterest, INTERESTS_OPTIONS } from '@/src/constants/Interests';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');

import { normalizeDate } from '@/src/utils/dateUtils';

const isEventLive = (dateStr?: string, timeStr?: string) => {
    if (!dateStr || !timeStr) return false;
    try {
        const normalized = normalizeDate(dateStr) || dateStr;
        const eventDateTime = new Date(`${normalized}T${timeStr}:00`);
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

const hidePoiStyle = [
    {
        featureType: "poi",
        elementType: "labels",
        stylers: [{ visibility: "off" }]
    }
];

const CATEGORY_PALETTE = [
    { bg: '#EEF2FF', text: '#6366F1' }, // indigo
    { bg: '#F5F3FF', text: '#8B5CF6' }, // violeta
    { bg: '#FDF4FF', text: '#A855F7' }, // roxo
    { bg: '#FDF2F8', text: '#EC4899' }, // rosa
    { bg: '#EFF6FF', text: '#3B82F6' }, // azul
    { bg: '#ECFDF5', text: '#10B981' }, // esmeralda
    { bg: '#FFF7ED', text: '#F97316' }, // laranja
    { bg: '#FFFBEB', text: '#D97706' }, // âmbar
    { bg: '#F0FDFA', text: '#14B8A6' }, // teal
    { bg: '#FFF1F2', text: '#F43F5E' }, // rosa-avermelhado
];

const getCategoryColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return CATEGORY_PALETTE[Math.abs(hash) % CATEGORY_PALETTE.length];
};

const getPlaceIconName = (vocations?: string[]): keyof typeof Ionicons.glyphMap => {
    if (!vocations || vocations.length === 0) return 'pin';
    if (vocations.includes('natureza')) return 'leaf';
    if (vocations.includes('esporte')) return 'football';
    if (vocations.includes('exercício')) return 'barbell';
    if (vocations.includes('cultura')) return 'book';
    if (vocations.includes('social')) return 'beer';
    if (vocations.includes('Ponto de Interesse')) return 'location';
    return 'pin';
};

const isEventAtPlace = (place: Place, meetings: import('@/src/types').Meeting[]) => meetings.some((meeting) => {
    if (meeting.type !== 'in-person' || meeting.lat == null || meeting.lng == null) return false;
    if (meeting.placeId === place.id) return true;

    return Math.abs(Number(meeting.lat) - place.latitude) < 0.0001
        && Math.abs(Number(meeting.lng) - place.longitude) < 0.0001;
});

const FILTER_CONFIG: { key: 'events' | 'communityPlaces' | 'osmPlaces' | 'googlePoi'; label: string; icon: any; color: string }[] = [
    { key: 'events', label: 'Eventos', icon: 'calendar', color: '#F59E0B' },
    { key: 'communityPlaces', label: 'Locais da Comunidade', icon: 'people', color: '#6366F1' },
    { key: 'osmPlaces', label: 'Descoberta (OSM)', icon: 'earth', color: '#10B981' },
    { key: 'googlePoi', label: 'Pontos do Google', icon: 'location', color: '#EC4899' },
];

export default function ExploreScreen() {
    const [eventType, setEventType] = useState<'in-person' | 'online'>('in-person');
    const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    // Filtros do Mapa
    const [mapFilters, setMapFilters] = useState({
        events: true,
        communityPlaces: true,
        osmPlaces: false,
        googlePoi: false
    });
    const { location, meetings, places, loading } = useExploreData(mapFilters.osmPlaces);
    const toggleMapFilter = (key: keyof typeof mapFilters) => {
        setMapFilters(prev => ({ ...prev, [key]: !prev[key] }));
    };
    const activeFilterCount = Object.values(mapFilters).filter(Boolean).length;

    const [filtersOpen, setFiltersOpen] = useState(false);
    const [headerHeight, setHeaderHeight] = useState(0);

    const [showMapOnboarding, setShowMapOnboarding] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [repeatCount, setRepeatCount] = useState(0);
    const [pickingLocation, setPickingLocation] = useState(false);
    const [newMeeting, setNewMeeting] = useState({
        title: '', interests: [] as string[], description: '', locationName: '', date: '', time: '',
        lat: 0, lng: 0, type: 'in-person', meetingLink: '', placeId: '',
    });

    const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
    const [showPlaceModal, setShowPlaceModal] = useState(false);
    const [frequentersProfiles, setFrequentersProfiles] = useState<User[]>([]);
    const [loadingProfiles, setLoadingProfiles] = useState(false);

    const mapRef = useRef<any>(null);
    const placeRequestId = useRef(0);
    const isExploreMounted = useRef(true);
    const pendingCreateEventTask = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);

    useEffect(() => {
        isExploreMounted.current = true;
        return () => {
            isExploreMounted.current = false;
            placeRequestId.current += 1;
            pendingCreateEventTask.current?.cancel();
        };
    }, []);

    useEffect(() => {
        if (location && newMeeting.lat === 0) {
            setNewMeeting(prev => ({ ...prev, lat: location.coords.latitude, lng: location.coords.longitude }));
        }
    }, [location]);

    useEffect(() => {
        setFiltersOpen(false);
    }, [viewMode, eventType]);

    useEffect(() => {
        const checkMapFirstTime = async () => {
            try {
                const hasSeen = await AsyncStorage.getItem('@reunionhub_has_seen_map_onboarding');
                if (hasSeen !== 'true') {
                    setShowMapOnboarding(true);
                }
            } catch (e) {
                console.error('[Explore] Erro ao carregar mapa:', e);
            }
        };
        checkMapFirstTime();
    }, []);

    const handleCloseMapOnboarding = async () => {
        try {
            await AsyncStorage.setItem('@reunionhub_has_seen_map_onboarding', 'true');
        } catch(e) {}
        setShowMapOnboarding(false);
    };

    const handleOpenPlaceModal = (place: Place) => {
        const requestId = ++placeRequestId.current;
        setSelectedPlace(place);
        setShowPlaceModal(true);
        setLoadingProfiles(true);
        setFrequentersProfiles([]);

        InteractionManager.runAfterInteractions(() => {
            const loadPlaceDetails = async () => {
                try {
                    let founderName = place.founderName;
                    if (place.founderId && !founderName) {
                        const founderDoc = await getDoc(doc(db, 'users', place.founderId));
                        founderName = founderDoc.data()?.nick || founderDoc.data()?.displayName;
                    }

                    let profiles: User[] = [];
                    if (place.frequenters && place.frequenters.length > 0) {
                        const chunks: string[][] = [];
                        for (let index = 0; index < place.frequenters.length; index += 10) {
                            chunks.push(place.frequenters.slice(index, index + 10));
                        }
                        for (const chunk of chunks) {
                            const profilesQuery = query(collection(db, 'users'), where('__name__', 'in', chunk));
                            const profilesSnapshot = await getDocs(profilesQuery);
                            profiles = [...profiles, ...profilesSnapshot.docs.map((profile) => ({ uid: profile.id, ...profile.data() } as User))];
                        }
                    }

                    if (!isExploreMounted.current || requestId !== placeRequestId.current) return;
                    if (founderName) {
                        setSelectedPlace((currentPlace) => currentPlace?.id === place.id ? { ...currentPlace, founderName } : currentPlace);
                    }
                    setFrequentersProfiles(profiles);
                } catch (error) {
                    if (isExploreMounted.current && requestId === placeRequestId.current) console.error('[Explore] Erro ao carregar detalhes do local:', error);
                } finally {
                    if (isExploreMounted.current && requestId === placeRequestId.current) setLoadingProfiles(false);
                }
            };
            loadPlaceDetails();
        });
    };

    const handleCreateEventAtSelectedPlace = () => {
        if (!selectedPlace) return;
        setNewMeeting({
            ...newMeeting,
            locationName: selectedPlace.name,
            lat: selectedPlace.latitude,
            lng: selectedPlace.longitude,
            type: 'in-person',
            placeId: selectedPlace.id
        });
        setShowPlaceModal(false);
        pendingCreateEventTask.current?.cancel();
        pendingCreateEventTask.current = InteractionManager.runAfterInteractions(() => {
            if (!isExploreMounted.current) return;
            setModalVisible(true);
            pendingCreateEventTask.current = null;
        });
    };

    const handleClosePlaceModal = () => {
        placeRequestId.current += 1;
        setLoadingProfiles(false);
        setShowPlaceModal(false);
    };



    const handleSavePlaceHabit = async (periods: string[]) => {
        if (!selectedPlace || !auth.currentUser) return;
        try {
            const placeRef = doc(db, 'places', selectedPlace.id);
            await setDoc(placeRef, { 
                id: selectedPlace.id, 
                name: selectedPlace.name, 
                latitude: selectedPlace.latitude, 
                longitude: selectedPlace.longitude, 
                vocations: selectedPlace.vocations || [],
                isCommunity: true
            }, { merge: true });
            
            await updateDoc(placeRef, {
                frequenters: arrayUnion(auth.currentUser.uid),
                [`habits.${auth.currentUser.uid}`]: periods
            });
            Alert.alert("Sucesso", "Sua rotina foi salva neste local!");
            setShowPlaceModal(false);
        } catch (error) {
            console.error(error);
            Alert.alert("Erro", "Não foi possível salvar a rotina.");
        }
    };

    const filteredMeetings = meetings.filter(m => {
        if (m.type !== eventType) return false;
        if (selectedCategory && !hasMatchingInterest([m.theme, ...(m.interests || [])], [selectedCategory])) return false;
        return true;
    });

    const visiblePlaces = useMemo(() => places.filter((place) => {
        if (!place.latitude || !place.longitude || isNaN(place.latitude) || isNaN(place.longitude)) return false;
        if (place.isCommunity && !mapFilters.communityPlaces) return false;
        if (!place.isCommunity && !mapFilters.osmPlaces) return false;
        return true;
    }), [places, mapFilters.communityPlaces, mapFilters.osmPlaces]);

    const renderMeetingCard = ({ item }: { item: any }) => (
        <TouchableOpacity style={styles.card} onPress={() => router.push(`/event/${item.id}` as any)}>
            <View style={styles.cardHeader}>
                <View style={styles.tagContainer}><Text style={styles.tagText}>{item.theme || 'Evento'}</Text></View>
                <Text style={styles.dateText}>{item.date ? item.date.split('-').reverse().join('/') : ''} • {item.time}</Text>
            </View>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
            <View style={styles.cardFooter}>
                <View style={styles.locationRow}>
                    <Ionicons name={eventType === 'online' ? "videocam-outline" : "location-outline"} size={16} color="#6B7280" />
                    <Text style={styles.locationText} numberOfLines={1}>{item.locationName}</Text>
                </View>
                {isEventLive(item.date, item.time) && (
                    <View style={styles.liveBadge}>
                        <View style={styles.liveDot} />
                        <Text style={styles.liveText}>Ao vivo</Text>
                    </View>
                )}
            </View>
        </TouchableOpacity>
    );

    if (loading) {
        return (
            <SafeAreaView style={[styles.container, styles.center]}>
                <ActivityIndicator size="large" color="#6366F1" />
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <LinearGradient
                colors={['#6366F1', '#8B5CF6']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.headerContainer}
                onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
            >
                <View style={styles.blobOne} />
                <View style={styles.blobTwo} />
                <View style={styles.headerTop}>
                    <View>
                        <Text style={styles.headerTitle}>Explorar</Text>
                        <Text style={styles.headerSubtitle}>Encontre pessoas e lugares por perto</Text>
                    </View>
                    <View style={styles.headerIconChip}>
                        <Ionicons name="compass" size={20} color="#fff" />
                    </View>
                </View>

                <View style={styles.segmentContainer}>
                    <TouchableOpacity style={[styles.segmentButton, eventType === 'in-person' && styles.segmentButtonActive]} onPress={() => setEventType('in-person')}>
                        <Ionicons name="location-outline" size={15} color={eventType === 'in-person' ? '#6366F1' : 'rgba(255,255,255,0.85)'} />
                        <Text style={[styles.segmentText, eventType === 'in-person' && styles.segmentTextActive]}>Presencial</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.segmentButton, eventType === 'online' && styles.segmentButtonActive]} onPress={() => setEventType('online')}>
                        <Ionicons name="videocam-outline" size={15} color={eventType === 'online' ? '#6366F1' : 'rgba(255,255,255,0.85)'} />
                        <Text style={[styles.segmentText, eventType === 'online' && styles.segmentTextActive]}>Online</Text>
                    </TouchableOpacity>
                </View>

                {eventType === 'in-person' && (
                    <View style={styles.controlsRow}>
                        <View style={styles.viewToggleContainer}>
                            <TouchableOpacity style={[styles.toggleIcon, viewMode === 'map' && styles.toggleIconActive]} onPress={() => setViewMode('map')}>
                                <Ionicons name="map" size={16} color={viewMode === 'map' ? '#6366F1' : 'rgba(255,255,255,0.85)'} />
                                <Text style={[styles.toggleText, viewMode === 'map' && styles.toggleTextActive]}>Mapa</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.toggleIcon, viewMode === 'list' && styles.toggleIconActive]} onPress={() => setViewMode('list')}>
                                <Ionicons name="list" size={16} color={viewMode === 'list' ? '#6366F1' : 'rgba(255,255,255,0.85)'} />
                                <Text style={[styles.toggleText, viewMode === 'list' && styles.toggleTextActive]}>Lista</Text>
                            </TouchableOpacity>
                        </View>

                        {viewMode === 'map' && (
                            <TouchableOpacity
                                style={[styles.filterTriggerBtn, filtersOpen && styles.filterTriggerBtnActive]}
                                onPress={() => setFiltersOpen(v => !v)}
                            >
                                <Ionicons name="options-outline" size={16} color={filtersOpen ? '#6366F1' : '#fff'} />
                                <Text style={[styles.filterTriggerText, filtersOpen && styles.filterTriggerTextActive]}>Filtros</Text>
                                {activeFilterCount > 0 && (
                                    <View style={styles.filterCountBadge}>
                                        <Text style={styles.filterCountText}>{activeFilterCount}</Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        )}
                    </View>
                )}

                <View style={styles.categoriesWrapper}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesScroll}>
                        <TouchableOpacity
                            style={[styles.categoryPill, styles.categoryPillAll, selectedCategory === null && styles.categoryPillAllActive]}
                            onPress={() => setSelectedCategory(null)}
                        >
                            <Ionicons name="apps" size={13} color={selectedCategory === null ? '#fff' : '#6366F1'} style={{ marginRight: 5 }} />
                            <Text style={[styles.categoryText, { color: selectedCategory === null ? '#fff' : '#6366F1' }]}>Todos</Text>
                        </TouchableOpacity>

                        {INTERESTS_OPTIONS.map(category => {
                            const palette = getCategoryColor(category);
                            const isActive = selectedCategory === category;
                            return (
                                <TouchableOpacity
                                    key={category}
                                    style={[styles.categoryPill, { backgroundColor: isActive ? palette.text : palette.bg }]}
                                    onPress={() => setSelectedCategory(isActive ? null : category)}
                                >
                                    {!isActive && <View style={[styles.categoryDot, { backgroundColor: palette.text }]} />}
                                    <Text style={[styles.categoryText, { color: isActive ? '#fff' : palette.text }]}>
                                        {category}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>
            </LinearGradient>

            {filtersOpen && (
                <>
                    <Pressable
                        style={styles.filtersDismissOverlay}
                        onPress={() => setFiltersOpen(false)}
                    />
                    <View style={[styles.filtersPanel, { top: headerHeight + 8 }]}>
                        <Text style={styles.filtersPanelTitle}>O que mostrar no mapa</Text>
                        {FILTER_CONFIG.map((f) => (
                            <View key={f.key} style={styles.filterRow}>
                                <View style={styles.filterRowLeft}>
                                    <View style={[styles.filterIconChip, { backgroundColor: `${f.color}1A` }]}>
                                        <Ionicons name={f.icon} size={14} color={f.color} />
                                    </View>
                                    <Text style={styles.filterRowLabel}>{f.label}</Text>
                                </View>
                                <Switch
                                    value={mapFilters[f.key]}
                                    onValueChange={() => toggleMapFilter(f.key)}
                                    trackColor={{ false: '#E5E7EB', true: f.color }}
                                    thumbColor="#fff"
                                    ios_backgroundColor="#E5E7EB"
                                />
                            </View>
                        ))}
                    </View>
                </>
            )}

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
                                <Ionicons name="calendar-outline" size={40} color="#C7CCF0" />
                                <Text style={styles.emptyText}>Nenhum evento encontrado.</Text>
                            </View>
                        }
                    />
                ) : (
                    <View style={styles.mapContainer}>
                        <MapView
                            ref={mapRef}
                            style={styles.map}
                            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
                            customMapStyle={mapFilters.googlePoi ? [] : hidePoiStyle}
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
                            showsPointsOfInterest={mapFilters.googlePoi}
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
                            {visiblePlaces.map((place) => {
                                const hasActiveEvent = isEventAtPlace(place, meetings);
                                const isOsmPlace = place.id.startsWith('osm_');
                                const markerColor = hasActiveEvent ? '#2563EB' : (isOsmPlace ? '#10B981' : '#8B5CF6');
                                const markerIcon = hasActiveEvent ? 'calendar' : getPlaceIconName(place.vocations);
                                return (
                                <Marker
                                    key={place.id}
                                    coordinate={{ latitude: Number(place.latitude), longitude: Number(place.longitude) }}
                                    onPress={() => handleOpenPlaceModal(place)}
                                    title={place.name}
                                >
                                    <View style={styles.markerContainer}>
                                        <View style={[styles.markerBubble, { borderColor: markerColor }]}>
                                            <Ionicons name={markerIcon} size={16} color={markerColor} />
                                        </View>
                                        <View style={[styles.markerArrow, { borderTopColor: markerColor }]} />
                                    </View>
                                </Marker>
                                );
                            })}
                            {mapFilters.events && filteredMeetings.filter((m) => m.lat != null && m.lng != null && !isNaN(Number(m.lat)) && !isNaN(Number(m.lng))).map((meeting) => (
                                <Marker
                                    key={meeting.id}
                                    coordinate={{ latitude: Number(meeting.lat), longitude: Number(meeting.lng) }}
                                    onPress={() => router.push(`/event/${meeting.id}` as any)}
                                    title={meeting.title}
                                    zIndex={isEventLive(meeting.date, meeting.time) ? 100 : 1}
                                >
                                    {isEventLive(meeting.date, meeting.time) ? <PulsingMarker /> : (
                                        <View style={styles.markerContainer}>
                                            <View style={[styles.markerBubble, { borderColor: '#6366F1' }]}>
                                                <Ionicons name="people" size={16} color="#6366F1" />
                                            </View>
                                            <View style={[styles.markerArrow, { borderTopColor: '#6366F1' }]} />
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
                                <Ionicons name="navigate" size={22} color="#6366F1" />
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
            </View>

            <View style={styles.actions}>
                <TouchableOpacity style={styles.createButton} onPress={() => setModalVisible(true)} activeOpacity={0.85}>
                    <LinearGradient
                        colors={['#6366F1', '#8B5CF6']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.gradientButton}
                    >
                        <Ionicons name="add" size={22} color="#fff" />
                        <Text style={styles.createButtonText}>Criar Evento</Text>
                    </LinearGradient>
                </TouchableOpacity>
            </View>

            <CreateEventModal
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
                eventType={eventType}
                newMeeting={newMeeting}
                setNewMeeting={setNewMeeting}
                onOpenLocationPicker={() => { setModalVisible(false); setPickingLocation(true); }}
                repeatCount={repeatCount}
                setRepeatCount={setRepeatCount}
                selectedPlace={selectedPlace}
                places={places}
            />

            <PlaceModal
                visible={showPlaceModal}
                onClose={handleClosePlaceModal}
                place={selectedPlace}
                loadingProfiles={loadingProfiles}
                frequentersProfiles={frequentersProfiles}
                placeEvents={selectedPlace ? meetings.filter(m => 
                    m.placeId === selectedPlace.id || 
                    (Math.abs(Number(m.lat) - selectedPlace.latitude) < 0.0001 && Math.abs(Number(m.lng) - selectedPlace.longitude) < 0.0001)
                ) : []}
                onSaveHabit={handleSavePlaceHabit}
                onCreateEventPress={handleCreateEventAtSelectedPlace}
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

            <Modal visible={showMapOnboarding} transparent={true} animationType="fade">
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
                    <View style={{ width: '80%', backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center' }}>
                        <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: '#e0e7ff', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                            <FontAwesome name="map" size={24} color="#4f46e5" />
                        </View>
                        <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#1f2937', marginBottom: 12, textAlign: 'center' }}>
                            Explorar Eventos e Locais
                        </Text>
                        <Text style={{ fontSize: 14, color: '#4b5563', textAlign: 'center', lineHeight: 22, marginBottom: 20 }}>
                            Use os filtros acima para ver eventos da comunidade ou ative as marcações de Locais Vagos (banco do Google Maps e Overpass) para conhecer novos lugares!
                        </Text>
                        <TouchableOpacity 
                            onPress={handleCloseMapOnboarding} 
                            style={{ backgroundColor: '#6366f1', paddingVertical: 12, paddingHorizontal: 32, borderRadius: 30, width: '100%', alignItems: 'center' }}
                        >
                            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>Entendi</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F9FAFB' },
    center: { alignItems: 'center', justifyContent: 'center' },
    headerContainer: {
        paddingBottom: 25,
        borderBottomLeftRadius: 30,
        borderBottomRightRadius: 30,
        overflow: 'hidden',
        shadowColor: '#4B4B76',
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 5,
        zIndex: 10,
    },
    blobOne: { position: 'absolute', top: -50, right: -20, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,255,255,0.1)' },
    blobTwo: { position: 'absolute', bottom: -50, left: -20, width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.1)' },
    headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 15 },
    headerTitle: { fontSize: 28, fontWeight: '900', color: '#fff' },
    headerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
    headerIconChip: { backgroundColor: 'rgba(255,255,255,0.2)', padding: 8, borderRadius: 12 },
    segmentContainer: { flexDirection: 'row', marginHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 12, padding: 4, marginBottom: 10, gap: 4 },
    segmentButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
    segmentButtonActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
    segmentText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '700' },
    segmentTextActive: { color: '#6366F1' },

    controlsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, marginTop: 2, marginBottom: 8 },
    viewToggleContainer: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 16, padding: 4 },
    toggleIcon: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12 },
    toggleIconActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
    toggleText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
    toggleTextActive: { color: '#6366F1' },

    filterTriggerBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 14, paddingVertical: 9,
        borderRadius: 16, position: 'relative',
    },
    filterTriggerBtnActive: { backgroundColor: '#fff' },
    filterTriggerText: { fontSize: 13, fontWeight: '700', color: '#fff' },
    filterTriggerTextActive: { color: '#6366F1' },
    filterCountBadge: {
        position: 'absolute', top: -5, right: -5, minWidth: 17, height: 17, borderRadius: 9,
        backgroundColor: '#EF4444', borderWidth: 1.5, borderColor: '#fff',
        justifyContent: 'center', alignItems: 'center', paddingHorizontal: 2,
    },
    filterCountText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },

    filtersDismissOverlay: {
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40,
    },
    filtersPanel: {
        position: 'absolute', right: 20, width: 250,
        backgroundColor: '#fff', borderRadius: 20, padding: 18,
        shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20,
        shadowOffset: { width: 0, height: 10 }, elevation: 12, zIndex: 50,
    },
    filtersPanelTitle: { fontSize: 11, fontWeight: '800', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
    filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
    filterRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, paddingRight: 8 },
    filterIconChip: { width: 28, height: 28, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
    filterRowLabel: { fontSize: 13, fontWeight: '600', color: '#374151', flexShrink: 1 },

    categoriesWrapper: { paddingLeft: 20, paddingBottom: 6 },
    categoriesScroll: { paddingRight: 40, gap: 10, alignItems: 'center' },
    categoryPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
    categoryPillAll: { backgroundColor: '#EEF2FF' },
    categoryPillAllActive: { backgroundColor: '#6366F1' },
    categoryText: { fontSize: 12, fontWeight: '700' },
    categoryDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },

    content: { flex: 1 },
    mapContainer: { flex: 1, width: '100%', height: '100%' },
    map: { width: '100%', height: '100%' },
    mapActions: { position: 'absolute', bottom: 100, right: 20, alignItems: 'center' },
    fab: { backgroundColor: '#fff', width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center', marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, elevation: 4 },
    listContent: { padding: 20, paddingBottom: 110 },
    card: {
        backgroundColor: '#fff', borderRadius: 18, padding: 16, marginBottom: 12,
        borderWidth: 1, borderColor: '#F0F1F8',
        shadowColor: '#4B4B76', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    tagContainer: { backgroundColor: '#EEF2FF', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
    tagText: { fontSize: 11, color: '#6366F1', fontWeight: '700', textTransform: 'uppercase' },
    dateText: { fontSize: 12, color: '#6B7280' },
    cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#1F2937', marginBottom: 10 },
    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    locationRow: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 },
    locationText: { fontSize: 13, color: '#4B5563', flexShrink: 1 },
    liveBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, gap: 5 },
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' },
    liveText: { fontSize: 11, color: '#EF4444', fontWeight: 'bold' },
    actions: { position: 'absolute', bottom: 20, right: 20, alignItems: 'center' },
    createButton: { borderRadius: 30, shadowColor: "#6366F1", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8 },
    gradientButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 20, borderRadius: 30 },
    createButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15, marginLeft: 8 },
    markerContainer: { alignItems: 'center', justifyContent: 'center' },
    markerBubble: { backgroundColor: '#fff', padding: 6, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
    markerArrow: { backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 6, alignSelf: 'center', marginTop: -2, zIndex: 2 },
    pulseRing: { position: 'absolute', width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(239, 68, 68, 0.4)', borderWidth: 2, borderColor: 'rgba(239, 68, 68, 0.8)', top: 0, zIndex: 1 },
    emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 10 },
    emptyText: { color: '#9CA3AF' }
});
