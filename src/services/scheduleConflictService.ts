import { collection, getDocs, limit, orderBy, query, startAfter, where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '@/src/services/firebaseConfig';
import type { Meeting } from '@/src/types';
import { eventsOverlap, isEventClosed } from '@/src/utils/eventSchedule';
import { getDateAfterDays, normalizeDate } from '@/src/utils/dateUtils';

/**
 * Responsabilidade: descobrir se horários candidatos colidem com eventos que o
 * usuário já confirmou. Leitura pontual, nunca listener.
 */

export type CandidateSchedule = Pick<Meeting, 'date' | 'time' | 'endDate' | 'endTime'>;

// A primeira consulta continua pequena; páginas extras só são lidas se houver
// mais compromissos no intervalo solicitado.
const CONFLICT_QUERY_LIMIT = 20;

/**
 * Retorna os eventos do usuário que se sobrepõem a algum dos candidatos.
 *
 * Custo: uma consulta na maioria das agendas; pagina apenas se necessário.
 * Reaproveita o índice
 * `attendees CONTAINS + date DESC` que já existe em firestore.indexes.json —
 * por isso o `orderBy('date', 'desc')`. Mesmo eventos antigos de até 24h só
 * podem conflitar se começaram no dia do candidato ou no dia anterior.
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

    const relevantDates = [...new Set(dates.flatMap((date) => [
        getDateAfterDays(-1, new Date(`${date}T12:00:00-03:00`)),
        date,
    ]))].sort();
    // A UI permite até cinco ocorrências (dez dias com os dias anteriores).
    // O fallback mantém a função correta caso outro consumidor ultrapasse o
    // limite de 30 valores do operador `in`.
    const dateFilter = relevantDates.length <= 30
        ? [where('date', 'in', relevantDates)]
        : [where('date', '>=', relevantDates[0]), where('date', '<=', relevantDates[relevantDates.length - 1])];

    const conflicts: Meeting[] = [];
    let cursor: QueryDocumentSnapshot | undefined;
    while (true) {
        const snapshot = await getDocs(query(
            collection(db, 'meetings'),
            where('attendees', 'array-contains', userId),
            ...dateFilter,
            orderBy('date', 'desc'),
            limit(CONFLICT_QUERY_LIMIT),
            ...(cursor ? [startAfter(cursor)] : []),
        ));
        conflicts.push(...snapshot.docs
            .map((document) => ({ id: document.id, ...document.data() } as Meeting))
            .filter((existing) => existing.id !== ignoreEventId
                && !isEventClosed(existing)
                && candidates.some((candidate) => eventsOverlap(candidate, existing))));
        if (snapshot.size < CONFLICT_QUERY_LIMIT) return conflicts;
        cursor = snapshot.docs[snapshot.docs.length - 1];
    }
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
