import { useState, useEffect, useMemo, useRef } from 'react';
import * as Location from 'expo-location';
import { collection, onSnapshot, query, where, limit, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@/src/services/firebaseConfig';
import { fetchNearbyPlaces, mapOsmToPlace } from '@/src/services/osmService';
import { Meeting, Place } from '@/src/types';
import { normalizeDate, getTodayStr } from '@/src/utils/dateUtils';

const toFiniteCoordinate = (value: unknown): number | undefined => {
    const coordinate = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(coordinate) ? coordinate : undefined;
};

const OSM_SEARCH_DELTA = 0.02;

export function useExploreData(loadOsmPlaces: boolean) {
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [databasePlaces, setDatabasePlaces] = useState<Place[]>([]);
    const [osmPlaces, setOsmPlaces] = useState<Place[]>([]);
    const [loading, setLoading] = useState(true);
    const osmCache = useRef(new Map<string, Place[]>());

    useEffect(() => {
        let isActive = true;

        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    const loc = await Location.getCurrentPositionAsync({});
                    if (isActive) setLocation(loc);
                }
            } catch (error) {
                console.warn('Erro ao obter localizacao:', error);
            }
        })();

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
                    setMeetings(data);
                    setLoading(false);
                }
            },
            (error) => {
                console.warn('Erro ao buscar eventos:', error);
                if (isActive) {
                    setMeetings([]);
                    setLoading(false);
                }
            }
        );

        return () => {
            isActive = false;
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (!location) return;
        let active = true;
        const fetchDatabasePlaces = async () => {
            try {
                const q = query(collection(db, 'places'), limit(30));
                const snap = await getDocs(q);
                const dbPlaces = snap.docs.map(d => ({id: d.id, ...d.data(), isCommunity: true} as Place));
                if (active) setDatabasePlaces(dbPlaces);
            } catch (error) {
                console.warn('Erro ao buscar locais da comunidade:', error);
            }
        };
        fetchDatabasePlaces();
        return () => { active = false; };
    }, [location]);

    useEffect(() => {
        if (!location || !loadOsmPlaces) return;
        const abortController = new AbortController();
        const lat = location.coords.latitude;
        const lon = location.coords.longitude;
        const cacheKey = `${lat.toFixed(2)}:${lon.toFixed(2)}`;
        const cachedPlaces = osmCache.current.get(cacheKey);

        if (cachedPlaces) {
            setOsmPlaces(cachedPlaces);
            return () => abortController.abort();
        }

        const fetchOsmPlaces = async () => {
            try {
                const rawOsm = await fetchNearbyPlaces(
                    lat - OSM_SEARCH_DELTA,
                    lon - OSM_SEARCH_DELTA,
                    lat + OSM_SEARCH_DELTA,
                    lon + OSM_SEARCH_DELTA,
                    abortController.signal
                );
                if (abortController.signal.aborted) return;
                const mappedPlaces = rawOsm
                    .map(mapOsmToPlace)
                    .filter((place): place is Place => place !== null);
                osmCache.current.set(cacheKey, mappedPlaces);
                setOsmPlaces(mappedPlaces);
            } catch (error) {
                if (!abortController.signal.aborted) console.warn('Erro ao buscar locais OSM (Overpass):', error);
            }
        };

        fetchOsmPlaces();
        return () => abortController.abort();
    }, [location, loadOsmPlaces]);

    const places = useMemo(() => {
        const osmById = new Map(osmPlaces.map((place) => [place.id, place]));
        const mergedOsmPlaces = osmPlaces.map((place) => {
            const databasePlace = databasePlaces.find((candidate) => candidate.id === place.id);
            return databasePlace ? { ...place, ...databasePlace, isCommunity: true } : { ...place, isCommunity: false };
        });
        const remainingDatabasePlaces = databasePlaces.filter((place) => !osmById.has(place.id));
        return [...mergedOsmPlaces, ...remainingDatabasePlaces];
    }, [databasePlaces, osmPlaces]);

    return { location, meetings, places, loading };
}
