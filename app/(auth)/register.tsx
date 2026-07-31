import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, Alert, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { router, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createUserWithEmailAndPassword, updateProfile, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../../src/services/firebaseConfig';
import { StyledInput } from '../../src/components/StyledInput';
import { StyledButton } from '../../src/components/StyledButton';
import { TermsModal } from '../../src/components/TermsModal';
import { STRINGS } from '../../src/constants/strings';

export default function RegisterScreen() {
    const [nick, setNick] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
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

        const sanitizedNick = nick.trim().toLowerCase().replace(/\s+/g, '');
        if (sanitizedNick.length < 3) {
            Alert.alert('Erro', 'O Nick deve ter pelo menos 3 caracteres.');
            return;
        }

        setLoading(true);
        try {
            // 0. Verificar se Nick já existe
            const q = query(collection(db, 'users'), where('searchName', '==', sanitizedNick));
            const nickCheck = await getDocs(q);
            if (!nickCheck.empty) {
                Alert.alert('Nick Indisponível', STRINGS.AUTH_ERROR_NICK_EXISTS);
                setLoading(false);
                return;
            }

            // 1. Criar Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Atualizar Perfil
            await updateProfile(user, { displayName: nick.trim() });

            // 3. Criar Documento no Firestore (Reputação inicial 0)
            await setDoc(doc(db, 'users', user.uid), {
                uid: user.uid,
                displayName: nick.trim(),
                nick: sanitizedNick,
                searchName: sanitizedNick,
                email: email,
                reputation: 0,
                eventsAttended: 0,
                isProfileComplete: false,
                createdAt: new Date().toISOString(),
            });

            Alert.alert('Sucesso', STRINGS.AUTH_REGISTER_SUCCESS, [
                { text: 'OK', onPress: () => router.replace('/' as any) }
            ]);
        } catch (error: any) {
            console.error(`${STRINGS.LOG_AUTH} [Register] Failed:`, error.code, error.message);
            
            let msg = STRINGS.ERROR_DEFAULT;
            if (error.code === 'auth/email-already-in-use') {
                msg = 'Este email já está em uso.';
            } else if (error.code === 'auth/weak-password') {
                msg = 'A senha deve ter pelo menos 6 caracteres.';
            } else if (error.code === 'auth/network-request-failed') {
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
