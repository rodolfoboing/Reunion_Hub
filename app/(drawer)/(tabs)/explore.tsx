import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, FlatList, Dimensions, ActivityIndicator, Platform, ScrollView, Switch, Pressable, Modal, Alert, InteractionManager, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import MapView, { Marker, PROVIDER_GOOGLE, PROVIDER_DEFAULT } from '../../../src/components/MapView';

import { useExploreData } from '@/src/features/explore/hooks/useExploreData';
import { CreateEventModal } from '@/src/features/explore/components/CreateEventModal';
import { PlaceModal } from '@/src/features/explore/components/PlaceModal';
import { LocationPickerModal } from '@/src/features/explore/components/LocationPickerModal';
import { EventInviteModal } from '@/src/features/events/components/EventInviteModal';
import { CreateMeetingDraft, HabitSchedule, HabitWeekday, Meeting, Place, User } from '../../../src/types';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../../../src/services/firebaseConfig';
import { functions } from '../../../src/services/firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import { hasMatchingInterest, INTERESTS_OPTIONS, normalizeInterests } from '@/src/constants/Interests';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');

type StoredMapRegion = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
const LAST_MAP_REGION_KEY = '@reunionhub_last_map_region';
const MAP_FILTERS_KEY = '@reunionhub_map_filters';

type MapFilters = { events: boolean; communityPlaces: boolean; osmPlaces: boolean; googlePoi: boolean };

/**
 * Padrão de instalação nova. Tudo ligado, EXCETO a Descoberta (OSM): ela consulta
 * a Overpass, uma API comunitária gratuita com limite de taxa, e o cache é só de
 * sessão — ligada para todos por padrão, multiplicaria o tráfego contra um
 * serviço que pode nos bloquear. Fica como opt-in consciente do usuário.
 * Os Pontos do Google são só estilo do mapa, sem custo, então vêm ligados.
 */
const DEFAULT_MAP_FILTERS: MapFilters = {
    events: true,
    communityPlaces: true,
    osmPlaces: false,
    googlePoi: true,
};

function parseStoredMapFilters(raw: string | null): MapFilters {
    if (!raw) return DEFAULT_MAP_FILTERS;
    try {
        const stored: unknown = JSON.parse(raw);
        if (typeof stored !== 'object' || stored === null) return DEFAULT_MAP_FILTERS;
        const record = stored as Record<string, unknown>;
        // Campo a campo: uma chave nova adicionada numa versão futura assume o
        // padrão em vez de virar `undefined` e desligar o filtro sem querer.
        return {
            events: typeof record.events === 'boolean' ? record.events : DEFAULT_MAP_FILTERS.events,
            communityPlaces: typeof record.communityPlaces === 'boolean' ? record.communityPlaces : DEFAULT_MAP_FILTERS.communityPlaces,
            osmPlaces: typeof record.osmPlaces === 'boolean' ? record.osmPlaces : DEFAULT_MAP_FILTERS.osmPlaces,
            googlePoi: typeof record.googlePoi === 'boolean' ? record.googlePoi : DEFAULT_MAP_FILTERS.googlePoi,
        };
    } catch {
        return DEFAULT_MAP_FILTERS;
    }
}
const DEFAULT_MAP_REGION: StoredMapRegion = { latitude: -23.5505, longitude: -46.6333, latitudeDelta: 0.05, longitudeDelta: 0.05 };

