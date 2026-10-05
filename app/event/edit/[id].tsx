import { useLocalSearchParams, router, Stack } from 'expo-router';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { auth, db, functions } from '@/src/services/firebaseConfig';
import { StyledButton } from '@/src/components/StyledButton';
import { ErrorState } from '@/src/components/ErrorState';
import { INTERESTS_OPTIONS, normalizeInterests } from '@/src/constants/Interests';
import { canEditEvent, getEventDateTime, getEventDurationIssue } from '@/src/utils/eventSchedule';
import { formatPickerDate, formatPickerTime, pickerDate, pickerTime } from '@/src/utils/eventDateTimePicker';
import { getFirebaseErrorCode } from '@/src/utils/authError';
import { scheduleEventReminder } from '@/src/utils/Notifications';
import type { Meeting } from '@/src/types';

const TITLE_MAX_LENGTH = 100;
const LOCATION_MAX_LENGTH = 150;
const DESCRIPTION_MAX_LENGTH = 2000;
const LINK_MAX_LENGTH = 500;
const MAX_EVENT_INTERESTS = 10;
const MIN_LEAD_TIME_MS = 5 * 60 * 1000;

/** Mesma normalização da criação: o `matches()` das regras casa a string inteira. */
function normalizeHttpsUrl(value: string): string {
    return value
        .replace(/[\s​‌‍⁠﻿]+/g, '')
        .replace(/^https:\/\//i, 'https://');
}

function isValidHttpsUrl(value: string): boolean {
    return /^https:\/\/[^\s.]+(?:\.[^\s.]+)+(?:[/?#][^\s]*)?$/i.test(value);
}

type LoadState = 'loading' | 'ready' | 'denied' | 'locked' | 'not-found' | 'error';

/**
 * Edição de evento pelo criador. A gravação é da callable `editEvent`, que
 * revalida autoria, status e o prazo de 24 h — esta tela só evita oferecer o que
 * o servidor recusaria.
 *
 * NÃO edita, de propósito: o tipo do evento, as coordenadas no mapa (exige o
 * seletor, que vive no Explorar) e a série de repetições.
 */
export default function EditEventScreen() {
    const { id } = useLocalSearchParams();
    const eventId = typeof id === 'string' ? id : null;

    const [state, setState] = useState<LoadState>('loading');
    const [saving, setSaving] = useState(false);
    const [eventType, setEventType] = useState<'in-person' | 'online'>('in-person');

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [locationName, setLocationName] = useState('');
    const [interests, setInterests] = useState<string[]>([]);
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [endDate, setEndDate] = useState('');
    const [endTime, setEndTime] = useState('');
    const [meetingLink, setMeetingLink] = useState('');

    const [showDatePicker, setShowDatePicker] = useState(false);
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [showEndDatePicker, setShowEndDatePicker] = useState(false);
    const [showEndTimePicker, setShowEndTimePicker] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            if (!eventId || !auth.currentUser) {
                if (!cancelled) setState('not-found');
                return;
            }
            try {
                const snapshot = await getDoc(doc(db, 'meetings', eventId));
                if (cancelled) return;
                if (!snapshot.exists()) {
                    setState('not-found');
                    return;
                }
                const event = { id: snapshot.id, ...snapshot.data() } as Meeting;
                if (event.createdBy !== auth.currentUser.uid) {
                    setState('denied');
                    return;
                }
                if (!canEditEvent(event)) {
                    setState('locked');
                    return;
                }

                setEventType(event.type === 'online' ? 'online' : 'in-person');
                setTitle(event.title || '');
                setDescription(event.description || '');
                setLocationName(event.locationName || '');
                setInterests(normalizeInterests(event.interests));
                setDate(event.date || '');
                setTime(event.time || '');
                setEndDate(event.endDate || event.date || '');
                setEndTime(event.endTime || '');
                setMeetingLink(event.meetingLink || '');
                setState('ready');
            } catch {
                if (!cancelled) {
                    console.error('[EditEvent] load_failed');
                    setState('error');
                }
            }
        };

        void load();
        return () => { cancelled = true; };
    }, [eventId]);

    // Valores do picker memoizados: `pickerTime('')` devolve um Date novo a cada
    // chamada, e um Date instável na prop `value` faz o seletor voltar para a hora
    // atual a cada re-render — foi um bug real na tela de criação.
    const startDateValue = useMemo(() => pickerDate(date), [date]);
    const startTimeValue = useMemo(() => pickerTime(time), [time]);
    const endDateValue = useMemo(() => pickerDate(endDate || date), [endDate, date]);
    const endTimeValue = useMemo(() => pickerTime(endTime), [endTime]);
    const minimumDate = useMemo(() => new Date(), []);

    const toggleInterest = (interest: string) => {
        setInterests((current) => {
            if (current.includes(interest)) return current.filter((item) => item !== interest);
            if (current.length >= MAX_EVENT_INTERESTS) {
                Alert.alert('Limite de interesses', `Escolha até ${MAX_EVENT_INTERESTS} interesses para este evento.`);
                return current;
            }
            return [...current, interest];
        });
    };

    const handleSave = async () => {
        if (!eventId || saving) return;

        const trimmedTitle = title.trim();
        const trimmedDescription = description.trim();
        const trimmedLocation = locationName.trim();
        const normalizedInterests = normalizeInterests(interests);
        const normalizedLink = normalizeHttpsUrl(meetingLink);

        if (trimmedTitle.length < 3) {
            Alert.alert('Nome muito curto', 'O nome do evento precisa de pelo menos 3 caracteres.');
            return;
        }
        if (!trimmedDescription || !trimmedLocation || !date || !time || !endDate || !endTime) {
            Alert.alert('Atenção', 'Preencha todos os campos obrigatórios.');
            return;
        }
        if (normalizedInterests.length === 0) {
            Alert.alert('Interesses inválidos', 'Selecione ao menos um interesse.');
            return;
        }
        if (eventType === 'online' && (!isValidHttpsUrl(normalizedLink) || normalizedLink.length > LINK_MAX_LENGTH)) {
            Alert.alert(
                'Link da reunião inválido',
                'O link precisa começar com "https://" e conter um endereço válido, sem espaços ou caracteres inválidos.'
            );
            return;
        }

        const start = getEventDateTime(date, time);
        if (!start) {
            Alert.alert('Data inválida', 'Revise a data e o horário de início.');
            return;
        }
        if (start.getTime() <= Date.now() + MIN_LEAD_TIME_MS) {
            Alert.alert('Horário muito próximo', 'Escolha um horário com pelo menos 5 minutos de antecedência.');
            return;
        }
        const durationIssue = getEventDurationIssue({ date, time, endDate, endTime });
        if (durationIssue === 'invalid') {
            Alert.alert('Data inválida', 'Revise as datas e os horários do evento.');
            return;
        }
        if (durationIssue === 'too-short') {
            Alert.alert('Evento muito curto', 'Um evento precisa durar pelo menos 15 minutos.');
            return;
        }
        if (durationIssue === 'too-long') {
            Alert.alert('Evento muito longo', 'Um evento pode durar no máximo 24 horas.');
            return;
        }

        setSaving(true);
        try {
            await httpsCallable(functions, 'editEvent')({
                eventId,
                title: trimmedTitle,
                description: trimmedDescription,
                locationName: trimmedLocation,
                interests: normalizedInterests,
                date,
                time,
                endDate,
                endTime,
                ...(eventType === 'online' ? { meetingLink: normalizedLink } : {}),
            });
            // O lembrete local foi agendado para o horário antigo; sem reagendar, o
            // aviso chegaria na hora errada.
            scheduleEventReminder({
                id: eventId,
                title: trimmedTitle,
                date,
                time,
                endDate,
                endTime,
                type: eventType,
                isOrganizer: true,
            }, auth.currentUser?.uid ?? '').catch(() => undefined);
            Alert.alert('Evento atualizado', 'Quem confirmou presença foi avisado das mudanças.');
            router.back();
        } catch (error) {
            const code = getFirebaseErrorCode(error);
            const serverMessage = error instanceof Error ? error.message : '';
            console.error('[EditEvent] save_failed', { code });
            Alert.alert(
                'Não foi possível salvar',
                // A Function já devolve mensagens em pt-BR explicando o motivo
                // (prazo vencido, duração inválida, link recusado).
                serverMessage || 'Confira sua conexão e tente novamente.'
            );
        } finally {
            setSaving(false);
        }
    };

    if (state !== 'ready') {
        const blocked: Record<Exclude<LoadState, 'ready'>, { title: string; message: string }> = {
            loading: { title: '', message: '' },
            denied: { title: 'Sem permissão', message: 'Só quem criou o evento pode editá-lo.' },
            locked: {
                title: 'Edição encerrada',
                message: 'A edição fecha 24 horas antes do início, para ninguém ser pego de surpresa. Se precisar mudar algo agora, avise os participantes pelo chat ou cancele o evento.',
            },
            'not-found': { title: 'Evento não encontrado', message: 'Este evento não existe mais.' },
            error: { title: 'Não foi possível carregar', message: 'Confira sua conexão e tente novamente.' },
        };
        return (
            <SafeAreaView style={styles.container} edges={['bottom']}>
                <Stack.Screen options={{ title: 'Editar evento', headerBackTitle: 'Voltar' }} />
                <View style={styles.center}>
                    {state === 'loading'
                        ? <ActivityIndicator size="large" color="#4F46E5" />
                        : <ErrorState title={blocked[state].title} message={blocked[state].message} />}
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['bottom']}>
            <Stack.Screen options={{ title: 'Editar evento', headerBackTitle: 'Voltar' }} />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                    <View style={styles.notice}>
                        <Ionicons name="information-circle-outline" size={17} color="#4338CA" />
                        <Text style={styles.noticeText}>
                            Quem já confirmou presença recebe um aviso quando você muda data, horário, local ou link.
                        </Text>
                    </View>

                    <Text style={styles.label}>Nome do Evento</Text>
                    <TextInput
                        style={styles.input}
                        value={title}
                        onChangeText={setTitle}
                        maxLength={TITLE_MAX_LENGTH}
                        placeholder="Ex: Café com Tecnologia"
                        placeholderTextColor="#B6C0CE"
                    />

                    <Text style={styles.label}>Interesses Envolvidos</Text>
                    <View style={styles.chips}>
                        {INTERESTS_OPTIONS.map((interest) => {
                            const selected = interests.includes(interest);
                            return (
                                <TouchableOpacity
                                    key={interest}
                                    style={[styles.chip, selected && styles.chipSelected]}
                                    onPress={() => toggleInterest(interest)}
                                >
                                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{interest}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    <Text style={styles.label}>Início</Text>
                    <View style={styles.row}>
                        <TouchableOpacity style={[styles.input, styles.rowItem]} onPress={() => setShowDatePicker(true)}>
                            <Text style={styles.inputValue}>{date || 'Escolher data'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.input, styles.rowItem]} onPress={() => setShowTimePicker(true)}>
                            <Text style={styles.inputValue}>{time || 'Escolher hora'}</Text>
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.label}>Término</Text>
                    <View style={styles.row}>
                        <TouchableOpacity style={[styles.input, styles.rowItem]} onPress={() => setShowEndDatePicker(true)}>
                            <Text style={styles.inputValue}>{endDate || 'Escolher data'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.input, styles.rowItem]} onPress={() => setShowEndTimePicker(true)}>
                            <Text style={styles.inputValue}>{endTime || 'Escolher hora'}</Text>
                        </TouchableOpacity>
                    </View>

                    {showDatePicker && (
                        <DateTimePicker value={startDateValue} minimumDate={minimumDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={(event, selected) => {
                            setShowDatePicker(false);
                            if (event.type !== 'dismissed' && selected) {
                                const nextDate = formatPickerDate(selected);
                                setDate(nextDate);
                                // Término nunca fica antes do início.
                                setEndDate((current) => (!current || current < nextDate ? nextDate : current));
                            }
                        }} />
                    )}
                    {showTimePicker && (
                        <DateTimePicker value={startTimeValue} mode="time" is24Hour display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={(event, selected) => {
                            setShowTimePicker(false);
                            if (event.type !== 'dismissed' && selected) setTime(formatPickerTime(selected));
                        }} />
                    )}
                    {showEndDatePicker && (
                        <DateTimePicker value={endDateValue} minimumDate={startDateValue} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={(event, selected) => {
                            setShowEndDatePicker(false);
                            if (event.type !== 'dismissed' && selected) setEndDate(formatPickerDate(selected));
                        }} />
                    )}
                    {showEndTimePicker && (
                        <DateTimePicker value={endTimeValue} mode="time" is24Hour display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={(event, selected) => {
                            setShowEndTimePicker(false);
                            if (event.type !== 'dismissed' && selected) setEndTime(formatPickerTime(selected));
                        }} />
                    )}

                    <Text style={styles.label}>{eventType === 'online' ? 'Plataforma (ex: Zoom, Meet)' : 'Nome do Local'}</Text>
                    <TextInput
                        style={styles.input}
                        value={locationName}
                        onChangeText={setLocationName}
                        maxLength={LOCATION_MAX_LENGTH}
                        placeholder={eventType === 'online' ? 'Ex: Google Meet' : 'Ex: Parque do Ibirapuera, SP'}
                        placeholderTextColor="#B6C0CE"
                    />
                    {eventType === 'in-person' && (
                        <Text style={styles.hint}>
                            O ponto marcado no mapa não muda por aqui. Para outro endereço, cancele e crie o evento no local certo.
                        </Text>
                    )}

                    {eventType === 'online' && (
                        <>
                            <Text style={styles.label}>Link da Reunião</Text>
                            <TextInput
                                style={styles.input}
                                value={meetingLink}
                                onChangeText={setMeetingLink}
                                onBlur={() => setMeetingLink((current) => normalizeHttpsUrl(current))}
                                maxLength={LINK_MAX_LENGTH}
                                placeholder="Cole aqui o link (https://...)"
                                placeholderTextColor="#B6C0CE"
                                autoCapitalize="none"
                                keyboardType="url"
                            />
                        </>
                    )}

                    <Text style={styles.label}>Descrição</Text>
                    <TextInput
                        style={[styles.input, styles.textArea]}
                        value={description}
                        onChangeText={setDescription}
                        maxLength={DESCRIPTION_MAX_LENGTH}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                        placeholder="Conte mais sobre o que vai acontecer no evento..."
                        placeholderTextColor="#B6C0CE"
                    />

                    <View style={{ height: 18 }} />
                    <StyledButton title="Salvar alterações" onPress={handleSave} isLoading={saving} />
                    <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()} disabled={saving}>
                        <Text style={styles.cancelText}>Descartar</Text>
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8FAFC' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    content: { padding: 20, paddingBottom: 40 },
    notice: {
        flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 18,
        padding: 12, borderRadius: 12, backgroundColor: '#EEF2FF', borderWidth: 1, borderColor: '#C7D2FE',
    },
    noticeText: { flex: 1, color: '#4338CA', fontSize: 12, lineHeight: 17 },
    label: { fontSize: 13, fontWeight: '800', color: '#334155', marginBottom: 7, marginTop: 14 },
    input: {
        backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0',
        paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#0F172A',
    },
    inputValue: { fontSize: 15, color: '#0F172A' },
    textArea: { minHeight: 110 },
    row: { flexDirection: 'row', gap: 10 },
    rowItem: { flex: 1 },
    hint: { marginTop: 6, fontSize: 12, color: '#64748B', lineHeight: 17 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0' },
    chipSelected: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
    chipText: { fontSize: 12, color: '#475569', fontWeight: '600' },
    chipTextSelected: { color: '#FFF' },
    cancelButton: { marginTop: 12, paddingVertical: 12, alignItems: 'center' },
    cancelText: { color: '#64748B', fontSize: 14, fontWeight: '700' },
});
