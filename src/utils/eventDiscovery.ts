import { CONFIG } from '@/src/constants/Config';
import { hasMatchingInterest } from '@/src/constants/Interests';
import type { Meeting } from '@/src/types';
import { getDateAfterDays, getTodayStr, normalizeDate } from '@/src/utils/dateUtils';
import { getDistanceFromLatLonInKm } from '@/src/utils/distance';
import { hasEventEnded, isEventInProgress } from '@/src/utils/eventSchedule';

export type UserCoordinates = {
    latitude: number;
    longitude: number;
};

type DiscoveryMeeting = Pick<
    Meeting,
    'attendees' | 'date' | 'endDate' | 'endTime' | 'interests' | 'lat' | 'lng' | 'status' | 'theme' | 'time' | 'title' | 'type'
>;

export type DiscoveryReason = 'in_progress' | 'interest' | 'history' | 'popular' | 'nearby';

export type EventDiscoveryContext = {
    userCoordinates?: UserCoordinates | null;
    userInterests?: unknown;
    historyTitles?: readonly string[];
    now?: Date;
};

export type EventDiscovery = {
    isRecommended: boolean;
    primaryReason: DiscoveryReason | null;
    reasons: DiscoveryReason[];
    shouldAnimateOnMap: boolean;
};

/**
 * Rótulos curtos: todo motivo é exibido como selo, dividindo a linha com o selo
 * temporal. Existia também uma versão longa (`DISCOVERY_REASON_LABELS`), usada
 * só pelo cartão de recomendação da Agenda enquanto ele era o único card sem
 * selo temporal. Agora que ele mostra os dois eixos como as demais telas, não há
 * mais espaço para frase — e uma única fonte evita que o mesmo motivo apareça
 * com nomes diferentes dependendo da tela.
 */
export const DISCOVERY_REASON_BADGE_LABELS: Record<DiscoveryReason, string> = {
    in_progress: 'Em andamento',
    interest: 'Seu interesse',
    history: 'Do seu histórico',
    popular: 'Popular',
    nearby: 'Perto de você',
};

const DISCOVERY_REASON_PRIORITY: DiscoveryReason[] = [
    'in_progress',
    'interest',
    'history',
    'popular',
    'nearby',
];

const hasActiveStatus = (meeting: DiscoveryMeeting): boolean =>
    meeting.status !== 'cancelled' && meeting.status !== 'completed';

function hasPopularAttendance(meeting: Pick<Meeting, 'attendees'>): boolean {
    return (meeting.attendees?.length || 0) >= CONFIG.POPULAR_ATTENDEES_COUNT;
}

/**
 * Evento publicado há pouco. É sinal padrão em apps de evento porque dá tração a
 * quem acabou de criar: sem confirmações ainda, ele nunca apareceria como
 * "Popular" e ficaria invisível justamente na janela em que precisa de gente.
 *
 * Aceita os dois formatos de `createdAt` que existem em produção — `Timestamp`
 * do Firestore e string ISO em registros antigos (ver §10 de dados legados).
 * Sem `createdAt` retorna false: ausência de dado não vira selo.
 */
export function isNewMeeting(meeting: Pick<Meeting, 'createdAt'>, now = new Date()): boolean {
    const createdAt = meeting.createdAt;
    if (!createdAt) return false;

    const createdMs = typeof createdAt === 'string'
        ? Date.parse(createdAt)
        : typeof (createdAt as { toMillis?: unknown }).toMillis === 'function'
            ? (createdAt as { toMillis: () => number }).toMillis()
            : Number.NaN;
    if (!Number.isFinite(createdMs)) return false;

    const ageMs = now.getTime() - createdMs;
    // `ageMs >= 0` descarta relógio adiantado no aparelho, que marcaria como novo
    // um evento com data de criação no futuro.
    return ageMs >= 0 && ageMs <= CONFIG.NEW_EVENT_WINDOW_HOURS * 60 * 60 * 1000;
}

