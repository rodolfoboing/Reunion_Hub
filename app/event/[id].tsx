import { useLocalSearchParams, router, Stack } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useState } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useFocusEffect } from '@react-navigation/native';
import { db, auth, functions } from '../../src/services/firebaseConfig';
import { CheckInRequest, Meeting } from '../../src/types';
import { StyledButton } from '@/src/components/StyledButton';
import { ErrorState } from '@/src/components/ErrorState';
import { FontAwesome } from '@expo/vector-icons';
import { normalizeDate } from '../../src/utils/dateUtils';
import { formatEventTimeRange, isEventInProgress, isEventRegistrationOpen, isEventToday } from '../../src/utils/eventSchedule';
import { useEventClock } from '@/src/hooks/useEventClock';
import { scheduleEventReminder, cancelEventReminder } from '../../src/utils/Notifications';
import { ReportReasonModal } from '@/src/components/ReportReasonModal';
import { markRelatedNotificationsAsRead } from '@/src/services/notificationReadService';
import { EventInviteModal } from '@/src/features/events/components/EventInviteModal';
import { submitReport } from '@/src/services/reportService';

// Helper para verificar se hoje é o dia do evento
// Formata a data para exibição amigável
const formatDateDisplay = (dateString: string | undefined): string => {
    const normalized = normalizeDate(dateString);
    if (!normalized) return 'Data a definir';

    try {
        const [year, month, day] = normalized.split('-');
        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const monthName = months[parseInt(month, 10) - 1] || month;
        return `${day} de ${monthName} de ${year}`;
    } catch (e) {
        return dateString || 'Data a definir';
    }
};

