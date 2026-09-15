import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/src/services/firebaseConfig';
import { StyledButton } from '@/src/components/StyledButton';
import { TermsModal } from '@/src/components/TermsModal';
import { CURRENT_TERMS_UPDATED_LABEL, CURRENT_TERMS_VERSION } from '@/src/constants/legal';
import { authLog, getFirebaseErrorCode } from '@/src/utils/authError';
import { unregisterCurrentPushDevice } from '@/src/services/pushRegistrationService';

/**
 * Exibida pelo portão do RootLayout quando o `termsVersion` gravado no perfil
 * é diferente do `CURRENT_TERMS_VERSION` vigente. Grava apenas os dois campos
 * do aceite — as regras do Firestore rejeitam qualquer outro campo neste fluxo.
 */
export default function AcceptTermsScreen() {
    const [showTerms, setShowTerms] = useState(false);
    const [saving, setSaving] = useState(false);

    const handleAccept = async () => {
        const user = auth.currentUser;
        if (!user || saving) return;

        setSaving(true);
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                termsVersion: CURRENT_TERMS_VERSION,
                termsAcceptedAt: serverTimestamp(),
            });
            authLog('terms_reaccepted');
            // O portão do RootLayout observa o perfil e redireciona sozinho assim
            // que a nova versão chega; não navegamos daqui para não competir com ele.
        } catch (error) {
            console.error('[Auth] terms_reaccept_failed', { code: getFirebaseErrorCode(error) });
            Alert.alert('Não foi possível registrar', 'Verifique sua conexão e tente novamente.');
        } finally {
            setSaving(false);
        }
    };

    const handleDecline = () => {
        Alert.alert(
            'Sair sem aceitar',
            'Para continuar usando o Reunion Hub é necessário aceitar os termos atualizados. Você pode sair agora e aceitar quando voltar.',
            [
                { text: 'Voltar', style: 'cancel' },
                {
                    text: 'Sair da conta',
                    style: 'destructive',
                    onPress: async () => {
                        const uid = auth.currentUser?.uid;
                        if (uid) {
                            await unregisterCurrentPushDevice(uid).catch(() => {
                                console.warn('[Auth] terms_decline_device_cleanup_failed');
                            });
                        }
                        await auth.signOut().catch((signOutError: unknown) => {
                            console.error('[Auth] terms_decline_sign_out_failed', { code: getFirebaseErrorCode(signOutError) });
                        });
                        router.replace('/login');
                    },
                },
            ],
        );
    };

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.iconCircle}>
                    <Ionicons name="document-text-outline" size={28} color="#4F46E5" />
                </View>

                <Text style={styles.title}>Atualizamos os termos</Text>
                <Text style={styles.subtitle}>
                    Nossas Regras e Termos de Uso mudaram em {CURRENT_TERMS_UPDATED_LABEL}. Leia a versão
                    atual e confirme para continuar usando o app.
                </Text>

                <TouchableOpacity
                    style={styles.readButton}
                    onPress={() => setShowTerms(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Ler as regras e termos de uso"
                >
                    <Ionicons name="book-outline" size={18} color="#4338CA" />
                    <Text style={styles.readButtonText}>Ler os termos completos</Text>
                    <Ionicons name="chevron-forward" size={18} color="#4338CA" />
                </TouchableOpacity>

                <View style={styles.actions}>
                    <StyledButton title="Aceitar e continuar" onPress={handleAccept} isLoading={saving} />
                    <TouchableOpacity
                        style={styles.declineButton}
                        onPress={handleDecline}
                        disabled={saving}
                        accessibilityRole="button"
                    >
                        <Text style={styles.declineText}>Não aceito agora</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>

            <TermsModal visible={showTerms} onClose={() => setShowTerms(false)} />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
    iconCircle: {
        width: 60, height: 60, borderRadius: 30, backgroundColor: '#EEF2FF',
        alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 20,
    },
    title: { fontSize: 26, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 10 },
    subtitle: { fontSize: 15, lineHeight: 22, color: '#6B7280', textAlign: 'center', marginBottom: 28 },
    readButton: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        borderWidth: 1, borderColor: '#C7D2FE', backgroundColor: '#F5F7FF',
        borderRadius: 14, paddingHorizontal: 16, paddingVertical: 15, marginBottom: 28,
    },
    readButtonText: { flex: 1, color: '#4338CA', fontSize: 15, fontWeight: '700' },
    actions: { width: '100%' },
    declineButton: { alignItems: 'center', paddingVertical: 14 },
    declineText: { color: '#6B7280', fontSize: 14, fontWeight: '600' },
});
