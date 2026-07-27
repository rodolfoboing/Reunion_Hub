import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Image, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { doc, updateDoc, getDoc, arrayUnion, setDoc } from 'firebase/firestore';
import { auth, db } from '../src/services/firebaseConfig';
import { INTERESTS_OPTIONS } from '../src/constants/Interests';
import { fetchNearbyPlaces, mapOsmToPlace } from '../src/services/osmService';
import { Place } from '../src/types';

const STEPS = {
    WELCOME_LOCATION: 0,
    INTERESTS: 1,
    PROFILE: 2,
    HABITS: 3
};

export default function OnboardingScreen() {
    const [step, setStep] = useState(STEPS.WELCOME_LOCATION);
    const [loading, setLoading] = useState(false);
    
    // Step 0: Location
    const [location, setLocation] = useState<Location.LocationObject | null>(null);

    // Step 1: Interests
    const [selectedInterests, setSelectedInterests] = useState<string[]>([]);

    // Step 2: Profile
    const [bio, setBio] = useState('');
    const [photoURI, setPhotoURI] = useState<string | null>(null);

    // Step 3: Habits
    const [suggestedPlaces, setSuggestedPlaces] = useState<Place[]>([]);
    const [loadingPlaces, setLoadingPlaces] = useState(false);
    // { placeId: { placeData, periods: ['Manhã', 'Tarde'] } }
    const [selectedHabits, setSelectedHabits] = useState<Record<string, { place: Place, periods: string[] }>>({});

    const handleRequestLocation = async () => {
        setLoading(true);
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
                const loc = await Location.getCurrentPositionAsync({});
                setLocation(loc);
            } else {
                Alert.alert('Aviso', 'Sem a localização não poderemos sugerir locais da sua comunidade, mas você pode continuar.');
            }
        } catch (error) {
            console.error('Erro ao pedir localização:', error);
        } finally {
            setLoading(false);
            setStep(STEPS.INTERESTS);
        }
    };

    const toggleInterest = (interest: string) => {
        setSelectedInterests(prev => 
            prev.includes(interest) 
                ? prev.filter(i => i !== interest)
                : [...prev, interest]
        );
    };

    const pickImage = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.5,
        });

        if (!result.canceled) {
            setPhotoURI(result.assets[0].uri);
        }
    };

    const fetchPlaces = async () => {
        if (!location) return;
        setLoadingPlaces(true);
        try {
            const lat = location.coords.latitude;
            const lng = location.coords.longitude;
            // Busca OSM num raio de ~2km
            const delta = 0.02;
            const elements = await fetchNearbyPlaces(lat - delta, lng - delta, lat + delta, lng + delta);
            
            const placesFound: Place[] = [];
            for (const el of elements) {
                const p = mapOsmToPlace(el);
                if (p) placesFound.push(p as Place);
            }
            // Pega apenas 5 para não sobrecarregar
            setSuggestedPlaces(placesFound.slice(0, 5));
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingPlaces(false);
        }
    };

    useEffect(() => {
        if (step === STEPS.HABITS && location && suggestedPlaces.length === 0) {
            fetchPlaces();
        }
    }, [step, location]);

    const toggleHabitPeriod = (place: Place, period: string) => {
        setSelectedHabits(prev => {
            const placeData = prev[place.id] || { place, periods: [] };
            const hasPeriod = placeData.periods.includes(period);
            
            const newPeriods = hasPeriod 
                ? placeData.periods.filter(p => p !== period)
                : [...placeData.periods, period];
            
            if (newPeriods.length === 0) {
                const newState = { ...prev };
                delete newState[place.id];
                return newState;
            }

            return {
                ...prev,
                [place.id]: { place, periods: newPeriods }
            };
        });
    };

    const handleFinish = async () => {
        setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) return;

            // 1. Update Profile (Photo/Bio/Interests)
            const userRef = doc(db, 'users', user.uid);
            await updateDoc(userRef, {
                interests: selectedInterests,
                bio: bio.trim(),
                photoURL: photoURI || user.photoURL, // Note: In a real app we'd upload to Storage first. We'll just save the local URI for MVP or skip if null.
                isProfileComplete: true
            });

            // 2. Save Habits to Places
            const habitPromises = Object.values(selectedHabits).map(async ({ place, periods }) => {
                const placeRef = doc(db, 'places', place.id);
                // merge: true so we don't overwrite if it exists
                await setDoc(placeRef, { 
                    id: place.id, 
                    name: place.name, 
                    latitude: place.latitude, 
                    longitude: place.longitude, 
                    vocations: place.vocations || [] 
                }, { merge: true });
                
                await updateDoc(placeRef, {
                    frequenters: arrayUnion(user.uid),
                    [`habits.${user.uid}`]: periods
                });
            });
            await Promise.all(habitPromises);

            // Redireciona pra home
            router.replace('/(drawer)/(tabs)');

        } catch (error) {
            console.error('Erro ao finalizar onboarding:', error);
            Alert.alert('Erro', 'Não foi possível salvar suas preferências.');
        } finally {
            setLoading(false);
        }
    };

    const renderStepContent = () => {
        switch (step) {
            case STEPS.WELCOME_LOCATION:
                return (
                    <View style={styles.stepContainer}>
                        <Ionicons name="map" size={80} color="#4F46E5" style={{ marginBottom: 24 }} />
                        <Text style={styles.title}>Bem-vindo ao Reunion Hub!</Text>
                        <Text style={styles.subtitle}>Para mostrarmos a comunidade ao seu redor, precisamos da sua localização.</Text>
                        <TouchableOpacity style={styles.primaryButton} onPress={handleRequestLocation}>
                            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Permitir Localização</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.secondaryButton} onPress={() => setStep(STEPS.INTERESTS)}>
                            <Text style={styles.secondaryButtonText}>Pular por enquanto</Text>
                        </TouchableOpacity>
                    </View>
                );
            case STEPS.INTERESTS:
                return (
                    <View style={styles.stepContainer}>
                        <Text style={styles.title}>O que você curte?</Text>
                        <Text style={styles.subtitle}>Escolha pelo menos 3 interesses para conectarmos você com a comunidade certa.</Text>
                        
                        <ScrollView contentContainerStyle={styles.interestsGrid}>
                            {INTERESTS_OPTIONS.map((interest, idx) => {
                                const isSelected = selectedInterests.includes(interest);
                                return (
                                    <TouchableOpacity 
                                        key={idx}
                                        style={[styles.interestChip, isSelected && styles.interestChipSelected]}
                                        onPress={() => toggleInterest(interest)}
                                    >
                                        <Text style={[styles.interestText, isSelected && styles.interestTextSelected]}>
                                            {interest}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>

                        <TouchableOpacity 
                            style={[styles.primaryButton, selectedInterests.length < 3 && styles.buttonDisabled]} 
                            disabled={selectedInterests.length < 3}
                            onPress={() => setStep(STEPS.PROFILE)}
                        >
                            <Text style={styles.buttonText}>Próximo ({selectedInterests.length}/3)</Text>
                        </TouchableOpacity>
                    </View>
                );
            case STEPS.PROFILE:
                return (
                    <View style={styles.stepContainer}>
                        <Text style={styles.title}>Seu Perfil de Comunidade</Text>
                        <Text style={styles.subtitle}>Adicione uma foto (opcional) e uma breve bio (obrigatório) para as pessoas te conhecerem.</Text>
                        
                        <TouchableOpacity style={styles.photoContainer} onPress={pickImage}>
                            {photoURI ? (
                                <Image source={{ uri: photoURI }} style={styles.photo} />
                            ) : (
                                <View style={styles.photoPlaceholder}>
                                    <Ionicons name="camera" size={40} color="#9CA3AF" />
                                    <Text style={styles.photoText}>Foto (Opcional)</Text>
                                </View>
                            )}
                        </TouchableOpacity>

                        <TextInput
                            style={styles.bioInput}
                            placeholder="Escreva algo sobre você... (Ex: Adoro jogar futebol de fds e conhecer novas pizzarias)"
                            multiline
                            numberOfLines={4}
                            value={bio}
                            onChangeText={setBio}
                            maxLength={150}
                        />

                        <TouchableOpacity 
                            style={[styles.primaryButton, bio.trim().length < 5 && styles.buttonDisabled]} 
                            disabled={bio.trim().length < 5}
                            onPress={() => setStep(STEPS.HABITS)}
                        >
                            <Text style={styles.buttonText}>Próximo</Text>
                        </TouchableOpacity>
                    </View>
                );
            case STEPS.HABITS:
                return (
                    <View style={styles.stepContainer}>
                        <Text style={styles.title}>Sua Rotina (Hábitos)</Text>
                        <Text style={styles.subtitle}>Você frequenta algum destes lugares? Marque o período para encontrar conexões espontâneas.</Text>
                        
                        {!location ? (
                            <View style={styles.center}>
                                <Text style={{color: '#6B7280', textAlign: 'center'}}>Sem localização, não podemos sugerir locais próximos.</Text>
                            </View>
                        ) : loadingPlaces ? (
                            <ActivityIndicator size="large" color="#4F46E5" style={{ marginTop: 40 }} />
                        ) : suggestedPlaces.length === 0 ? (
                            <View style={styles.center}>
                                <Text style={{color: '#6B7280', textAlign: 'center'}}>Nenhum local público encontrado perto de você no momento.</Text>
                            </View>
                        ) : (
                            <ScrollView style={{ flex: 1, width: '100%', marginTop: 16 }}>
                                {suggestedPlaces.map(place => {
                                    const selectedForPlace = selectedHabits[place.id]?.periods || [];
                                    return (
                                        <View key={place.id} style={styles.habitCard}>
                                            <Text style={styles.placeName}>{place.name}</Text>
                                            <View style={styles.periodRow}>
                                                {['Manhã', 'Tarde', 'Noite'].map(period => (
                                                    <TouchableOpacity 
                                                        key={period} 
                                                        style={[styles.periodChip, selectedForPlace.includes(period) && styles.periodChipSelected]}
                                                        onPress={() => toggleHabitPeriod(place, period)}
                                                    >
                                                        <Text style={[styles.periodText, selectedForPlace.includes(period) && styles.periodTextSelected]}>{period}</Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </View>
                                        </View>
                                    );
                                })}
                            </ScrollView>
                        )}

                        <TouchableOpacity style={styles.primaryButton} onPress={handleFinish}>
                            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Finalizar e Explorar</Text>}
                        </TouchableOpacity>
                    </View>
                );
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                <View style={styles.progressBar}>
                    {[0, 1, 2, 3].map(i => (
                        <View key={i} style={[styles.progressDot, step >= i && styles.progressDotActive]} />
                    ))}
                </View>
                {renderStepContent()}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    progressBar: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 16, gap: 8 },
    progressDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#E5E7EB' },
    progressDotActive: { backgroundColor: '#4F46E5' },
    stepContainer: { flex: 1, padding: 24, alignItems: 'center' },
    title: { fontSize: 24, fontWeight: 'bold', color: '#111827', textAlign: 'center', marginBottom: 8 },
    subtitle: { fontSize: 15, color: '#4B5563', textAlign: 'center', marginBottom: 32 },
    primaryButton: { backgroundColor: '#4F46E5', padding: 16, borderRadius: 12, width: '100%', alignItems: 'center', marginTop: 'auto' },
    buttonDisabled: { backgroundColor: '#9CA3AF' },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    secondaryButton: { padding: 16, width: '100%', alignItems: 'center', marginTop: 8 },
    secondaryButtonText: { color: '#6B7280', fontSize: 16, fontWeight: '600' },
    interestsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, paddingBottom: 24 },
    interestChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
    interestChipSelected: { backgroundColor: '#EEF2FF', borderColor: '#4F46E5' },
    interestText: { color: '#4B5563', fontWeight: '500' },
    interestTextSelected: { color: '#4F46E5', fontWeight: 'bold' },
    photoContainer: { marginBottom: 24 },
    photoPlaceholder: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#E5E7EB', borderStyle: 'dashed' },
    photo: { width: 120, height: 120, borderRadius: 60 },
    photoText: { fontSize: 12, color: '#9CA3AF', marginTop: 8 },
    bioInput: { width: '100%', backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 16, fontSize: 15, textAlignVertical: 'top', minHeight: 120 },
    habitCard: { backgroundColor: '#F9FAFB', padding: 16, borderRadius: 12, marginBottom: 12, width: '100%' },
    placeName: { fontSize: 16, fontWeight: 'bold', color: '#1F2937', marginBottom: 12 },
    periodRow: { flexDirection: 'row', gap: 8 },
    periodChip: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center' },
    periodChipSelected: { backgroundColor: '#EEF2FF', borderColor: '#4F46E5' },
    periodText: { fontSize: 14, color: '#4B5563' },
    periodTextSelected: { color: '#4F46E5', fontWeight: 'bold' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' }
});