export default function MeetingDetailsScreen() {
    const eventClock = useEventClock();
    const { id } = useLocalSearchParams<{ id?: string }>();
    const eventId = typeof id === 'string' ? id : null;
    const [meeting, setMeeting] = useState<Meeting | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [rsvpLoading, setRsvpLoading] = useState(false);
    const [checkInLoading, setCheckInLoading] = useState(false);
    const [confirmingCheckInUserId, setConfirmingCheckInUserId] = useState<string | null>(null);
    const [showReportReasonModal, setShowReportReasonModal] = useState(false);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [favoriteLoading, setFavoriteLoading] = useState(false);
    const [linkIssueLoading, setLinkIssueLoading] = useState(false);
    const [isFavorited, setIsFavorited] = useState(false);
    const [creatorName, setCreatorName] = useState('Usuário');
    const [retryKey, setRetryKey] = useState(0);

    useFocusEffect(useCallback(() => {
        if (!eventId) {
            setMeeting(null);
            setError(true);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(false);
        const unsubscribe = onSnapshot(doc(db, 'meetings', eventId), (snapshot) => {
            if (!snapshot.exists()) {
                setMeeting(null);
                setError(true);
            } else {
                setMeeting({ id: snapshot.id, ...snapshot.data() } as Meeting);
                setError(false);
            }
            setLoading(false);
        }, () => {
            setError(true);
            setLoading(false);
        });
        return unsubscribe;
    }, [eventId, retryKey]));

    useFocusEffect(useCallback(() => {
        const uid = auth.currentUser?.uid;
        if (!uid || !eventId) {
            setIsFavorited(false);
            return;
        }
        return onSnapshot(doc(db, 'users', uid, 'favoriteEvents', eventId), (snapshot) => {
            setIsFavorited(snapshot.exists());
        }, () => setIsFavorited(false));
    }, [eventId]));

    useEffect(() => {
        if (!meeting?.createdBy) return;
        let active = true;
        markRelatedNotificationsAsRead({ meetingId: meeting.id }).catch((notificationError) => {
            console.error('[Event] Erro ao marcar notificações como lidas:', notificationError);
        });

        getDoc(doc(db, 'users', meeting.createdBy)).then((creatorSnapshot) => {
            if (!active) return;
            const profile = creatorSnapshot.data();
            setCreatorName(profile?.nick || profile?.displayName || meeting.creatorName || 'Usuário');
        }).catch((creatorError) => {
            console.error('[Event] Erro ao carregar criador do evento:', creatorError);
            if (active) setCreatorName(meeting.creatorName || 'Usuário');
        });

        return () => { active = false; };
    }, [meeting?.createdBy, meeting?.creatorName, meeting?.id]);

    const handleReportLinkIssue = () => {
        if (!eventId || !meeting || !auth.currentUser || meeting.createdBy === auth.currentUser.uid) return;
        Alert.alert(
            'Avisar sobre o link?',
            'Alguns links de reunião só ficam disponíveis perto do horário. Envie o aviso se o link realmente parecer incorreto ou indisponível.',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Avisar criador',
                    onPress: async () => {
                        setLinkIssueLoading(true);
                        try {
                            const reportLinkIssue = httpsCallable<{ eventId: string }, { sent: boolean; alreadyReported: boolean }>(functions, 'reportEventLinkIssue');
                            const result = await reportLinkIssue({ eventId });
                            Alert.alert(
                                result.data.alreadyReported ? 'Aviso já enviado' : 'Criador avisado',
                                result.data.alreadyReported
                                    ? 'Você já avisou sobre este mesmo link. Evitamos enviar notificações repetidas.'
                                    : 'O criador recebeu um aviso para conferir o link.'
                            );
                        } catch {
                            console.error('[Event] link_issue_report_failed');
                            Alert.alert('Não foi possível avisar', 'Confira sua conexão e tente novamente.');
                        } finally {
                            setLinkIssueLoading(false);
                        }
                    },
                },
            ]
        );
    };

    const handleRSVP = async () => {
        const currentUser = auth.currentUser;
        if (!currentUser || !meeting || !eventId) {
            Alert.alert('Erro', 'Faça login para confirmar presença.');
            return;
        }
        Alert.alert(
            'Dica de Segurança e Responsabilidade',
            'Recomendamos que você sempre se comunique com os organizadores e verifique os detalhes do evento para garantir sua segurança e veracidade. Lembre-se que o Reunion Hub é apenas um facilitador tecnológico. No mais, divirta-se e faça ótimas conexões!',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Confirmar Presença',
                    onPress: async () => {
                        setRsvpLoading(true);
                        try {
                            await httpsCallable(functions, 'rsvpToEvent')({ eventId });
                            scheduleEventReminder({ id: eventId, title: meeting.title, date: meeting.date, time: meeting.time }, currentUser.uid)
                                .catch(() => console.warn('[Event] local_reminder_schedule_failed'));

                            Alert.alert('Sucesso', 'Presença confirmada! Lembre-se das dicas de segurança e não esqueça de fazer check-in no dia do evento.');
                        } catch (error) {
                            console.error('[Event] rsvp_failed');
                            Alert.alert('Não foi possível confirmar', 'As confirmações encerram no início do evento. Confira também sua conexão e tente novamente.');
                        } finally {
                            setRsvpLoading(false);
                        }
                    }
                }
            ]
        );
    };

    const handleCancelAttendance = () => {
        const currentUser = auth.currentUser;
        if (!currentUser || !meeting || !eventId) return;
        Alert.alert(
            'Cancelar presença',
            `Deseja cancelar sua presença em "${meeting.title}"? O organizador será avisado.`,
            [
                { text: 'Voltar', style: 'cancel' },
                {
                    text: 'Cancelar presença',
                    style: 'destructive',
                    onPress: async () => {
                        setRsvpLoading(true);
                        try {
                            const leaveEvent = httpsCallable<{ eventId: string }, { ok: boolean }>(functions, 'leaveEvent');
                            await leaveEvent({ eventId });
                            cancelEventReminder(eventId, currentUser.uid)
                                .catch(() => console.warn('[Event] local_reminder_cancel_failed'));
                            Alert.alert('Presença cancelada', 'Você saiu do evento e o organizador foi avisado.');
                        } catch {
                            console.error('[Event] attendance_cancellation_failed');
                            Alert.alert('Não foi possível cancelar', 'Confira sua conexão e tente novamente.');
                        } finally {
                            setRsvpLoading(false);
                        }
                    },
                },
            ]
        );
    };

    const handleCheckIn = async () => {
        if (!auth.currentUser || !meeting || !eventId) {
            Alert.alert('Erro', 'Faça login para fazer check-in.');
            return;
        }

        if (!isEventInProgress(meeting, eventClock)) {
            Alert.alert(
                'Check-in indisponível',
                'O check-in só pode ser solicitado entre o horário de início e o término do evento.'
            );
            return;
        }

        setCheckInLoading(true);
        try {
            const requestCheckIn = httpsCallable<{ eventId: string }, { requested: boolean; alreadyConfirmed: boolean }>(functions, 'checkInToEvent');
            const result = await requestCheckIn({ eventId });
            Alert.alert(
                result.data.alreadyConfirmed ? 'Check-in já confirmado' : 'Solicitação enviada',
                result.data.alreadyConfirmed
                    ? 'Sua presença já foi confirmada neste evento.'
                    : 'Aguarde a confirmação do organizador ou de outro participante. Os +10 pontos serão adicionados após a confirmação.'
            );

        } catch (error) {
            console.error('Check-in error:', error);
            Alert.alert('Erro', 'Falha ao fazer check-in. Tente novamente.');
        } finally {
            setCheckInLoading(false);
        }
    };

    const handleConfirmCheckIn = async (request: CheckInRequest) => {
        if (!meeting || !eventId) return;
        setConfirmingCheckInUserId(request.userId);
        try {
            const confirmCheckIn = httpsCallable<{ eventId: string; targetUserId: string }, { confirmed: boolean }>(functions, 'confirmEventCheckIn');
            const result = await confirmCheckIn({ eventId, targetUserId: request.userId });
            Alert.alert(
                result.data.confirmed ? 'Presença confirmada' : 'Check-in já confirmado',
                result.data.confirmed ? `${request.displayName} recebeu os pontos de participação.` : 'Esta solicitação já foi processada.'
            );
        } catch (error) {
            console.error('[Event] checkin_confirmation_failed');
            Alert.alert('Não foi possível confirmar', 'Verifique se o evento ainda está em andamento e tente novamente.');
        } finally {
            setConfirmingCheckInUserId(null);
        }
    };

    const handleEndEvent = async () => {
        Alert.alert(
            'Encerrar Evento',
            'Deseja encerrar definitivamente este evento? Se houve check-in, quem faltou perde 20 pontos. Se ninguém fez check-in, cada inscrito perde somente 1 ponto.',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Encerrar',
                    style: 'destructive',
                    onPress: async () => {
                        if (!eventId) return;
                        setLoading(true);
                        try {
                            const completeEvent = httpsCallable<{ eventId: string }, { noShows: number; becameFounder: boolean; alreadyCompleted: boolean; noCheckIns: boolean }>(functions, 'completeEvent');
                            const result = await completeEvent({ eventId });
                            if (result.data.alreadyCompleted) {
                                Alert.alert('Evento já encerrado', 'Este evento já havia sido finalizado.');
                            } else if (result.data.noCheckIns) {
                                Alert.alert('Evento encerrado', 'Ninguém registrou check-in. Como ninguém foi prejudicado, cada inscrito perdeu somente 1 ponto.');
                            } else if (result.data.becameFounder) {
                                Alert.alert('🌟 Você é um Fundador!', 'Parabéns! Você realizou o primeiro evento neste local e agora tem o título de Fundador Oficial deste espaço!');
                            } else {
                                Alert.alert('Concluído', `Evento encerrado! ${result.data.noShows} faltoso(s) foram penalizados.`);
                            }
                        } catch (error) {
                            Alert.alert('Erro', 'Falha ao encerrar evento.');
                        } finally {
                            setLoading(false);
                        }
                    }
                }
            ]
        );
    };

    const handleCancelEvent = async () => {
        if (!meeting || !eventId) return;
        Alert.alert(
            'Cancelar Evento',
            'Os participantes serão avisados. A penalidade de -15 pontos só será aplicada se outra pessoa já tiver confirmado presença. Deseja realmente cancelar?',
            [
                { text: 'Voltar', style: 'cancel' },
                {
                    text: 'Sim, Cancelar',
                    style: 'destructive',
                    onPress: async () => {
                        setLoading(true);
                        try {
                            const cancelEvent = httpsCallable<{ eventId: string }, { penalized: boolean }>(functions, 'cancelEvent');
                            const result = await cancelEvent({ eventId });
                            const uid = auth.currentUser?.uid;
                            if (uid) cancelEventReminder(eventId, uid).catch(() => console.warn('[Event] local_reminder_cancel_failed'));
                            
                            Alert.alert('Cancelado', result.data.penalized
                                ? 'O evento foi cancelado, os participantes foram avisados e sua reputação foi atualizada.'
                                : 'O evento foi cancelado. Como não havia outros participantes, sua reputação não foi alterada.');
                        } catch (e) {
                            Alert.alert('Erro', 'Falha ao cancelar evento.');
                        } finally {
                            setLoading(false);
                        }
                    }
                }
            ]
        );
    };

    const handleReportEvent = () => {
        setShowReportReasonModal(true);
    };

    const handleFavoriteCompletedEvent = async () => {
        if (!eventId) return;
        setFavoriteLoading(true);
        try {
            const toggleFavorite = httpsCallable<{ eventId: string }, { favorited: boolean }>(functions, 'toggleEventFavorite');
            const result = await toggleFavorite({ eventId });
            setIsFavorited(result.data.favorited);
            Alert.alert(result.data.favorited ? 'Adicionado aos favoritos' : 'Removido dos favoritos', result.data.favorited
                ? 'Este evento ficará disponível na sua aba Favoritos, mesmo quando o histórico comum for limpo.'
                : 'O evento foi removido da sua aba Favoritos.');
        } catch {
            Alert.alert('Não foi possível favoritar', 'Somente eventos concluídos com seu check-in confirmado podem ser favoritos.');
        } finally {
            setFavoriteLoading(false);
        }
    };

    const submitEventReport = async (reason: string) => {
        if (!auth.currentUser || !eventId) return;
        setShowReportReasonModal(false);
        try {
            const result = await submitReport({ type: 'event', targetId: eventId, reason });
            Alert.alert(result.alreadyReported ? 'Denúncia já registrada' : 'Denúncia recebida', result.alreadyReported
                ? 'Você já denunciou este evento. A equipe de moderação poderá analisá-lo.'
                : 'Nossa equipe analisará este evento em breve. Obrigado.');
        } catch (error) {
            console.error('[Event] Erro ao enviar denúncia:', error);
            Alert.alert('Erro', 'Não foi possível enviar a denúncia.');
        }
    };

    if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;
    if (error) return (
        <SafeAreaView style={styles.container} edges={['bottom']}>
            <ErrorState
                title="Não foi possível carregar o evento"
                message="O evento pode não existir mais ou sua conexão está indisponível."
                onRetry={() => setRetryKey((current) => current + 1)}
            />
        </SafeAreaView>
    );
    if (!meeting) return null;

    const currentUid = auth.currentUser?.uid;
    const isAttending = currentUid ? meeting.attendees?.includes(currentUid) : false;
    const hasCheckedIn = currentUid ? meeting.checkedIn?.includes(currentUid) : false;
    const pendingCheckIns = meeting.pendingCheckIns || [];
    const hasPendingCheckIn = currentUid ? pendingCheckIns.some((request) => request.userId === currentUid) : false;
    const confirmableCheckIns = currentUid && isAttending
        ? pendingCheckIns.filter((request) => request.userId !== currentUid)
        : [];
    const isToday = isEventToday(meeting, eventClock);
    const isInProgress = isEventInProgress(meeting, eventClock);
    const isRegistrationOpen = isEventRegistrationOpen(meeting, eventClock);
    const isCreator = currentUid ? meeting.createdBy === currentUid : false;
    const isCompleted = meeting.status === 'completed';

    return (
        <>
            <Stack.Screen options={{ title: 'Detalhes do Evento', headerBackTitle: 'Voltar' }} />
            <SafeAreaView style={styles.container} edges={['bottom']}>
            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.theme}>{meeting.theme}</Text>
                <Text style={styles.title}>{meeting.title}</Text>
                {isInProgress && (
                    <View style={styles.inProgressBanner}>
                        <FontAwesome name="play-circle" size={16} color="#047857" />
                        <Text style={styles.inProgressBannerText}>Evento em andamento</Text>
                    </View>
                )}

                {/* Criador do Evento */}
                {meeting.createdBy && (
                    <TouchableOpacity 
                        style={styles.creatorCard} 
                        onPress={() => router.push(`/public-profile/${meeting.createdBy}` as never)}
                    >
                        <View style={styles.creatorAvatar}>
                            <Text style={{color: '#fff', fontWeight: 'bold'}}>{creatorName.charAt(0).toUpperCase()}</Text>
                        </View>
                        <View>
                            <Text style={styles.creatorLabel}>Organizado por</Text>
                            <Text style={styles.creatorName}>{creatorName}</Text>
                        </View>
                        <FontAwesome name="chevron-right" size={16} color="#9ca3af" style={{ marginLeft: 'auto' }} />
                    </TouchableOpacity>
                )}

            <View style={styles.infoRow}>
                <FontAwesome name="map-marker" size={18} color="#6b7280" />
                <Text style={styles.infoText}>{meeting.locationName || 'Local a definir'}</Text>
            </View>

            <View style={styles.infoRow}>
                <FontAwesome name="calendar" size={18} color="#6b7280" />
                <Text style={styles.infoText}>{formatDateDisplay(meeting.date)}</Text>
                {isToday && (
                    <View style={styles.todayBadge}>
                        <Text style={styles.todayBadgeText}>HOJE</Text>
                    </View>
                )}
            </View>

            {meeting.time && (
                <View style={styles.infoRow}>
                    <FontAwesome name="clock-o" size={18} color="#6b7280" />
                    <Text style={styles.infoText}>{formatEventTimeRange(meeting)}</Text>
                </View>
            )}

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Sobre</Text>
                <Text style={styles.description}>{meeting.description || 'Sem descrição.'}</Text>
            </View>

            <TouchableOpacity
                style={styles.participantsSection}
                onPress={() => router.push({
                    pathname: '/event/attendees',
                    params: { meetingId: eventId || '', meetingTitle: meeting.title }
                } as never)}
                activeOpacity={0.7}
            >
                <View style={styles.participantsHeader}>
                    <Text style={styles.sectionTitle}>Participantes</Text>
                    <View style={styles.participantsRight}>
                        <View style={styles.participantsBadge}>
                            <Text style={styles.participantsBadgeText}>
                                {meeting.attendees?.length || 0}
                            </Text>
                        </View>
                        <FontAwesome name="chevron-right" size={16} color="#6b7280" />
                    </View>
                </View>
                <Text style={styles.participantsHint}>
                    Toque para ver todos os participantes
                </Text>
            </TouchableOpacity>

            {isAttending && (!meeting.status || meeting.status === 'active') && (
                <TouchableOpacity style={styles.inviteSection} onPress={() => setShowInviteModal(true)} activeOpacity={0.75}>
                    <View style={styles.inviteIcon}><FontAwesome name="user-plus" size={17} color="#4338CA" /></View>
                    <View style={styles.inviteContent}>
                        <Text style={styles.inviteTitle}>Convidar pessoas</Text>
                        <Text style={styles.inviteHint}>Chame alguém por nick ou de eventos em comum.</Text>
                    </View>
                    <FontAwesome name="chevron-right" size={16} color="#6B7280" />
                </TouchableOpacity>
            )}

            {/* Check-in Stats - só mostra se houver check-ins */}
            {meeting.checkedIn && meeting.checkedIn.length > 0 && (
                <View style={styles.checkInStats}>
                    <FontAwesome name="check-circle" size={16} color="#10b981" />
                    <Text style={styles.checkInStatsText}>
                        {meeting.checkedIn.length} pessoa(s) fizeram check-in
                    </Text>
                </View>
            )}

            {confirmableCheckIns.length > 0 && (
                <View style={styles.pendingCheckInsSection}>
                    <Text style={styles.pendingCheckInsTitle}>Confirmações pendentes</Text>
                    <Text style={styles.pendingCheckInsHint}>Confirme somente a presença de quem você encontrou no evento.</Text>
                    {confirmableCheckIns.map((request) => (
                        <View key={request.userId} style={styles.pendingCheckInRow}>
                            <Text style={styles.pendingCheckInName} numberOfLines={1}>{request.displayName}</Text>
                            <TouchableOpacity
                                style={styles.confirmCheckInButton}
                                onPress={() => handleConfirmCheckIn(request)}
                                disabled={confirmingCheckInUserId === request.userId}
                            >
                                {confirmingCheckInUserId === request.userId
                                    ? <ActivityIndicator size="small" color="#fff" />
                                    : <Text style={styles.confirmCheckInButtonText}>Confirmar</Text>}
                            </TouchableOpacity>
                        </View>
                    ))}
                </View>
            )}

            <View style={styles.footer}>
                {/* Lógica de Exibição do Rodapé */}
                {meeting.status === 'cancelled' ? (
                    <View style={[styles.waitingCheckIn, { backgroundColor: '#fef2f2' }]}>
                        <FontAwesome name="ban" size={24} color="#ef4444" />
                        <Text style={[styles.waitingText, { color: '#ef4444' }]}>Evento Cancelado</Text>
                        <Text style={styles.waitingSubtext}>Este evento foi cancelado pelo organizador e não ocorrerá mais.</Text>
                    </View>
                ) : isCompleted ? (
                    <>
                        <View style={styles.waitingCheckIn}>
                            <FontAwesome name="flag-checkered" size={24} color="#6b7280" />
                            <Text style={styles.waitingText}>Evento Encerrado</Text>
                            <Text style={styles.waitingSubtext}>Este evento já foi finalizado pelo criador.</Text>
                        </View>
                        {hasCheckedIn && (
                            <TouchableOpacity style={styles.favoriteButton} onPress={handleFavoriteCompletedEvent} disabled={favoriteLoading}>
                                {favoriteLoading ? <ActivityIndicator size="small" color="#BE123C" /> : <FontAwesome name={isFavorited ? 'heart' : 'heart-o'} size={16} color="#BE123C" />}
                                <Text style={styles.favoriteButtonText}>{isFavorited ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}</Text>
                            </TouchableOpacity>
                        )}
                    </>
                ) : (
                    <>
                        {/* Botão de RSVP / Presença (escondido para o criador) */}
                        {!isAttending && !isCreator && isRegistrationOpen ? (
                            <StyledButton
                                title="Confirmar Presença"
                                onPress={handleRSVP}
                                isLoading={rsvpLoading}
                            />
                        ) : !isAttending && !isCreator ? (
                            <View style={styles.waitingCheckIn}>
                                <FontAwesome name="lock" size={20} color="#6b7280" />
                                <Text style={styles.waitingText}>Confirmações encerradas</Text>
                                <Text style={styles.waitingSubtext}>Não é mais possível entrar neste evento após o horário de início.</Text>
                            </View>
                        ) : hasCheckedIn ? (
                            <View style={styles.checkedInContainer}>
                                <FontAwesome name="check-circle" size={24} color="#10b981" />
                                <Text style={styles.checkedInText}>Check-in realizado! ✅</Text>
                                <Text style={styles.checkedInSubtext}>Sua presença foi confirmada e os pontos foram adicionados.</Text>
                            </View>
                        ) : hasPendingCheckIn ? (
                            <View style={styles.waitingCheckIn}>
                                <FontAwesome name="hourglass-half" size={20} color="#D97706" />
                                <Text style={styles.waitingText}>Aguardando confirmação</Text>
                                <Text style={styles.waitingSubtext}>O organizador ou outro participante precisa confirmar sua presença.</Text>
                            </View>
                        ) : isInProgress ? (
                            <StyledButton
                                title="📍 Solicitar confirmação de check-in"
                                onPress={handleCheckIn}
                                isLoading={checkInLoading}
                                colors={['#10b981', '#34d399']}
                            />
                        ) : (
                            <View style={styles.waitingCheckIn}>
                                <FontAwesome name="clock-o" size={20} color="#6b7280" />
                                <Text style={styles.waitingText}>Presença confirmada</Text>
                                <Text style={styles.waitingSubtext}>
                                    O check-in poderá ser solicitado entre o início e o término do evento ({formatDateDisplay(meeting.date)})
                                </Text>
                            </View>
                        )}

                        {isAttending && !isCreator && !hasCheckedIn && isRegistrationOpen && (
                            <TouchableOpacity
                                style={styles.cancelAttendanceButton}
                                onPress={handleCancelAttendance}
                                disabled={rsvpLoading}
                            >
                                {rsvpLoading
                                    ? <ActivityIndicator size="small" color="#B91C1C" />
                                    : <FontAwesome name="user-times" size={16} color="#B91C1C" />}
                                <Text style={styles.cancelAttendanceButtonText}>Cancelar presença</Text>
                            </TouchableOpacity>
                        )}

                        <View style={{ height: 16 }} />

                        {meeting.type === 'online' && meeting.meetingLink ? (
                            <>
                                <StyledButton
                                    title="Acessar Reunião Online"
                                    onPress={() => {
                                        if (meeting.meetingLink) {
                                            Linking.openURL(meeting.meetingLink).catch(() =>
                                                Alert.alert('Erro', 'Não foi possível abrir o link: ' + meeting.meetingLink)
                                            );
                                        }
                                    }}
                                    colors={['#3b82f6', '#60a5fa']}
                                />
                                {!isCreator && currentUid ? (
                                    <TouchableOpacity
                                        style={styles.linkIssueButton}
                                        onPress={handleReportLinkIssue}
                                        disabled={linkIssueLoading}
                                    >
                                        {linkIssueLoading
                                            ? <ActivityIndicator size="small" color="#B45309" />
                                            : <FontAwesome name="exclamation-triangle" size={15} color="#B45309" />}
                                        <Text style={styles.linkIssueButtonText}>Avisar que o link pode estar com problema</Text>
                                    </TouchableOpacity>
                                ) : null}
                            </>
                        ) : null}

                        {isCreator && (
                            <View style={{ marginTop: 24 }}>
                                <StyledButton
                                    title="Encerrar Evento & Calcular Presenças"
                                    onPress={handleEndEvent}
                                    colors={['#ef4444', '#f87171']}
                                />
                                <View style={{ height: 12 }} />
                                <TouchableOpacity
                                    style={{ padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#ef4444', borderRadius: 12 }}
                                    onPress={handleCancelEvent}
                                >
                                    <Text style={{ color: '#ef4444', fontWeight: 'bold' }}>Cancelar Evento</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                        {!isCreator && currentUid && (
                            <TouchableOpacity style={styles.reportButton} onPress={handleReportEvent}>
                                <FontAwesome name="flag" size={16} color="#ef4444" />
                                <Text style={styles.reportText}>Denunciar Evento</Text>
                            </TouchableOpacity>
                        )}
                    </>
                )}
            </View>
            </ScrollView>
            </SafeAreaView>
            <ReportReasonModal
                visible={showReportReasonModal}
                targetType="event"
                onClose={() => setShowReportReasonModal(false)}
                onSelectReason={submitEventReport}
            />
            {meeting && <EventInviteModal visible={showInviteModal} eventId={meeting.id} onClose={() => setShowInviteModal(false)} />}
        </>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    content: { padding: 24, paddingBottom: 40 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    theme: { color: '#6366f1', fontWeight: 'bold', fontSize: 14, textTransform: 'uppercase', marginBottom: 4 },
    title: { fontSize: 28, fontWeight: 'bold', color: '#111', marginBottom: 16 },
    inProgressBanner: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, backgroundColor: '#D1FAE5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16 },
    inProgressBannerText: { color: '#047857', fontSize: 13, fontWeight: '800' },
    infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    infoText: { marginLeft: 8, color: '#374151', fontSize: 16 },
    section: { marginTop: 24 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8, color: '#1f2937' },
    description: { fontSize: 16, color: '#4b5563', lineHeight: 24 },
    footer: { marginTop: 40 },
    participantsSection: {
        marginTop: 24,
        backgroundColor: '#f9fafb',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    participantsHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    participantsRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    participantsBadge: {
        backgroundColor: '#6366f1',
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 12,
        marginRight: 8,
    },
    participantsBadgeText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 14,
    },
    participantsHint: {
        fontSize: 13,
        color: '#9ca3af',
        marginTop: 8,
    },
    inviteSection: { flexDirection: 'row', alignItems: 'center', marginTop: 12, padding: 16, backgroundColor: '#F5F3FF', borderRadius: 16, borderWidth: 1, borderColor: '#DDD6FE' },
    inviteIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EDE9FE', marginRight: 12 },
    inviteContent: { flex: 1 },
    inviteTitle: { color: '#312E81', fontWeight: '800', fontSize: 15 },
    inviteHint: { color: '#6B7280', fontSize: 12, marginTop: 3 },
    creatorCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f9fafb',
        padding: 12,
        borderRadius: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#e5e7eb'
    },
    creatorAvatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#6366f1',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    creatorLabel: { fontSize: 12, color: '#6b7280' },
    creatorName: { fontSize: 16, fontWeight: 'bold', color: '#1f2937' },
    reportButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 32,
        padding: 16,
    },
    reportText: {
        color: '#ef4444',
        fontWeight: 'bold',
        marginLeft: 8,
    },
    todayBadge: {
        backgroundColor: '#10b981',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
        marginLeft: 8,
    },
    todayBadgeText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: 'bold',
    },
    checkedInContainer: {
        alignItems: 'center',
        backgroundColor: '#ecfdf5',
        padding: 20,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#a7f3d0',
    },
    checkedInText: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#047857',
        marginTop: 8,
    },
    checkedInSubtext: {
        fontSize: 13,
        color: '#6b7280',
        marginTop: 4,
    },
    waitingCheckIn: {
        alignItems: 'center',
        backgroundColor: '#f9fafb',
        padding: 20,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    waitingText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#1f2937',
        marginTop: 8,
    },
    waitingSubtext: {
        fontSize: 13,
        color: '#6b7280',
        marginTop: 4,
        textAlign: 'center',
    },
    checkInStats: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        paddingHorizontal: 8,
    },
    checkInStatsText: {
        fontSize: 13,
        color: '#10b981',
        marginLeft: 6,
        fontWeight: '500',
    },
    pendingCheckInsSection: { marginTop: 18, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#FDE68A', backgroundColor: '#FFFBEB' },
    pendingCheckInsTitle: { color: '#92400E', fontSize: 15, fontWeight: '800' },
    pendingCheckInsHint: { color: '#A16207', fontSize: 12, lineHeight: 17, marginTop: 4, marginBottom: 10 },
    pendingCheckInRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8 },
    pendingCheckInName: { flex: 1, color: '#374151', fontSize: 14, fontWeight: '600' },
    confirmCheckInButton: { minWidth: 88, minHeight: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, backgroundColor: '#16A34A' },
    confirmCheckInButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
    cancelAttendanceButton: { minHeight: 46, marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
    cancelAttendanceButtonText: { color: '#B91C1C', fontSize: 14, fontWeight: '800' },
    linkIssueButton: { minHeight: 44, marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: '#FDE68A', backgroundColor: '#FFFBEB', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 12 },
    linkIssueButtonText: { color: '#92400E', fontSize: 13, fontWeight: '700', textAlign: 'center' },
    favoriteButton: { minHeight: 48, marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: '#FECDD3', backgroundColor: '#FFF1F2', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
    favoriteButtonText: { color: '#BE123C', fontSize: 14, fontWeight: '800' },
});

