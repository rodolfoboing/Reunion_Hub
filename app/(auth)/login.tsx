import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, KeyboardAvoidingView, Platform, Alert, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { Link, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { signInWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../src/services/firebaseConfig';
import { StyledInput } from '../../src/components/StyledInput';
import { StyledButton } from '../../src/components/StyledButton';
import { TermsModal } from '../../src/components/TermsModal';
import { STRINGS } from '../../src/constants/strings';

export default function LoginScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const [showTermsModal, setShowTermsModal] = useState(false);


    const handleLogin = async () => {
        if (!email || !password) {
            Alert.alert('Erro', STRINGS.AUTH_ERROR_EMPTY_FIELDS);
            return;
        }
        
        if (!acceptedTerms) {
            Alert.alert('Termos de Uso', STRINGS.AUTH_ERROR_TERMS);
            return;
        }

        setLoading(true);
        try {
            await signInWithEmailAndPassword(auth, email, password);
            // Redirect logic is handled by _layout but we add a fallback/direct replace
            router.replace('/');
        } catch (error: any) {
            console.error(`${STRINGS.LOG_AUTH} [Login] Failed to sign in user:`, error.code, error.message);
            
            let msg = STRINGS.ERROR_DEFAULT;
            if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                msg = STRINGS.AUTH_ERROR_INVALID_CREDS;
            } else if (error.code === 'auth/network-request-failed') {
                msg = STRINGS.ERROR_NETWORK;
            }
            Alert.alert('Erro no Login', msg);
        } finally {
            setLoading(false);
        }
    };

    return (
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

                    <TouchableOpacity style={styles.checkboxContainer} onPress={() => setAcceptedTerms(!acceptedTerms)} activeOpacity={0.7}>
                        <Ionicons 
                            name={acceptedTerms ? "checkbox" : "square-outline"} 
                            size={24} 
                            color={acceptedTerms ? "#6366f1" : "#9ca3af"} 
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
            
            <TermsModal visible={showTermsModal} onClose={() => setShowTermsModal(false)} />
        </KeyboardAvoidingView>
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
    linkTextInline: {
        color: '#6366f1',
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
