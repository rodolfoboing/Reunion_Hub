import React, { Dispatch, SetStateAction, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { collection, doc, writeBatch, getDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db, auth } from '@/src/services/firebaseConfig';
import { INTERESTS_OPTIONS, normalizeInterests } from '@/src/constants/Interests';
import { CONFIG } from '@/src/constants/Config';
import { getEventDateTime, getEventDurationIssue } from '@/src/utils/eventSchedule';
import { scheduleEventReminders } from '@/src/utils/Notifications';
import type { EventReminder } from '@/src/utils/Notifications';
import type { CreateMeetingDraft } from '@/src/types';
import { getCurrentTimeStr, getDateStr, getTodayStr } from '@/src/utils/dateUtils';

const TITLE_MAX_LENGTH = 100;
const LOCATION_MAX_LENGTH = 150;
const DESCRIPTION_MAX_LENGTH = 2000;
const LINK_MAX_LENGTH = 500;

function isValidHttpsUrl(value: string): boolean {
    return /^https:\/\/[^\s.]+(?:\.[^\s.]+)+(?:[/?#][^\s]*)?$/i.test(value);
}

function pickerDate(value: string): Date {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function pickerTime(value: string): Date {
    const result = new Date();
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
    result.setSeconds(0, 0);
    if (match) result.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return result;
}

function formatPickerDate(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatPickerTime(value: Date): string {
    const hours = String(value.getHours()).padStart(2, '0');
    const minutes = String(value.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

interface CreateEventModalProps {
    visible: boolean;
    onClose: () => void;
    eventType: 'in-person' | 'online';
    newMeeting: CreateMeetingDraft;
    setNewMeeting: Dispatch<SetStateAction<CreateMeetingDraft>>;
    onOpenLocationPicker: () => void;
    repeatCount: number;
    setRepeatCount: (count: number) => void;
    repeatStartDate: string;
    setRepeatStartDate: (date: string) => void;
    onCreated?: (eventId: string) => void;
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
    repeatStartDate,
    setRepeatStartDate,
    onCreated,
}: CreateEventModalProps) {
    const [submitting, setSubmitting] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [showEndDatePicker, setShowEndDatePicker] = useState(false);
    const [showEndTimePicker, setShowEndTimePicker] = useState(false);
    const [showRepeatStartDatePicker, setShowRepeatStartDatePicker] = useState(false);
    const [inviteAfterCreate, setInviteAfterCreate] = useState(false);

    const toggleInterest = (interest: string) => {
        if (!newMeeting.interests.includes(interest) && newMeeting.interests.length >= 10) {
            Alert.alert('Limite de interesses', 'Escolha no máximo 10 interesses por evento.');
            return;
        }
        setNewMeeting((prev) => {
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

        let isEmailVerified = currentUser.emailVerified;
        if (!isEmailVerified) {
            try {
                await currentUser.reload();
                isEmailVerified = currentUser.emailVerified;
                if (isEmailVerified) await currentUser.getIdToken(true);
            } catch {
                console.warn('[CreateEvent] email_verification_refresh_failed');
                Alert.alert('Sem conexão', 'Não foi possível atualizar a verificação do e-mail. Confira sua internet e tente novamente.');
                return;
            }
        }

        if (!isEmailVerified) {
            Alert.alert('Verifique seu e-mail', 'Confirme seu e-mail antes de criar um evento. Você pode enviar ou conferir o link de verificação na tela de Perfil.');
            return;
        }

        const title = newMeeting.title.trim();
        const description = newMeeting.description.trim();
        const locationName = newMeeting.locationName.trim();
        const meetingLink = newMeeting.meetingLink.trim();
        const isFieldsMissing = !title || newMeeting.interests.length === 0 || !locationName || !description || !newMeeting.date || !newMeeting.time || !newMeeting.endDate || !newMeeting.endTime;
        if (isFieldsMissing) {
            Alert.alert('Atenção', 'Por favor, preencha todos os campos obrigatórios.');
            return;
        }
        if (title.length < 3) {
            Alert.alert('Nome muito curto', 'Use pelo menos 3 caracteres no nome do evento.');
            return;
        }
        const durationIssue = getEventDurationIssue(newMeeting);
        if (durationIssue === 'invalid') {
            Alert.alert('Término inválido', 'A data e a hora de término precisam ser posteriores ao início.');
            return;
        }
        if (durationIssue === 'too-short') {
            Alert.alert('Evento muito curto', 'O evento precisa durar pelo menos 15 minutos.');
            return;
        }
        if (durationIssue === 'too-long') {
            Alert.alert('Evento muito longo', 'Um evento pode durar no máximo 24 horas. Crie outra edição caso precise continuar depois disso.');
            return;
        }
        if (title.length > TITLE_MAX_LENGTH || locationName.length > LOCATION_MAX_LENGTH || description.length > DESCRIPTION_MAX_LENGTH) {
            Alert.alert('Texto muito longo', `Use até ${TITLE_MAX_LENGTH} caracteres no nome, ${LOCATION_MAX_LENGTH} no local e ${DESCRIPTION_MAX_LENGTH} na descrição.`);
            return;
        }
        const today = getTodayStr();
        if (newMeeting.date < today || (newMeeting.date === today && newMeeting.time <= getCurrentTimeStr())) {
            Alert.alert('Data inválida', 'Escolha uma data e horário futuros para o evento.');
            return;
        }
        if (repeatCount > 0 && (!repeatStartDate || repeatStartDate <= newMeeting.date)) {
            Alert.alert('Data de repetição inválida', 'Escolha uma data posterior à primeira edição para a próxima repetição.');
            return;
        }
        if (eventType === 'online' && (!isValidHttpsUrl(meetingLink) || meetingLink.length > LINK_MAX_LENGTH)) {
            Alert.alert('Link inválido', 'Informe um link HTTPS válido para a reunião online.');
            return;
        }
        if (eventType === 'in-person' && (!Number.isFinite(newMeeting.lat) || !Number.isFinite(newMeeting.lng) || newMeeting.lat < -90 || newMeeting.lat > 90 || newMeeting.lng < -180 || newMeeting.lng > 180 || (newMeeting.lat === 0 && newMeeting.lng === 0))) {
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
                            if ((creatorData?.reputation ?? 0) <= -50) {
                                Alert.alert('Conta sem nível de confiança', 'Sua reputação atual não permite criar novos eventos. Participe de eventos e mantenha presenças confirmadas para recuperar confiança.');
                                return;
                            }
                            const creatorName = creatorData?.nick || creatorData?.displayName || auth.currentUser?.displayName || 'Usuário';
                            const normalizedInterests = normalizeInterests(newMeeting.interests);
                            const baseStart = getEventDateTime(newMeeting.date, newMeeting.time);
                            const baseEnd = getEventDateTime(newMeeting.endDate, newMeeting.endTime);
                            const repeatBaseStart = repeatCount > 0 ? getEventDateTime(repeatStartDate, newMeeting.time) : null;
                            if (!baseStart || !baseEnd || baseEnd <= baseStart || (repeatCount > 0 && !repeatBaseStart)) {
                                Alert.alert('Data inválida', 'Revise as datas e os horários do evento.');
                                return;
                            }
                            const durationMs = baseEnd.getTime() - baseStart.getTime();
                            const batch = writeBatch(db);
                            const seriesId = doc(collection(db, 'meetings')).id; // Gerar um ID de série
                            let firstEventId = '';
                            const createdEventReminders: EventReminder[] = [];
                            
                            for (let i = 0; i <= repeatCount; i++) {
                                const currentEventStart = i === 0 || !repeatBaseStart
                                    ? new Date(baseStart)
                                    : new Date(repeatBaseStart.getTime() + ((i - 1) * 7 * 24 * 60 * 60 * 1000));
                                const currentEventEnd = new Date(currentEventStart.getTime() + durationMs);
                                const dateStr = getDateStr(currentEventStart);
                                const endDateStr = getDateStr(currentEventEnd);
                                
                                const newDocRef = doc(collection(db, 'meetings'));
                                if (i === 0) firstEventId = newDocRef.id;
                                createdEventReminders.push({
                                    id: newDocRef.id,
                                    title: newMeeting.title,
                                    date: dateStr,
                                    time: newMeeting.time,
                                    endDate: endDateStr,
                                    endTime: newMeeting.endTime,
                                    type: eventType,
                                    isOrganizer: true,
                                });
                                batch.set(newDocRef, {
                                    ...newMeeting,
                                    title,
                                    description,
                                    locationName,
                                    interests: normalizedInterests,
                                    date: dateStr,
                                    endDate: endDateStr,
                                    startsAt: Timestamp.fromDate(currentEventStart),
                                    endsAt: Timestamp.fromDate(currentEventEnd),
                                    theme: normalizedInterests[0],
                                    type: eventType,
                                    meetingLink: eventType === 'online' ? meetingLink : '',
                                    lat: eventType === 'in-person' ? newMeeting.lat : null,
                                    lng: eventType === 'in-person' ? newMeeting.lng : null,
                                    placeId: eventType === 'in-person' ? newMeeting.placeId : '',
                                    createdBy: creatorId,
                                    creatorName,
                                    createdAt: serverTimestamp(),
                                    isRepeated: repeatCount > 0,
                                    seriesId: repeatCount > 0 ? seriesId : null,
                                    attendees: [creatorId],
                                    status: 'active',
                                });
                            }

                            await batch.commit();
                            scheduleEventReminders(createdEventReminders, creatorId).catch(() => undefined);



                            const successMessage = repeatCount > 0
                                ? `Evento criado com ${repeatCount} repetições semanais!`
                                : 'Seu evento foi criado e já está disponível para a comunidade!';
                            setNewMeeting({
                                title: '', interests: [], description: '', locationName: '', date: '', time: '', endDate: '', endTime: '',
                                lat: 0, lng: 0, type: 'in-person', meetingLink: '', placeId: '',
                            });
                            setRepeatCount(0);
                            setRepeatStartDate('');
                            setInviteAfterCreate(false);
                            onClose();
                            if (inviteAfterCreate && firstEventId) {
                                Alert.alert('Evento criado', `${successMessage}\n\nAgora escolha quem você deseja convidar.`);
                                onCreated?.(firstEventId);
                            } else {
                                Alert.alert('Sucesso', successMessage);
                            }
                        } catch {
                            console.error('[CreateEvent] creation_failed');
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
                            <TextInput style={styles.input} maxLength={TITLE_MAX_LENGTH} placeholderTextColor="#B6C0CE" placeholder="Ex: Café com Tecnologia" value={newMeeting.title} onChangeText={(text) => setNewMeeting({ ...newMeeting, title: text })} />
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
                            <Text style={styles.inputLabel}>Início</Text>
                            <View style={styles.row}>
                                <TouchableOpacity style={[styles.input, { flex: 1, marginRight: 8, justifyContent: 'center' }]} onPress={() => setShowDatePicker(true)}>
                                    <Text style={{ color: newMeeting.date ? '#111827' : '#B6C0CE' }}>{newMeeting.date ? newMeeting.date.split('-').reverse().join('/') : 'Data (Dia/Mês)'}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.input, { flex: 1, justifyContent: 'center' }]} onPress={() => setShowTimePicker(true)}>
                                    <Text style={{ color: newMeeting.time ? '#111827' : '#B6C0CE' }}>{newMeeting.time || 'Horário'}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Término</Text>
                            <View style={styles.row}>
                                <TouchableOpacity style={[styles.input, { flex: 1, marginRight: 8, justifyContent: 'center' }]} onPress={() => setShowEndDatePicker(true)}>
                                    <Text style={{ color: newMeeting.endDate ? '#111827' : '#B6C0CE' }}>{newMeeting.endDate ? newMeeting.endDate.split('-').reverse().join('/') : 'Data de término'}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.input, { flex: 1, justifyContent: 'center' }]} onPress={() => setShowEndTimePicker(true)}>
                                    <Text style={{ color: newMeeting.endTime ? '#111827' : '#B6C0CE' }}>{newMeeting.endTime || 'Horário'}</Text>
                                </TouchableOpacity>
                            </View>
                            <Text style={styles.helperText}>Duração permitida: de 15 minutos a 24 horas. O término pode ser no dia seguinte.</Text>
                        </View>
                        {showDatePicker && (
                            <DateTimePicker value={pickerDate(newMeeting.date)} minimumDate={new Date()} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={(event, selectedDate) => {
                                setShowDatePicker(false);
                                if (event.type !== 'dismissed' && selectedDate) {
                                    const nextDate = formatPickerDate(selectedDate);
                                    setNewMeeting((current) => ({
                                        ...current,
                                        date: nextDate,
                                        endDate: !current.endDate || current.endDate < nextDate ? nextDate : current.endDate,
                                    }));
                                }
                            }} />
                        )}
                        {showEndDatePicker && (
                            <DateTimePicker value={pickerDate(newMeeting.endDate || newMeeting.date)} minimumDate={pickerDate(newMeeting.date)} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={(event, selectedDate) => {
                                setShowEndDatePicker(false);
                                if (event.type !== 'dismissed' && selectedDate) {
                                    setNewMeeting((current) => ({ ...current, endDate: formatPickerDate(selectedDate) }));
                                }
                            }} />
                        )}
                        {showTimePicker && (
                            <DateTimePicker value={pickerTime(newMeeting.time)} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'} is24Hour={true} onChange={(event, selectedDate) => {
                                setShowTimePicker(false);
                                if (event.type !== 'dismissed' && selectedDate) {
                                    setNewMeeting((current) => ({ ...current, time: formatPickerTime(selectedDate) }));
                                }
                            }} />
                        )}
                        {showEndTimePicker && (
                            <DateTimePicker value={pickerTime(newMeeting.endTime)} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'} is24Hour={true} onChange={(event, selectedDate) => {
                                setShowEndTimePicker(false);
                                if (event.type !== 'dismissed' && selectedDate) {
                                    setNewMeeting((current) => ({ ...current, endTime: formatPickerTime(selectedDate) }));
                                }
                            }} />
                        )}
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>{eventType === 'online' ? 'Plataforma (ex: Zoom, Meet)' : 'Nome do Local'}</Text>
                            <TextInput style={styles.input} maxLength={LOCATION_MAX_LENGTH} placeholderTextColor="#B6C0CE" placeholder={eventType === 'online' ? "Ex: Google Meet" : "Ex: Parque do Ibirapuera, SP"} value={newMeeting.locationName} onChangeText={(text) => setNewMeeting({ ...newMeeting, locationName: text })} />
                        </View>
                        {eventType === 'online' && (
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Link da Reunião</Text>
                                <TextInput style={styles.input} maxLength={LINK_MAX_LENGTH} placeholderTextColor="#B6C0CE" placeholder="Cole aqui o link (https://...)" value={newMeeting.meetingLink} onChangeText={(text) => setNewMeeting({ ...newMeeting, meetingLink: text })} autoCapitalize="none" keyboardType="url" />
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
                            <TextInput style={[styles.input, styles.textArea]} maxLength={DESCRIPTION_MAX_LENGTH} placeholderTextColor="#B6C0CE" placeholder="Conte mais sobre o que vai acontecer no evento..." multiline numberOfLines={4} textAlignVertical="top" value={newMeeting.description} onChangeText={(text) => setNewMeeting({ ...newMeeting, description: text })} />
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
                        {repeatCount > 0 && (
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Data da próxima repetição</Text>
                                <TouchableOpacity style={[styles.input, { justifyContent: 'center' }]} onPress={() => setShowRepeatStartDatePicker(true)}>
                                    <Text style={{ color: repeatStartDate ? '#111827' : '#9CA3AF' }}>
                                        {repeatStartDate ? repeatStartDate.split('-').reverse().join('/') : 'Escolher próxima data'}
                                    </Text>
                                </TouchableOpacity>
                                <Text style={styles.helperText}>As demais repetições serão semanais a partir desta data.</Text>
                            </View>
                        )}
                        {showRepeatStartDatePicker && (
                            <DateTimePicker value={pickerDate(repeatStartDate)} minimumDate={new Date()} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={(event, selectedDate) => {
                                setShowRepeatStartDatePicker(false);
                                if (event.type === 'dismissed' || !selectedDate) return;
                                setRepeatStartDate(formatPickerDate(selectedDate));
                            }} />
                        )}
                        <TouchableOpacity
                            style={[styles.inviteOption, inviteAfterCreate && styles.inviteOptionSelected]}
                            onPress={() => setInviteAfterCreate((current) => !current)}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: inviteAfterCreate }}
                        >
                            <Ionicons name={inviteAfterCreate ? 'checkbox' : 'square-outline'} size={22} color="#4F46E5" />
                            <View style={styles.inviteOptionText}>
                                <Text style={styles.inviteOptionTitle}>Convidar pessoas após criar</Text>
                                <Text style={styles.helperText}>Você poderá escolher contatos recentes ou buscar pelo nick. Em eventos repetidos, o convite vale para a primeira data.</Text>
                            </View>
                        </TouchableOpacity>
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
    helperText: { fontSize: 12, color: '#6B7280', marginTop: 6, fontStyle: 'italic' },
    inviteOption: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB' },
    inviteOptionSelected: { borderColor: '#A5B4FC', backgroundColor: '#EEF2FF' },
    inviteOptionText: { flex: 1 },
    inviteOptionTitle: { color: '#312E81', fontSize: 14, fontWeight: '700' },
});
