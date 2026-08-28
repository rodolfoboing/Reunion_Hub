import { Dispatch, SetStateAction, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Image, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { auth, db } from '../../src/services/firebaseConfig';
import { doc, updateDoc } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { storage } from '../../src/services/firebaseConfig';
import * as ImagePicker from 'expo-image-picker';
import { StyledButton } from '../../src/components/StyledButton';
import { FontAwesome } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { INTERESTS_OPTIONS, normalizeInterests } from '../../src/constants/Interests';
import { uploadProfileImage } from '@/src/services/profileService';
import { getFirebaseErrorCode } from '@/src/utils/authError';

export default function CompleteProfileScreen() {
    const [bio, setBio] = useState('');
    const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
    const [image, setImage] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const pickImage = async () => {
        // No permissions request is necessary for launching the image library
        let result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.5,
        });

        if (!result.canceled) {
            setImage(result.assets[0].uri);
        }
    };

    const toggleSelection = (item: string, list: string[], setList: Dispatch<SetStateAction<string[]>>) => {
        if (list.includes(item)) {
            setList(list.filter(i => i !== item));
        } else {
            setList([...list, item]);
        }
    };

    const handleSave = async () => {
        const user = auth.currentUser;
        if (!user || loading) return;
        setLoading(true);

        try {
            let uploadedPhotoUrl = user.photoURL || null;
            
            // Se o usuário selecionou uma nova imagem local, fazemos o upload
            if (image && !image.startsWith('http')) {
                uploadedPhotoUrl = await uploadProfileImage(storage, user.uid, image);
            }

            const userRef = doc(db, 'users', user.uid);
            await updateDoc(userRef, {
                bio,
                interests: normalizeInterests(selectedInterests),
                photoURL: uploadedPhotoUrl,
                isProfileComplete: true
            });

            if (uploadedPhotoUrl) {
                await updateProfile(user, { photoURL: uploadedPhotoUrl });
            }

            Alert.alert('Sucesso', 'Perfil atualizado!', [
                { text: 'Ir para Início', onPress: () => router.replace('/') }
            ]);
        } catch (error) {
            const code = getFirebaseErrorCode(error);
            console.error('[Onboarding] profile_completion_failed', { code });
            Alert.alert(
                'Não foi possível concluir',
                code === 'auth/network-request-failed' || code === 'storage/retry-limit-exceeded'
                    ? 'Verifique sua conexão e tente novamente.'
                    : 'Seu perfil ainda não foi concluído. Tente novamente.',
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
                <Text style={styles.title}>Complete seu Perfil</Text>
                <Text style={styles.subtitle}>Conte-nos mais sobre você para personalizarmos sua experiência.</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.label}>Foto de Perfil</Text>
                <TouchableOpacity onPress={pickImage} style={styles.imagePicker}>
                    {image ? (
                        <Image source={{ uri: image }} style={styles.profileImage} />
                    ) : (
                        <View style={styles.placeholderImage}>
                            <FontAwesome name="camera" size={32} color="#9ca3af" />
                            <Text style={styles.placeholderText}>Toque para alterar</Text>
                        </View>
                    )}
                </TouchableOpacity>
            </View>

            <View style={styles.section}>
                <Text style={styles.label}>Bio</Text>
                <TextInput
                    style={styles.bioInput}
                    placeholder="Escreva um pouco sobre você..."
                    multiline
                    numberOfLines={4}
                    value={bio}
                    onChangeText={setBio}
                />
            </View>

            <View style={styles.section}>
                <Text style={styles.label}>Interesses</Text>
                <View style={styles.chipsContainer}>
                    {INTERESTS_OPTIONS.map(item => (
                        <TouchableOpacity
                            key={item}
                            style={[styles.chip, selectedInterests.includes(item) && styles.chipSelected]}
                            onPress={() => toggleSelection(item, selectedInterests, setSelectedInterests)}
                        >
                            <Text style={[styles.chipText, selectedInterests.includes(item) && styles.chipTextSelected]}>{item}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            <View style={styles.preferencesNotice}>
                <FontAwesome name="sliders" size={22} color="#4F46E5" />
                <View style={styles.preferencesNoticeText}>
                    <Text style={styles.preferencesNoticeTitle}>Você mantém o controle</Text>
                    <Text style={styles.preferencesNoticeBody}>
                        Notificações, recomendações e a exibição dos lugares que você frequenta começam ativas. Em Perfil › Editar perfil, você pode desativar cada opção quando quiser. Recomendações presenciais usam apenas uma localização aproximada e recente.
                    </Text>
                </View>
            </View>

            <StyledButton
                title="Salvar e Continuar"
                onPress={handleSave}
                isLoading={loading}
            />
            </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    content: { padding: 24, paddingBottom: 40 },
    header: { marginBottom: 32, alignItems: 'center' },
    title: { fontSize: 28, fontWeight: 'bold', color: '#1f2937', marginBottom: 8 },
    subtitle: { fontSize: 16, color: '#6b7280', textAlign: 'center' },
    section: { marginBottom: 24 },
    label: { fontSize: 16, fontWeight: '600', color: '#374151', marginBottom: 12 },
    imagePicker: { alignSelf: 'center', marginBottom: 8 },
    profileImage: { width: 120, height: 120, borderRadius: 60 },
    placeholderImage: {
        width: 120, height: 120, borderRadius: 60, backgroundColor: '#f3f4f6',
        justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb'
    },
    placeholderText: { marginTop: 8, fontSize: 12, color: '#9ca3af' },
    bioInput: {
        backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12,
        padding: 16, fontSize: 16, color: '#1f2937', textAlignVertical: 'top', minHeight: 100
    },
    chipsContainer: { flexDirection: 'row', flexWrap: 'wrap' },
    chip: {
        paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f3f4f6',
        marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: '#e5e7eb'
    },
    chipSelected: { backgroundColor: '#e0e7ff', borderColor: '#6366f1' },
    chipText: { color: '#4b5563' },
    chipTextSelected: { color: '#4338ca', fontWeight: 'bold' },
    preferencesNotice: {
        flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#EEF2FF',
        borderWidth: 1, borderColor: '#C7D2FE', borderRadius: 14, padding: 16, marginBottom: 24,
    },
    preferencesNoticeText: { flex: 1 },
    preferencesNoticeTitle: { color: '#3730A3', fontSize: 15, fontWeight: '700', marginBottom: 5 },
    preferencesNoticeBody: { color: '#4B5563', fontSize: 13, lineHeight: 19 },
});

