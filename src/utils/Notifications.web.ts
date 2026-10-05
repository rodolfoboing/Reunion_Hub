export type PushRegistration = {
  granted: boolean;
  expoToken: string | null;
  nativeToken: string | null;
  platform: null;
};

export type NotificationTarget = {
  conversationId?: string;
  meetingId?: string;
  notificationType?: string;
};

export function setActiveNotificationTarget(_target: NotificationTarget | null): void {
  return;
}

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
  const payload = data as { path?: unknown; url?: unknown; notificationType?: unknown; notificationId?: unknown };
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
  return { granted: false, expoToken: null, nativeToken: null, platform: null };
}

export async function getExpoPushToken(): Promise<string | null> {
  return null;
}

export async function sendLocalNotification(_title: string, _body: string, _seconds = 0): Promise<void> {
  return;
}

export function reportNotificationOperationError(_operation: string, _error: unknown): void {
  return;
}

export async function scheduleEventReminders(_events: EventReminder[], _userId: string): Promise<void> {
  return;
}

export async function syncEventReminders(_events: EventReminder[], _userId: string): Promise<void> {
  return;
}

export async function scheduleEventReminder(_event: EventReminder, _userId: string): Promise<void> {
  return;
}

export async function cancelEventReminder(_eventId: string, _userId: string): Promise<void> {
  return;
}

export async function setEventRemindersEnabled(_userId: string, _enabled: boolean): Promise<void> {
  return;
}

export async function areEventRemindersEnabled(_userId: string): Promise<boolean> {
  return false;
}

export async function setReengagementReminderEnabled(_userId: string, _enabled: boolean): Promise<void> {
  return;
}

export async function refreshReengagementReminder(_userId: string): Promise<void> {
  return;
}

export async function activateNotificationUser(_userId: string | null): Promise<void> {
  return;
}
