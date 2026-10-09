import type { ExternalEvent } from '@/src/services/ticketmasterEventService';
import { getCurrentTimeStr, getDateStr } from '@/src/utils/dateUtils';
import { getEventDateTime } from '@/src/utils/eventSchedule';

const SUGGESTED_MEETING_DURATION_MINUTES = 120;

/** Sugestão editável para o encontro, sem presumir a duração do evento externo. */
export function getExternalMeetingSchedule(event: Pick<ExternalEvent, 'suggestedDate' | 'suggestedTime'>) {
    const date = event.suggestedDate;
    const start = getEventDateTime(date, event.suggestedTime);
    if (!start) return { date, time: '', endDate: date, endTime: '' };

    const end = new Date(start.getTime() + SUGGESTED_MEETING_DURATION_MINUTES * 60_000);
    return {
        date,
        time: event.suggestedTime ?? '',
        endDate: getDateStr(end),
        endTime: getCurrentTimeStr(end),
    };
}
