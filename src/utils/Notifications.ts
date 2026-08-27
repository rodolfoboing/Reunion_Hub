import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getEventInterval } from '@/src/utils/eventSchedule';

const LEGACY_EVENT_REMINDERS_KEY = '@reunionhub_event_reminders';
const EVENT_REMINDERS_KEY_PREFIX = '@reunionhub_event_reminders:';
const EVENT_REMINDERS_ENABLED_PREFIX = '@reunionhub_event_reminders_enabled:';
const REENGAGEMENT_REMINDER_KEY_PREFIX = '@reunionhub_reengagement_reminder:';
const REENGAGEMENT_ENABLED_KEY_PREFIX = '@reunionhub_reengagement_enabled:';
const REENGAGEMENT_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
let reminderQueue: Promise<void> = Promise.resolve();
let activeNotificationTarget: NotificationTarget | null = null;
const notificationErrorLogTimes = new Map<string, number>();
const NOTIFICATION_ERROR_LOG_DEDUP_MS = 60_000;

export type EventReminder = {
  id: string;
  title: string;
  date?: string;
  time?: string;
  endDate?: string;
  endTime?: string;
  type?: 'online' | 'in-person';
  isOrganizer?: boolean;
};

type StoredEventReminder = {
  signature: string;
  notificationIds: string[];
};

function notificationErrorDetails(error: unknown): { code: string; message: string } {
  if (!error || typeof error !== 'object') {
    return { code: 'unknown', message: typeof error === 'string' ? error.slice(0, 240) : 'Unknown notification error' };
  }
  const candidate = error as { code?: unknown; message?: unknown };
  return {
    code: typeof candidate.code === 'string' ? candidate.code : 'unknown',
    message: typeof candidate.message === 'string' ? candidate.message.slice(0, 240) : 'Unknown notification error',
  };
}

export function reportNotificationOperationError(operation: string, error: unknown): void {
  const details = notificationErrorDetails(error);
  const logKey = `${operation}:${details.code}:${details.message}`;
  const now = Date.now();
  const lastLoggedAt = notificationErrorLogTimes.get(logKey) ?? 0;
  if (now - lastLoggedAt < NOTIFICATION_ERROR_LOG_DEDUP_MS) return;
  notificationErrorLogTimes.set(logKey, now);
  console.warn('[Notifications] operation_failed', { operation, ...details });
}

function enqueueReminderOperation(operationName: string, operation: () => Promise<void>): Promise<void> {
  const result = reminderQueue.then(operation).catch((error: unknown) => {
    reportNotificationOperationError(operationName, error);
    throw error;
  });
  reminderQueue = result.catch(() => undefined);
  return result;
}

function notificationIdRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function storedEventReminderRecord(value: unknown): Record<string, StoredEventReminder> {
  if (!value || typeof value !== 'object') return {};
  const reminders: Record<string, StoredEventReminder> = {};
  Object.entries(value).forEach(([eventId, stored]) => {
    if (typeof stored === 'string') {
      reminders[eventId] = { signature: 'legacy', notificationIds: [stored] };
      return;
    }
    if (!stored || typeof stored !== 'object') return;
    const candidate = stored as { signature?: unknown; notificationIds?: unknown };
    if (typeof candidate.signature !== 'string' || !Array.isArray(candidate.notificationIds)) return;
    const notificationIds = candidate.notificationIds.filter((identifier): identifier is string => typeof identifier === 'string');
    if (notificationIds.length > 0) reminders[eventId] = { signature: candidate.signature, notificationIds };
  });
  return reminders;
}

export type PushRegistration = {
  granted: boolean;
  expoToken: string | null;
  nativeToken: string | null;
  platform: 'android' | 'ios' | null;
};

export type NotificationTarget = {
  conversationId?: string;
  meetingId?: string;
  notificationType?: string;
};

export function setActiveNotificationTarget(target: NotificationTarget | null): void {
  activeNotificationTarget = target;
}

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
  const payload = data as { eventId?: unknown; meetingId?: unknown; conversationId?: unknown; notificationType?: unknown };
  if (typeof payload.conversationId === 'string') return { conversationId: payload.conversationId };
  if (typeof payload.meetingId === 'string') return { meetingId: payload.meetingId };
  if (typeof payload.eventId === 'string') return { meetingId: payload.eventId };
  if (typeof payload.notificationType === 'string') return { notificationType: payload.notificationType };
  return null;
}

