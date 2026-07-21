import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link, Tabs } from 'expo-router';
import { Pressable } from 'react-native';

import Colors from '@/src/constants/Colors';
import { useColorScheme } from '@/src/components/useColorScheme';
import { useClientOnlyValue } from '@/src/components/useClientOnlyValue';
import { useEffect, useState } from 'react';
import { auth, db } from '../../../src/services/firebaseConfig';
import { doc, getDoc, setDoc } from 'firebase/firestore';

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
    const checkRole = async () => {
      if (auth.currentUser) {
        // --- AUTO ADMIN PROMOTION PARA TESTE ---
        if (auth.currentUser.email === 'rodolfo-bm473@hotmail.com') {
            await setDoc(doc(db, 'users', auth.currentUser.uid), { role: 'admin' }, { merge: true });
        }
        // ---------------------------------------

        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const role = userDoc.data().role;
          if (role === 'admin' || role === 'moderator') {
            setIsAdmin(true);
          }
        }
      }
    };
    checkRole();
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
