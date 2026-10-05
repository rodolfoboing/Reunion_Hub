import { CURRENT_TERMS_VERSION } from '@/src/constants/legal';

/** Para onde o perfil (confirmado pelo servidor) exige que a sessão vá. */
export type ProfileGate = 'onboarding' | 'accept-terms' | 'ready';

export type SessionRedirect = '/login' | '/(auth)/onboarding' | '/(auth)/accept-terms' | '/(drawer)/(tabs)';

const SIGNED_OUT_SCREENS = new Set(['login', 'register', 'forgot-password']);

/**
 * `undefined` = documento inexistente. Cadastros novos gravam
 * `isProfileComplete: false` explicitamente; perfis antigos, anteriores ao
 * campo, contam como concluídos. O onboarding vem antes do reaceite porque
 * também é o caminho de recuperação de perfil inexistente (registro interrompido).
 */
export function getProfileGate(profile: Readonly<Record<string, unknown>> | undefined): ProfileGate {
    if (!profile || profile.isProfileComplete === false) return 'onboarding';
    if (profile.termsVersion !== CURRENT_TERMS_VERSION) return 'accept-terms';
    return 'ready';
}

type SnapshotMetadata = { fromCache: boolean; hasPendingWrites: boolean };

export function isServerConfirmed(metadata: SnapshotMetadata): boolean {
    return !metadata.fromCache && !metadata.hasPendingWrites;
}

/**
 * Portão a partir de um snapshot do perfil, ou `null` quando o snapshot não
 * serve para decidir (mantém a decisão anterior).
 *
 * Só dado confirmado pelo servidor pode MANDAR alguém para onboarding/aceite:
 * com o stream do Firestore offline, o listener dispara do cache com
 * `exists() === false`; e uma escrita local pendente num doc que ainda não
 * chegou aparece como documento só com os campos escritos. Os dois faziam
 * "Complete seu Perfil" e "Atualizamos os termos" piscarem.
 *
 * LIBERAR pode ser otimista: 'ready' exige o doc completo (um doc parcial nunca
 * tem `termsVersion` vigente), e vem da escrita da própria pessoa no aceite ou
 * no onboarding. Se o servidor rejeitar, o snapshot confirmado seguinte a devolve.
 */
export function resolveProfileGate(
    profile: Readonly<Record<string, unknown>> | undefined,
    metadata: SnapshotMetadata,
): ProfileGate | null {
    const gate = getProfileGate(profile);
    return gate === 'ready' || isServerConfirmed(metadata) ? gate : null;
}

/**
 * Compara onde a pessoa está (1º e 2º segmentos da rota) com onde a sessão
 * exige que ela esteja. `profileGate === null` = perfil ainda não confirmado:
 * nada muda até o servidor responder.
 */
export function getSessionRedirect(input: {
    signedIn: boolean;
    profileGate: ProfileGate | null;
    group: string | undefined;
    screen: string | undefined;
}): SessionRedirect | null {
    const authScreen = input.group === '(auth)' ? input.screen : undefined;

    if (!input.signedIn) {
        return authScreen !== undefined && SIGNED_OUT_SCREENS.has(authScreen) ? null : '/login';
    }
    if (input.profileGate === null) return null;

    if (input.profileGate === 'onboarding') {
        // O cadastro cria a conta antes do perfil; register.tsx conduz a pessoa
        // ao onboarding quando termina (ou desfaz a conta se falhar).
        return authScreen === 'onboarding' || authScreen === 'register' ? null : '/(auth)/onboarding';
    }
    if (input.profileGate === 'accept-terms') {
        return authScreen === 'accept-terms' ? null : '/(auth)/accept-terms';
    }
    return authScreen !== undefined ? '/(drawer)/(tabs)' : null;
}
