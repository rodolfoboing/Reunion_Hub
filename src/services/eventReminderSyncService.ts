import { collection, getDocs, limit, orderBy, query, startAfter, where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { auth, db } from '@/src/services/firebaseConfig';
import { areEventRemindersEnabled, syncEventReminders, type EventReminder } from '@/src/utils/Notifications';
import { hasEventEnded } from '@/src/utils/eventSchedule';
import type { Meeting } from '@/src/types';
import { getDateAfterDays } from '@/src/utils/dateUtils';

const EVENT_QUERY_LIMIT = 100;
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const lastSyncedAt = new Map<string, number>();
const activeSyncs = new Map<string, Promise<void>>();

async function loadMatchingEvents(field: 'attendees' | 'createdBy', userId: string, earliestStartDate: string): Promise<QueryDocumentSnapshot[]> {
  const documents: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  while (true) {
    const page = await getDocs(query(
      collection(db, 'meetings'),
      where(field, field === 'attendees' ? 'array-contains' : '==', userId),
      where('date', '>=', earliestStartDate),
      orderBy('date', 'desc'),
      limit(EVENT_QUERY_LIMIT),
      ...(cursor ? [startAfter(cursor)] : []),
    ));
    documents.push(...page.docs);
    if (page.size < EVENT_QUERY_LIMIT) return documents;
    cursor = page.docs[page.docs.length - 1];
  }
}

/**
 * Reconcilia os lembretes após alterações feitas em outro aparelho ou pelo
 * organizador. A consulta dupla inclui eventos antigos cujo criador não estava
 * em `attendees`. Só roda ao iniciar/retomar a sessão, com intervalo mínimo.
 */
export function syncOwnEventReminders(userId: string, force = false): Promise<void> {
  if (auth.currentUser?.uid !== userId) return Promise.resolve();
  const active = activeSyncs.get(userId);
  if (active) return active;
  if (!force && Date.now() - (lastSyncedAt.get(userId) ?? 0) < REFRESH_INTERVAL_MS) return Promise.resolve();

  const operation = (async () => {
    if (!(await areEventRemindersEnabled(userId))) return;
    // Um evento pode atravessar a meia-noite; os anteriores a ontem já terminaram.
    const earliestStartDate = getDateAfterDays(-1);
    const [attending, created] = await Promise.all([
      loadMatchingEvents('attendees', userId, earliestStartDate),
      loadMatchingEvents('createdBy', userId, earliestStartDate),
    ]);
    if (auth.currentUser?.uid !== userId) return;

    const events = new Map<string, Meeting>();
    [...attending, ...created].forEach((snapshot) => {
      events.set(snapshot.id, { id: snapshot.id, ...snapshot.data() } as Meeting);
    });
    const reminders: EventReminder[] = [...events.values()]
      .filter((event) => event.status !== 'cancelled' && event.status !== 'completed' && !hasEventEnded(event))
      .map((event) => ({
        id: event.id,
        title: event.title || 'Evento',
        date: event.date,
        time: event.time,
        endDate: event.endDate,
        endTime: event.endTime,
        type: event.type,
        isOrganizer: event.createdBy === userId,
      }));
    await syncEventReminders(reminders, userId);
    lastSyncedAt.set(userId, Date.now());
  })().finally(() => activeSyncs.delete(userId));
  activeSyncs.set(userId, operation);
  return operation;
}
