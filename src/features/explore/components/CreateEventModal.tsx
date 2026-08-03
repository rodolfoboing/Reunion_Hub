import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { collection, addDoc, doc, setDoc, updateDoc, arrayUnion, writeBatch, getDoc } from 'firebase/firestore';
import { db, auth } from '@/src/services/firebaseConfig';
import { INTERESTS_OPTIONS, normalizeInterests } from '@/src/constants/Interests';
import { CONFIG } from '@/src/constants/Config';

interface CreateEventModalProps {
    visible: boolean;
    onClose: () => void;
    eventType: 'in-person' | 'online';
    newMeeting: any;
    setNewMeeting: (meeting: any) => void;
    onOpenLocationPicker: () => void;
    repeatCount: number;
    setRepeatCount: (count: number) => void;
    selectedPlace?: any;
    places?: any[];
}

export function CreateEventModal({
    visible,
    onClose,
    eventType,
    newMeeting,
    setNewMeeting,
    onOpenLocationPicker,
    repeatCount,
    setRepeatCount,
    selectedPlace,
    places
}: CreateEventModalProps) {
    const [submitting, setSubmitting] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [showTimePicker, setShowTimePicker] = useState(false);

    const toggleInterest = (interest: string) => {
        setNewMeeting((prev: any) => {
            const interests = prev.interests.includes(interest)
                ? prev.interests.filter((i: string) => i !== interest)
                : [...prev.interests, interest];
            return { ...prev, interests };
        });
    };



    const handleCreateEvent = async () => {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            Alert.alert('Sessão Expirada', 'Por favor, faça login novamente para criar um evento.');
            return;
        }

        try {
            await currentUser.reload();
            await currentUser.getIdToken(true);
        } catch (error) {
            console.error('[CreateEvent] Não foi possível atualizar a verificação de e-mail:', error);
            Alert.alert('Verificação necessária', 'Não foi possível confirmar seu e-mail agora. Tente novamente em instantes.');
            return;
        }

        if (!currentUser.emailVerified) {
            Alert.alert('Verifique seu e-mail', 'Confirme seu e-mail antes de criar um evento. Você pode enviar ou conferir o link de verificação na tela de Perfil.');
            return;
        }

        const isFieldsMissing = !newMeeting.title.trim() || newMeeting.interests.length === 0 || !newMeeting.locationName.trim() || !newMeeting.description.trim() || !newMeeting.date || !newMeeting.time;
        if (isFieldsMissing) {
            Alert.alert('Atenção', 'Por favor, preencha todos os campos obrigatórios.');
            return;
        }
        if (eventType === 'online' && !newMeeting.meetingLink.trim()) {
            Alert.alert('Atenção', 'Para eventos online, o Link da Reunião é obrigatório.');
            return;
        }
        if (eventType === 'in-person' && (newMeeting.lat === 0 || newMeeting.lat == null)) {
            Alert.alert('Atenção', 'Para eventos presenciais, é obrigatório selecionar uma localização no mapa.');
            return;
        }

        Alert.alert(
            'Responsabilidade do Organizador',
            'Como criador deste evento, VOCÊ é o único responsável por sua organização, segurança e veracidade. O Reunion Hub é apenas um facilitador tecnológico e se isenta de qualquer responsabilidade legal. Deseja criar o evento sob sua responsabilidade?',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Assumo a Responsabilidade',
                    onPress: async () => {
                        const creatorId = auth.currentUser?.uid;
                        if (!creatorId) {
                            Alert.alert('Erro', 'Faça login para criar um evento.');
                            return;
                        }
                        setSubmitting(true);
                        try {
                            const creatorProfile = await getDoc(doc(db, 'users', creatorId));
                            const creatorData = creatorProfile.data();
                            const creatorName = creatorData?.nick || creatorData?.displayName || auth.currentUser?.displayName || 'Usuário';
                            const normalizedInterests = normalizeInterests(newMeeting.interests);
                            const baseDate = new Date(`${newMeeting.date}T${newMeeting.time}:00`);
                            const batch = writeBatch(db);
                            const seriesId = doc(collection(db, 'meetings')).id; // Gerar um ID de série
                            
                            for (let i = 0; i <= repeatCount; i++) {
                                const currentEventDate = new Date(baseDate);
                                currentEventDate.setDate(baseDate.getDate() + (i * 7));

                                const year = currentEventDate.getFullYear();
                                const month = String(currentEventDate.getMonth() + 1).padStart(2, '0');
                                const day = String(currentEventDate.getDate()).padStart(2, '0');
                                const dateStr = `${year}-${month}-${day}`;
                                
                                const newDocRef = doc(collection(db, 'meetings'));
                                batch.set(newDocRef, {
                                    ...newMeeting,
                                    interests: normalizedInterests,
                                    date: dateStr,
                                    theme: normalizedInterests[0],
                                    type: eventType,
                                    meetingLink: eventType === 'online' ? newMeeting.meetingLink : '',
                                    lat: eventType === 'in-person' ? newMeeting.lat : null,
                                    lng: eventType === 'in-person' ? newMeeting.lng : null,
                                    placeId: eventType === 'in-person' ? newMeeting.placeId : '',
                                    createdBy: creatorId,
                                    creatorName,
                                    createdAt: new Date().toISOString(),
                                    isRepeated: repeatCount > 0,
                                    seriesId: repeatCount > 0 ? seriesId : null,
                                    attendees: [creatorId],
                                });
                            }

                            await batch.commit();



                            Alert.alert('Sucesso', repeatCount > 0 ? `Evento criado com ${repeatCount} repetições semanais!` : 'Seu evento foi criado e já está disponível para a comunidade!');
                            
                            setNewMeeting({
                                title: '', interests: [], description: '', locationName: '', date: '', time: '',
                                lat: newMeeting.lat, lng: newMeeting.lng, type: 'in-person', meetingLink: '', placeId: '',
                            });
                            onClose();
                        } catch (error) {
                            console.error('Error adding document: ', error);
                            Alert.alert('Erro', 'Ocorreu um problema ao criar seu evento.');
                        } finally {
                            setSubmitting(false);
                        }
                    }
                }
            ]
        );
    };

    return (
        <Modal animationType="slide" transparent={true} visible={visible} onRequestClose={onClose}>
            <SafeAreaView style={styles.modalOverlay} edges={['bottom']}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Criar Novo Evento</Text>
                        <TouchableOpacity onPress={onClose}>
                            <Ionicons name="close" size={24} color="#6B7280" />
                        </TouchableOpacity>
                    </View>
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.formContent}>
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Nome do Evento</Text>
                            <TextInput style={styles.input} placeholder="Ex: Café com Tecnologia" value={newMeeting.title} onChangeText={(text) => setNewMeeting({ ...newMeeting, title: text })} />
                        </View>
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Interesses Envolvidos</Text>
                            <View style={styles.interestsContainer}>
                                {INTERESTS_OPTIONS.map((interest: string) => (
                                    <TouchableOpacity key={interest} style={[styles.interestChip, newMeeting.interests.includes(interest) && styles.interestChipSelected]} onPress={() => toggleInterest(interest)}>
                                        <Text style={[styles.interestChipText, newMeeting.interests.includes(interest) && styles.interestChipTextSelected]}>{interest}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Data e Horário</Text>
                            <View style={styles.row}>
                                <TouchableOpacity style={[styles.input, { flex: 1, marginRight: 8, justifyContent: 'center' }]} onPress={() => setShowDatePicker(true)}>
                                    <Text style={{ color: newMeeting.date ? '#111827' : '#9CA3AF' }}>{newMeeting.date ? newMeeting.date.split('-').reverse().join('/') : 'Data (Dia/Mês)'}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.input, { flex: 1, justifyContent: 'center' }]} onPress={() => setShowTimePicker(true)}>
                                    <Text style={{ color: newMeeting.time ? '#111827' : '#9CA3AF' }}>{newMeeting.time || 'Horário'}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                        {showDatePicker && (
                            <DateTimePicker value={new Date()} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={(event, selectedDate) => {
                                setShowDatePicker(false);
                                if (selectedDate) {
                                    const year = selectedDate.getFullYear();
                                    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
                                    const day = String(selectedDate.getDate()).padStart(2, '0');
                                    setNewMeeting({ ...newMeeting, date: `${year}-${month}-${day}` });
                                }
                            }} />
                        )}
                        {showTimePicker && (
                            <DateTimePicker value={new Date()} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'} is24Hour={true} onChange={(event, selectedDate) => {
                                setShowTimePicker(false);
                                if (selectedDate) {
                                    const hours = String(selectedDate.getHours()).padStart(2, '0');
                                    const minutes = String(selectedDate.getMinutes()).padStart(2, '0');
                                    setNewMeeting({ ...newMeeting, time: `${hours}:${minutes}` });
                                }
                            }} />
                        )}
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>{eventType === 'online' ? 'Plataforma (ex: Zoom, Meet)' : 'Nome do Local'}</Text>
                            <TextInput style={styles.input} placeholder={eventType === 'online' ? "Ex: Google Meet" : "Ex: Parque do Ibirapuera, SP"} value={newMeeting.locationName} onChangeText={(text) => setNewMeeting({ ...newMeeting, locationName: text })} />
                        </View>
                        {eventType === 'online' && (
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Link da Reunião</Text>
                                <TextInput style={styles.input} placeholder="Cole aqui o link (https://...)" value={newMeeting.meetingLink} onChangeText={(text) => setNewMeeting({ ...newMeeting, meetingLink: text })} autoCapitalize="none" keyboardType="url" />
                            </View>
                        )}
                        {eventType === 'in-person' && (
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Localização Geográfica</Text>
                                <TouchableOpacity style={styles.mapPickerButton} onPress={onOpenLocationPicker}>
                                    <Ionicons name="location" size={20} color="#4F46E5" />
                                    <Text style={styles.mapPickerText}>{newMeeting.lat !== 0 ? 'Localização definida no mapa' : 'Selecionar no Mapa'}</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Descrição Detalhada</Text>
                            <TextInput style={[styles.input, styles.textArea]} placeholder="Conte mais sobre o que vai acontecer no evento..." multiline numberOfLines={4} textAlignVertical="top" value={newMeeting.description} onChangeText={(text) => setNewMeeting({ ...newMeeting, description: text })} />
                        </View>
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Repetição Semanal (Opcional)</Text>
                            <View style={styles.repeatContainer}>
                                <Text style={styles.repeatText}>{repeatCount === 0 ? 'Não repetir' : `Repetir por +${repeatCount} semana(s)`}</Text>
                                <View style={styles.repeatControls}>
                                    <TouchableOpacity onPress={() => setRepeatCount(Math.max(0, repeatCount - 1))} style={styles.repeatBtn}><Ionicons name="remove" size={20} color="#4F46E5" /></TouchableOpacity>
                                    <Text style={styles.repeatCount}>{repeatCount}</Text>
                                    <TouchableOpacity onPress={() => setRepeatCount(Math.min(CONFIG.MAX_REPEAT_WEEKS, repeatCount + 1))} style={styles.repeatBtn}><Ionicons name="add" size={20} color="#4F46E5" /></TouchableOpacity>
                                </View>
                            </View>
                            <Text style={styles.helperText}>Máximo de {CONFIG.MAX_REPEAT_WEEKS} repetições (aprox. 30 dias) para garantir que o evento não fique obsoleto.</Text>
                        </View>
                        <View style={styles.modalFooter}>
                            <TouchableOpacity style={[styles.submitButton, submitting && styles.submitButtonDisabled]} onPress={handleCreateEvent} disabled={submitting}>
                                {submitting ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark-circle" size={20} color="#fff" style={{ marginRight: 8 }} /><Text style={styles.submitButtonText}>Confirmar Criação</Text></>}
                            </TouchableOpacity>
                        </View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '90%' },
    formContent: { paddingBottom: 12 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#111827' },
    inputGroup: { marginBottom: 20 },
    inputLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
    input: { backgroundColor: '#F3F4F6', borderRadius: 12, padding: 12, fontSize: 16, color: '#111827', borderWidth: 1, borderColor: '#E5E7EB' },
    textArea: { height: 120, paddingTop: 12 },
    modalFooter: { marginTop: 12, marginBottom: 24 },
    submitButton: { backgroundColor: '#4F46E5', borderRadius: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    submitButtonDisabled: { opacity: 0.7 },
    submitButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    interestsContainer: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
    interestChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F3F4F6', marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: '#E5E7EB' },
    interestChipSelected: { backgroundColor: '#EEF2FF', borderColor: '#4F46E5' },
    interestChipText: { fontSize: 13, color: '#6B7280' },
    interestChipTextSelected: { color: '#4F46E5', fontWeight: 'bold' },
    row: { flexDirection: 'row', alignItems: 'center' },
    mapPickerButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', borderStyle: 'dashed' },
    mapPickerText: { marginLeft: 8, color: '#4F46E5', fontWeight: '600' },
    repeatContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F3F4F6', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E5E7EB' },
    repeatText: { fontSize: 14, fontWeight: '600', color: '#374151' },
    repeatControls: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, padding: 4 },
    repeatBtn: { padding: 8 },
    repeatCount: { fontSize: 16, fontWeight: 'bold', color: '#111827', marginHorizontal: 10, width: 20, textAlign: 'center' },
    helperText: { fontSize: 12, color: '#6B7280', marginTop: 6, fontStyle: 'italic' }
});
