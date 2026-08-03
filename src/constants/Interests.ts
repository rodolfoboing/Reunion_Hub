export const INTERESTS_OPTIONS = [
    'Tecnologia & Inovação',
    'Negócios & Carreira',
    'Festas & Shows',
    'Música',
    'Dança',
    'Saúde & Bem-Estar',
    'Gastronomia',
    'Artes & Cultura',
    'Esportes',
    'Educação & Workshops',
    'Networking',
    'Cinema & Teatro',
    'Religião & Espiritualidade',
    'Games & Geek',
    'Jogos Digitais',
    'Sustentabilidade',
    'Animais de Estimação',
    'Literatura',
    'Filosofia'
];

const LEGACY_INTEREST_ALIASES: Record<string, string> = {
    'tecnologia': 'Tecnologia & Inovação',
    'arte': 'Artes & Cultura',
    'negócios': 'Negócios & Carreira',
    'viagens': 'Festas & Shows',
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
