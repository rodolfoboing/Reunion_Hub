import type { Meeting } from '@/src/types';
import { getTodayStr, normalizeDate } from '@/src/utils/dateUtils';

type EventSchedule = Pick<Meeting, 'date' | 'time' | 'endDate' | 'endTime'>;
type EventLifecycle = EventSchedule & Pick<Meeting, 'status' | 'checkInReviewDeadlineAt'>;

// Eventos antigos não tinham término. Mantemos a janela que o mapa já usava
// até que esses registros sejam atualizados, sem alterar seu comportamento.
const LEGACY_EVENT_DURATION_MINUTES = 180;
export const MIN_EVENT_DURATION_MINUTES = 15;
export const MAX_EVENT_DURATION_MINUTES = 24 * 60;
export const CHECK_IN_REVIEW_WINDOW_MS = 2 * 60 * 60 * 1000;

export type EventDurationIssue = 'invalid' | 'too-short' | 'too-long' | null;

export type EventJourneyPhase = 'cancelled' | 'completed' | 'awaiting_processing' | 'in_progress' | 'starting_soon' | 'today' | 'upcoming';
export type EventJourneyTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type EventJourneyState = {
    phase: EventJourneyPhase;
    label: string;
    compactLabel: string;
    title: string;
    message: string;
    tone: EventJourneyTone;
};

type EventJourneyOptions = {
    isAttending?: boolean;
    isCreator?: boolean;
    hasCheckedIn?: boolean;
    hasPendingCheckIn?: boolean;
    pendingReviewCount?: number;
};

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

export function getEventInterval(event: EventSchedule): { start: Date; end: Date } | null {
    const start = getEventDateTime(event.date, event.time);
    if (!start) return null;

    if (!event.endTime) {
        return { start, end: new Date(start.getTime() + (LEGACY_EVENT_DURATION_MINUTES * 60 * 1000)) };
    }

    const end = getEventDateTime(event.endDate || event.date, event.endTime);
    return end ? { start, end } : null;
}

export function getEventDurationIssue(event: EventSchedule): EventDurationIssue {
    const interval = getEventInterval(event);
    if (!interval || interval.end <= interval.start) return 'invalid';

    const durationMinutes = (interval.end.getTime() - interval.start.getTime()) / 60_000;
    if (durationMinutes < MIN_EVENT_DURATION_MINUTES) return 'too-short';
    if (durationMinutes > MAX_EVENT_DURATION_MINUTES) return 'too-long';
    return null;
}

export function formatEventTimeRange(event: EventSchedule): string {
    if (!event.time) return 'Horário a definir';
    if (!event.endTime) return event.time;
    if (!event.endDate || event.endDate === event.date) return `${event.time} às ${event.endTime}`;

    const normalizedEndDate = normalizeDate(event.endDate);
    if (!normalizedEndDate) return `${event.time} às ${event.endTime}`;
    const [year, month, day] = normalizedEndDate.split('-');
    return `${event.time} até ${day}/${month}/${year} às ${event.endTime}`;
}

export function isEventToday(event: EventSchedule, now = new Date()): boolean {
    const normalizedDate = normalizeDate(event.date);
    return normalizedDate !== null && normalizedDate === getTodayStr(now);
}

export function isEventInProgress(event: EventSchedule, now = new Date()): boolean {
    const interval = getEventInterval(event);
    return !!interval && interval.start <= now && now < interval.end;
}

/** Retorna true somente quando existe um intervalo válido e seu término já passou. */
export function hasEventEnded(event: EventSchedule, now = new Date()): boolean {
    const interval = getEventInterval(event);
    return !!interval && now >= interval.end;
}

export function isEventClosed(event: Pick<Meeting, 'status'>): boolean {
    return event.status === 'completed' || event.status === 'cancelled';
}

/** Cancelamento continua disponível durante o encontro, mas nunca após seu término. */
export function canCancelActiveEvent(event: EventLifecycle, now = new Date()): boolean {
    return !isEventClosed(event) && !hasEventEnded(event, now);
}

/** Participantes só podem sair antes do horário de início. */
export function canLeaveActiveEvent(event: EventLifecycle, now = new Date()): boolean {
    return !isEventClosed(event) && isEventRegistrationOpen(event, now);
}

