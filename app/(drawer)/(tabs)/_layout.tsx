import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';

import Colors from '@/src/constants/Colors';
import { useColorScheme } from '@/src/components/useColorScheme';
import { useClientOnlyValue } from '@/src/components/useClientOnlyValue';
import { useEffect, useState } from 'react';
import { auth, db } from '../../../src/services/firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

// You can explore the built-in icon families and icons on the web at https://icons.expo.fyi/
function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={28} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let isActive = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (isActive) setIsAdmin(false);
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const role = userDoc.exists() ? userDoc.get('role') : null;

        if (isActive) {
          setIsAdmin(role === 'admin' || role === 'moderator');
        }
      } catch (error) {
        console.error('[Tabs] Failed to load moderation role:', error);
        if (isActive) setIsAdmin(false);
      }
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        // Disable the static render of the header on web
        // to prevent a hydration error in React Navigation v6.
        headerShown: useClientOnlyValue(false, true),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Início',
          headerShown: false, // <--- ADICIONE ESTA LINHA AQUI
          tabBarIcon: ({ color }) => <TabBarIcon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explorar Eventos',
          headerShown: false,
          tabBarIcon: ({ color }) => <TabBarIcon name="compass" color={color} />,
        }}
      />
      <Tabs.Screen
        name="agenda"
        options={{
          title: 'Minha Agenda',
          headerShown: false,
          tabBarIcon: ({ color }) => <TabBarIcon name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Mensagens',
          headerShown: false,
          tabBarIcon: ({ color }) => <TabBarIcon name="envelope" color={color} />,
        }}
      />
      <Tabs.Screen
        name="moderation"
        options={{
          href: isAdmin ? '/(drawer)/(tabs)/moderation' : null, // Oculta a tab bar inteira se não for admin
          title: 'Moderação',
          headerShown: false,
          tabBarIcon: ({ color }) => <TabBarIcon name="shield" color={color} />,
        }}
      />
    </Tabs>
  );
}