export function isMeetingNearby(
    meeting: Pick<Meeting, 'lat' | 'lng' | 'type'>,
    userCoordinates: UserCoordinates | null | undefined,
): boolean {
    if (meeting.type === 'online' || !userCoordinates) return false;

    const latitude = Number(meeting.lat);
    const longitude = Number(meeting.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;

    return getDistanceFromLatLonInKm(
        userCoordinates.latitude,
        userCoordinates.longitude,
        latitude,
        longitude,
    ) <= CONFIG.NEARBY_RADIUS_KM;
}

function isWithinDiscoveryWindow(
    meeting: Pick<Meeting, 'date'>,
    now = new Date(),
): boolean {
    const date = normalizeDate(meeting.date);
    return !!date
        && date >= getTodayStr(now)
        && date <= getDateAfterDays(CONFIG.AGENDA_DISCOVERY_DAYS, now);
}

// Popularidade contextual: online não depende de distância; presencial só é
// relevante para o usuário quando está dentro do raio configurado.
function isPopularForUser(
    meeting: Pick<Meeting, 'attendees' | 'lat' | 'lng' | 'type'>,
    userCoordinates: UserCoordinates | null | undefined,
): boolean {
    if (!hasPopularAttendance(meeting)) return false;
    return meeting.type === 'online' || isMeetingNearby(meeting, userCoordinates);
}

/**
 * Motivo a mostrar no selo do card, ou null quando ele não acrescenta nada.
 *
 * O app tem DOIS eixos de sinalização, e eles estavam misturados:
 *   - QUANDO o evento acontece  → `getEventJourneyState` (HOJE, EM BREVE, ...)
 *   - POR QUE ele aparece p/ você → este motivo (Seu interesse, Popular, ...)
 *
 * Dois filtros, cada um consertando um defeito real:
 *
 * 1. `in_progress` nunca sai daqui. "Está acontecendo" é estado temporal, não
 *    motivo de descoberta. Enquanto morava nesta lista, Início e Explorar
 *    precisavam repetir `isLive ? null : primaryReason` para escondê-lo — a
 *    mesma gambiarra escrita em dois lugares.
 *
 * 2. `impliedReasons` são os motivos que a própria seção já comunica. Um card
 *    marcado "Seu interesse" dentro da seção "Eventos do seu interesse" não
 *    informava nada e ainda ocupava o selo que deveria dizer "HOJE".
 */
export function getDiscoveryBadgeReason(
    discovery: EventDiscovery,
    impliedReasons: readonly DiscoveryReason[] = [],
): DiscoveryReason | null {
    return DISCOVERY_REASON_PRIORITY.find((reason) => reason !== 'in_progress'
        && !impliedReasons.includes(reason)
        && discovery.reasons.includes(reason)) ?? null;
}

/**
 * Este evento deve ser sugerido ao usuário, respeitando a preferência de perfil
 * "eventos populares fora dos meus interesses"?
 *
 * Fonte única para Início, Agenda e Explorar. Antes cada tela aplicava a própria
 * variação da mesma regra: o Início ignorava o motivo `history`, e o Explorar não
 * consultava a preferência — o mapa piscava "popular" mesmo para quem desligou.
 *
 * Não precisa checar `isRecommended`: ele é verdadeiro sempre que há motivo
 * personalizado ou popular, que é exatamente o que esta função exige.
 */
export function shouldSuggestEvent(
    discovery: EventDiscovery,
    showPopularOutsideInterests: boolean,
): boolean {
    const personalized = discovery.reasons.includes('interest') || discovery.reasons.includes('history');
    return personalized || (showPopularOutsideInterests && discovery.reasons.includes('popular'));
}

/**
 * Classifica um evento para a descoberta sem persistir dados derivados.
 * A mesma função atende Início, Agenda e Explorar, evitando que um selo
 * tenha significado diferente em cada tela.
 */
export function getEventDiscovery(
    meeting: DiscoveryMeeting,
    context: EventDiscoveryContext = {},
): EventDiscovery {
    const now = context.now ?? new Date();
    const reasons: DiscoveryReason[] = [];
    const active = hasActiveStatus(meeting);
    const ended = active && hasEventEnded(meeting, now);
    const withinWindow = active && !ended && isWithinDiscoveryWindow(meeting, now);
    const nearby = withinWindow && isMeetingNearby(meeting, context.userCoordinates);
    const geographicallyEligible = meeting.type === 'online' || nearby;
    const matchesInterest = withinWindow
        && geographicallyEligible
        && hasMatchingInterest([...(meeting.interests || []), meeting.theme], context.userInterests);
    const matchesHistory = withinWindow
        && geographicallyEligible
        && typeof meeting.title === 'string'
        && (context.historyTitles?.includes(meeting.title) ?? false);
    const popular = withinWindow && isPopularForUser(meeting, context.userCoordinates);
    const inProgress = active && !ended && isEventInProgress(meeting, now);

    if (inProgress) reasons.push('in_progress');
    if (matchesInterest) reasons.push('interest');
    if (matchesHistory) reasons.push('history');
    if (popular) reasons.push('popular');
    if (nearby) reasons.push('nearby');

    const isRecommended = matchesInterest || matchesHistory || popular;
    const primaryReason = DISCOVERY_REASON_PRIORITY.find((reason) => reasons.includes(reason)) ?? null;
    const happensToday = normalizeDate(meeting.date) === getTodayStr(now);

    return {
        isRecommended,
        primaryReason,
        reasons,
        shouldAnimateOnMap: inProgress || popular || (matchesInterest && happensToday && nearby),
    };
}
