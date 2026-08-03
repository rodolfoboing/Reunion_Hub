import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import 'react-native-reanimated';
import { auth, db } from '../src/services/firebaseConfig'; // Import auth
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useColorScheme } from '@/src/components/useColorScheme';
import { getNotificationRoute, setupNotifications } from '../src/utils/Notifications';
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
  const [user, setUser] = useState<any>(null);

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
        // Redireciona para login se não houver usuário
        router.replace('/login');
      } else {
        // Verifica se o perfil está completo
        const checkProfile = async () => {
          try {
            const docRef = doc(db, 'users', user.uid);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
              const data = docSnap.data();
              // Sync email verification status if it changed
              if (user.emailVerified && !data.emailVerified) {
                await setDoc(docRef, { emailVerified: true }, { merge: true });
              }
              
              if (data.isProfileComplete === false) {
                console.log("[ReunionHub Debug] Perfil incompleto, redirecionando para onboarding.");
                router.replace('/onboarding' as any);
              }
            }
          } catch (error) {
            console.error("Erro ao checar perfil completo", error);
          }
        };
        checkProfile();
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
    const savePushToken = async (token: string) => {
      if (!user) return;
      try {
        await setDoc(doc(db, 'users', user.uid), { expoPushToken: token }, { merge: true });
        console.log('[ReunionHub Debug] Push Token salvo no Firestore para o usuário:', user.uid);
      } catch (error) {
        console.error('[ReunionHub Debug] Erro ao salvar push token', error);
      }
    };

    setupNotifications().then(async (result) => {
      console.log('[ReunionHub Debug] Permissões de notificação:', result.granted ? 'Concedidas' : 'Negadas');
      if (result.granted && result.token && user) {
        await savePushToken(result.token);
      }
    });

    const tokenSubscription = Notifications.addPushTokenListener(({ data: token }) => {
      savePushToken(token).catch((error) => {
        console.error('[ReunionHub Debug] Erro ao atualizar push token', error);
      });
    });

    return () => tokenSubscription.remove();
  }, [user]);

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
