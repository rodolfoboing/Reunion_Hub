import { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import { collection, onSnapshot, query, where, limit, getDocs } from 'firebase/firestore';
import { db } from '@/src/services/firebaseConfig';
import { fetchNearbyPlaces, mapOsmToPlace } from '@/src/services/osmService';
import { Meeting, Place } from '@/src/types';

export function useExploreData() {
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [places, setPlaces] = useState<Place[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
                let loc = await Location.getCurrentPositionAsync({});
                setLocation(loc);
            }
        })();

        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const q = query(
            collection(db, 'meetings'),
            where('date', '>=', todayStr),
            limit(100)
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...(doc.data() as Omit<Meeting, 'id'>),
                lat: doc.data().lat || -23.5505,
                lng: doc.data().lng || -46.6333,
                locationName: doc.data().locationName || 'Local a definir'
            })) as Meeting[];
            setMeetings(data);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!location) return;
        const fetchPlaces = async () => {
            const lat = location.coords.latitude;
            const lon = location.coords.longitude;
            const delta = 0.05;
            const rawOsm = await fetchNearbyPlaces(lat - delta, lon - delta, lat + delta, lon + delta);
            const mapped = rawOsm.map(mapOsmToPlace).filter((p: Place | null) => p !== null);
            
            const q = query(collection(db, 'places'), limit(100));
            const snap = await getDocs(q);
            const dbPlaces = snap.docs.map(d => ({id: d.id, ...d.data()} as Place));

            const finalPlaces = mapped.map((osmPlace: any) => {
                const dbMatch = dbPlaces.find((p) => p.id === osmPlace.id);
                return dbMatch ? { ...osmPlace, ...dbMatch } : osmPlace;
            });
            
            const extraDb = dbPlaces.filter((p) => !finalPlaces.some((fp: any) => fp.id === p.id));
            setPlaces([...finalPlaces, ...extraDb] as Place[]);
        };
        fetchPlaces();
    }, [location]);

    return { location, meetings, places, loading };
}

export default function Ignore() { return null; }
