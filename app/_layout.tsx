import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useState } from 'react';
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
import { syncOwnEventReminders } from '../src/services/eventReminderSyncService';
import { ErrorBoundary as CustomErrorBoundary } from '../src/components/ErrorBoundary';
import { getSessionRedirect, isServerConfirmed, resolveProfileGate, type ProfileGate } from '../src/utils/sessionGate';
import { toUserProfile } from '../src/utils/userProfile';
import { UserProfileProvider } from '../src/hooks/useUserProfile';
import type { User } from '../src/types';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

// Sem `unstable_settings.initialRouteName` de propósito: com '(auth)' ali, toda
// abertura do app montava a pilha raiz como [(auth), (drawer)], e o "voltar" da
// Home revelava uma tela de auth (com a sessão ativa) em vez de fechar o app.
// Quem decide entre auth e app é o SessionRedirect, abaixo.

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  const [authInitialized, setAuthInitialized] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  // Guardado junto do uid: o portão de uma conta nunca vale para a próxima que entrar.
  const [confirmedGate, setConfirmedGate] = useState<{ uid: string; gate: ProfileGate } | null>(null);
  // Perfil publicado no Context para toda a árvore autenticada — ver
  // `src/hooks/useUserProfile.tsx`. Alimentado pelo listener abaixo, que já
  // existia para o portão de sessão.
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const userId = user?.uid ?? null;
  const profileGate = confirmedGate && confirmedGate.uid === userId ? confirmedGate.gate : null;

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
    // Só escondemos a splash quando TUDO estiver carregado (fontes + auth)
    if (loaded && authInitialized) {
      SplashScreen.hideAsync().catch(e => console.warn(e));
    }
  }, [loaded, authInitialized]);

  // Lê o perfil e as preferências da sessão. Não navega: só calcula o portão,
  // que o SessionRedirect aplica comparando com a rota atual.
  useEffect(() => {
    // Sessão encerrada: limpa o perfil publicado, senão a próxima conta a entrar
    // veria por um instante os dados da anterior.
    if (!userId) {
      setUserProfile(null);
      return;
    }

    let banHandled = false;
    // Assinatura do último perfil publicado no Context. `includeMetadataChanges`
    // faz este listener disparar também em troca de metadado, e `toUserProfile`
    // devolve objeto novo a cada chamada — sem esta comparação, cada flip de
    // metadado re-renderizaria todas as abas montadas.
    let publishedProfile = '';
    // includeMetadataChanges: sem isso, a confirmação do servidor de um dado igual
    // ao do cache não gera evento, e o portão ficaria esperando para sempre.
    const unsubscribeProfile = onSnapshot(doc(db, 'users', userId), { includeMetadataChanges: true }, (snapshot) => {
      const profile = snapshot.data();

      // Publica o perfil ANTES da lógica do portão: o portão sai cedo em
      // snapshot não confirmado (`if (!gate) return`), e as telas não têm por que
      // esperar por isso para mostrar interesses, favoritos ou papel.
      const nextProfile = snapshot.exists() && profile ? toUserProfile(userId, profile) : null;
      const nextSignature = nextProfile ? JSON.stringify(nextProfile) : '';
      if (nextSignature !== publishedProfile) {
        publishedProfile = nextSignature;
        setUserProfile(nextProfile);
      }

      // `banned` só é gravado pelo servidor, então vale mesmo vindo do cache.
      if (profile?.banned === true) {
        if (banHandled) return;
        banHandled = true;
        console.warn('[RootLayout] banned_account_session_ended');
        unregisterCurrentPushDevice(userId)
          .catch(() => console.error('[RootLayout] banned_device_cleanup_failed'))
          .finally(() => auth.signOut().catch(() => console.error('[RootLayout] banned_sign_out_failed')));
        return;
      }
      const gate = resolveProfileGate(snapshot.exists() ? profile : undefined, snapshot.metadata);
      if (!gate) return;
      setConfirmedGate((current) => (current?.uid === userId && current.gate === gate ? current : { uid: userId, gate }));
    }, () => console.error('[RootLayout] profile_route_check_failed'));

    // Mesma regra do perfil: um cache vazio (offline) ou um merge local parcial
    // liam as chaves ausentes como `true` e religavam lembretes desativados.
    let appliedPreferences: string | null = null;
    const unsubscribeNotificationSettings = onSnapshot(doc(db, 'notificationSettings', userId), { includeMetadataChanges: true }, (snapshot) => {
      if (!isServerConfirmed(snapshot.metadata)) return;
      const eventReminders = snapshot.data()?.notifyEventReminders !== false;
      const recommendations = snapshot.data()?.notifyRecommendations !== false;
      const preferences = `${eventReminders}|${recommendations}`;
      if (preferences === appliedPreferences) return;
      appliedPreferences = preferences;
      setEventRemindersEnabled(userId, eventReminders).then(() => {
        if (eventReminders) return syncOwnEventReminders(userId, true);
      }).catch(() => console.warn('[RootLayout] reminder_preference_sync_failed'));
      setReengagementReminderEnabled(userId, recommendations).catch(() => {
        console.warn('[RootLayout] reengagement_preference_sync_failed');
      });
    }, () => console.error('[RootLayout] reminder_preference_load_failed'));

    return () => {
      unsubscribeProfile();
      unsubscribeNotificationSettings();
    };
  }, [userId]);

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

    let pushSaved = false;
    let registeringPush = false;
    const registerPush = async () => {
      if (registeringPush || auth.currentUser?.uid !== user.uid) return;
      registeringPush = true;
      try {
        const result = await setupNotifications();
        if (auth.currentUser?.uid !== user.uid) return;
        if (result.granted) {
          refreshReengagementReminder(user.uid).catch((error: unknown) =>
            reportNotificationOperationError('reengagement_after_registration', error));
        }
        if (result.granted && (result.expoToken || result.nativeToken)) {
          await savePushRegistration(user.uid, result);
          pushSaved = true;
        }
      } catch (error) {
        reportNotificationOperationError('setup_or_registration', error);
      } finally {
        registeringPush = false;
      }
    };
    void registerPush();

    const tokenSubscription = Notifications.addPushTokenListener((deviceToken) => {
      getExpoPushToken(deviceToken).catch((error: unknown) => {
        reportNotificationOperationError('expo_push_token_refresh', error);
        return null;
      }).then((expoToken) => {
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
      syncOwnEventReminders(user.uid).catch((error: unknown) =>
        reportNotificationOperationError('event_reminders_app_resume', error));
      if (!pushSaved) void registerPush();
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
      } else if (user && target?.meetingId && notificationType === 'event_updated') {
        syncOwnEventReminders(user.uid, true).catch((error: unknown) =>
          reportNotificationOperationError('event_reminders_after_update', error));
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
      } else if (user && target?.meetingId && notificationType === 'event_updated') {
        syncOwnEventReminders(user.uid, true).catch((error: unknown) =>
          reportNotificationOperationError('event_reminders_after_update', error));
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

  return <RootLayoutNav signedIn={userId !== null} profileGate={profileGate} userProfile={userProfile} />;
}

function RootLayoutNav({ signedIn, profileGate, userProfile }: {
  signedIn: boolean;
  profileGate: ProfileGate | null;
  userProfile: User | null;
}) {
  const colorScheme = useColorScheme();

  return (
    <SafeAreaProvider>
    <CustomErrorBoundary>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* Dentro do ThemeProvider e por fora do Stack: toda tela enxerga o perfil
          sem abrir listener próprio. */}
      <UserProfileProvider profile={userProfile}>
        <Stack>
          {/* Alteração 2: Stack com grupos (main) e (auth) */}
          <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="info-modal" options={{ presentation: 'modal' }} />
        </Stack>
        {/* Depois do Stack: o efeito dele roda com o navegador já montado. */}
        <SessionRedirect signedIn={signedIn} profileGate={profileGate} />
      </UserProfileProvider>
      </ThemeProvider>
    </CustomErrorBoundary>
    </SafeAreaProvider>
  );
}

/**
 * Único dono dos redirecionamentos de sessão. Compara a rota ATUAL com a que a
 * sessão exige, em vez de lembrar o último destino: aquele atalho dessincronizava
 * com o botão voltar e com as navegações das telas de login/cadastro, deixando a
 * pessoa logada presa numa tela de auth ou pulando o aceite dos termos.
 */
function SessionRedirect({ signedIn, profileGate }: { signedIn: boolean; profileGate: ProfileGate | null }) {
  const segments: string[] = useSegments();
  const group = segments[0];
  const screen = segments[1];

  useEffect(() => {
    const target = getSessionRedirect({ signedIn, profileGate, group, screen });
    if (!target) return;
    if (__DEV__) console.info('[RootLayout] session_redirect', { from: `${group}/${screen}`, target });
    // Descarta o que foi empilhado por cima (evento, conversa...) para o voltar
    // não levar de novo para fora do portão.
    if (router.canDismiss()) router.dismissAll();
    router.replace(target);
  }, [signedIn, profileGate, group, screen]);

  return null;
}