function regionSearchKey(region: StoredMapRegion): string {
    return `${region.latitude.toFixed(2)}:${region.longitude.toFixed(2)}:${region.latitudeDelta.toFixed(2)}:${region.longitudeDelta.toFixed(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function getFirebaseErrorCode(error: unknown): string {
    if (!isRecord(error) || typeof error.code !== 'string') return 'unknown';
    return error.code;
}

const HABIT_WEEKDAYS: HabitWeekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function parseHabitSchedule(value: unknown): HabitSchedule | undefined {
    if (!isRecord(value)) return undefined;
    const schedule: HabitSchedule = {};
    HABIT_WEEKDAYS.forEach((weekday) => {
        const periods = value[weekday];
        if (Array.isArray(periods)) {
            const validPeriods = periods.filter((period): period is string => typeof period === 'string');
            if (validPeriods.length > 0) schedule[weekday] = validPeriods;
        }
    });
    return Object.keys(schedule).length > 0 ? schedule : undefined;
}

function parseStoredMapRegion(value: string): StoredMapRegion | null {
    try {
        const parsed: unknown = JSON.parse(value);
        if (!isRecord(parsed)) return null;
        const latitude = typeof parsed.latitude === 'number' ? parsed.latitude : NaN;
        const longitude = typeof parsed.longitude === 'number' ? parsed.longitude : NaN;
        const latitudeDelta = typeof parsed.latitudeDelta === 'number' ? parsed.latitudeDelta : NaN;
        const longitudeDelta = typeof parsed.longitudeDelta === 'number' ? parsed.longitudeDelta : NaN;
        return [latitude, longitude, latitudeDelta, longitudeDelta].every(Number.isFinite)
            ? { latitude, longitude, latitudeDelta, longitudeDelta }
            : null;
    } catch {
        return null;
    }
}

import { useEventClock } from '@/src/hooks/useEventClock';
import { DISCOVERY_REASON_BADGE_LABELS, getDiscoveryBadgeReason, getEventDiscovery, isNewMeeting, shouldSuggestEvent } from '@/src/utils/eventDiscovery';
import { getDistanceFromLatLonInKm } from '@/src/utils/distance';
import { getEventJourneyState, hasEventEnded } from '@/src/utils/eventSchedule';
import { ErrorState } from '@/src/components/ErrorState';
import { getTodayStr, normalizeDate } from '@/src/utils/dateUtils';
import { toUserProfile } from '@/src/utils/userProfile';

// PNGs locais são renderizados nativamente pelo mapa. Não use componentes React
// como filhos de Marker: no Android + Fabric eles podem ser fotografados antes
// de terminar a medição, gerando pontos minúsculos ou imagens recortadas.
const MAP_MARKER_IMAGES = {
    events: {
        general: {
            normal: require('../../../assets/map-markers/event-general.png'),
            liveOn: require('../../../assets/map-markers/event-general-live-on.png'),
            liveOff: require('../../../assets/map-markers/event-general-live-off.png'),
            popularOn: require('../../../assets/map-markers/event-general-popular-on.png'),
            popularOff: require('../../../assets/map-markers/event-general-popular-off.png'),
        },
        social: {
            normal: require('../../../assets/map-markers/event-social.png'),
            liveOn: require('../../../assets/map-markers/event-social-live-on.png'),
            liveOff: require('../../../assets/map-markers/event-social-live-off.png'),
            popularOn: require('../../../assets/map-markers/event-social-popular-on.png'),
            popularOff: require('../../../assets/map-markers/event-social-popular-off.png'),
        },
        sports: {
            normal: require('../../../assets/map-markers/event-sports.png'),
            liveOn: require('../../../assets/map-markers/event-sports-live-on.png'),
            liveOff: require('../../../assets/map-markers/event-sports-live-off.png'),
            popularOn: require('../../../assets/map-markers/event-sports-popular-on.png'),
            popularOff: require('../../../assets/map-markers/event-sports-popular-off.png'),
        },
        games: {
            normal: require('../../../assets/map-markers/event-games.png'),
            liveOn: require('../../../assets/map-markers/event-games-live-on.png'),
            liveOff: require('../../../assets/map-markers/event-games-live-off.png'),
            popularOn: require('../../../assets/map-markers/event-games-popular-on.png'),
            popularOff: require('../../../assets/map-markers/event-games-popular-off.png'),
        },
        study: {
            normal: require('../../../assets/map-markers/event-study.png'),
            liveOn: require('../../../assets/map-markers/event-study-live-on.png'),
            liveOff: require('../../../assets/map-markers/event-study-live-off.png'),
            popularOn: require('../../../assets/map-markers/event-study-popular-on.png'),
            popularOff: require('../../../assets/map-markers/event-study-popular-off.png'),
        },
        culture: {
            normal: require('../../../assets/map-markers/event-culture.png'),
            liveOn: require('../../../assets/map-markers/event-culture-live-on.png'),
            liveOff: require('../../../assets/map-markers/event-culture-live-off.png'),
            popularOn: require('../../../assets/map-markers/event-culture-popular-on.png'),
            popularOff: require('../../../assets/map-markers/event-culture-popular-off.png'),
        },
        technology: {
            normal: require('../../../assets/map-markers/event-technology.png'),
            liveOn: require('../../../assets/map-markers/event-technology-live-on.png'),
            liveOff: require('../../../assets/map-markers/event-technology-live-off.png'),
            popularOn: require('../../../assets/map-markers/event-technology-popular-on.png'),
            popularOff: require('../../../assets/map-markers/event-technology-popular-off.png'),
        },
        nature: {
            normal: require('../../../assets/map-markers/event-nature.png'),
            liveOn: require('../../../assets/map-markers/event-nature-live-on.png'),
            liveOff: require('../../../assets/map-markers/event-nature-live-off.png'),
            popularOn: require('../../../assets/map-markers/event-nature-popular-on.png'),
            popularOff: require('../../../assets/map-markers/event-nature-popular-off.png'),
        },
    },
    place: require('../../../assets/map-markers/place.png'),
    community: require('../../../assets/map-markers/place-community.png'),
    discovered: require('../../../assets/map-markers/place-discovered.png'),
    osm: require('../../../assets/map-markers/place-osm.png'),
} as const;

type EventMarkerCategory = keyof typeof MAP_MARKER_IMAGES.events;

const normalizeMarkerText = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

// Mapa direto interesse -> \u00edcone. A taxonomia \u00e9 FECHADA (INTERESTS_OPTIONS) e o
// `theme` \u00e9 sempre normalizedInterests[0], ent\u00e3o casar por palavra-chave de texto
// livre era a ferramenta errada: 11 dos 19 interesses ca\u00edam em 'general' e os
// conjuntos social/study/nature nunca chegavam a ser usados.
// Chaves sem acento e em min\u00fasculas (mesma normaliza\u00e7\u00e3o de normalizeMarkerText),
// para n\u00e3o depender de como o acento est\u00e1 gravado no arquivo.
// Interesse novo em INTERESTS_OPTIONS precisa de uma linha aqui \u2014 sen\u00e3o cai em 'general'.
const INTEREST_MARKER_CATEGORY: Record<string, EventMarkerCategory> = {
    'tecnologia & inovacao': 'technology',
    'negocios & carreira': 'social',
    'festas & shows': 'social',
    'musica': 'culture',
    'danca': 'culture',
    'saude & bem-estar': 'sports',
    'gastronomia': 'social',
    'artes & cultura': 'culture',
    'esportes': 'sports',
    'educacao & workshops': 'study',
    'networking': 'social',
    'cinema & teatro': 'culture',
    'religiao & espiritualidade': 'social',
    'games & geek': 'games',
    'jogos digitais': 'games',
    'sustentabilidade': 'nature',
    'animais de estimacao': 'nature',
    'literatura': 'study',
    'filosofia': 'study',
};

const getEventMarkerCategory = (meeting: Pick<Meeting, 'theme' | 'interests'>): EventMarkerCategory => {
    // normalizeInterests converte os aliases legados (\u00a710) para a taxonomia atual,
    // ent\u00e3o eventos antigos continuam recebendo o \u00edcone certo.
    const canonicalInterests = normalizeInterests([meeting.theme, ...(meeting.interests || [])]);
    for (const interest of canonicalInterests) {
        const category = INTEREST_MARKER_CATEGORY[normalizeMarkerText(interest)];
        if (category) return category;
    }
    return 'general';
};

const getEventMarkerImage = (meeting: Pick<Meeting, 'theme' | 'interests'>, isLive: boolean, isHighlighted: boolean, blinkOn: boolean) => {
    const categoryImages = MAP_MARKER_IMAGES.events[getEventMarkerCategory(meeting)];
    if (isLive) return blinkOn ? categoryImages.liveOn : categoryImages.liveOff;
    if (isHighlighted) return blinkOn ? categoryImages.popularOn : categoryImages.popularOff;
    return categoryImages.normal;
};

const hideGooglePoiStyle = [
    {
        featureType: "poi",
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

const isMeetingAtPlace = (place: Place, meeting: Meeting) => {
    if (meeting.type !== 'in-person' || meeting.lat == null || meeting.lng == null) return false;
    if (meeting.placeId === place.id) return true;

    return Math.abs(Number(meeting.lat) - place.latitude) < 0.0001
        && Math.abs(Number(meeting.lng) - place.longitude) < 0.0001;
};

const FILTER_CONFIG: { key: 'events' | 'communityPlaces' | 'osmPlaces' | 'googlePoi'; label: string; icon: any; color: string }[] = [
    { key: 'events', label: 'Eventos', icon: 'calendar', color: '#F59E0B' },
    { key: 'communityPlaces', label: 'Locais da Comunidade', icon: 'people', color: '#6366F1' },
    { key: 'osmPlaces', label: 'Descoberta (OSM)', icon: 'earth', color: '#10B981' },
    { key: 'googlePoi', label: 'Pontos do Google', icon: 'location', color: '#EC4899' },
];

export default function ExploreScreen() {
    const eventClock = useEventClock();
    const isFocused = useIsFocused();
    const { createEvent, date: requestedEventDate, requestKey } = useLocalSearchParams<{
        createEvent?: string;
        date?: string;
        requestKey?: string;
    }>();
    const [eventType, setEventType] = useState<'in-person' | 'online'>('in-person');
    const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [userInterests, setUserInterests] = useState<string[]>([]);
    const [showPopularOutsideInterests, setShowPopularOutsideInterests] = useState(true);

    // Filtros do Mapa — a escolha do usuário é gravada e vale até ele mudar.
    const [mapFilters, setMapFilters] = useState<MapFilters>(DEFAULT_MAP_FILTERS);
    const [mapInitialRegion, setMapInitialRegion] = useState<StoredMapRegion>(DEFAULT_MAP_REGION);
    const [searchRegion, setSearchRegion] = useState<StoredMapRegion>(DEFAULT_MAP_REGION);
    const [storedRegionStatus, setStoredRegionStatus] = useState<'loading' | 'available' | 'missing'>('loading');
    const mapActive = isFocused && eventType === 'in-person' && viewMode === 'map';
    const {
        location,
        locationStatus,
        locationIssue,
        canAskLocationPermissionAgain,
        meetings,
        places,
        loading,
        error,
        placesError,
        osmError,
        osmLoading,
        retry,
        retryLocation,
        refreshPlace,
    } = useExploreData(mapFilters.osmPlaces, mapFilters.communityPlaces, isFocused, mapActive, searchRegion);
    const locationWarningText = locationIssue === 'permission-denied'
        ? canAskLocationPermissionAgain
            ? 'Permita o acesso à localização e toque para tentar novamente.'
            : 'A permissão de localização está bloqueada. Toque para abrir as configurações.'
        : locationIssue === 'services-disabled'
            ? 'O GPS está desativado. Toque para ativar e tentar novamente.'
            : 'Não foi possível obter sua posição. Vá para uma área aberta e tente novamente.';
    const handleLocationRecovery = () => {
        if (locationIssue === 'permission-denied' && !canAskLocationPermissionAgain) {
            Linking.openSettings().catch(() => {
                console.warn('[Explore] app_settings_open_failed');
            });
            return;
        }
        void retryLocation();
    };
    // Grava dentro do próprio toggle, que é o único ponto de mutação: um effect
    // sobre `mapFilters` também gravaria o padrão logo após a carga, apagando a
    // escolha do usuário caso a leitura falhasse.
    const persistMapFilters = (next: MapFilters) => {
        AsyncStorage.setItem(MAP_FILTERS_KEY, JSON.stringify(next)).catch(() => {
            console.warn('[Explore] map_filters_save_failed');
        });
    };
    const toggleMapFilter = (key: keyof MapFilters) => {
        setMapFilters((prev) => {
            const next = { ...prev, [key]: !prev[key] };
            persistMapFilters(next);
            return next;
        });
    };
    const restoreDefaultMapFilters = () => {
        setMapFilters(DEFAULT_MAP_FILTERS);
        persistMapFilters(DEFAULT_MAP_FILTERS);
    };
    // O selo do botão indica que o usuário MUDOU algo, não quantos filtros estão
    // ligados: contar os ativos marcava uma instalação nova como "filtrada",
    // porque a Descoberta (OSM) nasce desligada de propósito.
    const changedFilterCount = (Object.keys(DEFAULT_MAP_FILTERS) as (keyof MapFilters)[])
        .filter((key) => mapFilters[key] !== DEFAULT_MAP_FILTERS[key]).length;

    const [filtersOpen, setFiltersOpen] = useState(false);
    const [headerHeight, setHeaderHeight] = useState(0);

    const [showMapOnboarding, setShowMapOnboarding] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [createdEventIdForInvite, setCreatedEventIdForInvite] = useState<string | null>(null);
    const [repeatCount, setRepeatCount] = useState(0);
    const [repeatStartDate, setRepeatStartDate] = useState('');
    const [pickingLocation, setPickingLocation] = useState(false);
    const [newMeeting, setNewMeeting] = useState<CreateMeetingDraft>({
        title: '', interests: [] as string[], description: '', locationName: '', date: '', time: '', endDate: '', endTime: '',
        lat: 0, lng: 0, type: 'in-person', meetingLink: '', placeId: '',
    });

    const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
    const [showPlaceModal, setShowPlaceModal] = useState(false);
    const [frequentersProfiles, setFrequentersProfiles] = useState<User[]>([]);
    const [loadingProfiles, setLoadingProfiles] = useState(false);

    // Carga única da preferência gravada. A Descoberta (OSM) nasce desligada, então
    // nada é buscado antes desta leitura: se o usuário a tiver ligado, a busca começa
    // ao chegar aqui, sem nenhuma consulta desperdiçada no meio.
    useEffect(() => {
        let cancelled = false;
        AsyncStorage.getItem(MAP_FILTERS_KEY)
            .then((raw) => {
                if (!cancelled) setMapFilters(parseStoredMapFilters(raw));
            })
            .catch(() => {
                console.warn('[Explore] map_filters_load_failed');
            });
        return () => { cancelled = true; };
    }, []);

    const mapRef = useRef<any>(null);
    const placeRequestId = useRef(0);
    const isExploreMounted = useRef(true);
    const pendingCreateEventTask = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);
    const handledCalendarCreateRequest = useRef<string | null>(null);
    const regionSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        isExploreMounted.current = true;
        return () => {
            isExploreMounted.current = false;
            placeRequestId.current += 1;
            pendingCreateEventTask.current?.cancel();
            if (regionSearchTimer.current) clearTimeout(regionSearchTimer.current);
        };
    }, []);

    useEffect(() => {
        AsyncStorage.getItem(LAST_MAP_REGION_KEY).then((storedRegion) => {
            if (!storedRegion) {
                setStoredRegionStatus('missing');
                return;
            }
            const region = parseStoredMapRegion(storedRegion);
            if (region) {
                setMapInitialRegion(region);
                setSearchRegion(region);
                setStoredRegionStatus('available');
            }
            else {
                console.warn('[Explore] last_map_region_invalid');
                setStoredRegionStatus('missing');
            }
        }).catch(() => {
            console.warn('[Explore] last_map_region_load_failed');
            setStoredRegionStatus('missing');
        });
    }, []);

    useEffect(() => {
        if (storedRegionStatus !== 'missing' || !location) return;
        const currentRegion: StoredMapRegion = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
        };
        setMapInitialRegion(currentRegion);
        setSearchRegion(currentRegion);
        setStoredRegionStatus('available');
        AsyncStorage.setItem(LAST_MAP_REGION_KEY, JSON.stringify(currentRegion)).catch(() => {
            console.warn('[Explore] initial_location_region_save_failed');
        });
    }, [location, storedRegionStatus]);

    useEffect(() => {
        if (!isFocused || createEvent !== '1' || typeof requestedEventDate !== 'string') return;
        const normalizedDate = normalizeDate(requestedEventDate);
        const operationKey = `${requestKey || 'calendar'}:${requestedEventDate}`;
        if (handledCalendarCreateRequest.current === operationKey) return;
        handledCalendarCreateRequest.current = operationKey;

        router.setParams({ createEvent: '', date: '', requestKey: '' });
        if (!normalizedDate || normalizedDate <= getTodayStr()) {
            console.warn('[Explore] calendar_create_date_invalid');
            return;
        }

        setShowMapOnboarding(false);
        pendingCreateEventTask.current?.cancel();
        pendingCreateEventTask.current = InteractionManager.runAfterInteractions(() => {
            if (!isExploreMounted.current) return;
            setNewMeeting((current) => ({
                ...current,
                date: normalizedDate,
                endDate: normalizedDate,
                type: eventType,
            }));
            setModalVisible(true);
            pendingCreateEventTask.current = null;
        });
    }, [createEvent, eventType, isFocused, requestKey, requestedEventDate]);

    // Uma leitura pontual ao focar a tela mantém os interesses alinhados ao perfil
    // sem sustentar outro listener do Firestore durante o uso do mapa.
    useEffect(() => {
        if (!isFocused) return;
        const currentUid = auth.currentUser?.uid;
        if (!currentUid) return;

        let active = true;
        getDoc(doc(db, 'users', currentUid)).then((snapshot) => {
            if (active && snapshot.exists()) {
                // Mesma leitura que já era feita: aproveita o documento para trazer
                // também a preferência, sem custo adicional de Firestore.
                setUserInterests(normalizeInterests(snapshot.data().interests));
                setShowPopularOutsideInterests(snapshot.data().showPopularOutsideInterests !== false);
            }
        }).catch((error) => {
            if (__DEV__) console.warn('[Explore] user_interests_load_failed', error);
        });

        return () => {
            active = false;
        };
    }, [isFocused]);

    const handleMapRegionChange = (region: StoredMapRegion) => {
        AsyncStorage.setItem(LAST_MAP_REGION_KEY, JSON.stringify(region)).catch(() => {
            console.warn('[Explore] last_map_region_save_failed');
        });
        if (regionSearchTimer.current) clearTimeout(regionSearchTimer.current);
        regionSearchTimer.current = setTimeout(() => {
            setSearchRegion((currentRegion) => regionSearchKey(currentRegion) === regionSearchKey(region) ? currentRegion : region);
            regionSearchTimer.current = null;
        }, 700);
    };

    useEffect(() => {
        setFiltersOpen(false);
    }, [viewMode, eventType]);

    useEffect(() => {
        const checkMapFirstTime = async () => {
            if (createEvent === '1' || handledCalendarCreateRequest.current !== null) return;
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
    }, [createEvent]);

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

                    let discovererName = place.discovererName;
                    if (place.discovererId && !discovererName) {
                        const discovererDoc = await getDoc(doc(db, 'users', place.discovererId));
                        discovererName = discovererDoc.data()?.nick || discovererDoc.data()?.displayName;
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
                            profiles = [
                                ...profiles,
                                ...profilesSnapshot.docs
                                    .map((profile) => toUserProfile(profile.id, profile.data())),
                            ];
                        }
                    }

                    let currentUserHabitSchedule: HabitSchedule | undefined;
                    const currentUserId = auth.currentUser?.uid;
                    if (currentUserId) {
                        const privateHabit = await getDoc(doc(db, 'users', currentUserId, 'placeHabits', place.id));
                        currentUserHabitSchedule = privateHabit.exists()
                            ? parseHabitSchedule(privateHabit.data()?.schedule)
                            : undefined;
                    }

                    if (!isExploreMounted.current || requestId !== placeRequestId.current) return;
                    if (founderName || discovererName) {
                        setSelectedPlace((currentPlace) => currentPlace?.id === place.id
                            ? {
                                ...currentPlace,
                                founderName,
                                discovererName,
                                currentUserHabitSchedule,
                                isCurrentUserFrequenting: Boolean(currentUserHabitSchedule),
                            }
                            : currentPlace);
                    } else if (currentUserHabitSchedule) {
                        setSelectedPlace((currentPlace) => currentPlace?.id === place.id
                            ? { ...currentPlace, currentUserHabitSchedule, isCurrentUserFrequenting: true }
                            : currentPlace);
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
        // Funcional: o spread do estado capturado no render descartava qualquer
        // alteração feita entre a renderização e este toque — data e hora inclusive.
        setNewMeeting((current) => ({
            ...current,
            locationName: selectedPlace.name,
            lat: selectedPlace.latitude,
            lng: selectedPlace.longitude,
            type: 'in-person',
            placeId: selectedPlace.id,
        }));
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



    const handleSavePlaceHabit = async (schedule: import('@/src/types').HabitSchedule) => {
        if (!selectedPlace || !auth.currentUser) return;
        try {
            await httpsCallable(functions, 'savePlaceHabit')({
                placeId: selectedPlace.id,
                name: selectedPlace.name,
                latitude: selectedPlace.latitude,
                longitude: selectedPlace.longitude,
                vocations: selectedPlace.vocations || [],
                schedule,
            });
            const currentUserId = auth.currentUser.uid;
            const [refreshedPlace, currentUserSnapshot] = await Promise.all([
                refreshPlace(selectedPlace.id),
                getDoc(doc(db, 'users', currentUserId)),
            ]);
            if (refreshedPlace) setSelectedPlace({
                ...refreshedPlace,
                currentUserHabitSchedule: schedule,
                isCurrentUserFrequenting: true,
            });
            if (currentUserSnapshot.exists()) {
                const currentUserProfile = toUserProfile(currentUserSnapshot.id, currentUserSnapshot.data());
                setFrequentersProfiles((currentProfiles) => {
                    const withoutCurrentUser = currentProfiles.filter(({ uid }) => uid !== currentUserId);
                    return [...withoutCurrentUser, currentUserProfile];
                });
            }
            Alert.alert("Sucesso", "Sua rotina foi salva neste local!");
        } catch (error) {
            console.error('[Explore] place_habit_save_failed', { code: getFirebaseErrorCode(error) });
            Alert.alert("Erro", "Não foi possível salvar a rotina.");
            throw error;
        }
    };

    const handleRemovePlaceHabit = async () => {
        if (!selectedPlace || !auth.currentUser) return;
        try {
            await httpsCallable<{ placeId: string }, { ok: boolean }>(functions, 'removePlaceHabit')({
                placeId: selectedPlace.id,
            });
            const refreshedPlace = await refreshPlace(selectedPlace.id);
            if (refreshedPlace) setSelectedPlace({
                ...refreshedPlace,
                currentUserHabitSchedule: undefined,
                isCurrentUserFrequenting: false,
            });
            setFrequentersProfiles((currentProfiles) => currentProfiles.filter(({ uid }) => uid !== auth.currentUser?.uid));
            Alert.alert('Rotina removida', 'Você não aparece mais como frequentador deste local.');
        } catch (error) {
            console.error('[Explore] place_habit_remove_failed', error);
            Alert.alert('Erro', 'Não foi possível remover sua rotina deste local.');
            throw error;
        }
    };

    const viewerUid = auth.currentUser?.uid;
    const isAttendingMeeting = (meeting: Meeting) => Boolean(viewerUid && meeting.attendees?.includes(viewerUid));

    const filteredMeetings = meetings.filter(m => {
        if (m.status === 'cancelled' || m.status === 'completed' || hasEventEnded(m, eventClock)) return false;
        if (m.type !== eventType) return false;
        if (selectedCategory && !hasMatchingInterest([m.theme, ...(m.interests || [])], [selectedCategory])) return false;
        return true;
    });

    /** Distância até o evento, ou null quando não se aplica (online, sem GPS). */
    const meetingDistanceKm = (meeting: Meeting): number | null => {
        if (meeting.type === 'online' || !location) return null;
        const latitude = Number(meeting.lat);
        const longitude = Number(meeting.lng);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        return getDistanceFromLatLonInKm(location.coords.latitude, location.coords.longitude, latitude, longitude);
    };

    /**
     * Estado do marcador em texto, no balão. A arte sozinha comunica por cor e
     * piscada — inacessível para quem não distingue as cores ou reduz animações —
     * e o balão é o único lugar do mapa onde texto cabe. Traz os dois eixos, a
     * contagem de confirmados e, no lugar da remoção feita na lista, o aviso de
     * que você já vai a este evento.
     */
    const describeMarkerMeeting = (meeting: Meeting) => {
        const journey = getEventJourneyState(meeting, eventClock);
        const attendeeCount = meeting.attendees?.length || 0;
        const parts = [
            isAttendingMeeting(meeting) ? 'Você vai' : null,
            journey.compactLabel,
            attendeeCount === 1 ? '1 confirmado' : `${attendeeCount} confirmados`,
        ];
        return parts.filter(Boolean).join(' • ');
    };

    const visiblePlaces = useMemo(() => places.filter((place) => {
        if (!place.latitude || !place.longitude || isNaN(place.latitude) || isNaN(place.longitude)) return false;
        if (place.isCommunity && !mapFilters.communityPlaces) return false;
        if (!place.isCommunity && !mapFilters.osmPlaces) return false;
        return true;
    }), [places, mapFilters.communityPlaces, mapFilters.osmPlaces]);

    const userCoordinates = location
        ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
        : null;
    const getMeetingDiscovery = (meeting: Meeting) => getEventDiscovery(meeting, {
        userCoordinates,
        userInterests,
        now: eventClock,
    });
    // Respeita a preferência do perfil, igual ao Início e à Agenda: antes o mapa
    // destacava "popular" mesmo para quem desativou populares fora dos interesses.
    const isPopularMeeting = (meeting: Meeting) => {
        const discovery = getMeetingDiscovery(meeting);
        return discovery.reasons.includes('popular')
            && shouldSuggestEvent(discovery, showPopularOutsideInterests);
    };

    /**
     * A LISTA é para descobrir o que você ainda não conhece: um evento já
     * confirmado só ocupa espaço, porque ele já está na sua Agenda. No MAPA o
     * marcador continua — você precisa localizar o seu próprio evento — e lá a
     * participação é anunciada no balão.
     *
     * A ordem vinha crua do Firestore (`orderBy('date')`), então um evento a 8 km
     * sem ninguém confirmado aparecia acima de um a 300 m com quinze pessoas, só
     * por começar meia hora antes. Os critérios agora são em cascata:
     *
     *   1. FASE — reaproveita `getEventJourneyState`, a mesma fonte dos selos, então
     *      a ordem da lista bate com o que cada card exibe. Evento é um momento:
     *      ao vivo > começa em breve > hoje > próximos dias. Um evento popular
     *      daqui a cinco dias não pode passar na frente de um que é hoje.
     *   2. POPULAR — dentro da mesma fase, o que já tem gente confirmada.
     *   3. DISTÂNCIA — depois, o mais perto. Sem GPS ou em evento online não há
     *      distância, e esses ficam por último dentro do próprio grupo.
     *   4. DATA E HORA — desempate estável, para a lista não dançar entre renders.
     */
    const LIST_PHASE_RANK: Record<string, number> = {
        in_progress: 0,
        starting_soon: 1,
        today: 2,
        upcoming: 3,
    };
    const rankedListMeetings = filteredMeetings
        .filter((meeting) => !isAttendingMeeting(meeting))
        .map((meeting) => ({
            meeting,
            phaseRank: LIST_PHASE_RANK[getEventJourneyState(meeting, eventClock).phase] ?? 9,
            isPopular: isPopularMeeting(meeting),
            distanceKm: meetingDistanceKm(meeting),
            startKey: `${meeting.date ?? ''} ${meeting.time ?? ''}`,
        }))
        .sort((first, second) => {
            if (first.phaseRank !== second.phaseRank) return first.phaseRank - second.phaseRank;
            if (first.isPopular !== second.isPopular) return first.isPopular ? -1 : 1;
            if (first.distanceKm !== second.distanceKm) {
                if (first.distanceKm === null) return 1;
                if (second.distanceKm === null) return -1;
                return first.distanceKm - second.distanceKm;
            }
            return first.startKey.localeCompare(second.startKey);
        });
    const listMeetings = rankedListMeetings.map(({ meeting }) => meeting);
    const hiddenAttendingCount = filteredMeetings.length - listMeetings.length;
    const isInterestHighlightMeeting = (meeting: Meeting) => {
        const discovery = getMeetingDiscovery(meeting);
        return discovery.shouldAnimateOnMap && discovery.reasons.includes('interest');
    };
    const shouldBlinkMeeting = (meeting: Meeting) => getMeetingDiscovery(meeting).shouldAnimateOnMap;

    const markerMeetingForPlace = (place: Place) => {
        if (!mapFilters.events) return undefined;
        const eventsAtPlace = filteredMeetings.filter((meeting) => isMeetingAtPlace(place, meeting));
        return eventsAtPlace.find((meeting) => getMeetingDiscovery(meeting).reasons.includes('in_progress'))
            || eventsAtPlace.find(isPopularMeeting)
            || eventsAtPlace.find(isInterestHighlightMeeting)
            || eventsAtPlace[0];
    };

    // Um único relógio alterna os PNGs dos eventos destacados. Isso mantém o
    // efeito de piscar sem criar Animated.Value, loop ou View dentro de cada Marker.
    const hasBlinkingMapEvent = mapFilters.events && filteredMeetings.some(shouldBlinkMeeting);
    const [markerBlinkOn, setMarkerBlinkOn] = useState(true);

    useEffect(() => {
        if (viewMode !== 'map' || !hasBlinkingMapEvent) {
            setMarkerBlinkOn(true);
            return;
        }

        const blinkTimer = setInterval(() => {
            setMarkerBlinkOn((current) => !current);
        }, 750);

        return () => clearInterval(blinkTimer);
    }, [hasBlinkingMapEvent, viewMode]);

    const renderMeetingCard = ({ item }: { item: Meeting }) => {
        const discovery = getMeetingDiscovery(item);
        const isLive = discovery.reasons.includes('in_progress');
        // A lista é filtrada por online/presencial, não por motivo de descoberta:
        // nenhum motivo está implícito na seção, então os dois eixos aparecem.
        // Faltava justamente o temporal — o card dizia "Seu interesse" sem nunca
        // dizer que o evento era hoje.
        const badgeReason = getDiscoveryBadgeReason(discovery);
        const journeyState = isLive ? null : getEventJourneyState(item, eventClock);
        const attendeeCount = item.attendees?.length || 0;
        // `label` traz "COMEÇA EM 45 MIN"; `compactLabel` reduz tudo a "EM BREVE".
        // Aqui a linha é inteira, então a contagem precisa cabe e é mais acionável.
        const journeyText = journeyState?.phase === 'starting_soon' ? journeyState.label : journeyState?.compactLabel;
        // Mesma função que ordena a lista: se o card mostrasse uma distância
        // calculada por outro caminho, a ordem poderia contradizer o que se lê.
        const distanceKm = meetingDistanceKm(item);
        return (
        <TouchableOpacity style={styles.card} onPress={() => router.push(`/event/${item.id}` as any)}>
            <View style={styles.cardHeader}>
                <View style={styles.tagContainer}><Text style={styles.tagText}>{item.theme || 'Evento'}</Text></View>
                <Text style={styles.dateText}>{item.date ? item.date.split('-').reverse().join('/') : ''} • {item.time}</Text>
            </View>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
            {/* Confirmados e distância: dois dados que o app já tinha em mãos e
                nunca mostrava. Contagem de presença é o principal sinal social
                nos apps de evento, e alimentava só o cálculo interno de "Popular". */}
            <View style={styles.cardMetaRow}>
                <View style={styles.cardMetaItem}>
                    <Ionicons name="people-outline" size={13} color="#6B7280" />
                    <Text style={styles.cardMetaText}>
                        {attendeeCount === 1 ? '1 confirmado' : `${attendeeCount} confirmados`}
                    </Text>
                </View>
                {distanceKm !== null && (
                    <View style={styles.cardMetaItem}>
                        <Ionicons name="navigate-outline" size={13} color="#6B7280" />
                        <Text style={styles.cardMetaText}>{`a ${distanceKm.toFixed(1)} km`}</Text>
                    </View>
                )}
                {isNewMeeting(item, eventClock) && (
                    <View style={styles.newBadge}><Text style={styles.newBadgeText}>NOVO</Text></View>
                )}
            </View>
            <View style={styles.cardFooter}>
                <View style={styles.locationRow}>
                    <Ionicons name={eventType === 'online' ? "videocam-outline" : "location-outline"} size={16} color="#6B7280" />
                    <Text style={styles.locationText} numberOfLines={1}>{item.locationName}</Text>
                </View>
                {isLive ? (
                    <View style={styles.liveBadge}>
                        <View style={styles.liveDot} />
                        <Text style={styles.liveText}>Ao vivo</Text>
                    </View>
                ) : journeyText ? (
                    <View style={styles.journeyBadge}>
                        <Text style={styles.journeyBadgeText} numberOfLines={1}>{journeyText}</Text>
                    </View>
                ) : null}
                {badgeReason && (
                    <View style={styles.discoveryBadge}>
                        <Text style={styles.discoveryBadgeText} numberOfLines={1}>{DISCOVERY_REASON_BADGE_LABELS[badgeReason]}</Text>
                    </View>
                )}
            </View>
        </TouchableOpacity>
        );
    };

    if (loading) {
        return (
            <SafeAreaView style={[styles.container, styles.center]}>
                <ActivityIndicator size="large" color="#6366F1" />
            </SafeAreaView>
        );
    }

    return (
        <View style={styles.container}>
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
                                {changedFilterCount > 0 && (
                                    <View style={styles.filterCountBadge}>
                                        <Text style={styles.filterCountText}>{changedFilterCount}</Text>
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
                        <Text style={styles.filterHint}>
                            A Descoberta (OSM) busca locais em um serviço externo e vem desligada.
                            Sua escolha fica salva para as próximas vezes.
                        </Text>
                        {changedFilterCount > 0 && (
                            <TouchableOpacity
                                onPress={restoreDefaultMapFilters}
                                style={styles.filterResetButton}
                                accessibilityRole="button"
                                accessibilityLabel="Restaurar filtros padrão do mapa"
                            >
                                <Ionicons name="refresh" size={13} color="#6366F1" />
                                <Text style={styles.filterResetText}>Restaurar padrão</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </>
            )}

            <View style={styles.content}>
                {eventType === 'online' || viewMode === 'list' ? error ? (
                    <ErrorState
                        title="Não foi possível carregar os eventos"
                        message="Confira sua conexão e tente novamente."
                        onRetry={retry}
                    />
                ) : (
                    <FlatList
                        data={listMeetings}
                        keyExtractor={(item) => item.id}
                        renderItem={renderMeetingCard}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        // Sem este aviso, sumir com um evento confirmado parece defeito.
                        ListHeaderComponent={hiddenAttendingCount > 0 ? (
                            <TouchableOpacity
                                style={styles.attendingNotice}
                                onPress={() => router.push('/agenda' as never)}
                                accessibilityRole="button"
                                accessibilityLabel="Abrir a Agenda para ver os eventos que você confirmou"
                            >
                                <Ionicons name="checkmark-circle" size={15} color="#10B981" />
                                <Text style={styles.attendingNoticeText}>
                                    {hiddenAttendingCount === 1
                                        ? '1 evento que você confirmou está na sua Agenda'
                                        : `${hiddenAttendingCount} eventos que você confirmou estão na sua Agenda`}
                                </Text>
                                <Ionicons name="chevron-forward" size={14} color="#10B981" />
                            </TouchableOpacity>
                        ) : null}
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
                            key={`${mapInitialRegion.latitude}:${mapInitialRegion.longitude}`}
                            /* Android (Google Maps) respeita o customMapStyle; iOS usa
                               PROVIDER_DEFAULT (Apple Maps), que o ignora e obedece só
                               showsPointsOfInterest. Os dois precisam do MESMO valor —
                               antes `showsPointsOfInterest` tinha um `Platform.OS ===
                               'android' ||` que o fixava em true e mascarava o filtro. */
                            customMapStyle={mapFilters.googlePoi ? [] : hideGooglePoiStyle}
                            initialRegion={mapInitialRegion}
                            showsUserLocation={true}
                            showsPointsOfInterest={mapFilters.googlePoi}
                            onRegionChangeComplete={(region) => {
                                const nextRegion: StoredMapRegion = {
                                    latitude: region.latitude,
                                    longitude: region.longitude,
                                    latitudeDelta: region.latitudeDelta,
                                    longitudeDelta: region.longitudeDelta,
                                };
                                handleMapRegionChange(nextRegion);
                            }}
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
                                const markerMeeting = markerMeetingForPlace(place);
                                const hasActiveEvent = Boolean(markerMeeting);
                                const discovery = markerMeeting ? getMeetingDiscovery(markerMeeting) : null;
                                const isLive = discovery?.reasons.includes('in_progress') === true;
                                const isPopular = discovery?.reasons.includes('popular') === true;
                                const matchesInterestToday = discovery?.shouldAnimateOnMap === true && discovery.reasons.includes('interest');
                                const isHighlighted = isPopular || matchesInterestToday;
                                const hasFrequenters = (place.frequenters?.length || 0) > 0;
                                const isDiscovered = Boolean(place.discovererId || place.discovererName);
                                const isOsmPlace = place.id.startsWith('osm_');
                                const markerImage = markerMeeting
                                    ? getEventMarkerImage(markerMeeting, isLive, isHighlighted, markerBlinkOn)
                                    : hasFrequenters
                                        ? MAP_MARKER_IMAGES.community
                                        : isDiscovered
                                            ? MAP_MARKER_IMAGES.discovered
                                            : isOsmPlace
                                                ? MAP_MARKER_IMAGES.osm
                                                : MAP_MARKER_IMAGES.place;
                                return (
                                <Marker
                                    key={place.id}
                                    coordinate={{ latitude: Number(place.latitude), longitude: Number(place.longitude) }}
                                    onPress={() => handleOpenPlaceModal(place)}
                                    title={place.name}
                                    description={markerMeeting ? describeMarkerMeeting(markerMeeting) : undefined}
                                    image={markerImage}
                                    anchor={{ x: 0.5, y: 0.5 }}
                                    zIndex={isLive ? 100 : isPopular ? 80 : matchesInterestToday ? 70 : hasActiveEvent ? 40 : hasFrequenters ? 30 : 10}
                                />
                                );
                            })}
                            {mapFilters.events && filteredMeetings.filter((meeting) =>
                                meeting.lat != null
                                && meeting.lng != null
                                && !isNaN(Number(meeting.lat))
                                && !isNaN(Number(meeting.lng))
                                && !visiblePlaces.some((place) => isMeetingAtPlace(place, meeting))
                            ).map((meeting) => {
                                const discovery = getMeetingDiscovery(meeting);
                                const isLive = discovery.reasons.includes('in_progress');
                                const isPopular = discovery.reasons.includes('popular');
                                const matchesInterestToday = discovery.shouldAnimateOnMap && discovery.reasons.includes('interest');
                                const isHighlighted = isPopular || matchesInterestToday;
                                return (
                                <Marker
                                    key={meeting.id}
                                    coordinate={{ latitude: Number(meeting.lat), longitude: Number(meeting.lng) }}
                                    onPress={() => router.push(`/event/${meeting.id}` as any)}
                                    title={meeting.title}
                                    description={describeMarkerMeeting(meeting)}
                                    image={getEventMarkerImage(meeting, isLive, isHighlighted, markerBlinkOn)}
                                    anchor={{ x: 0.5, y: 0.5 }}
                                    zIndex={isLive ? 100 : isPopular ? 80 : matchesInterestToday ? 70 : 1}
                                />
                                );
                            })}
                        </MapView>
                        <View style={styles.mapStatusContainer} pointerEvents="box-none">
                            {(locationStatus === 'denied' || locationStatus === 'error') && (
                                <TouchableOpacity style={styles.mapStatusWarning} onPress={handleLocationRecovery}>
                                    <Ionicons name="location-outline" size={15} color="#92400E" />
                                    <Text style={styles.mapStatusWarningText}>{locationWarningText}</Text>
                                </TouchableOpacity>
                            )}
                            {mapFilters.events && error && (
                                <TouchableOpacity style={styles.mapStatusError} onPress={retry}>
                                    <Ionicons name="refresh" size={15} color="#B91C1C" />
                                    <Text style={styles.mapStatusErrorText}>Falha ao carregar eventos. Tentar novamente</Text>
                                </TouchableOpacity>
                            )}
                            {mapFilters.communityPlaces && placesError && (
                                <TouchableOpacity style={styles.mapStatusError} onPress={retry}>
                                    <Ionicons name="refresh" size={15} color="#B91C1C" />
                                    <Text style={styles.mapStatusErrorText}>Falha nos locais da comunidade. Tentar novamente</Text>
                                </TouchableOpacity>
                            )}
                            {mapFilters.osmPlaces && osmLoading && (
                                <View style={styles.mapStatusInfo}>
                                    <ActivityIndicator size="small" color="#047857" />
                                    <Text style={styles.mapStatusInfoText}>Buscando locais OSM nesta área...</Text>
                                </View>
                            )}
                            {mapFilters.osmPlaces && osmError && !osmLoading && (
                                <TouchableOpacity style={styles.mapStatusError} onPress={retry}>
                                    <Ionicons name="refresh" size={15} color="#B91C1C" />
                                    <Text style={styles.mapStatusErrorText}>Overpass indisponível. Tentar novamente</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                        <View style={styles.mapActions}>
                            <TouchableOpacity style={styles.fab} onPress={() => {
                                if (!location) {
                                    void retryLocation();
                                    return;
                                }
                                mapRef.current?.animateToRegion({
                                    latitude: location.coords.latitude,
                                    longitude: location.coords.longitude,
                                    latitudeDelta: 0.01,
                                    longitudeDelta: 0.01,
                                }, 1000);
                            }}>
                                {locationStatus === 'checking' && !location
                                    ? <ActivityIndicator size="small" color="#6366F1" />
                                    : <Ionicons name="navigate" size={22} color="#6366F1" />}
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
            </View>

            <View style={styles.actions}>
                <TouchableOpacity style={styles.createButton} onPress={() => {
                    setSelectedPlace(null);
                    setNewMeeting((current) => ({
                        ...current,
                        locationName: '',
                        placeId: '',
                        lat: 0,
                        lng: 0,
                    }));
                    setModalVisible(true);
                }} activeOpacity={0.85}>
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
                repeatStartDate={repeatStartDate}
                setRepeatStartDate={setRepeatStartDate}
                onCreated={setCreatedEventIdForInvite}
            />

            <PlaceModal
                visible={showPlaceModal}
                onClose={handleClosePlaceModal}
                place={selectedPlace}
                loadingProfiles={loadingProfiles}
                frequentersProfiles={frequentersProfiles}
                placeEvents={selectedPlace ? meetings.filter(m =>
                    m.status !== 'cancelled'
                    && m.status !== 'completed'
                    && !hasEventEnded(m, eventClock)
                    && (m.placeId === selectedPlace.id ||
                    (Math.abs(Number(m.lat) - selectedPlace.latitude) < 0.0001 && Math.abs(Number(m.lng) - selectedPlace.longitude) < 0.0001))
                ) : []}
                onSaveHabit={handleSavePlaceHabit}
                onRemoveHabit={handleRemovePlaceHabit}
                onCreateEventPress={handleCreateEventAtSelectedPlace}
            />
            {createdEventIdForInvite && (
                <EventInviteModal
                    visible
                    eventId={createdEventIdForInvite}
                    onClose={() => setCreatedEventIdForInvite(null)}
                />
            )}

            <LocationPickerModal
                visible={pickingLocation}
                onClose={() => {
                    setPickingLocation(false);
                    setModalVisible(true);
                }}
                location={location}
                currentLat={newMeeting.lat}
                currentLng={newMeeting.lng}
                onLocationChange={(lat, lng) => {
                    setSelectedPlace(null);
                    setNewMeeting((current) => ({ ...current, lat, lng, placeId: '' }));
                }}
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
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F9FAFB' },
    center: { alignItems: 'center', justifyContent: 'center' },
    headerContainer: {
        paddingTop: 50,
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
    filterHint: { fontSize: 11, color: '#9CA3AF', lineHeight: 15, marginTop: 8 },
    attendingNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ECFDF5', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12 },
    attendingNoticeText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#047857' },
    cardMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 6 },
    cardMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    cardMetaText: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
    newBadge: { backgroundColor: '#FEF3C7', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
    newBadgeText: { fontSize: 9, fontWeight: '800', color: '#B45309', letterSpacing: 0.5 },
    filterResetButton: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#EEF2FF' },
    filterResetText: { fontSize: 12, fontWeight: '700', color: '#6366F1' },
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

    content: { flex: 1, backgroundColor: '#F9FAFB' },
    mapContainer: { flex: 1, width: '100%', height: '100%' },
    map: { width: '100%', height: '100%' },
    mapStatusContainer: { position: 'absolute', top: 12, left: 12, right: 12, gap: 7 },
    mapStatusWarning: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: 'rgba(255,251,235,0.96)', borderWidth: 1, borderColor: '#FDE68A' },
    mapStatusWarningText: { flex: 1, color: '#92400E', fontSize: 12, fontWeight: '600' },
    mapStatusError: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: 'rgba(254,242,242,0.96)', borderWidth: 1, borderColor: '#FECACA' },
    mapStatusErrorText: { flex: 1, color: '#B91C1C', fontSize: 12, fontWeight: '700' },
    mapStatusInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: 'rgba(236,253,245,0.96)', borderWidth: 1, borderColor: '#A7F3D0' },
    mapStatusInfoText: { flex: 1, color: '#047857', fontSize: 12, fontWeight: '600' },
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
    discoveryBadge: { flexShrink: 0, backgroundColor: '#EEF2FF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
    discoveryBadgeText: { fontSize: 10, color: '#4F46E5', fontWeight: '800' },
    // Mesmo vocabulário e mesma cor do selo temporal do Início e da Agenda.
    journeyBadge: { flexShrink: 0, backgroundColor: '#EEF2FF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
    journeyBadgeText: { fontSize: 10, color: '#4338CA', fontWeight: '900' },
    actions: { position: 'absolute', bottom: 20, right: 20, alignItems: 'center' },
    createButton: { borderRadius: 30, shadowColor: "#6366F1", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8 },
    gradientButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 20, borderRadius: 30 },
    createButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15, marginLeft: 8 },
    emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 10 },
    emptyText: { color: '#9CA3AF' }
});
