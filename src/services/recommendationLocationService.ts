import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/src/services/firebaseConfig';

const LOCATION_CACHE_KEY_PREFIX = '@reunionhub_recommendation_location:';
const LOCATION_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

type Coordinates = {
    latitude: number;
    longitude: number;
};

function approximateCoordinate(value: number): number {
    return Math.round(value * 10) / 10;
}

function validCoordinates(coordinates: Coordinates): boolean {
    return Number.isFinite(coordinates.latitude)
        && Number.isFinite(coordinates.longitude)
        && coordinates.latitude >= -90
        && coordinates.latitude <= 90
        && coordinates.longitude >= -180
        && coordinates.longitude <= 180;
}

function recentCell(value: string | null, cellKey: string): boolean {
    if (!value) return false;
    try {
        const parsed: unknown = JSON.parse(value);
        if (!parsed || typeof parsed !== 'object' || !('cellKey' in parsed) || !('savedAt' in parsed)) return false;
        return parsed.cellKey === cellKey
            && typeof parsed.savedAt === 'number'
            && Date.now() - parsed.savedAt < LOCATION_REFRESH_INTERVAL_MS;
    } catch {
        return false;
    }
}

export async function updateRecommendationLocation(userId: string, coordinates: Coordinates): Promise<void> {
    if (!userId || !validCoordinates(coordinates)) return;

    const latitude = approximateCoordinate(coordinates.latitude);
    const longitude = approximateCoordinate(coordinates.longitude);
    const cellKey = `${latitude.toFixed(1)}:${longitude.toFixed(1)}`;
    const cacheKey = `${LOCATION_CACHE_KEY_PREFIX}${userId}`;
    if (recentCell(await AsyncStorage.getItem(cacheKey), cellKey)) return;

    const settingsRef = doc(db, 'notificationSettings', userId);
    const settingsSnapshot = await getDoc(settingsRef);
    if (!settingsSnapshot.exists() || settingsSnapshot.data()?.notifyRecommendations !== true) return;

    await setDoc(settingsRef, {
        recommendationLocation: {
            latitude,
            longitude,
            updatedAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
    }, { merge: true });
    await AsyncStorage.setItem(cacheKey, JSON.stringify({ cellKey, savedAt: Date.now() }));
}

export async function clearRecommendationLocationCache(userId: string): Promise<void> {
    await AsyncStorage.removeItem(`${LOCATION_CACHE_KEY_PREFIX}${userId}`);
}
