import type { Meeting } from '@/src/types';
import { getTodayStr, normalizeDate } from '@/src/utils/dateUtils';

type EventSchedule = Pick<Meeting, 'date' | 'time' | 'endTime'>;

// Eventos antigos não tinham término. Mantemos a janela que o mapa já usava
// até que esses registros sejam atualizados, sem alterar seu comportamento.
const LEGACY_EVENT_DURATION_MINUTES = 180;

function parseTime(time: string | undefined): number | null {
    if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;

    const [hoursText, minutesText] = time.split(':');
    const hours = Number(hoursText);
    const minutes = Number(minutesText);

    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }

    return (hours * 60) + minutes;
}

export function getEventDateTime(date: string | undefined, time: string | undefined): Date | null {
    const normalizedDate = normalizeDate(date);
    const minutesSinceMidnight = parseTime(time);
    if (!normalizedDate || minutesSinceMidnight === null) return null;

    const hours = String(Math.floor(minutesSinceMidnight / 60)).padStart(2, '0');
    const minutes = String(minutesSinceMidnight % 60).padStart(2, '0');
    const value = new Date(`${normalizedDate}T${hours}:${minutes}:00-03:00`);

    return Number.isNaN(value.getTime()) ? null : value;
}

export function isEndTimeAfterStart(time: string | undefined, endTime: string | undefined): boolean {
    const startMinutes = parseTime(time);
    const endMinutes = parseTime(endTime);
    return startMinutes !== null && endMinutes !== null && endMinutes > startMinutes;
}

export function formatEventTimeRange(event: EventSchedule): string {
    if (!event.time) return 'Horário a definir';
    return event.endTime ? `${event.time} às ${event.endTime}` : event.time;
}

export function isEventToday(event: EventSchedule, now = new Date()): boolean {
    const normalizedDate = normalizeDate(event.date);
    return normalizedDate !== null && normalizedDate === getTodayStr(now);
}

export function isEventInProgress(event: EventSchedule, now = new Date()): boolean {
    const eventStart = getEventDateTime(event.date, event.time);
    if (!eventStart || eventStart > now) return false;

    const eventEnd = event.endTime
        ? getEventDateTime(event.date, event.endTime)
        : new Date(eventStart.getTime() + (LEGACY_EVENT_DURATION_MINUTES * 60 * 1000));

    return !!eventEnd && now < eventEnd;
}

export function isEventRegistrationOpen(event: EventSchedule, now = new Date()): boolean {
    const eventStart = getEventDateTime(event.date, event.time);
    return !!eventStart && now < eventStart;
}
