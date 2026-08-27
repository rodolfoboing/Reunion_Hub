import { useState, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { collection, onSnapshot, query, where, limit, getDocs, getDoc, doc, orderBy } from 'firebase/firestore';
import type { DocumentData } from 'firebase/firestore';
import { auth, db } from '@/src/services/firebaseConfig';
import { fetchNearbyPlaces, mapOsmToPlace } from '@/src/services/osmService';
import { updateRecommendationLocation } from '@/src/services/recommendationLocationService';
import { Meeting, Place } from '@/src/types';
import { normalizeDate, getTodayStr } from '@/src/utils/dateUtils';

const toFiniteCoordinate = (value: unknown): number | undefined => {
    const coordinate = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(coordinate) ? coordinate : undefined;
};

const OSM_SEARCH_DELTA = 0.02;

export type ExploreRegion = {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
};

export type LocationAccessStatus = 'checking' | 'granted' | 'denied' | 'error';
export type LocationIssue = 'permission-denied' | 'services-disabled' | 'unavailable' | null;

const LOCATION_FIX_TIMEOUT_MS = 20_000;

function locationErrorDetails(error: unknown): { code: string; message: string } {
    if (error && typeof error === 'object') {
        const code = 'code' in error && typeof error.code === 'string'
            ? error.code
            : 'unknown';
        const message = 'message' in error && typeof error.message === 'string'
            ? error.message
            : 'Location request failed';
        return { code, message };
    }
    return { code: 'unknown', message: String(error) };
}

/**
 * Alguns aparelhos Android devolvem null/erro no pedido pontual do Fused
 * Location Provider, embora a permissão e os provedores estejam ativos. Uma
 * assinatura curta recebe o primeiro fix e é removida imediatamente.
 */
function waitForAndroidLocation(signal: AbortSignal): Promise<Location.LocationObject> {
    return new Promise((resolve, reject) => {
        let subscription: Location.LocationSubscription | null = null;
        let settled = false;

        const cleanup = () => {
            clearTimeout(timeout);
            signal.removeEventListener('abort', handleAbort);
            subscription?.remove();
            subscription = null;
        };
        const finish = (location?: Location.LocationObject, error?: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (location) resolve(location);
            else reject(error ?? new Error('location-unavailable'));
        };
        const handleAbort = () => finish(undefined, new Error('location-request-aborted'));
        const timeout = setTimeout(
            () => finish(undefined, new Error('location-request-timeout')),
            LOCATION_FIX_TIMEOUT_MS,
        );

        signal.addEventListener('abort', handleAbort, { once: true });
        void Location.watchPositionAsync(
            {
                accuracy: Location.Accuracy.High,
                timeInterval: 1_000,
                distanceInterval: 0,
                mayShowUserSettingsDialog: true,
            },
            (location) => finish(location),
            (reason) => finish(undefined, new Error(reason)),
        ).then((createdSubscription) => {
            if (settled) {
                createdSubscription.remove();
                return;
            }
            subscription = createdSubscription;
        }).catch((error: unknown) => {
            const details = locationErrorDetails(error);
            finish(undefined, new Error(`${details.code}: ${details.message}`));
        });
    });
}

const databasePlaceFrom = (id: string, data: DocumentData): Place => {
    const frequenters = Array.isArray(data.frequenters)
        ? data.frequenters.filter((userId): userId is string => typeof userId === 'string')
        : [];
    const discovererId = typeof data.discovererId === 'string' ? data.discovererId : frequenters[0];
    return {
        id,
        ...data,
        name: typeof data.name === 'string' ? data.name : 'Local de encontro',
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
        frequenters,
        discovererId,
        isCommunity: true,
    };
};

export function useExploreData(
    loadOsmPlaces: boolean,
    loadCommunityPlaces: boolean,
    active: boolean,
    mapActive: boolean,
    visibleRegion: ExploreRegion,
) {
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [databasePlaces, setDatabasePlaces] = useState<Place[]>([]);
    const [osmPlaces, setOsmPlaces] = useState<Place[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [retryKey, setRetryKey] = useState(0);
    const [locationRetryKey, setLocationRetryKey] = useState(0);
    const [locationStatus, setLocationStatus] = useState<LocationAccessStatus>('checking');
    const [locationIssue, setLocationIssue] = useState<LocationIssue>(null);
    const [canAskLocationPermissionAgain, setCanAskLocationPermissionAgain] = useState(true);
    const [placesError, setPlacesError] = useState(false);
    const [osmError, setOsmError] = useState(false);
    const [osmLoading, setOsmLoading] = useState(false);
    const osmCache = useRef(new Map<string, Place[]>());
    const meetingsLoaded = useRef(false);

    useEffect(() => {
        let isActive = true;
        const locationAbortController = new AbortController();

        (async () => {
            let fallbackLocation: Location.LocationObject | null = null;
            if (isActive) {
                setLocationStatus('checking');
                setLocationIssue(null);
            }
            try {
                let permission = await Location.getForegroundPermissionsAsync();
                if (permission.status !== 'granted' && permission.canAskAgain) {
                    permission = await Location.requestForegroundPermissionsAsync();
                }
                if (isActive) setCanAskLocationPermissionAgain(permission.canAskAgain);
                const { status } = permission;
                if (status === 'granted') {
                    fallbackLocation = await Location.getLastKnownPositionAsync({
                        maxAge: 7 * 24 * 60 * 60 * 1000,
                        requiredAccuracy: 10_000,
                    });
                    if (fallbackLocation && isActive) {
                        setLocation(fallbackLocation);
                        setLocationStatus('granted');
                        console.info('[ExploreData] location_acquired', { source: 'last_known' });
                    }

                    const providerStatus = await Location.getProviderStatusAsync();
                    if (!providerStatus.locationServicesEnabled) {
                        if (!fallbackLocation && isActive) {
                            setLocationStatus('error');
                            setLocationIssue('services-disabled');
                        }
                        return;
                    }

                    if (Platform.OS === 'android'
                        && providerStatus.gpsAvailable === false
                        && providerStatus.networkAvailable === false) {
                        if (!fallbackLocation && isActive) {
                            setLocationStatus('error');
                            setLocationIssue('services-disabled');
                        }
                        return;
                    }

                    const loc = Platform.OS === 'android'
                        ? await waitForAndroidLocation(locationAbortController.signal)
                        : await Location.getCurrentPositionAsync({
                            accuracy: Location.Accuracy.Balanced,
                            mayShowUserSettingsDialog: true,
                        });
                    if (isActive) {
                        setLocation(loc);
                        setLocationStatus('granted');
                        setLocationIssue(null);
                        console.info('[ExploreData] location_acquired', { source: 'fresh' });
                    }
                    const userId = auth.currentUser?.uid;
                    if (userId) {
                        updateRecommendationLocation(userId, loc.coords).catch(() => {
                            console.warn('[ExploreData] recommendation_location_sync_failed');
                        });
                    }
                } else if (isActive) {
                    setLocationStatus('denied');
                    setLocationIssue('permission-denied');
                }
            } catch (locationError: unknown) {
                const details = locationErrorDetails(locationError);
                if (details.message === 'location-request-aborted') return;
                console.warn('[ExploreData] location_request_failed', {
                    code: details.code,
                    reason: details.message,
                    platform: Platform.OS,
                });
                if (isActive && !fallbackLocation) {
                    setLocationStatus('error');
                    setLocationIssue('unavailable');
                }
            }
        })();

        return () => {
            isActive = false;
            locationAbortController.abort();
        };
    }, [locationRetryKey]);

    useEffect(() => {
        if (!active) return;
        let isActive = true;
        if (!meetingsLoaded.current) setLoading(true);

        const todayStr = getTodayStr();

        const q = query(
            collection(db, 'meetings'),
            where('date', '>=', todayStr),
            orderBy('date'),
            limit(30)
        );
        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const data = snapshot.docs.map(doc => {
                    const meeting = doc.data() as Omit<Meeting, 'id'>;
                    const normalizedDate = normalizeDate(meeting.date);
                    return {
                        id: doc.id,
                        ...meeting,
                        date: normalizedDate || meeting.date,
                        lat: toFiniteCoordinate(meeting.lat),
                        lng: toFiniteCoordinate(meeting.lng),
                        locationName: meeting.locationName || 'Local a definir'
                    };
                }).filter(m => {
                    if (!m.date) return false;
                    if (m.status === 'cancelled' || m.status === 'completed') return false;
                    return m.date >= todayStr;
                }) as Meeting[];
                if (isActive) {
                    meetingsLoaded.current = true;
                    setMeetings(data);
                    setError(false);
                    setLoading(false);
                }
            },
            (error) => {
                console.warn('Erro ao buscar eventos:', error);
                if (isActive) {
                    meetingsLoaded.current = true;
                    setMeetings([]);
                    setError(true);
                    setLoading(false);
                }
            }
        );

        return () => {
            isActive = false;
            unsubscribe();
        };
    }, [active, retryKey]);

    useEffect(() => {
        if (!mapActive || !loadCommunityPlaces) return;
        let active = true;
        const fetchDatabasePlaces = async () => {
            try {
                const halfLatitudeDelta = Math.min(Math.max(visibleRegion.latitudeDelta / 2, 0.005), 0.08);
                const q = query(
                    collection(db, 'places'),
                    where('latitude', '>=', visibleRegion.latitude - halfLatitudeDelta),
                    where('latitude', '<=', visibleRegion.latitude + halfLatitudeDelta),
                    orderBy('latitude'),
                    limit(50),
                );
                const snap = await getDocs(q);
                const halfLongitudeDelta = Math.min(Math.max(visibleRegion.longitudeDelta / 2, 0.005), 0.08);
                const dbPlaces = snap.docs
                    .map((placeDocument) => databasePlaceFrom(placeDocument.id, placeDocument.data()))
                    .filter((place) => Math.abs(place.longitude - visibleRegion.longitude) <= halfLongitudeDelta);
                if (active) {
                    setDatabasePlaces(dbPlaces);
                    setPlacesError(false);
                }
            } catch (error) {
                console.warn('Erro ao buscar locais da comunidade:', error);
                if (active) setPlacesError(true);
            }
        };
        fetchDatabasePlaces();
        return () => { active = false; };
    }, [loadCommunityPlaces, mapActive, retryKey, visibleRegion.latitude, visibleRegion.longitude, visibleRegion.latitudeDelta, visibleRegion.longitudeDelta]);

    useEffect(() => {
        if (!mapActive || !loadOsmPlaces) {
            setOsmLoading(false);
            return;
        }
        const abortController = new AbortController();
        const lat = visibleRegion.latitude;
        const lon = visibleRegion.longitude;
        const cacheKey = `${lat.toFixed(2)}:${lon.toFixed(2)}:${visibleRegion.latitudeDelta.toFixed(2)}:${visibleRegion.longitudeDelta.toFixed(2)}`;
        const cachedPlaces = osmCache.current.get(cacheKey);

        if (cachedPlaces) {
            setOsmPlaces(cachedPlaces);
            setOsmError(false);
            setOsmLoading(false);
            return () => abortController.abort();
        }

        const fetchOsmPlaces = async () => {
            setOsmLoading(true);
            try {
                const latitudeDelta = Math.min(Math.max(visibleRegion.latitudeDelta / 2, 0.005), OSM_SEARCH_DELTA);
                const longitudeDelta = Math.min(Math.max(visibleRegion.longitudeDelta / 2, 0.005), OSM_SEARCH_DELTA);
                const rawOsm = await fetchNearbyPlaces(
                    lat - latitudeDelta,
                    lon - longitudeDelta,
                    lat + latitudeDelta,
                    lon + longitudeDelta,
                    abortController.signal
                );
                if (abortController.signal.aborted) return;
                const mappedPlaces = rawOsm
                    .map(mapOsmToPlace)
                    .filter((place): place is Place => place !== null);
                osmCache.current.set(cacheKey, mappedPlaces);
                setOsmPlaces(mappedPlaces);
                setOsmError(false);
            } catch (error) {
                if (!abortController.signal.aborted) {
                    console.warn('Erro ao buscar locais OSM (Overpass):', error);
                    setOsmError(true);
                }
            } finally {
                if (!abortController.signal.aborted) setOsmLoading(false);
            }
        };

        fetchOsmPlaces();
        return () => abortController.abort();
    }, [loadOsmPlaces, mapActive, retryKey, visibleRegion.latitude, visibleRegion.longitude, visibleRegion.latitudeDelta, visibleRegion.longitudeDelta]);

    const places = useMemo(() => {
        const osmById = new Map(osmPlaces.map((place) => [place.id, place]));
        const mergedOsmPlaces = osmPlaces.map((place) => {
            const databasePlace = databasePlaces.find((candidate) => candidate.id === place.id);
            return databasePlace ? { ...place, ...databasePlace, isCommunity: true } : { ...place, isCommunity: false };
        });
        const remainingDatabasePlaces = databasePlaces.filter((place) => !osmById.has(place.id));
        return [...mergedOsmPlaces, ...remainingDatabasePlaces];
    }, [databasePlaces, osmPlaces]);

    const refreshPlace = async (placeId: string): Promise<Place | null> => {
        try {
            const snapshot = await getDoc(doc(db, 'places', placeId));
            if (!snapshot.exists()) return null;

            const refreshedPlace = databasePlaceFrom(snapshot.id, snapshot.data());
            setDatabasePlaces((currentPlaces) => {
                const existingIndex = currentPlaces.findIndex((place) => place.id === placeId);
                if (existingIndex < 0) return [refreshedPlace, ...currentPlaces].slice(0, 30);
                return currentPlaces.map((place) => place.id === placeId ? refreshedPlace : place);
            });
            return refreshedPlace;
        } catch {
            console.warn('[ExploreData] place_refresh_failed');
            return null;
        }
    };

    const retry = () => {
        setLoading(true);
        setError(false);
        setPlacesError(false);
        setOsmError(false);
        setRetryKey((current) => current + 1);
    };

    const retryLocation = async () => {
        if (Platform.OS === 'android' && locationIssue === 'services-disabled') {
            try {
                await Location.enableNetworkProviderAsync();
            } catch {
                console.warn('[ExploreData] location_provider_enable_declined');
            }
        }
        setLocationRetryKey((current) => current + 1);
    };

    return {
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
    };
}
