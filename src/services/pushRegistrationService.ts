import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteField, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/src/services/firebaseConfig';
import type { PushRegistration } from '@/src/utils/Notifications';

const PUSH_DEVICE_ID_KEY = '@reunionhub_push_device_id';

function createDeviceId(): string {
    const randomParts = Array.from({ length: 5 }, () => Math.random().toString(36).slice(2, 12));
    return `device_${Date.now().toString(36)}_${randomParts.join('')}`;
}

let cachedDeviceIdPromise: Promise<string> | null = null;

// Memoizado: sem isso, duas chamadas concorrentes na primeira execução (ex.:
// setupNotifications() e o listener de token do expo-notifications disparando
// quase juntos, comum no primeiro login num aparelho novo) podiam ler o
// AsyncStorage antes de qualquer uma gravar, cada uma gerando um deviceId
// diferente — dois documentos pushDevices para o mesmo aparelho, e toda
// notificação do servidor saía duplicada dali em diante.
function getPushDeviceId(): Promise<string> {
    if (!cachedDeviceIdPromise) {
        cachedDeviceIdPromise = (async () => {
            const storedId = await AsyncStorage.getItem(PUSH_DEVICE_ID_KEY);
            if (storedId?.startsWith('device_') && storedId.length <= 100) return storedId;

            const deviceId = createDeviceId();
            await AsyncStorage.setItem(PUSH_DEVICE_ID_KEY, deviceId);
            return deviceId;
        })().catch((error) => {
            cachedDeviceIdPromise = null; // permite tentar de novo na próxima chamada em vez de travar a sessão inteira
            console.warn('[PushRegistration] device_id_failed');
            throw error;
        });
    }
    return cachedDeviceIdPromise;
}

export async function savePushRegistration(userId: string, registration: PushRegistration): Promise<void> {
    if (auth.currentUser?.uid !== userId || (!registration.expoToken && !registration.nativeToken)) return;

    const deviceId = await getPushDeviceId();
    const deviceRef = doc(db, 'pushDevices', deviceId);
    // Uma falha temporária em um dos provedores não pode apagar o token válido
    // do mesmo aparelho. Ao trocar de conta, nunca herdamos tokens da anterior.
    // A leitura de um registro pertencente à conta anterior é negada pelas
    // regras; a nova conta ainda pode assumir o mesmo aparelho pela escrita.
    const previous = await getDoc(deviceRef).catch(() => null);
    const sameOwner = previous?.exists() && previous.data().userId === userId;
    await setDoc(deviceRef, {
        userId,
        expoPushToken: registration.expoToken ?? (sameOwner ? previous?.data().expoPushToken ?? null : null),
        nativePushToken: registration.nativeToken ?? (sameOwner ? previous?.data().nativePushToken ?? null : null),
        platform: registration.platform,
        updatedAt: serverTimestamp(),
    });
    // Nunca logar o valor dos tokens (§14) — só a presença deles.
    if (__DEV__) console.info('[PushRegistration] device_saved', {
        deviceId,
        platform: registration.platform,
        hasExpoToken: Boolean(registration.expoToken),
        hasNativeToken: Boolean(registration.nativeToken),
    });

    // Migração segura: o servidor novo envia apenas para registros por dispositivo.
    // Remover o formato antigo evita que dados privados permaneçam duplicados.
    // updateDoc, não setDoc com merge: o merge num perfil que ainda não chegou do
    // servidor criava localmente um `users/{uid}` só com esse campo, e o portão
    // do RootLayout lia a falta de `termsVersion` como "Atualizamos os termos".
    await Promise.all([
        deleteDoc(doc(db, 'pushTokens', userId)).catch(() => undefined),
        updateDoc(doc(db, 'users', userId), { expoPushToken: deleteField() }).catch(() => undefined),
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
