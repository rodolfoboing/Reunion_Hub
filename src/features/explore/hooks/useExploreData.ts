import { useState, useEffect, useMemo, useRef } from 'react';
import * as Location from 'expo-location';
import { collection, onSnapshot, query, where, limit, getDocs, getDoc, doc, orderBy } from 'firebase/firestore';
import type { DocumentData } from 'firebase/firestore';
import { db } from '@/src/services/firebaseConfig';
import { fetchNearbyPlaces, mapOsmToPlace } from '@/src/services/osmService';
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
    const [locationStatus, setLocationStatus] = useState<LocationAccessStatus>('checking');
    const [placesError, setPlacesError] = useState(false);
    const [osmError, setOsmError] = useState(false);
    const [osmLoading, setOsmLoading] = useState(false);
    const osmCache = useRef(new Map<string, Place[]>());
    const meetingsLoaded = useRef(false);

    useEffect(() => {
        let isActive = true;

        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    const lastLocation = await Location.getLastKnownPositionAsync();
                    if (lastLocation && isActive) setLocation(lastLocation);
                    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                    if (isActive) {
                        setLocation(loc);
                        setLocationStatus('granted');
                    }
                } else if (isActive) {
                    setLocationStatus('denied');
                }
            } catch (error) {
                console.warn('Erro ao obter localizacao:', error);
                if (isActive) setLocationStatus('error');
            }
        })();

        return () => { isActive = false; };
    }, []);

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

    return {
        location,
        locationStatus,
        meetings,
        places,
        loading,
        error,
        placesError,
        osmError,
        osmLoading,
        retry,
        refreshPlace,
    };
}
