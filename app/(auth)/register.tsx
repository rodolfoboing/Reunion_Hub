import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, Alert, ScrollView } from 'react-native';
import { router, Link } from 'expo-router';
import { createUserWithEmailAndPassword, updateProfile, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../../src/services/firebaseConfig';
import { StyledInput } from '../../src/components/StyledInput';
import { StyledButton } from '../../src/components/StyledButton';

export default function RegisterScreen() {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);



    const handleRegister = async () => {
        if (!name || !email || !password) {
            Alert.alert('Erro', 'Preencha todos os campos.');
            return;
        }

        setLoading(true);
        try {
            // 1. Criar Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Atualizar Perfil
            await updateProfile(user, { displayName: name });

            // 3. Criar Documento no Firestore (Reputação inicial 0)
            // Gera sufixo aleatório para evitar colisão de Nicks no Chat
            const randomSuffix = Math.floor(1000 + Math.random() * 9000);
            const sanitizedNick = `${name.toLowerCase().replace(/\s+/g, '')}_${randomSuffix}`;
            
            await setDoc(doc(db, 'users', user.uid), {
                uid: user.uid,
                displayName: name,
                nick: sanitizedNick,
                searchName: sanitizedNick,
                email: email,
                reputation: 0,
                eventsAttended: 0,
                isProfileComplete: false,
                createdAt: new Date().toISOString(),
            });

            Alert.alert('Sucesso', 'Conta criada com sucesso!', [
                { text: 'OK', onPress: () => router.replace('/onboarding' as any) }
            ]);
        } catch (error: any) {
            console.error(error);
            Alert.alert('Erro no Cadastro', error.message || 'Falha ao criar conta.');
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
                    <Text style={styles.title}>Crie sua conta</Text>
                    <Text style={styles.subtitle}>Junte-se à comunidade Reunion Hub.</Text>
                </View>

                <View style={styles.form}>
                    <StyledInput
                        label="Nome Completo"
                        placeholder="João Silva"
                        value={name}
                        onChangeText={setName}
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
});