export function getNotificationRoute(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as { path?: unknown; url?: unknown; eventId?: unknown; meetingId?: unknown; conversationId?: unknown; notificationType?: unknown; notificationId?: unknown };
  const directPath = typeof payload.path === 'string' ? payload.path : payload.url;
  if (typeof directPath === 'string' && directPath.startsWith('/')) {
    if (directPath.startsWith('/event/')) {
      const context = new URLSearchParams();
      if (typeof payload.notificationType === 'string' && !directPath.includes('notificationType=')) {
        context.set('notificationType', payload.notificationType);
      }
      if (typeof payload.notificationId === 'string' && !directPath.includes('notificationId=')) {
        context.set('notificationId', payload.notificationId);
      }
      const query = context.toString();
      if (query) return `${directPath}${directPath.includes('?') ? '&' : '?'}${query}`;
    }
    return directPath;
  }
  const target = getNotificationTarget(data);
  if (target?.conversationId) return `/conversation/${target.conversationId}`;
  if (target?.meetingId) {
    const context = new URLSearchParams();
    if (typeof payload.notificationType === 'string') context.set('notificationType', payload.notificationType);
    if (typeof payload.notificationId === 'string') context.set('notificationId', payload.notificationId);
    const query = context.toString();
    return `/event/${target.meetingId}${query ? `?${query}` : ''}`;
  }
  return null;
}

export async function setupNotifications(): Promise<PushRegistration> {
  // Configura o handler para decidir o que fazer quando uma notificação é recebida app aberto
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const incomingTarget = getNotificationTarget(notification.request.content.data);
      const isCurrentTarget = Boolean(
        incomingTarget
        && activeNotificationTarget
        && ((incomingTarget.conversationId
          && incomingTarget.conversationId === activeNotificationTarget.conversationId)
          || (incomingTarget.meetingId
            && incomingTarget.meetingId === activeNotificationTarget.meetingId))
      );
      return ({
      shouldShowAlert: !isCurrentTarget,
      shouldPlaySound: !isCurrentTarget,
      shouldSetBadge: false,
      shouldShowBanner: !isCurrentTarget,
      shouldShowList: !isCurrentTarget,
      priority: isCurrentTarget
        ? Notifications.AndroidNotificationPriority.DEFAULT
        : Notifications.AndroidNotificationPriority.HIGH,
    });
    },
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Mensagens',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4F46E5',
    });
    await Notifications.setNotificationChannelAsync('events', {
      name: 'Atualizações de eventos',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 150, 200],
      lightColor: '#4F46E5',
    });
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Lembretes de eventos',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4F46E5',
    });
    await Notifications.setNotificationChannelAsync('recommendations', {
      name: 'Recomendações e novidades',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180],
      lightColor: '#4F46E5',
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
    return { granted: false, expoToken: null, nativeToken: null, platform: null };
  }
  
  let expoToken: string | null = null;
  let nativeToken: string | null = null;
  try {
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    nativeToken = typeof devicePushToken.data === 'string' ? devicePushToken.data : null;
    expoToken = await getExpoPushToken(devicePushToken);
  } catch (error) {
    reportNotificationOperationError('push_token_registration', error);
  }

  return {
    granted: true,
    expoToken,
    nativeToken,
    platform: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : null,
  };
}

export async function sendLocalNotification(title: string, body: string, seconds = 0) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
      },
      trigger: seconds > 0
        ? { seconds, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, channelId: 'events' }
        : Platform.OS === 'android' ? { channelId: 'events' } : null,
    });
  } catch (error) {
    reportNotificationOperationError('local_notification_schedule', error);
    throw error;
  }
}

async function loadReminderIds(userId: string): Promise<Record<string, StoredEventReminder>> {
  const storedReminders = await AsyncStorage.getItem(eventRemindersKey(userId));
  let reminders: Record<string, StoredEventReminder> = {};
  try {
    const parsed: unknown = JSON.parse(storedReminders || '{}');
    reminders = storedEventReminderRecord(parsed);
  } catch {
    console.warn('[Notifications] stored_event_reminders_invalid');
  }

  return reminders;
}

async function saveReminderIds(userId: string, reminders: Record<string, StoredEventReminder>): Promise<void> {
  await AsyncStorage.setItem(eventRemindersKey(userId), JSON.stringify(reminders));
}

async function eventRemindersEnabled(userId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(`${EVENT_REMINDERS_ENABLED_PREFIX}${userId}`)) !== 'false';
}

