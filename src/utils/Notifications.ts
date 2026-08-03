import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const EVENT_REMINDERS_KEY = '@reunionhub_event_reminders';

export type PushRegistration = {
  granted: boolean;
  token: string | null;
};

export type NotificationTarget = {
  conversationId?: string;
  meetingId?: string;
};

export function getNotificationTarget(data: unknown): NotificationTarget | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as { eventId?: unknown; meetingId?: unknown; conversationId?: unknown };
  if (typeof payload.conversationId === 'string') return { conversationId: payload.conversationId };
  if (typeof payload.meetingId === 'string') return { meetingId: payload.meetingId };
  if (typeof payload.eventId === 'string') return { meetingId: payload.eventId };
  return null;
}

export function getNotificationRoute(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as { path?: unknown; url?: unknown; eventId?: unknown; meetingId?: unknown; conversationId?: unknown };
  const directPath = typeof payload.path === 'string' ? payload.path : payload.url;
  if (typeof directPath === 'string' && directPath.startsWith('/')) return directPath;
  const target = getNotificationTarget(data);
  if (target?.conversationId) return `/conversation/${target.conversationId}`;
  if (target?.meetingId) return `/event/${target.meetingId}`;
  return null;
}

export async function setupNotifications(): Promise<PushRegistration> {
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
    console.log('[Notifications] Permissão para notificações negada.');
    return { granted: false, token: null };
  }
  
  let token = null;
  try {
    const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) {
      throw new Error('Expo projectId não encontrado para registrar push token.');
    }
    const tokenResponse = await Notifications.getExpoPushTokenAsync({
        projectId,
    });
    token = tokenResponse.data;
  } catch (error) {
    console.error('[Notifications] Erro ao obter Expo Push Token:', error);
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

export async function scheduleEventReminder(event: { id: string; title: string; date?: string; time?: string }) {
  if (!event.date || !event.time) return;

  const eventDate = new Date(`${event.date}T${event.time}:00`);
  const reminderDate = new Date(eventDate.getTime() - 2 * 60 * 60 * 1000);
  if (Number.isNaN(reminderDate.getTime()) || reminderDate <= new Date()) return;

  const reminders = JSON.parse(await AsyncStorage.getItem(EVENT_REMINDERS_KEY) || '{}') as Record<string, string>;
  if (reminders[event.id]) await Notifications.cancelScheduledNotificationAsync(reminders[event.id]);

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: { title: 'Seu evento começa em breve', body: `"${event.title}" começa em cerca de 2 horas.`, sound: true, data: { eventId: event.id } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminderDate },
  });
  reminders[event.id] = notificationId;
  await AsyncStorage.setItem(EVENT_REMINDERS_KEY, JSON.stringify(reminders));
}

export async function cancelEventReminder(eventId: string) {
  const reminders = JSON.parse(await AsyncStorage.getItem(EVENT_REMINDERS_KEY) || '{}') as Record<string, string>;
  const notificationId = reminders[eventId];
  if (!notificationId) return;
  await Notifications.cancelScheduledNotificationAsync(notificationId);
  delete reminders[eventId];
  await AsyncStorage.setItem(EVENT_REMINDERS_KEY, JSON.stringify(reminders));
}
