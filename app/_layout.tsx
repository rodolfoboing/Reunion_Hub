import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, View, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import type { User as FirebaseUser } from 'firebase/auth';
import 'react-native-reanimated';
import { auth, db } from '../src/services/firebaseConfig'; // Import auth
import { doc, onSnapshot } from 'firebase/firestore';
import { useColorScheme } from '@/src/components/useColorScheme';
import { activateNotificationUser, cancelEventReminder, getExpoPushToken, getNotificationRoute, refreshReengagementReminder, reportNotificationOperationError, setEventRemindersEnabled, setReengagementReminderEnabled, setupNotifications } from '../src/utils/Notifications';
import { getNotificationTarget } from '../src/utils/Notifications';
import { markRelatedNotificationsAsRead } from '../src/services/notificationReadService';
import { savePushRegistration, unregisterCurrentPushDevice } from '../src/services/pushRegistrationService';
import { ErrorBoundary as CustomErrorBoundary } from '../src/components/ErrorBoundary';
import { CURRENT_TERMS_VERSION } from '../src/constants/legal';

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
            unregisterCurrentPushDevice(user.uid)
              .catch(() => console.error('[RootLayout] banned_device_cleanup_failed'))
              .finally(() => auth.signOut().catch(() => console.error('[RootLayout] banned_sign_out_failed')));
            router.replace('/login');
            return;
          }
          // Cadastros novos gravam false explicitamente. Perfis antigos que já existiam
          // antes desse campo são tratados como concluídos e não voltam ao onboarding.
          // O onboarding vem antes do reaceite porque também é o caminho de
          // recuperação de perfil inexistente (registro interrompido).
          const profile = snapshot.data();
          const needsOnboarding = !snapshot.exists() || profile?.isProfileComplete === false;
          const needsTermsAcceptance = !needsOnboarding && profile?.termsVersion !== CURRENT_TERMS_VERSION;
          const target = needsOnboarding
            ? '/(auth)/onboarding'
            : needsTermsAcceptance
              ? '/(auth)/accept-terms'
              : '/(drawer)/(tabs)';
          if (lastProfileRoute.current !== target) {
            lastProfileRoute.current = target;
            router.replace(target as never);
          }
        }, () => console.error('[RootLayout] profile_route_check_failed'));
        const unsubscribeNotificationSettings = onSnapshot(doc(db, 'notificationSettings', user.uid), (snapshot) => {
          setEventRemindersEnabled(user.uid, snapshot.data()?.notifyEventReminders !== false).catch(() => {
            console.warn('[RootLayout] reminder_preference_sync_failed');
          });
          setReengagementReminderEnabled(user.uid, snapshot.data()?.notifyRecommendations !== false).catch(() => {
            console.warn('[RootLayout] reengagement_preference_sync_failed');
          });
        }, () => console.error('[RootLayout] reminder_preference_load_failed'));
        return () => {
          unsubscribeProfile();
          unsubscribeNotificationSettings();
        };
      }
    }
  }, [loaded, authInitialized, user]);

  // Fallback de segurança: só atua se fontes ou autenticação ainda não terminaram.
  useEffect(() => {
    if (loaded && authInitialized) return;
    const timer = setTimeout(() => {
      if (__DEV__) console.warn('[RootLayout] splash_fallback_timeout');
      SplashScreen.hideAsync().catch(() => {
        if (__DEV__) console.warn('[RootLayout] splash_fallback_hide_failed');
      });
    }, 3000);
    return () => clearTimeout(timer);
  }, [loaded, authInitialized]);

  // Inicializa notificações e salva o push token
  useEffect(() => {
    if (!authInitialized) return;
    activateNotificationUser(user?.uid ?? null).catch(() => {
      console.warn('[Notifications] reminder_owner_sync_failed');
    });
    if (!user) return;

    setupNotifications().then(async (result) => {
      if (result.granted) {
        await refreshReengagementReminder(user.uid);
      }
      if (result.granted && (result.expoToken || result.nativeToken)) {
        await savePushRegistration(user.uid, result);
      }
    }).catch((error: unknown) => reportNotificationOperationError('setup_or_registration', error));

    const tokenSubscription = Notifications.addPushTokenListener((deviceToken) => {
      getExpoPushToken(deviceToken).then((expoToken) => {
        const nativeToken = typeof deviceToken.data === 'string' ? deviceToken.data : null;
        if (expoToken || nativeToken) return savePushRegistration(user.uid, {
          granted: true,
          expoToken,
          nativeToken,
          platform: deviceToken.type === 'android' ? 'android' : deviceToken.type === 'ios' ? 'ios' : null,
        });
      }).catch((error: unknown) => reportNotificationOperationError('push_token_refresh', error));
    });

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      refreshReengagementReminder(user.uid).catch((error: unknown) => {
        reportNotificationOperationError('reengagement_app_resume', error);
      });
    });

    return () => {
      tokenSubscription.remove();
      appStateSubscription.remove();
    };
  }, [authInitialized, user]);

  useEffect(() => {
    if (!loaded || !authInitialized) return;

    const handleNotificationResponse = async (response: Notifications.NotificationResponse) => {
      const notificationData = response.notification.request.content.data;
      const route = getNotificationRoute(notificationData);
      const target = getNotificationTarget(notificationData);
      const notificationType = typeof notificationData.notificationType === 'string' ? notificationData.notificationType : '';
      if (user && target?.meetingId && (notificationType === 'event_cancelled' || notificationType === 'event_completed')) {
        await cancelEventReminder(target.meetingId, user.uid).catch(() => undefined);
      }
      if (target) {
        try {
          await markRelatedNotificationsAsRead(target);
        } catch (error) {
          console.error('[ReunionHub Debug] Erro ao marcar notificação do push como lida:', error);
        }
      }
      if (route) {
        if (__DEV__) console.info('[Notifications] deep_link_opened', { route });
        router.push(route as never);
      }
      await Notifications.clearLastNotificationResponseAsync();
    };

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response).catch((error) => {
        console.error('[ReunionHub Debug] Erro ao abrir notificação:', error);
      });
    });

    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      const target = getNotificationTarget(data);
      const notificationType = typeof data.notificationType === 'string' ? data.notificationType : '';
      if (user && target?.meetingId && (notificationType === 'event_cancelled' || notificationType === 'event_completed')) {
        cancelEventReminder(target.meetingId, user.uid).catch(() => undefined);
      }
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) return handleNotificationResponse(response);
    }).catch((error) => {
      console.error('[ReunionHub Debug] Erro ao ler última notificação:', error);
    });

    return () => {
      responseSubscription.remove();
      receivedSubscription.remove();
    };
  }, [loaded, authInitialized, user]);

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
