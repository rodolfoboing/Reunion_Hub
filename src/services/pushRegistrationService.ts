import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteField, deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/src/services/firebaseConfig';
import type { PushRegistration } from '@/src/utils/Notifications';

const PUSH_DEVICE_ID_KEY = '@reunionhub_push_device_id';

function createDeviceId(): string {
    const randomParts = Array.from({ length: 5 }, () => Math.random().toString(36).slice(2, 12));
    return `device_${Date.now().toString(36)}_${randomParts.join('')}`;
}

async function getPushDeviceId(): Promise<string> {
    const storedId = await AsyncStorage.getItem(PUSH_DEVICE_ID_KEY);
    if (storedId?.startsWith('device_') && storedId.length <= 100) return storedId;

    const deviceId = createDeviceId();
    await AsyncStorage.setItem(PUSH_DEVICE_ID_KEY, deviceId);
    return deviceId;
}

export async function savePushRegistration(userId: string, registration: PushRegistration): Promise<void> {
    if (auth.currentUser?.uid !== userId || (!registration.expoToken && !registration.nativeToken)) return;

    const deviceId = await getPushDeviceId();
    await setDoc(doc(db, 'pushDevices', deviceId), {
        userId,
        expoPushToken: registration.expoToken,
        nativePushToken: registration.nativeToken,
        platform: registration.platform,
        updatedAt: serverTimestamp(),
    });

    // Migração segura: o servidor novo envia apenas para registros por dispositivo.
    // Remover o formato antigo evita que dados privados permaneçam duplicados.
    await Promise.all([
        deleteDoc(doc(db, 'pushTokens', userId)).catch(() => undefined),
        setDoc(doc(db, 'users', userId), { expoPushToken: deleteField() }, { merge: true }).catch(() => undefined),
    ]);
}

export async function unregisterCurrentPushDevice(userId: string): Promise<void> {
    if (auth.currentUser?.uid !== userId) return;
    const deviceId = await getPushDeviceId();
    const deviceRef = doc(db, 'pushDevices', deviceId);
    const snapshot = await getDoc(deviceRef);
    if (!snapshot.exists() || snapshot.data().userId !== userId) return;
    await deleteDoc(deviceRef);
}
