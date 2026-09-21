import { initializeApp } from "firebase/app";
import { getFirestore, initializeFirestore } from "firebase/firestore";
import { initializeAuth, getReactNativePersistence, getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Configuração pública do cliente Firebase, com valores padrão no próprio código.
 *
 * Estes valores JÁ são públicos por definição: o prefixo `EXPO_PUBLIC_` faz o
 * Metro inliná-los dentro do bundle, então qualquer pessoa que abra o app —
 * web ou APK — consegue lê-los. Não é o sigilo deles que protege os dados, e sim
 * as `firestore.rules` e as Cloud Functions (ver §13 do CLAUDE.md).
 *
 * Tê-los aqui faz um clone novo rodar sem etapa manual de configuração, que é o
 * caso do GitHub Codespaces. A variável de ambiente continua tendo precedência,
 * então apontar para outro projeto Firebase é só definir o `.env`.
 *
 * A chave do Google Maps NÃO segue este padrão de propósito: ela é cobrável e
 * fica fora do repositório. Veja `.env.example`.
 */
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "AIzaSyCHRxRFDSiemidPLyMapXJ20XYjSzSWXQQ",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "reunionhub-f23cd.firebaseapp.com",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "reunionhub-f23cd",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "reunionhub-f23cd.firebasestorage.app",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "814626560626",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "1:814626560626:web:ccfc5edc0dbba89cd4c0eb",
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-XRL0E64SNX"
};


const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true
});

import { Platform } from 'react-native';

// Initialize Auth with persistence for native, default for web
export const auth = Platform.OS === 'web'
  ? getAuth(app)
  : initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage)
    });

export const storage = getStorage(app);
export const functions = getFunctions(app, 'us-central1');