export async function setEventRemindersEnabled(userId: string, enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(`${EVENT_REMINDERS_ENABLED_PREFIX}${userId}`, String(enabled));
  if (!enabled) await syncEventReminders([], userId);
}

async function pruneMissingReminderIds(userId: string, reminders: Record<string, StoredEventReminder>): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const scheduledIds = new Set(scheduled.map((notification) => notification.identifier));
  let changed = false;
  Object.entries(reminders).forEach(([eventId, reminder]) => {
    const availableIds = reminder.notificationIds.filter((notificationId) => scheduledIds.has(notificationId));
    if (availableIds.length === 0) {
      delete reminders[eventId];
      changed = true;
    } else if (availableIds.length !== reminder.notificationIds.length) {
      reminders[eventId] = { ...reminder, notificationIds: availableIds };
      changed = true;
    }
  });
  if (changed) await saveReminderIds(userId, reminders);
}

async function scheduleEventRemindersOperation(events: EventReminder[], userId: string, removeMissing: boolean): Promise<void> {
  const reminders = await loadReminderIds(userId);
  await pruneMissingReminderIds(userId, reminders);
  if (!(await eventRemindersEnabled(userId))) {
    for (const reminder of Object.values(reminders)) {
      await Promise.all(reminder.notificationIds.map((notificationId) =>
        Notifications.cancelScheduledNotificationAsync(notificationId)
      ));
    }
    await saveReminderIds(userId, {});
    return;
  }
  const desiredEventIds = new Set<string>();

  for (const event of events) {
    if (!event.date || !event.time) continue;
    const interval = getEventInterval(event);
    if (!interval) continue;
    desiredEventIds.add(event.id);

    const now = new Date();
    const preparationDate = new Date(interval.start.getTime() - 2 * 60 * 60 * 1000);
    const endTime = event.endTime ?? interval.end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const schedule = [
      {
        stage: 'preparation',
        date: preparationDate,
        title: 'Seu evento começa em 2 horas',
        body: `"${event.title}" começa às ${event.time}. Confira ${event.type === 'online' ? 'o link de acesso' : 'o local'} e combine os últimos detalhes.`,
      },
      {
        stage: 'start',
        date: interval.start,
        title: 'O evento começou',
        body: `"${event.title}" está em andamento. Faça seu check-in até ${endTime} para registrar sua participação.`,
      },
      {
        stage: 'end',
        date: interval.end,
        title: event.isOrganizer ? 'Hora de revisar as presenças' : 'O evento terminou',
        body: event.isOrganizer
          ? `"${event.title}" terminou. Abra o evento para revisar os check-ins e concluir o encontro.`
          : `"${event.title}" terminou. Abra o evento para acompanhar a confirmação do seu check-in.`,
      },
    ].filter(({ date }) => !Number.isNaN(date.getTime()) && date > now);

    const signature = [event.title, event.date, event.time, event.endDate ?? '', event.endTime ?? '', event.type ?? '', event.isOrganizer ? 'organizer' : 'participant'].join('|');
    const existingReminder = reminders[event.id];
    if (existingReminder?.signature === signature && existingReminder.notificationIds.length === schedule.length) continue;
    if (existingReminder) {
      await Promise.all(existingReminder.notificationIds.map((notificationId) =>
        Notifications.cancelScheduledNotificationAsync(notificationId)
      ));
      delete reminders[event.id];
    }
    if (schedule.length === 0) {
      await saveReminderIds(userId, reminders);
      continue;
    }
    const notificationIds: string[] = [];
    try {
      for (const reminder of schedule) {
        const notificationId = await Notifications.scheduleNotificationAsync({
          content: {
            title: reminder.title,
            body: reminder.body,
            sound: true,
            data: { eventId: event.id, reminderType: 'event', lifecycleStage: reminder.stage, reminderOwnerId: userId },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.date, channelId: 'reminders' },
        });
        notificationIds.push(notificationId);
      }
      reminders[event.id] = { signature, notificationIds };
      await saveReminderIds(userId, reminders);
    } catch (error) {
      await Promise.all(notificationIds.map((notificationId) =>
        Notifications.cancelScheduledNotificationAsync(notificationId).catch((cleanupError: unknown) => {
          reportNotificationOperationError('partial_event_reminder_cleanup', cleanupError);
        })
      ));
      delete reminders[event.id];
      throw error;
    }
  }

  if (removeMissing) {
    for (const [eventId, reminder] of Object.entries(reminders)) {
      if (desiredEventIds.has(eventId)) continue;
      await Promise.all(reminder.notificationIds.map((notificationId) =>
        Notifications.cancelScheduledNotificationAsync(notificationId)
      ));
      delete reminders[eventId];
    }
    await saveReminderIds(userId, reminders);
  }
}

