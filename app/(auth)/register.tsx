import { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, Alert, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { router, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createUserWithEmailAndPassword, deleteUser, sendEmailVerification, updateProfile, User as FirebaseUser } from 'firebase/auth';
import { auth } from '../../src/services/firebaseConfig';
import { StyledInput } from '../../src/components/StyledInput';
import { StyledButton } from '../../src/components/StyledButton';
import { TermsModal } from '../../src/components/TermsModal';
import { STRINGS } from '../../src/constants/strings';
import { authLog, getFirebaseErrorCode } from '../../src/utils/authError';
import { createInitialUserProfile, isValidNickname, NicknameUnavailableError, normalizeNickname } from '@/src/services/profileService';

export default function RegisterScreen() {
    const [nick, setNick] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const [showTermsModal, setShowTermsModal] = useState(false);


    const handleRegister = async () => {
        if (!nick || !email || !password) {
            Alert.alert('Erro', STRINGS.AUTH_ERROR_EMPTY_FIELDS);
            return;
        }

        if (!acceptedTerms) {
            Alert.alert('Termos de Uso', STRINGS.AUTH_ERROR_TERMS);
            return;
        }

        const normalizedEmail = email.trim().toLowerCase();
        const sanitizedNick = normalizeNickname(nick);
        if (!isValidNickname(sanitizedNick)) {
            Alert.alert('Erro', 'O nick deve ter de 3 a 20 caracteres: letras, números, ponto, hífen ou sublinhado.');
            return;
        }
        if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
            Alert.alert('E-mail inválido', 'Informe um e-mail válido.');
            return;
        }
        if (password.length < 6) {
            Alert.alert('Senha fraca', 'A senha deve ter pelo menos 6 caracteres.');
            return;
        }
        if (password !== confirmPassword) {
            Alert.alert('Senhas diferentes', 'Digite a mesma senha nos dois campos.');
            return;
        }

        setLoading(true);
        let createdUser: FirebaseUser | null = null;
        let profileSaved = false;
        try {
            // 1. Criar a identidade no Authentication.
            const userCredential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
            const user = userCredential.user;
            createdUser = user;

            // 2. Atualizar Perfil
            await updateProfile(user, { displayName: sanitizedNick });

            // 3. Reservar o nick e criar o perfil na mesma transação. Isso também
            // registra a versão e a data do aceite dos termos no servidor.
            await createInitialUserProfile({
                userId: user.uid,
                nick: sanitizedNick,
                email: normalizedEmail,
            });
            profileSaved = true;

            sendEmailVerification(user).then(
                () => authLog('email_verification_sent_after_registration'),
                (verificationError: unknown) => console.warn('[Auth] email_verification_send_failed', { code: getFirebaseErrorCode(verificationError) })
            );
            authLog('registration_completed');

            Alert.alert('Sucesso', STRINGS.AUTH_REGISTER_SUCCESS, [
                { text: 'OK', onPress: () => router.replace('/') }
            ]);
        } catch (error) {
            const code = getFirebaseErrorCode(error);
            console.error('[Auth] registration_failed', { code });

            if (createdUser && !profileSaved) {
                deleteUser(createdUser).catch((cleanupError: unknown) => {
                    console.error('[Auth] incomplete_registration_cleanup_failed', { code: getFirebaseErrorCode(cleanupError) });
                });
            }
            
            let msg = STRINGS.ERROR_DEFAULT;
            if (error instanceof NicknameUnavailableError) {
                msg = STRINGS.AUTH_ERROR_NICK_EXISTS;
            } else if (code === 'auth/email-already-in-use') {
                msg = 'Este email já está em uso.';
            } else if (code === 'auth/weak-password') {
                msg = 'A senha deve ter pelo menos 6 caracteres.';
            } else if (code === 'auth/network-request-failed') {
                msg = STRINGS.ERROR_NETWORK;
            }
            Alert.alert('Erro no Cadastro', msg);
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
                    <Text style={styles.title}>Crie sua conta</Text>
                    <Text style={styles.subtitle}>Junte-se à comunidade Reunion Hub.</Text>
                </View>

                <View style={styles.form}>
                    <StyledInput
                        label="Nick (Apelido único)"
                        placeholder="Ex: gui_gamer99"
                        value={nick}
                        onChangeText={setNick}
                        autoCapitalize="none"
                    />

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

                    <StyledInput
                        label="Confirmar senha"
                        placeholder="********"
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        secureTextEntry
                    />

                    <TouchableOpacity style={styles.checkboxContainer} onPress={() => setAcceptedTerms(!acceptedTerms)} activeOpacity={0.7}>
                        <Ionicons 
                            name={acceptedTerms ? "checkbox" : "square-outline"} 
                            size={24} 
                            color={acceptedTerms ? "#ec4899" : "#9ca3af"} 
                        />
                        <Text style={styles.checkboxText}>
                            Sou maior de 18 anos e concordo integralmente com os{' '}
                            <Text style={styles.linkTextInline} onPress={() => setShowTermsModal(true)}>
                                Termos e Regras
                            </Text>
                            {' '}e com a{' '}
                            <Text style={styles.linkTextInline} onPress={() => Linking.openURL('https://sites.google.com/view/sosfiber-softwares/politica-de-privacidade')}>
                                Política de Privacidade
                            </Text>. Assumo os riscos de uso do app.
                        </Text>
                    </TouchableOpacity>

                    <StyledButton
                        title="Cadastrar"
                        onPress={handleRegister}
                        isLoading={loading}
                        colors={['#ec4899', '#8b5cf6']} // Cores diferentes para registro
                    />

                    <View style={styles.footer}>
                        <Text style={styles.footerText}>Já tem uma conta?</Text>
                        <Link href="/login" asChild>
                            <Text style={styles.link}> Entrar</Text>
                        </Link>
                    </View>
                </View>
                </ScrollView>
            
                <TermsModal visible={showTermsModal} onClose={() => setShowTermsModal(false)} />
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
        marginBottom: 48,
    },
    title: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: '#6b7280',
        textAlign: 'center',
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
        color: '#ec4899',
        fontWeight: '600',
        fontSize: 14,
    },
    linkTextInline: {
        color: '#ec4899',
        fontWeight: 'bold',
        textDecorationLine: 'underline',
    },
    checkboxContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        marginBottom: 20,
        paddingHorizontal: 4,
    },
    checkboxText: {
        marginLeft: 12,
        fontSize: 13,
        color: '#4b5563',
        flex: 1,
        lineHeight: 18,
    },
});
