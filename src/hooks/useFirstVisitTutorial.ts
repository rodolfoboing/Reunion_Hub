import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

export type TutorialScreen = 'inicio' | 'explorar' | 'agenda' | 'mensagens' | 'perfil';

const storageKey = (screen: TutorialScreen) => `@reunionhub_tutorial_${screen}`;

/**
 * Chaves das duas telas que já tinham tutorial próprio antes deste mecanismo.
 * Sem isto, quem já dispensou o manual do Início ou o aviso do mapa veria o
 * popup de novo só porque a chave mudou de nome.
 */
const LEGACY_KEYS: Partial<Record<TutorialScreen, string>> = {
    inicio: '@reunionhub_has_seen_manual',
    explorar: '@reunionhub_has_seen_map_onboarding',
};

/**
 * Controla o tutorial de primeira visita de uma tela.
 *
 * Uma leitura do AsyncStorage na montagem e uma escrita ao dispensar — nada de
 * banco. O estado começa oculto e só aparece depois da leitura, então quem já
 * viu nunca vê o popup piscar.
 */
export function useFirstVisitTutorial(screen: TutorialScreen) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const checkFirstVisit = async () => {
            try {
                const legacyKey = LEGACY_KEYS[screen];
                const keys = legacyKey ? [storageKey(screen), legacyKey] : [storageKey(screen)];
                const stored = await AsyncStorage.multiGet(keys);
                const alreadySeen = stored.some(([, value]) => value === 'true');
                if (!cancelled && !alreadySeen) setVisible(true);
            } catch {
                // Falha de storage não pode travar a tela: no pior caso o
                // tutorial não aparece, que é melhor que aparecer sempre.
                console.warn('[Tutorial] first_visit_read_failed', { screen });
            }
        };

        void checkFirstVisit();
        return () => { cancelled = true; };
    }, [screen]);

    const dismiss = useCallback(async () => {
        // Fecha na hora e grava depois: a UI não deve esperar o disco.
        setVisible(false);
        try {
            await AsyncStorage.setItem(storageKey(screen), 'true');
        } catch {
            console.warn('[Tutorial] first_visit_save_failed', { screen });
        }
    }, [screen]);

    return { visible, dismiss };
}
