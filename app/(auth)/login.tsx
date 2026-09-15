import { useState } from 'react';
import { View, Text, StyleSheet, Image, KeyboardAvoidingView, Platform, Alert, ScrollView } from 'react-native';
import { Link, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../src/services/firebaseConfig';
import { StyledInput } from '../../src/components/StyledInput';
import { StyledButton } from '../../src/components/StyledButton';
import { STRINGS } from '../../src/constants/strings';
import { authLog, getFirebaseErrorCode } from '../../src/utils/authError';

export default function LoginScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const handleLogin = async () => {
        if (!email || !password) {
            Alert.alert('Erro', STRINGS.AUTH_ERROR_EMPTY_FIELDS);
            return;
        }
        const normalizedEmail = email.trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
            Alert.alert('E-mail inválido', 'Informe um e-mail válido para entrar.');
            return;
        }

        setLoading(true);
        try {
            await signInWithEmailAndPassword(auth, normalizedEmail, password);
            authLog('login_completed');
            // Redirect logic is handled by _layout but we add a fallback/direct replace
            router.replace('/');
        } catch (error) {
            const code = getFirebaseErrorCode(error);
            console.error('[Auth] login_failed', { code });
            
            let msg = STRINGS.ERROR_DEFAULT;
            if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
                msg = STRINGS.AUTH_ERROR_INVALID_CREDS;
            } else if (code === 'auth/user-disabled') {
                // banUser desativa a conta no Auth; sem este caso a pessoa banida
                // recebia "erro inesperado" e não entendia o que aconteceu.
                msg = STRINGS.AUTH_ERROR_ACCOUNT_DISABLED;
            } else if (code === 'auth/too-many-requests') {
                msg = STRINGS.AUTH_ERROR_TOO_MANY_ATTEMPTS;
            } else if (code === 'auth/network-request-failed') {
                msg = STRINGS.ERROR_NETWORK;
            }
            Alert.alert('Erro no Login', msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.container}
            >
                <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.header}>
                    <Image
                        source={require('../../assets/images/Whisk_Reunion_Hub_Logo.png')}
                        style={styles.logo}
                        resizeMode="contain"
                    />
                    <Text style={styles.subtitle}>Conecte-se com pessoas, crie momentos.</Text>
                </View>

                <View style={styles.form}>
                    <StyledInput
                        label="Email"
                        placeholder="seu@email.com"
                        value={email}
                        onChangeText={setEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                    />

                    <StyledInput
                        label="Senha"
                        placeholder="********"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                    />

                    <Link href="/forgot-password" asChild>
                        <Text style={styles.forgotPasswordLink}>Esqueci minha senha</Text>
                    </Link>

                    <StyledButton
                        title="Entrar"
                        onPress={handleLogin}
                        isLoading={loading}
                    />

                    <View style={styles.footer}>
                        <Text style={styles.footerText}>Não tem uma conta?</Text>
                        <Link href="/register" asChild>
                            <Text style={styles.link}> Cadastre-se</Text>
                        </Link>
                    </View>
                </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    scrollContent: {
        flexGrow: 1,
        justifyContent: 'center',
        padding: 24,
        paddingBottom: 32,
    },
    header: {
        alignItems: 'center',
        marginBottom: 4,
    },
    logo: {
        width: 350,
        height: 350,
        alignSelf: 'center',
    },
    title: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 18,
        color: '#062664ff',
        textAlign: 'center',
        marginBottom: 14,
    },
    form: {
        width: '100%',
    },
    footer: {
        marginTop: 24,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    footerText: {
        color: '#6b7280',
        fontSize: 14,
    },
    link: {
        color: '#6366f1',
        fontWeight: '600',
        fontSize: 14,
    },
    forgotPasswordLink: {
        alignSelf: 'flex-end',
        marginTop: 4,
        marginBottom: 12,
        color: '#6366f1',
        fontSize: 14,
        fontWeight: '600',
    },
});
