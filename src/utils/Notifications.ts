import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getEventDateTime } from '@/src/utils/eventSchedule';

const LEGACY_EVENT_REMINDERS_KEY = '@reunionhub_event_reminders';
const EVENT_REMINDERS_KEY_PREFIX = '@reunionhub_event_reminders:';
let reminderQueue: Promise<void> = Promise.resolve();

export type EventReminder = {
  id: string;
  title: string;
  date?: string;
  time?: string;
};

function notificationIdRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

export type PushRegistration = {
  granted: boolean;
  token: string | null;
};

export type NotificationTarget = {
  conversationId?: string;
  meetingId?: string;
};

function eventRemindersKey(userId: string): string {
  return `${EVENT_REMINDERS_KEY_PREFIX}${userId}`;
}

function expoProjectId(): string | null {
  return Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId ?? null;
}

export async function getExpoPushToken(devicePushToken?: Notifications.DevicePushToken): Promise<string | null> {
  const projectId = expoProjectId();
  if (!projectId) throw new Error('Expo projectId não encontrado para registrar push token.');
  const response = await Notifications.getExpoPushTokenAsync({ projectId, devicePushToken });
  return response.data;
}

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
    token = await getExpoPushToken();
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

async function loadReminderIds(userId: string): Promise<Record<string, string>> {
  const storedReminders = await AsyncStorage.getItem(eventRemindersKey(userId));
  let reminders: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(storedReminders || '{}');
    reminders = notificationIdRecord(parsed);
  } catch {
    console.warn('[Notifications] stored_event_reminders_invalid');
  }

  return reminders;
}

async function saveReminderIds(userId: string, reminders: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(eventRemindersKey(userId), JSON.stringify(reminders));
}

async function pruneMissingReminderIds(userId: string, reminders: Record<string, string>): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const scheduledIds = new Set(scheduled.map((notification) => notification.identifier));
  let changed = false;
  Object.entries(reminders).forEach(([eventId, notificationId]) => {
    if (!scheduledIds.has(notificationId)) {
      delete reminders[eventId];
      changed = true;
    }
  });
  if (changed) await saveReminderIds(userId, reminders);
}

async function scheduleEventRemindersOperation(events: EventReminder[], userId: string, removeMissing: boolean): Promise<void> {
  const reminders = await loadReminderIds(userId);
  await pruneMissingReminderIds(userId, reminders);
  const desiredEventIds = new Set<string>();

  for (const event of events) {
    if (!event.date || !event.time) continue;
    const eventDate = getEventDateTime(event.date, event.time);
    if (!eventDate) continue;
    const reminderDate = new Date(eventDate.getTime() - 2 * 60 * 60 * 1000);
    if (Number.isNaN(reminderDate.getTime()) || reminderDate <= new Date()) continue;
    desiredEventIds.add(event.id);

    if (reminders[event.id]) {
      continue;
    }
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Seu evento começa em 2 horas',
        body: `"${event.title}" começa em cerca de 2 horas.`,
        sound: true,
        data: { eventId: event.id, reminderType: 'event', reminderOwnerId: userId },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminderDate },
    });
    reminders[event.id] = notificationId;
    try {
      await saveReminderIds(userId, reminders);
    } catch (error) {
      await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
      delete reminders[event.id];
      throw error;
    }
  }

  if (removeMissing) {
    for (const [eventId, notificationId] of Object.entries(reminders)) {
      if (desiredEventIds.has(eventId)) continue;
      await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
      delete reminders[eventId];
    }
    await saveReminderIds(userId, reminders);
  }
}

export function scheduleEventReminders(events: EventReminder[], userId: string): Promise<void> {
  const operation = reminderQueue.then(() => scheduleEventRemindersOperation(events, userId, false));
  reminderQueue = operation.catch(() => undefined);
  return operation;
}

export function syncEventReminders(events: EventReminder[], userId: string): Promise<void> {
  const operation = reminderQueue.then(() => scheduleEventRemindersOperation(events, userId, true));
  reminderQueue = operation.catch(() => undefined);
  return operation;
}

export function scheduleEventReminder(event: EventReminder, userId: string): Promise<void> {
  return scheduleEventReminders([event], userId);
}

export function cancelEventReminder(eventId: string, userId: string): Promise<void> {
  const operation = reminderQueue.then(async () => {
    const reminders = await loadReminderIds(userId);
    const notificationId = reminders[eventId];
    if (!notificationId) return;
    await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
    delete reminders[eventId];
    await saveReminderIds(userId, reminders);
  });
  reminderQueue = operation.catch(() => undefined);
  return operation;
}

export function activateNotificationUser(userId: string | null): Promise<void> {
  const operation = reminderQueue.then(async () => {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled.map(async (notification) => {
      const data = notification.content.data;
      if (data?.reminderType !== 'event') return;
      if (userId && data.reminderOwnerId === userId) return;
      await Notifications.cancelScheduledNotificationAsync(notification.identifier).catch(() => undefined);
    }));

    let legacy: Record<string, string> = {};
    try {
      legacy = notificationIdRecord(JSON.parse(await AsyncStorage.getItem(LEGACY_EVENT_REMINDERS_KEY) || '{}'));
    } catch {
      console.warn('[Notifications] legacy_event_reminders_invalid');
    }
    await Promise.all(Object.values(legacy).map((notificationId) =>
      Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined)
    ));
    await AsyncStorage.removeItem(LEGACY_EVENT_REMINDERS_KEY);
  });
  reminderQueue = operation.catch(() => undefined);
  return operation;
}
