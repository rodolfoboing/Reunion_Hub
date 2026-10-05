import React, { Dispatch, SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
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
import { getDateStr } from '@/src/utils/dateUtils';
import { getFirebaseErrorCode } from '@/src/utils/authError';
import { STRINGS } from '@/src/constants/strings';
// Compartilhados com a tela de edição: as duas escrevem os mesmos campos e
// precisam interpretar o calendário igual.
import { formatPickerDate, formatPickerTime, pickerDate, pickerTime } from '@/src/utils/eventDateTimePicker';
import { describeConflicts, findScheduleConflicts, type CandidateSchedule } from '@/src/services/scheduleConflictService';

const TITLE_MAX_LENGTH = 100;
const LOCATION_MAX_LENGTH = 150;
const DESCRIPTION_MAX_LENGTH = 2000;
const LINK_MAX_LENGTH = 500;
// Folga entre confirmar e o batch chegar ao servidor: as regras exigem
// `startsAt > request.time`, então um evento marcado para "daqui a 1 minuto"
// era rejeitado com permission-denied depois do alerta de responsabilidade.
const MIN_LEAD_TIME_MS = 5 * 60 * 1000;

type PlannedOccurrence = CandidateSchedule & { start: Date; end: Date };

function isValidHttpsUrl(value: string): boolean {
    return /^https:\/\/[^\s.]+(?:\.[^\s.]+)+(?:[/?#][^\s]*)?$/i.test(value);
}

/**
 * Deixa o link no formato que as `firestore.rules` aceitam, sem alterar o que
 * importa para abrir a reunião. Dois ajustes, cada um por um motivo concreto:
 *
 * 1. Espaços, tabulações, quebras de linha e caracteres invisíveis (zero-width,
 *    BOM) são removidos de TODA a string, não só das pontas. O `matches()` do
 *    Firestore casa a string INTEIRA e o `.` do RE2 não casa quebra de linha:
 *    um único `\n` no meio — comum ao colar de um convite do Meet ou do Teams —
 *    fazia a gravação ser recusada com permission-denied. URL válida não tem
 *    espaço em branco, então remover nunca quebra um link legítimo.
 * 2. O esquema vira minúsculo. Ele é case-insensitive na RFC 3986 e o
 *    `isValidHttpsUrl` acima aceita `HTTPS://` por causa do `/i`, mas a regra
 *    compara com `^https://` literal. Só o esquema: caminho, query e fragmento
 *    são sensíveis a maiúsculas e não podem ser tocados.
 */
function normalizeHttpsUrl(value: string): string {
    // \s cobre espaço, tab e quebra de linha; os \u são invisíveis que vêm
    // junto ao copiar de páginas web (zero-width space/non-joiner/joiner,
    // word joiner e BOM) e não aparecem na tela para o usuário corrigir.
    return value
        .replace(/[\s​‌‍⁠﻿]+/g, '')
        .replace(/^https:\/\//i, 'https://');
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
    const creationFlowRef = useRef(false);
    const creatingRef = useRef(false);

    // Reabrir o modal é o único ponto em que uma nova criação é legítima: a trava
    // fica fechada após um sucesso justamente para barrar um segundo envio do
    // mesmo formulário.
    useEffect(() => {
        if (visible) creatingRef.current = false;
    }, [visible]);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [showEndDatePicker, setShowEndDatePicker] = useState(false);
    const [showEndTimePicker, setShowEndTimePicker] = useState(false);
    const [showRepeatStartDatePicker, setShowRepeatStartDatePicker] = useState(false);
    const [inviteAfterCreate, setInviteAfterCreate] = useState(false);

    // A IDENTIDADE do Date importa aqui: o DateTimePicker reposiciona o seletor
    // toda vez que a prop `value` muda. pickerDate/pickerTime chamam `new Date()`,
    // e o pai (explore.tsx) re-renderiza sozinho a cada 750ms (piscar dos
    // marcadores) e a cada 60s (useEventClock) — então o seletor recebia um
    // "agora" novo o tempo todo e, com o campo ainda vazio, voltava para o
    // horário atual no meio da escolha. Memoizar pela string estabiliza.
    const startDatePickerValue = useMemo(() => pickerDate(newMeeting.date), [newMeeting.date]);
    const startTimePickerValue = useMemo(() => pickerTime(newMeeting.time), [newMeeting.time]);
    const endDatePickerValue = useMemo(
        () => pickerDate(newMeeting.endDate || newMeeting.date),
        [newMeeting.endDate, newMeeting.date],
    );
    const endTimePickerValue = useMemo(() => pickerTime(newMeeting.endTime), [newMeeting.endTime]);
    const repeatDatePickerValue = useMemo(
        () => pickerDate(repeatStartDate || newMeeting.date),
        [repeatStartDate, newMeeting.date],
    );
    // Recalculado a cada abertura do modal: estável enquanto aberto, sem congelar
    // "hoje" para sempre se o app ficar dias em segundo plano.
    const todayMinimumDate = useMemo(() => new Date(), [visible]);
    const repeatMinimumDate = useMemo(
        () => new Date(pickerDate(newMeeting.date).getTime() + 24 * 60 * 60 * 1000),
        [newMeeting.date],
    );

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
        // A ref trava no primeiro toque, antes do React desabilitar o botão.
        // Os alertas são aguardados: cancelar, falhar ou terminar a validação
        // passa pelo mesmo finally, sem deixar o formulário preso.
        if (creationFlowRef.current || creatingRef.current) return;
        creationFlowRef.current = true;
        setSubmitting(true);
        try {
            await validateAndCreateEvent();
        } catch (error) {
            console.error('[CreateEvent] validation_failed', { code: getFirebaseErrorCode(error) });
            Alert.alert('Erro', STRINGS.EVENT_CREATE_ERROR);
        } finally {
            creationFlowRef.current = false;
            setSubmitting(false);
        }
    };

    const requestClose = () => {
        // Fechar e reabrir durante a consulta/gravação permitiria que o fluxo
        // antigo continuasse sobre um formulário novo.
        if (!creationFlowRef.current) onClose();
    };

    const validateAndCreateEvent = async () => {
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
        const meetingLink = normalizeHttpsUrl(newMeeting.meetingLink);
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
        // Compara instantes, não strings: antes a data escolhida vinha no fuso do
        // aparelho (formatPickerDate) e era comparada com o calendário de São Paulo
        // (getTodayStr), o que divergia perto da meia-noite ou em outro fuso.
        const plannedStart = getEventDateTime(newMeeting.date, newMeeting.time);
        if (!plannedStart) {
            Alert.alert('Data inválida', 'Revise a data e o horário de início do evento.');
            return;
        }
        if (plannedStart.getTime() <= Date.now() + MIN_LEAD_TIME_MS) {
            Alert.alert('Horário muito próximo', 'Escolha um horário com pelo menos 5 minutos de antecedência.');
            return;
        }
        if (repeatCount > 0 && (!repeatStartDate || repeatStartDate <= newMeeting.date)) {
            Alert.alert('Data de repetição inválida', 'Escolha uma data posterior à primeira edição para a próxima repetição.');
            return;
        }
        if (eventType === 'online' && (!isValidHttpsUrl(meetingLink) || meetingLink.length > LINK_MAX_LENGTH)) {
            Alert.alert(
                'Link da reunião inválido',
                meetingLink.length > LINK_MAX_LENGTH
                    ? `O link é muito longo. Use até ${LINK_MAX_LENGTH} caracteres.`
                    : 'O link precisa começar com "https://" e conter um endereço válido, sem espaços ou caracteres inválidos. Tente copiar e colar novamente do convite da reunião.',
            );
            return;
        }
        if (eventType === 'in-person' && (!Number.isFinite(newMeeting.lat) || !Number.isFinite(newMeeting.lng) || newMeeting.lat < -90 || newMeeting.lat > 90 || newMeeting.lng < -180 || newMeeting.lng > 180 || (newMeeting.lat === 0 && newMeeting.lng === 0))) {
            Alert.alert('Atenção', 'Para eventos presenciais, é obrigatório selecionar uma localização no mapa.');
            return;
        }

        const normalizedInterests = normalizeInterests(newMeeting.interests);
        if (normalizedInterests.length === 0) {
            Alert.alert('Interesses inválidos', 'Selecione ao menos um interesse válido para o evento.');
            return;
        }

        const baseEnd = getEventDateTime(newMeeting.endDate, newMeeting.endTime);
        const repeatBaseStart = repeatCount > 0 ? getEventDateTime(repeatStartDate, newMeeting.time) : null;
        if (!baseEnd || baseEnd <= plannedStart || (repeatCount > 0 && !repeatBaseStart)) {
            Alert.alert('Data inválida', 'Revise as datas e os horários do evento.');
            return;
        }

        // Ocorrências calculadas antes dos alertas: servem tanto para o aviso de
        // conflito quanto para a gravação, sem recalcular nem divergir entre os dois.
        const durationMs = baseEnd.getTime() - plannedStart.getTime();
        const occurrences: PlannedOccurrence[] = [];
        for (let index = 0; index <= repeatCount; index += 1) {
            const start = index === 0 || !repeatBaseStart
                ? new Date(plannedStart)
                : new Date(repeatBaseStart.getTime() + ((index - 1) * 7 * 24 * 60 * 60 * 1000));
            const end = new Date(start.getTime() + durationMs);
            occurrences.push({
                start,
                end,
                date: getDateStr(start),
                endDate: getDateStr(end),
                time: newMeeting.time,
                endTime: newMeeting.endTime,
            });
        }

        let conflicts: Awaited<ReturnType<typeof findScheduleConflicts>> = [];
        try {
            conflicts = await findScheduleConflicts(currentUser.uid, occurrences);
        } catch {
            // Aviso é conveniência: uma falha na consulta não pode impedir a criação.
            console.warn('[CreateEvent] conflict_check_failed');
        }

        if (conflicts.length > 0) {
            const proceed = await new Promise<boolean>((resolve) => Alert.alert(
                'Conflito de agenda',
                `Você já tem compromisso no mesmo horário:\n\n${describeConflicts(conflicts)}\n\nDeseja criar mesmo assim?`,
                [
                    { text: 'Revisar horário', style: 'cancel', onPress: () => resolve(false) },
                    { text: 'Criar mesmo assim', onPress: () => resolve(true) },
                ],
                { cancelable: true, onDismiss: () => resolve(false) },
            ));
            if (!proceed) return;
        }

        if (await confirmResponsibility()) {
            await createEvents(occurrences, normalizedInterests, meetingLink);
        }
    };

    // `meetingLink` viaja validado daqui até a gravação. Antes o write relia
    // `newMeeting.meetingLink` por conta própria, então o valor conferido e o
    // valor gravado podiam divergir — foi exatamente assim que o link com
    // esquema em maiúsculas passou pela validação e quebrou nas regras.
    const confirmResponsibility = (): Promise<boolean> => new Promise((resolve) => {
        Alert.alert(
            'Responsabilidade do Organizador',
            'Como criador deste evento, VOCÊ é o único responsável por sua organização, segurança e veracidade. O Reunion Hub é apenas um facilitador tecnológico e se isenta de qualquer responsabilidade legal. Deseja criar o evento sob sua responsabilidade?',
            [
                { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
                {
                    text: 'Assumo a Responsabilidade',
                    onPress: () => resolve(true),
                }
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
        );
    });

    const createEvents = async (occurrences: PlannedOccurrence[], normalizedInterests: string[], meetingLink: string) => {
        // Segunda barreira, na própria escrita: entre a validação e este ponto o
        // usuário passou por dois Alerts, e nada garante que só um fluxo chegou aqui.
        if (creatingRef.current) return;
        const creatorId = auth.currentUser?.uid;
        if (!creatorId) {
            Alert.alert('Erro', 'Faça login para criar um evento.');
            return;
        }
        creatingRef.current = true;
        let created = false;
        try {
            const creatorProfile = await getDoc(doc(db, 'users', creatorId));
            const creatorData = creatorProfile.data();
            if ((creatorData?.reputation ?? 0) <= -50) {
                Alert.alert('Conta sem nível de confiança', 'Sua reputação atual não permite criar novos eventos. Participe de eventos e mantenha presenças confirmadas para recuperar confiança.');
                return;
            }
            const creatorName = creatorData?.nick || creatorData?.displayName || auth.currentUser?.displayName || 'Usuário';
            const batch = writeBatch(db);
            const seriesId = doc(collection(db, 'meetings')).id; // Gerar um ID de série
            const isRepeated = occurrences.length > 1;
            let firstEventId = '';
            const createdEventReminders: EventReminder[] = [];

            occurrences.forEach((occurrence, index) => {
                const newDocRef = doc(collection(db, 'meetings'));
                if (index === 0) firstEventId = newDocRef.id;
                createdEventReminders.push({
                    id: newDocRef.id,
                    title: newMeeting.title.trim(),
                    date: occurrence.date,
                    time: occurrence.time,
                    endDate: occurrence.endDate,
                    endTime: occurrence.endTime,
                    type: eventType,
                    isOrganizer: true,
                });
                // Campos explícitos em vez de `...newMeeting`: o spread gravava o
                // rascunho inteiro, então qualquer campo novo em CreateMeetingDraft
                // passaria a ir para o banco sem ninguém decidir (a regra de criação
                // usa hasAll, não hasOnly, então campo extra não é barrado).
                batch.set(newDocRef, {
                    title: newMeeting.title.trim(),
                    description: newMeeting.description.trim(),
                    locationName: newMeeting.locationName.trim(),
                    interests: normalizedInterests,
                    theme: normalizedInterests[0],
                    date: occurrence.date,
                    time: occurrence.time,
                    endDate: occurrence.endDate,
                    endTime: occurrence.endTime,
                    startsAt: Timestamp.fromDate(occurrence.start),
                    endsAt: Timestamp.fromDate(occurrence.end),
                    type: eventType,
                    meetingLink: eventType === 'online' ? meetingLink : '',
                    lat: eventType === 'in-person' ? newMeeting.lat : null,
                    lng: eventType === 'in-person' ? newMeeting.lng : null,
                    placeId: eventType === 'in-person' ? newMeeting.placeId : '',
                    createdBy: creatorId,
                    creatorName,
                    createdAt: serverTimestamp(),
                    isRepeated,
                    seriesId: isRepeated ? seriesId : null,
                    attendees: [creatorId],
                    status: 'active',
                });
            });

            await batch.commit();
            created = true;
            scheduleEventReminders(createdEventReminders, creatorId).catch(() => undefined);

            const repetitions = occurrences.length - 1;
            const successMessage = repetitions > 0
                ? `Evento criado com ${repetitions} repetições semanais!`
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
        } catch (error) {
            // Era `catch {}` puro: o erro sumia e sobrava um log sem nenhuma
            // informação, impossível de diagnosticar. O código sempre; o objeto
            // completo só em desenvolvimento, para não poluir produção.
            const code = getFirebaseErrorCode(error);
            console.error('[CreateEvent] creation_failed', { code });
            if (__DEV__) console.error('[CreateEvent] creation_failed_detail', error);
            // "Ocorreu um problema" já custou três reproduções para ser
            // diagnosticado. A mensagem aponta o campo mais provável de cada tipo
            // de evento, em vez de deixar o usuário adivinhar o que revisar.
            if (code === 'permission-denied') {
                Alert.alert(
                    'Não foi possível criar o evento',
                    eventType === 'online'
                        ? 'Verifique o link da reunião: ele precisa começar com "https://" e não pode conter espaços, quebras de linha ou caracteres inválidos. Tente apagar o campo e colar o link de novo.\n\nConfira também a data e os horários.'
                        : 'Verifique se a localização está marcada no mapa e se a data e os horários estão corretos.',
                );
            } else {
                Alert.alert('Erro', 'Ocorreu um problema ao criar seu evento. Confira sua conexão e tente novamente.');
            }
        } finally {
            // A trava da escrita permanece após sucesso até reabrir o modal.
            // Uma falha permite tentar novamente com o mesmo rascunho.
            if (!created) creatingRef.current = false;
        }
    };

    return (
        <Modal animationType="slide" transparent={true} visible={visible} onRequestClose={requestClose}>
            <SafeAreaView style={styles.modalOverlay} edges={['bottom']}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Criar Novo Evento</Text>
                        <TouchableOpacity onPress={requestClose} disabled={submitting}>
                            <Ionicons name="close" size={24} color="#6B7280" />
                        </TouchableOpacity>
                    </View>
                    {/* TODO manutenção: todo setNewMeeting daqui para baixo é
                        FUNCIONAL, e precisa continuar sendo. Com `{ ...newMeeting }`
                        o handler grava o rascunho capturado no render em que foi
                        criado; uma tecla despachada pelo nativo antes do commit do
                        re-render reverte campos alterados nesse intervalo. Foi assim
                        que digitar o link zerava `time` e o relógio voltava para a
                        hora atual — só em evento online, porque só ele tem o campo. */}
                    <ScrollView pointerEvents={submitting ? 'none' : 'auto'} showsVerticalScrollIndicator={false} contentContainerStyle={styles.formContent}>
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Nome do Evento</Text>
                            <TextInput style={styles.input} maxLength={TITLE_MAX_LENGTH} placeholderTextColor="#B6C0CE" placeholder="Ex: Café com Tecnologia" value={newMeeting.title} onChangeText={(text) => setNewMeeting((current) => ({ ...current, title: text }))} />
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
                            <DateTimePicker value={startDatePickerValue} minimumDate={todayMinimumDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={(event, selectedDate) => {
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
                            <DateTimePicker value={endDatePickerValue} minimumDate={startDatePickerValue} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={(event, selectedDate) => {
                                setShowEndDatePicker(false);
                                if (event.type !== 'dismissed' && selectedDate) {
                                    setNewMeeting((current) => ({ ...current, endDate: formatPickerDate(selectedDate) }));
                                }
                            }} />
                        )}
                        {showTimePicker && (
                            <DateTimePicker value={startTimePickerValue} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'} is24Hour={true} onChange={(event, selectedDate) => {
                                setShowTimePicker(false);
                                if (event.type !== 'dismissed' && selectedDate) {
                                    setNewMeeting((current) => ({ ...current, time: formatPickerTime(selectedDate) }));
                                }
                            }} />
                        )}
                        {showEndTimePicker && (
                            <DateTimePicker value={endTimePickerValue} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'} is24Hour={true} onChange={(event, selectedDate) => {
                                setShowEndTimePicker(false);
                                if (event.type !== 'dismissed' && selectedDate) {
                                    setNewMeeting((current) => ({ ...current, endTime: formatPickerTime(selectedDate) }));
                                }
                            }} />
                        )}
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>{eventType === 'online' ? 'Plataforma (ex: Zoom, Meet)' : 'Nome do Local'}</Text>
                            <TextInput style={styles.input} maxLength={LOCATION_MAX_LENGTH} placeholderTextColor="#B6C0CE" placeholder={eventType === 'online' ? "Ex: Google Meet" : "Ex: Parque do Ibirapuera, SP"} value={newMeeting.locationName} onChangeText={(text) => setNewMeeting((current) => ({ ...current, locationName: text }))} />
                        </View>
                        {eventType === 'online' && (
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Link da Reunião</Text>
                                <TextInput style={styles.input} maxLength={LINK_MAX_LENGTH} placeholderTextColor="#B6C0CE" placeholder="Cole aqui o link (https://...)" value={newMeeting.meetingLink}
                                    onChangeText={(text) => setNewMeeting((current) => ({ ...current, meetingLink: text }))}
                                    // Normaliza ao sair do campo, não a cada tecla: no Fabric o
                                    // EditText nativo descarta uma atualização controlada do mesmo
                                    // tamanho, e `HTTPS://` → `https://` tem 8 caracteres nos dois
                                    // lados — a conversão acontecia no estado mas não na tela.
                                    // Fora do modo de edição a troca aparece de verdade.
                                    // Isto é conveniência visual: quem garante a gravação válida
                                    // é a normalização na validação (ver `meetingLink` acima).
                                    onBlur={() => setNewMeeting((current) => ({ ...current, meetingLink: normalizeHttpsUrl(current.meetingLink) }))}
                                    autoCapitalize="none" keyboardType="url" />
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
                            <TextInput style={[styles.input, styles.textArea]} maxLength={DESCRIPTION_MAX_LENGTH} placeholderTextColor="#B6C0CE" placeholder="Conte mais sobre o que vai acontecer no evento..." multiline numberOfLines={4} textAlignVertical="top" value={newMeeting.description} onChangeText={(text) => setNewMeeting((current) => ({ ...current, description: text }))} />
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
                        {/* Mínimo é o dia seguinte à 1ª edição: com `new Date()` dava
                            para escolher uma data anterior ao evento e só descobrir no alerta. */}
                        {showRepeatStartDatePicker && (
                            <DateTimePicker
                                value={repeatDatePickerValue}
                                minimumDate={repeatMinimumDate}
                                mode="date"
                                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                                onChange={(event, selectedDate) => {
                                    setShowRepeatStartDatePicker(false);
                                    if (event.type === 'dismissed' || !selectedDate) return;
                                    setRepeatStartDate(formatPickerDate(selectedDate));
                                }}
                            />
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
