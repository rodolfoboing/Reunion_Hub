import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import type { User as FirebaseUser } from 'firebase/auth';
import 'react-native-reanimated';
import { auth, db } from '../src/services/firebaseConfig'; // Import auth
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { useColorScheme } from '@/src/components/useColorScheme';
import { activateNotificationUser, getExpoPushToken, getNotificationRoute, setupNotifications } from '../src/utils/Notifications';
import { getNotificationTarget } from '../src/utils/Notifications';
import { markRelatedNotificationsAsRead } from '../src/services/notificationReadService';
import { ErrorBoundary as CustomErrorBoundary } from '../src/components/ErrorBoundary';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Alteração 1: O ponto de partida agora é (auth) se não estiver logado
  initialRouteName: '(auth)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  const [authInitialized, setAuthInitialized] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const lastProfileRoute = useRef<string | null>(null);

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    // Timeout de segurança caso o Firebase demore a responder
    const timeout = setTimeout(() => {
      setAuthInitialized(true);
    }, 2000);

    const unsubscribe = auth.onAuthStateChanged((u) => {
      clearTimeout(timeout);
      setUser(u);
      setAuthInitialized(true);
    });

    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    console.log(`[ReunionHub Debug] Estado atual: loaded=${loaded}, authInitialized=${authInitialized}, user=${user ? 'Logged In' : 'Logged Out'}`);

    // Só tomamos ação quando TUDO estiver carregado (fontes + auth)
    if (loaded && authInitialized) {
      SplashScreen.hideAsync().catch(e => console.warn(e));

      if (!user) {
        lastProfileRoute.current = null;
        // Redireciona para login se não houver usuário
        router.replace('/login');
      } else {
        const profileRef = doc(db, 'users', user.uid);
        const unsubscribeProfile = onSnapshot(profileRef, (snapshot) => {
          if (snapshot.exists() && snapshot.data().banned === true) {
            console.warn('[RootLayout] banned_account_session_ended');
            auth.signOut().catch(() => console.error('[RootLayout] banned_sign_out_failed'));
            router.replace('/login');
            return;
          }
          // Cadastros novos gravam false explicitamente. Perfis antigos que já existiam
          // antes desse campo são tratados como concluídos e não voltam ao onboarding.
          const target = snapshot.exists() && snapshot.data().isProfileComplete !== false
            ? '/(drawer)/(tabs)'
            : '/(auth)/onboarding';
          if (lastProfileRoute.current !== target) {
            lastProfileRoute.current = target;
            router.replace(target as never);
          }
        }, () => console.error('[RootLayout] profile_route_check_failed'));
        return unsubscribeProfile;
      }
    }
  }, [loaded, authInitialized, user]);

  // Fallback de segurança: Esconde a splash screen após 3 segundos de qualquer jeito
  useEffect(() => {
    const timer = setTimeout(() => {
      console.log("[ReunionHub Debug] Forçando hideAsync após timeout");
      SplashScreen.hideAsync().catch(e => console.warn(e));
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Inicializa notificações e salva o push token
  useEffect(() => {
    if (!authInitialized) return;
    const savePushToken = async (token: string) => {
      if (!user) return;
      try {
        await setDoc(doc(db, 'users', user.uid), { expoPushToken: token }, { merge: true });
        if (__DEV__) console.info('[Notifications] expo_token_saved');
      } catch (error) {
        console.error('[ReunionHub Debug] Erro ao salvar push token', error);
      }
    };

    activateNotificationUser(user?.uid ?? null).catch(() => {
      console.warn('[Notifications] reminder_owner_sync_failed');
    });

    setupNotifications().then(async (result) => {
      console.log('[ReunionHub Debug] Permissões de notificação:', result.granted ? 'Concedidas' : 'Negadas');
      if (result.granted && result.token && user) {
        await savePushToken(result.token);
      }
    }).catch(() => console.error('[Notifications] setup_failed'));

    const tokenSubscription = Notifications.addPushTokenListener((deviceToken) => {
      getExpoPushToken(deviceToken).then((expoToken) => {
        if (expoToken) return savePushToken(expoToken);
      }).catch(() => {
        console.error('[Notifications] expo_token_refresh_failed');
      });
    });

    return () => tokenSubscription.remove();
  }, [authInitialized, user]);

  useEffect(() => {
    if (!loaded || !authInitialized) return;

    const handleNotificationResponse = async (response: Notifications.NotificationResponse) => {
      const notificationData = response.notification.request.content.data;
      const route = getNotificationRoute(notificationData);
      const target = getNotificationTarget(notificationData);
      if (target) {
        try {
          await markRelatedNotificationsAsRead(target);
        } catch (error) {
          console.error('[ReunionHub Debug] Erro ao marcar notificação do push como lida:', error);
        }
      }
      if (route) {
        console.log('[ReunionHub Debug] Abrindo notificação para:', route);
        router.push(route as never);
      }
      await Notifications.clearLastNotificationResponseAsync();
    };

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response).catch((error) => {
        console.error('[ReunionHub Debug] Erro ao abrir notificação:', error);
      });
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) return handleNotificationResponse(response);
    }).catch((error) => {
      console.error('[ReunionHub Debug] Erro ao ler última notificação:', error);
    });

    return () => responseSubscription.remove();
  }, [loaded, authInitialized]);

  if (!loaded || !authInitialized) {
    // Retornamos uma View temporária para garantir que o React renderize algo
    // Isso ajuda a substituir a Splash Screen nativa se o hideAsync funcionar
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#eef2ff' }}>
        <Text style={{ fontSize: 18, color: '#4338ca', marginBottom: 20 }}>Carregando Reunion Hub...</Text>
        <Text>Status: Fontes={loaded ? 'OK' : '...'}, Auth={authInitialized ? 'OK' : '...'}</Text>
      </View>
    );
  }

  console.log('[ReunionHub Debug] Renderizando RootLayoutNav');
  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <SafeAreaProvider>
    <CustomErrorBoundary>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          {/* Alteração 2: Stack com grupos (main) e (auth) */}
          <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="info-modal" options={{ presentation: 'modal' }} />
        </Stack>
      </ThemeProvider>
    </CustomErrorBoundary>
    </SafeAreaProvider>
  );
}
