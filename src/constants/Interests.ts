/**
 * Taxonomia FECHADA de interesses. Alimenta, sem nenhuma lista paralela:
 * os chips do onboarding, do perfil e da criação de evento, o filtro de
 * categorias do Explorar, e o casamento de recomendação (`hasMatchingInterest`).
 *
 * A ordem é a de exibição, agrupada por afinidade — 32 chips em ordem aleatória
 * ficam impossíveis de varrer com o olho. Nada de dado depende da ordem.
 *
 * Ao ACRESCENTAR um interesse aqui, é obrigatório mapeá-lo em
 * `INTEREST_MARKER_CATEGORY` (app/(drawer)/(tabs)/explore.tsx); sem isso o
 * evento cai no marcador genérico do mapa. Há uma checagem em `__DEV__` lá que
 * avisa se alguém esquecer.
 *
 * Ao RENOMEAR ou REMOVER um interesse, adicione o valor antigo em
 * `LEGACY_INTEREST_ALIASES` — perfis e eventos já gravados continuam com a
 * string antiga no banco (§10).
 */
export const INTERESTS_OPTIONS = [
    // Encontrar gente e sair
    'Encontros & Amizades',
    'Networking',
    'Festas & Shows',
    'Bares & Vida Noturna',
    'Gastronomia',
    'Família & Crianças',
    // Cultura e expressão
    'Música',
    'Dança',
    'Artes & Cultura',
    'Cinema & Teatro',
    'Literatura',
    'Fotografia',
    'Artesanato & DIY',
    'Moda & Beleza',
    // Corpo e ar livre
    'Esportes',
    'Saúde & Bem-Estar',
    'Trilhas & Ar Livre',
    'Viagens & Aventura',
    // Conhecimento e sentido
    'Educação & Workshops',
    'Idiomas & Intercâmbio',
    'Filosofia',
    'Religião & Espiritualidade',
    // Trabalho e dinheiro
    'Negócios & Carreira',
    'Finanças & Investimentos',
    'Tecnologia & Inovação',
    // Jogos
    'Games & Geek',
    'Jogos Digitais',
    'Jogos de Mesa & RPG',
    // Causas e nichos
    'Sustentabilidade',
    'Voluntariado & Causas',
    'Animais de Estimação',
    'Carros & Motos'
];

/**
 * Quantos interesses uma pessoa pode marcar no perfil. Estava declarado em
 * `profile.tsx` E em `onboarding.tsx` com o mesmo valor — dois lugares para
 * mudar, nenhuma garantia de mudarem juntos. Fica aqui, ao lado da taxonomia
 * que ele limita.
 *
 * As `firestore.rules` aceitam até 19 (teto generoso contra abuso por script);
 * este é o limite de produto, e é ele que o usuário vê.
 */
export const MAX_PROFILE_INTERESTS = 10;

const LEGACY_INTEREST_ALIASES: Record<string, string> = {
    'tecnologia': 'Tecnologia & Inovação',
    'arte': 'Artes & Cultura',
    'negócios': 'Negócios & Carreira',
    // Agora existe categoria de viagem de verdade. Este alias apontava para
    // 'Festas & Shows' só porque era o destino menos ruim disponível, então quem
    // marcou "viagens" no app antigo recebia recomendação de show. Nada é
    // reescrito no banco: a conversão acontece na leitura.
    'viagens': 'Viagens & Aventura',
    'cinema': 'Cinema & Teatro',
    'workshops': 'Educação & Workshops',
    'social': 'Networking',
    'esportivo': 'Esportes',
    'online': 'Tecnologia & Inovação',
    'feiras': 'Negócios & Carreira',
};

const keyForInterest = (interest: string) => interest
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

const canonicalInterestsByKey = new Map(
    INTERESTS_OPTIONS.map((interest) => [keyForInterest(interest), interest])
);

/** Converte interesses antigos para a taxonomia atual, sem duplicatas. */
export const normalizeInterests = (values: unknown): string[] => {
    if (!Array.isArray(values)) return [];

    return values.reduce<string[]>((normalized, value) => {
        if (typeof value !== 'string') return normalized;

        const key = keyForInterest(value);
        const canonical = canonicalInterestsByKey.get(key) ?? LEGACY_INTEREST_ALIASES[key];
        if (canonical && !normalized.includes(canonical)) normalized.push(canonical);
        return normalized;
    }, []);
};

export const hasMatchingInterest = (eventInterests: unknown, userInterests: unknown) => {
    const userInterestSet = new Set(normalizeInterests(userInterests));
    return normalizeInterests(eventInterests).some((interest) => userInterestSet.has(interest));
};
