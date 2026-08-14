export type PushRegistration = {
  granted: boolean;
  token: string | null;
};

export type NotificationTarget = {
  conversationId?: string;
  meetingId?: string;
};

export type EventReminder = {
  id: string;
  title: string;
  date?: string;
  time?: string;
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
  const payload = data as { path?: unknown; url?: unknown };
  const directPath = typeof payload.path === 'string' ? payload.path : payload.url;
  if (typeof directPath === 'string' && directPath.startsWith('/')) return directPath;
  const target = getNotificationTarget(data);
  if (target?.conversationId) return `/conversation/${target.conversationId}`;
  if (target?.meetingId) return `/event/${target.meetingId}`;
  return null;
}

export async function setupNotifications(): Promise<PushRegistration> {
  return { granted: false, token: null };
}

export async function getExpoPushToken(): Promise<string | null> {
  return null;
}

export async function sendLocalNotification(_title: string, _body: string, _seconds = 0): Promise<void> {
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

export async function activateNotificationUser(_userId: string | null): Promise<void> {
  return;
}
