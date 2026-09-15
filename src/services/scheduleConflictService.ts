import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/src/services/firebaseConfig';
import type { Meeting } from '@/src/types';
import { eventsOverlap, isEventClosed } from '@/src/utils/eventSchedule';
import { getDateAfterDays, normalizeDate } from '@/src/utils/dateUtils';

/**
 * Responsabilidade: descobrir se horários candidatos colidem com eventos que o
 * usuário já confirmou. Leitura pontual, nunca listener.
 */

export type CandidateSchedule = Pick<Meeting, 'date' | 'time' | 'endDate' | 'endTime'>;

// Uma agenda pessoal raramente tem muitos eventos no mesmo par de dias; 20 cobre
// o caso real com folga e mantém o custo previsível (§6).
const CONFLICT_QUERY_LIMIT = 20;

/**
 * Retorna os eventos do usuário que se sobrepõem a algum dos candidatos.
 *
 * Custo: **uma** consulta, com janela de datas fechada. Reaproveita o índice
 * `attendees CONTAINS + date DESC` que já existe em firestore.indexes.json —
 * por isso o `orderBy('date', 'desc')`. Como um evento dura no máximo 24h, um
 * conflito só pode começar no dia anterior ao primeiro candidato ou depois,
 * o que fecha a janela sem precisar varrer a agenda inteira.
 */
export async function findScheduleConflicts(
    userId: string,
    candidates: CandidateSchedule[],
    ignoreEventId?: string,
): Promise<Meeting[]> {
    const dates = candidates
        .map((candidate) => normalizeDate(candidate.date))
        .filter((date): date is string => date !== null)
        .sort();
    if (dates.length === 0) return [];

    const firstDay = new Date(`${dates[0]}T12:00:00-03:00`);
    if (Number.isNaN(firstDay.getTime())) return [];

    const snapshot = await getDocs(query(
        collection(db, 'meetings'),
        where('attendees', 'array-contains', userId),
        where('date', '>=', getDateAfterDays(-1, firstDay)),
        where('date', '<=', dates[dates.length - 1]),
        orderBy('date', 'desc'),
        limit(CONFLICT_QUERY_LIMIT),
    ));

    return snapshot.docs
        .map((document) => ({ id: document.id, ...document.data() } as Meeting))
        .filter((existing) => existing.id !== ignoreEventId
            && !isEventClosed(existing)
            && candidates.some((candidate) => eventsOverlap(candidate, existing)));
}

/** Resumo curto para alerta, sem estourar a caixa de diálogo. */
export function describeConflicts(conflicts: Meeting[]): string {
    const names = conflicts.slice(0, 3).map((conflict) => {
        const day = normalizeDate(conflict.date)?.split('-').reverse().join('/') ?? '';
        return `• ${conflict.title || 'Evento'} — ${day} ${conflict.time || ''}`.trim();
    });
    const remaining = conflicts.length - names.length;
    return remaining > 0 ? `${names.join('\n')}\n• e mais ${remaining}` : names.join('\n');
}
