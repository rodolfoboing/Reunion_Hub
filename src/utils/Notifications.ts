import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

export async function setupNotifications() {
  // Configura o handler para decidir o que fazer quando uma notificação é recebida app aberto
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true, // Mostra o alerta
      shouldPlaySound: true, // Toca som
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
      priority: Notifications.AndroidNotificationPriority.HIGH,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  if (finalStatus !== 'granted') {
    console.log('Permissão para notificações negada!');
    return { granted: false, token: null };
  }
  
  let token = null;
  try {
    const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    const tokenResponse = await Notifications.getExpoPushTokenAsync({
        projectId,
    });
    token = tokenResponse.data;
  } catch (error) {
    console.log('Erro ao obter Push Token:', error);
  }

  return { granted: true, token };
}

export async function sendLocalNotification(title: string, body: string, seconds = 0) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
    },
    trigger: seconds > 0 ? { seconds, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL } : null,
  });
}
