import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import 'react-native-reanimated';
import { auth } from '../firebaseConfig'; // Import auth
import { useColorScheme } from '@/components/useColorScheme';
import { setupNotifications } from '../utils/Notifications';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Alteração 1: O ponto de partida agora é o Drawer, não as Tabs diretas
  initialRouteName: '(drawer)',
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
        router.replace('/(drawer)/login');
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

  // Inicializa notificações
  useEffect(() => {
    setupNotifications().then(granted => {
      console.log('[ReunionHub Debug] Permissões de notificação:', granted ? 'Concedidas' : 'Negadas');
    });
  }, []);

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
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        {/* Alteração 2: Apontamos para a pasta (drawer) */}
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
    </ThemeProvider>
  );
}