/** O favorito independe do processamento noturno quando a presença já foi confirmada. */
export function canFavoriteAttendedEvent(event: EventLifecycle, hasCheckedIn: boolean, now = new Date()): boolean {
    return hasCheckedIn
        && event.status !== 'cancelled'
        && (event.status === 'completed' || hasEventEnded(event, now));
}

/**
 * Permite oferecer o favorito enquanto um check-in antigo ainda aguarda a
 * recuperação do servidor. No mesmo dia, preservamos a janela de revisão do
 * organizador; em dias posteriores, o fechamento automático confirmará o
 * pedido pendente antes de salvar o favorito.
 */
export function canRequestFavoriteAttendedEvent(
    event: EventLifecycle,
    hasCheckedIn: boolean,
    hasPendingCheckIn: boolean,
    now = new Date(),
): boolean {
    if (canFavoriteAttendedEvent(event, hasCheckedIn, now)) return true;
    const interval = getEventInterval(event);
    return hasPendingCheckIn
        && event.status !== 'cancelled'
        && Boolean(interval && now >= interval.end && getTodayStr(interval.end) < getTodayStr(now));
}

export function getCheckInReviewDeadline(event: EventLifecycle): Date | null {
    const storedDeadline = event.checkInReviewDeadlineAt?.toDate();
    if (storedDeadline && !Number.isNaN(storedDeadline.getTime())) return storedDeadline;

    const interval = getEventInterval(event);
    return interval ? new Date(interval.end.getTime() + CHECK_IN_REVIEW_WINDOW_MS) : null;
}

/** O organizador dispõe de duas horas após o término para revisar as presenças. */
export function canManuallyCompleteEvent(event: EventLifecycle, now = new Date()): boolean {
    const interval = getEventInterval(event);
    if (!interval || isEventClosed(event) || now < interval.end) return false;
    const deadline = getCheckInReviewDeadline(event);
    return deadline !== null && now <= deadline;
}

export function isEventRegistrationOpen(event: EventSchedule, now = new Date()): boolean {
    const eventStart = getEventDateTime(event.date, event.time);
    return !!eventStart && now < eventStart;
}

function remainingTimeLabel(milliseconds: number): string {
    const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes === 0 ? `${hours} h` : `${hours} h ${remainingMinutes} min`;
}

/**
 * Fonte única para a comunicação temporal de um evento. É cálculo local:
 * não cria leituras, listeners ou escritas no Firebase.
 */
