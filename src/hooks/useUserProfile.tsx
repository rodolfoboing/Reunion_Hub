import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { User } from '@/src/types';

type UserProfileContextValue = {
    /** Perfil da sessão, ou `null` quando não há sessão / o doc ainda não chegou. */
    profile: User | null;
};

const UserProfileContext = createContext<UserProfileContextValue>({ profile: null });

/**
 * Perfil da própria pessoa, compartilhado por toda a árvore autenticada.
 *
 * MOTIVO: `users/{uid}` tinha SETE `onSnapshot` simultâneos — raiz (portão de
 * sessão), layout das abas e Moderação (ambos só pelo `role`), Início, Agenda,
 * Mensagens e Perfil. Como Drawer e Tabs mantêm as telas montadas, os seis das
 * abas ficavam vivos ao mesmo tempo. O Firestore cobra uma leitura por documento
 * POR listener, então abrir o app custava 7 leituras do mesmo doc, e cada
 * escrita no perfil (salvar, favoritar) custava outras 7. Viola o §6 do
 * CLAUDE.md: "um listener por dado".
 *
 * Este provedor NÃO abre listener próprio: ele recebe o valor do listener que
 * `app/_layout.tsx` já mantinha para o portão de sessão. Assim o total vai de
 * sete para um, sem nenhuma leitura nova.
 *
 * O valor aceita snapshot de cache e escrita pendente de propósito — favoritar
 * precisa refletir na hora. Quem exige confirmação do servidor é apenas o portão
 * de sessão, que continua com a regra dele em `sessionGate.ts`.
 */
export function UserProfileProvider({ profile, children }: { profile: User | null; children: ReactNode }) {
    // A identidade do objeto só muda quando o perfil muda: a raiz já filtra
    // eventos de metadado por assinatura, então nenhum re-render é gratuito.
    const value = useMemo(() => ({ profile }), [profile]);
    return <UserProfileContext.Provider value={value}>{children}</UserProfileContext.Provider>;
}

/**
 * Perfil da sessão. Devolve `null` fora de sessão ou antes do primeiro snapshot,
 * então trate a ausência — não é erro.
 */
export function useUserProfile(): User | null {
    return useContext(UserProfileContext).profile;
}

/** Atalho para as telas que só querem saber se a pessoa é da moderação. */
export function useIsStaffProfile(): boolean {
    const profile = useUserProfile();
    return profile?.role === 'admin' || profile?.role === 'moderator';
}
