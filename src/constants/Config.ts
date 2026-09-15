export const CONFIG = {
    // Distância máxima para buscar eventos e locais próximos (em km)
    NEARBY_RADIUS_KM: 10,
    
    // Número mínimo de participantes para um evento ser considerado "Popular" (fogo/flame)
    POPULAR_ATTENDEES_COUNT: 3,
    // Janela do selo "NOVO" (horas desde a criação). Puramente visual: não entra
    // em nenhuma consulta, então mudar aqui não altera custo de banco.
    NEW_EVENT_WINDOW_HOURS: 48,
    // Janela de descoberta (Agenda, Início e os selos de getEventDiscovery).
    // Não aumenta leitura: as consultas que a usam já têm limit fixo.
    AGENDA_DISCOVERY_DAYS: 15,
    AGENDA_DISCOVERY_LIMIT: 50,
    // Sugestões exibidas na Agenda. Alimenta ao mesmo tempo o carrossel, os
    // pontos do calendário e a lista do dia — por isso precisa cobrir a janela
    // inteira de AGENDA_DISCOVERY_DAYS. É recorte em memória de AGENDA_DISCOVERY_LIMIT,
    // então não gera leitura adicional.
    AGENDA_RECOMMENDATIONS_LIMIT: 20,
    AGENDA_FAVORITES_LIMIT: 50,
    AGENDA_MY_EVENTS_LIMIT: 100,
    PROFILE_PLACES_LIMIT: 30,

    // Limite máximo de semanas que um evento pode ser repetido na criação
    MAX_REPEAT_WEEKS: 4,
};