export function getEventJourneyState(
    event: EventLifecycle,
    now = new Date(),
    options: EventJourneyOptions = {},
): EventJourneyState {
    if (event.status === 'cancelled') {
        return { phase: 'cancelled', label: 'CANCELADO', compactLabel: 'CANCELADO', title: 'Evento cancelado', message: 'Este evento não acontecerá mais.', tone: 'danger' };
    }
    if (event.status === 'completed') {
        return { phase: 'completed', label: 'CONCLUÍDO', compactLabel: 'CONCLUÍDO', title: 'Evento concluído', message: 'As presenças e a reputação já foram processadas.', tone: 'neutral' };
    }

    const interval = getEventInterval(event);
    if (!interval) {
        return { phase: 'upcoming', label: 'AGENDADO', compactLabel: 'AGENDADO', title: 'Evento agendado', message: 'Confira a data e o horário antes de participar.', tone: 'info' };
    }

    if (now >= interval.end) {
        if (options.isCreator && (options.pendingReviewCount ?? 0) > 0 && options.hasCheckedIn) {
            const deadline = getCheckInReviewDeadline(event);
            const remaining = deadline && deadline > now
                ? remainingTimeLabel(deadline.getTime() - now.getTime())
                : null;
            return {
                phase: 'awaiting_processing', label: 'REVISÃO NECESSÁRIA', compactLabel: 'REVISAR', title: 'Revise as presenças',
                message: remaining
                    ? `${options.pendingReviewCount} check-in(s) aguardam sua decisão. Prazo restante: aproximadamente ${remaining}.`
                    : 'O prazo de revisão terminou. Os check-ins serão aprovados automaticamente pelo processamento do evento.',
                tone: 'warning',
            };
        }
        if (options.hasPendingCheckIn) {
            return {
                phase: 'awaiting_processing', label: 'AGUARDANDO RESULTADO', compactLabel: 'EM ANÁLISE', title: 'Check-in em análise',
                message: 'O organizador tem até duas horas após o término para revisar sua presença. Sem revisão, ela será aprovada automaticamente.', tone: 'warning',
            };
        }
        return {
            phase: 'awaiting_processing', label: 'EVENTO ENCERRADO', compactLabel: 'ENCERRADO', title: 'Evento encerrado',
            message: options.isCreator
                ? 'O horário terminou. Se houver check-ins pendentes, revise-os dentro da janela de duas horas.'
                : 'O horário terminou. O resultado de presenças e reputação será sincronizado automaticamente.',
            tone: 'neutral',
        };
    }

    if (now >= interval.start) {
        const untilEnd = remainingTimeLabel(interval.end.getTime() - now.getTime());
        if (options.hasCheckedIn) {
            return {
                phase: 'in_progress', label: 'EM ANDAMENTO', compactLabel: 'EM ANDAMENTO', title: 'Sua presença está confirmada',
                message: `O evento termina em aproximadamente ${untilEnd}. Seu check-in já foi registrado.`, tone: 'success',
            };
        }
        if (options.hasPendingCheckIn) {
            return {
                phase: 'in_progress', label: 'CHECK-IN ENVIADO', compactLabel: 'CHECK-IN ENVIADO', title: 'Solicitação registrada',
                message: `O evento termina em aproximadamente ${untilEnd}. Sua presença será revisada após o término.`, tone: 'warning',
            };
        }
        if (options.isAttending || options.isCreator) {
            return {
                phase: 'in_progress', label: 'EM ANDAMENTO', compactLabel: 'EM ANDAMENTO', title: 'Faça seu check-in',
                message: `Você tem até o fim do evento, em aproximadamente ${untilEnd}, para registrar sua presença.`, tone: 'success',
            };
        }
        return {
            phase: 'in_progress', label: 'EM ANDAMENTO', compactLabel: 'EM ANDAMENTO', title: 'Evento acontecendo agora',
            message: `O evento termina em aproximadamente ${untilEnd}. As novas confirmações de presença já foram encerradas.`, tone: 'success',
        };
    }

    const untilStartMs = interval.start.getTime() - now.getTime();
    const startingSoon = untilStartMs <= 2 * 60 * 60 * 1000;
    if (startingSoon) {
        return {
            phase: 'starting_soon', label: `COMEÇA EM ${remainingTimeLabel(untilStartMs).toUpperCase()}`, compactLabel: 'EM BREVE',
            title: options.isAttending || options.isCreator ? 'Prepare-se para o evento' : 'Evento começando em breve',
            message: options.isAttending || options.isCreator
                ? `Confira ${event.time ? `o horário (${event.time}) e ` : ''}o local ou link. O check-in será liberado no início.`
                : 'As confirmações de presença ficam disponíveis somente até o horário de início.',
            tone: 'info',
        };
    }

    // Mesmo dia, mas ainda fora da janela de "começa em breve" (2h): "AGENDADO"
    // não comunica isso — sem essa distinção, um evento daqui a 3 dias e um
    // evento hoje à noite mostravam o mesmo selo (Início, Agenda e o card do evento
    // usam esta mesma função, então a correção vale para os três de uma vez).
    if (isEventToday(event, now)) {
        return {
            phase: 'today', label: 'HOJE', compactLabel: 'HOJE', title: options.isAttending || options.isCreator ? 'Você tem evento hoje' : 'Evento acontece hoje',
            message: options.isAttending || options.isCreator
                ? `O check-in ficará disponível no período: ${formatEventTimeRange(event)}.`
                : 'Confirme presença antes do início para participar.',
            tone: 'info',
        };
    }

    return {
        phase: 'upcoming', label: 'AGENDADO', compactLabel: 'AGENDADO', title: options.isAttending || options.isCreator ? 'Você vai participar' : 'Evento agendado',
        message: options.isAttending || options.isCreator
            ? `O check-in ficará disponível no período: ${formatEventTimeRange(event)}.`
            : 'Confirme presença antes do início para participar.',
        tone: 'info',
    };
}