export function scheduleEventReminders(events: EventReminder[], userId: string): Promise<void> {
  return enqueueReminderOperation('event_reminder_schedule', () => scheduleEventRemindersOperation(events, userId, false));
}

export function syncEventReminders(events: EventReminder[], userId: string): Promise<void> {
  return enqueueReminderOperation('event_reminder_sync', () => scheduleEventRemindersOperation(events, userId, true));
}

export function scheduleEventReminder(event: EventReminder, userId: string): Promise<void> {
  return scheduleEventReminders([event], userId);
}

export function cancelEventReminder(eventId: string, userId: string): Promise<void> {
  return enqueueReminderOperation('event_reminder_cancel', async () => {
    const reminders = await loadReminderIds(userId);
    const reminder = reminders[eventId];
    if (!reminder) return;
    await Promise.all(reminder.notificationIds.map((notificationId) =>
      Notifications.cancelScheduledNotificationAsync(notificationId)
    ));
    delete reminders[eventId];
    await saveReminderIds(userId, reminders);
  });
}

async function syncReengagementReminderOperation(userId: string | null): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled
    .filter((notification) => notification.content.data?.reminderType === 'reengagement')
    .map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier))
  );

  if (!userId) return;
  await AsyncStorage.removeItem(`${REENGAGEMENT_REMINDER_KEY_PREFIX}${userId}`);
  const enabled = (await AsyncStorage.getItem(`${REENGAGEMENT_ENABLED_KEY_PREFIX}${userId}`)) === 'true';
  if (!enabled) return;

  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') return;

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Que tal encontrar algo para fazer?',
      body: 'Faz sete dias que você não abre o Reunion Hub. Veja eventos interessantes ou crie um encontro para reunir pessoas.',
      sound: true,
      data: {
        reminderType: 'reengagement',
        reminderOwnerId: userId,
        path: '/(drawer)/(tabs)',
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(Date.now() + REENGAGEMENT_DELAY_MS),
      channelId: 'recommendations',
    },
  });
  await AsyncStorage.setItem(`${REENGAGEMENT_REMINDER_KEY_PREFIX}${userId}`, notificationId);
}

export async function setReengagementReminderEnabled(userId: string, enabled: boolean): Promise<void> {
  const preferenceKey = `${REENGAGEMENT_ENABLED_KEY_PREFIX}${userId}`;
  const storedPreference = await AsyncStorage.getItem(preferenceKey);
  const nextPreference = String(enabled);
  await AsyncStorage.setItem(preferenceKey, nextPreference);
  if (storedPreference === nextPreference) return;
  return enqueueReminderOperation('reengagement_preference_sync', () => syncReengagementReminderOperation(userId));
}

export function refreshReengagementReminder(userId: string): Promise<void> {
  return enqueueReminderOperation('reengagement_reminder_refresh', () => syncReengagementReminderOperation(userId));
}

export function activateNotificationUser(userId: string | null): Promise<void> {
  return enqueueReminderOperation('reminder_owner_sync', async () => {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled.map(async (notification) => {
      const data = notification.content.data;
      if (data?.reminderType === 'reengagement') {
        await Notifications.cancelScheduledNotificationAsync(notification.identifier);
        return;
      }
      if (data?.reminderType !== 'event') return;
      if (userId && data.reminderOwnerId === userId) return;
      await Notifications.cancelScheduledNotificationAsync(notification.identifier);
    }));

    let legacy: Record<string, string> = {};
    try {
      legacy = notificationIdRecord(JSON.parse(await AsyncStorage.getItem(LEGACY_EVENT_REMINDERS_KEY) || '{}'));
    } catch {
      console.warn('[Notifications] legacy_event_reminders_invalid');
    }
    await Promise.all(Object.values(legacy).map((notificationId) =>
      Notifications.cancelScheduledNotificationAsync(notificationId)
    ));
    await AsyncStorage.removeItem(LEGACY_EVENT_REMINDERS_KEY);

    if (userId) await syncReengagementReminderOperation(userId);
  });
}
