import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Drawer } from 'expo-router/drawer';
import { Ionicons } from '@expo/vector-icons';
import CustomDrawerContent from './CustomDrawerContent';

export default function DrawerLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer
        drawerContent={(props) => <CustomDrawerContent {...props} />}
        screenOptions={{
          headerShown: false,
          // Gaveta desativada: nenhum ponto do app a abre (não existe botão de
          // menu nem chamada a openDrawer), então o gesto de borda era a única
          // porta — e abria uma lista que o usuário nunca deveria ver, com as
          // rotas de app/(drawer)/ que não estão declaradas abaixo aparecendo
          // com rótulo padrão e sem ícone.
          //
          // O Drawer continua como container das rotas: /profile e
          // /notifications seguem funcionando por router.push(), que é como o
          // app realmente navega até elas.
          swipeEnabled: false,
          drawerActiveTintColor: '#4f46e5',
          drawerInactiveTintColor: '#6b7280',
          drawerLabelStyle: { marginLeft: -20, fontWeight: '600' }
        }}
      >
        {/* Aqui conectamos o Drawer às Tabs que você já tem */}
        <Drawer.Screen
          name="(tabs)"
          options={{
            drawerLabel: 'Início',
            title: 'Reunion Hub',
            drawerIcon: ({ color, size }) => (
              <Ionicons name="home-outline" size={size} color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="notifications"
          options={{
            drawerLabel: 'Notificações',
            title: 'Notificações',
            drawerIcon: ({ color, size }) => (
              <Ionicons name="notifications-outline" size={size} color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="profile"
          options={{
            drawerLabel: 'Meu Perfil',
            title: 'Meu Perfil',
            drawerIcon: ({ color, size }) => (
              <Ionicons name="person-outline" size={size} color={color} />
            ),
          }}
        />
        {/* Redirecionamentos de rotas antigas (/map → /explore, /my-events →
            /agenda). Continuam valendo como destino de link, mas não são telas:
            sem esta declaração o Expo Router os registrava sozinho na lista da
            gaveta, com rótulo cru e sem ícone. */}
        <Drawer.Screen name="map" options={{ drawerItemStyle: { display: 'none' } }} />
        <Drawer.Screen name="my-events" options={{ drawerItemStyle: { display: 'none' } }} />
      </Drawer>
    </GestureHandlerRootView>
  );
}
