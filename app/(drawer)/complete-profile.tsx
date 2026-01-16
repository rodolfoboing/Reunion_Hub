import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Image, TouchableOpacity, TextInput } from 'react-native';
import { router } from 'expo-router';
import { auth, db } from '../../firebaseConfig';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import { StyledButton } from '../../components/StyledButton';
import { StyledInput } from '../../components/StyledInput';
import { FontAwesome } from '@expo/vector-icons';

import { INTERESTS_OPTIONS } from '../../constants/Interests';

export default function CompleteProfileScreen() {
    const [bio, setBio] = useState('');
    const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
    const [image, setImage] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const pickImage = async () => {
        // No permissions request is necessary for launching the image library
        let result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.5,
            base64: true,
        });

        if (!result.canceled) {
            setImage(result.assets[0].uri);
        }
    };

    const toggleSelection = (item: string, list: string[], setList: any) => {
        if (list.includes(item)) {
            setList(list.filter(i => i !== item));
        } else {
            setList([...list, item]);
        }
    };

    const handleSave = async () => {
        if (!auth.currentUser) return;
        setLoading(true);

        try {
            const userRef = doc(db, 'users', auth.currentUser.uid);
            await updateDoc(userRef, {
                bio,
                interests: selectedInterests,
                // eventTypes removed
                isProfileComplete: true
            });

            Alert.alert('Sucesso', 'Perfil atualizado!', [
                { text: 'Ir para Início', onPress: () => router.replace('/(drawer)/(tabs)') }
            ]);
        } catch (error) {
            console.error(error);
            Alert.alert('Erro', 'Falha ao salvar perfil.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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

            <StyledButton
                title="Salvar e Continuar"
                onPress={handleSave}
                isLoading={loading}
            />
        </ScrollView>
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
});

