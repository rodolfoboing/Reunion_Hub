import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/src/services/firebaseConfig';
import { StyledButton } from '@/src/components/StyledButton';
import { StyledInput } from '@/src/components/StyledInput';
import { authLog, getFirebaseErrorCode } from '@/src/utils/authError';
import { EMAIL_MAX_LENGTH } from '@/src/constants/textLimits';

export default function ForgotPasswordScreen() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);

    const handlePasswordReset = async () => {
        const normalizedEmail = email.trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
            Alert.alert('E-mail inválido', 'Informe o e-mail usado na sua conta.');
            return;
        }

        setLoading(true);
        try {
            await sendPasswordResetEmail(auth, normalizedEmail);
            authLog('password_reset_requested');
            Alert.alert(
                'Confira seu e-mail',
                'Se houver uma conta com este e-mail, enviaremos as instruções para criar uma nova senha.',
                [{ text: 'Voltar ao login', onPress: () => router.replace('/login') }]
            );
        } catch (error) {
            const code = getFirebaseErrorCode(error);
            console.error('[Auth] password_reset_failed', { code });
            const message = code === 'auth/network-request-failed'
                ? 'Não foi possível conectar. Verifique sua internet e tente novamente.'
                : 'Não foi possível solicitar a redefinição agora. Tente novamente mais tarde.';
            Alert.alert('Não foi possível enviar', message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                    <View style={styles.card}>
                        <Text style={styles.title}>Recuperar senha</Text>
                        <Text style={styles.subtitle}>Informe seu e-mail e enviaremos as instruções para criar uma nova senha.</Text>
                        <StyledInput
                            label="E-mail"
                            placeholder="seu@email.com"
                            value={email}
                            onChangeText={setEmail}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="email-address"
                            textContentType="emailAddress"
                            maxLength={EMAIL_MAX_LENGTH}
                        />
                        <StyledButton title="Enviar instruções" onPress={handlePasswordReset} isLoading={loading} />
                        <Link href="/login" asChild>
                            <Text style={styles.backLink}>Voltar para entrar</Text>
                        </Link>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
    card: { width: '100%' },
    title: { fontSize: 30, fontWeight: '800', color: '#1f2937', marginBottom: 10 },
    subtitle: { fontSize: 16, lineHeight: 23, color: '#6b7280', marginBottom: 28 },
    backLink: { alignSelf: 'center', marginTop: 22, color: '#6366f1', fontSize: 14, fontWeight: '600' },
});
