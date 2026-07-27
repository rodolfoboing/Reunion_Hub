import { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import { collection, onSnapshot, query, where, limit, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@/src/services/firebaseConfig';
import { fetchNearbyPlaces, mapOsmToPlace } from '@/src/services/osmService';
import { Meeting, Place } from '@/src/types';
import { normalizeDate, getTodayStr } from '@/src/utils/dateUtils';

const FALLBACK_LOCATION = {
    coords: {
        latitude: -23.5505,
        longitude: -46.6333,
    },
} as Location.LocationObject;

export function useExploreData() {
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [places, setPlaces] = useState<Place[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    const loc = await Location.getCurrentPositionAsync({});
                    setLocation(loc);
                } else {
                    setLocation(FALLBACK_LOCATION);
                }
            } catch (error) {
                console.warn('Erro ao obter localizacao:', error);
                setLocation(FALLBACK_LOCATION);
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
                    const normalizedDate = normalizeDate(doc.data().date);
                    return {
                        id: doc.id,
                        ...(doc.data() as Omit<Meeting, 'id'>),
                        date: normalizedDate || doc.data().date,
                        lat: Number(doc.data().lat) || -23.5505,
                        lng: Number(doc.data().lng) || -46.6333,
                        locationName: doc.data().locationName || 'Local a definir'
                    };
                }).filter(m => {
                    if (!m.date) return false;
                    if (m.status === 'cancelled' || m.status === 'completed') return false;
                    return m.date >= todayStr;
                }) as Meeting[];
                setMeetings(data);
                setLoading(false);
            },
            (error) => {
                console.warn('Erro ao buscar eventos:', error);
                setMeetings([]);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!location) return;
        const fetchPlaces = async () => {
            try {
                const lat = location.coords.latitude;
                const lon = location.coords.longitude;
                const delta = 0.05;
                
                // Fetch DB Places (Always works regardless of OSM)
                const q = query(collection(db, 'places'), limit(30));
                const snap = await getDocs(q);
                const dbPlaces = snap.docs.map(d => ({id: d.id, ...d.data(), isCommunity: true} as Place));
                
                // Fetch OSM Places (May fail / timeout)
                let mapped: any[] = [];
                try {
                    const rawOsm = await fetchNearbyPlaces(lat - delta, lon - delta, lat + delta, lon + delta);
                    mapped = rawOsm.map(mapOsmToPlace).filter((p: Place | null) => p !== null);
                } catch (osmError) {
                    console.warn('Erro ao buscar locais OSM (Overpass):', osmError);
                }

                const finalPlaces = mapped.map((osmPlace: any) => {
                    const dbMatch = dbPlaces.find((p) => p.id === osmPlace.id);
                    return dbMatch ? { ...osmPlace, ...dbMatch, isCommunity: true } : { ...osmPlace, isCommunity: false };
                });
                
                const extraDb = dbPlaces.filter((p) => !finalPlaces.some((fp: any) => fp.id === p.id));
                setPlaces([...finalPlaces, ...extraDb] as Place[]);
            } catch (error) {
                console.warn('Erro fatal ao buscar locais:', error);
            }
        };
        fetchPlaces();
    }, [location]);

    return { location, meetings, places, loading };
}
