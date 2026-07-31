import { useLocalSearchParams, router, Stack } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator, TouchableOpacity, Linking } from 'react-native';
import { useEffect, useState, useRef } from 'react';
import { doc, getDoc, updateDoc, arrayUnion, increment, addDoc, collection, writeBatch, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, auth, functions } from '../../src/services/firebaseConfig';
import { Meeting } from '../../src/types';
import { StyledButton } from '@/src/components/StyledButton';
import { ErrorState } from '@/src/components/ErrorState';
import { FontAwesome } from '@expo/vector-icons';
import { normalizeDate, getTodayStr } from '../../src/utils/dateUtils';
import { scheduleEventReminder, cancelEventReminder } from '../../src/utils/Notifications';
import { ReportReasonModal } from '@/src/components/ReportReasonModal';

// Helper para verificar se hoje é o dia do evento
const isEventDay = (eventDate: string | undefined): boolean => {
    const normalized = normalizeDate(eventDate);
    if (!normalized) return false;
    return normalized === getTodayStr();
};

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
    const { id } = useLocalSearchParams();
    const [meeting, setMeeting] = useState<Meeting | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [rsvpLoading, setRsvpLoading] = useState(false);
    const [checkInLoading, setCheckInLoading] = useState(false);
    const [showReportReasonModal, setShowReportReasonModal] = useState(false);
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        fetchMeeting();
        return () => {
            isMounted.current = false;
        };
    }, [id]);

    const fetchMeeting = async () => {
        if (!isMounted.current) return;
        setLoading(true);
        setError(false);
        try {
            const docRef = doc(db, 'meetings', id as string);
            const docSnap = await getDoc(docRef);
            
            if (!isMounted.current) return;

            if (docSnap.exists()) {
                setMeeting({ id: docSnap.id, ...docSnap.data() } as Meeting);
            } else {
                setError(true);
            }
        } catch (error) {
            console.error(error);
            if (isMounted.current) {
                setError(true);
            }
        } finally {
            if (isMounted.current) {
                setLoading(false);
            }
        }
    };

    const handleRSVP = async () => {
        if (!auth.currentUser || !meeting) {
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
                            // VERIFICAR REPUTAÇÃO DO USUÁRIO (Prevenção de Tóxicos)
                            const userRef = doc(db, 'users', auth.currentUser!.uid);
                            const userSnap = await getDoc(userRef);
                            if (userSnap.exists()) {
                                const rep = userSnap.data().reputation || 0;
                                if (rep <= -50) {
                                    Alert.alert('Bloqueado', 'Você tem muitas faltas (No-Show). Sua reputação está muito baixa para confirmar presença em novos eventos.');
                                    setRsvpLoading(false);
                                    return;
                                }
                            }

                            await httpsCallable(functions, 'rsvpToEvent')({ eventId: id });
                            await scheduleEventReminder({ id: id as string, title: meeting.title, date: meeting.date, time: meeting.time });

                            Alert.alert('Sucesso', 'Presença confirmada! Lembre-se das dicas de segurança e não esqueça de fazer check-in no dia do evento.');
                            fetchMeeting(); // Refresh UI
                        } catch (error) {
                            console.error(error);
                            Alert.alert('Erro', 'Falha ao confirmar presença.');
                        } finally {
                            setRsvpLoading(false);
                        }
                    }
                }
            ]
        );
    };

    const handleCheckIn = async () => {
        if (!auth.currentUser || !meeting) {
            Alert.alert('Erro', 'Faça login para fazer check-in.');
            return;
        }

        // Verificar se é o dia do evento
        if (!isEventDay(meeting.date)) {
            Alert.alert(
                'Check-in indisponível',
                'O check-in só pode ser feito no dia do evento.'
            );
            return;
        }

        setCheckInLoading(true);
        try {
            await httpsCallable(functions, 'checkInToEvent')({ eventId: id });

            Alert.alert(
                '✅ Check-in Confirmado!',
                'Parabéns! Você ganhou +10 pontos de reputação por participar deste evento.',
                [{ text: 'Legal!', style: 'default' }]
            );

            fetchMeeting(); // Refresh UI
        } catch (error) {
            console.error('Check-in error:', error);
            Alert.alert('Erro', 'Falha ao fazer check-in. Tente novamente.');
        } finally {
            setCheckInLoading(false);
        }
    };

    const handleEndEvent = async () => {
        Alert.alert(
            'Encerrar Evento',
            'Deseja encerrar definitivamente este evento? Isso punirá com -20 de reputação todos que confirmaram presença e não fizeram check-in (No-Show).',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Encerrar',
                    style: 'destructive',
                    onPress: async () => {
                        setLoading(true);
                        try {
                            if (!meeting) return;
                            const attendees = meeting.attendees || [];
                            const checkedIn = meeting.checkedIn || [];
                            
                            // Encontrar Faltosos (No-Show) excluindo o organizador
                            const noShows = attendees.filter((uid: string) => !checkedIn.includes(uid) && uid !== meeting.createdBy);
                            
                            // Punir Faltosos (-20 rep) em Batch
                            if (noShows.length > 0) {
                                const batch = writeBatch(db);
                                noShows.forEach((uid: string) => {
                                    const userRef = doc(db, 'users', uid);
                                    batch.update(userRef, { reputation: increment(-20) });
                                });
                                await batch.commit().catch(e => console.log('Erro ao punir em batch:', e));
                            }

                            // Atualizar evento para status completed
                            const meetingRef = doc(db, 'meetings', id as string);
                            await updateDoc(meetingRef, {
                                status: 'completed'
                            });

                            // --- LÓGICA DE PIONEIRISMO (FUNDADOR) ---
                            if (meeting.placeId) {
                                const placeRef = doc(db, 'places', meeting.placeId);
                                const placeSnap = await getDoc(placeRef);
                                if (placeSnap.exists() && !placeSnap.data().founderId) {
                                    // O primeiro a concluir um evento vira o fundador
                                    await updateDoc(placeRef, {
                                        founderId: auth.currentUser?.uid,
                                        founderName: auth.currentUser?.displayName || 'Pioneiro'
                                    });

                                    // Atualiza o contador de fundações do usuário no db
                                    const userRefCreator = doc(db, 'users', auth.currentUser?.uid || '');
                                    await updateDoc(userRefCreator, {
                                        foundedPlacesCount: increment(1)
                                    });
                                    Alert.alert('🌟 Você é um Fundador!', 'Parabéns! Você realizou o primeiro evento neste local e agora tem o título de Fundador Oficial deste espaço!');
                                } else {
                                    Alert.alert('Concluído', `Evento encerrado! ${noShows.length} faltosos foram penalizados.`);
                                }
                            } else {
                                Alert.alert('Concluído', `Evento encerrado! ${noShows.length} faltosos foram penalizados.`);
                            }
                            // ----------------------------------------

                            fetchMeeting();
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
        if (!meeting) return;
        Alert.alert(
            'Cancelar Evento',
            'Atenção: Cancelar este evento descontará -15 pontos da sua reputação por frustrar os participantes. Deseja realmente cancelar?',
            [
                { text: 'Voltar', style: 'cancel' },
                {
                    text: 'Sim, Cancelar',
                    style: 'destructive',
                    onPress: async () => {
                        setLoading(true);
                        try {
                            await httpsCallable(functions, 'cancelEvent')({ eventId: id });
                            await cancelEventReminder(id as string);
                            
                            Alert.alert('Cancelado', 'O evento foi cancelado e sua reputação foi atualizada.');
                            fetchMeeting();
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

    const submitEventReport = async (reason: string) => {
        const reporterId = auth.currentUser?.uid;
        if (!reporterId || !id) return;
        setShowReportReasonModal(false);
        try {
            await addDoc(collection(db, 'reports'), {
                type: 'event',
                targetId: id,
                reportedBy: reporterId,
                reason,
                createdAt: serverTimestamp()
            });
            Alert.alert('Denúncia recebida', 'Nossa equipe analisará este evento em breve. Obrigado.');
        } catch (error) {
            console.error('[Event] Erro ao enviar denúncia:', error);
            Alert.alert('Erro', 'Não foi possível enviar a denúncia.');
        }
    };

    const handleReportOnlineAccessIssue = () => {
        Alert.alert(
            'Informar problema de acesso',
            'Alguns links só liberam perto do horário do evento. Deseja avisar o criador mesmo assim?',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Avisar criador',
                    onPress: async () => {
                        try {
                            const reporterId = auth.currentUser?.uid;
                            if (!reporterId || !meeting?.createdBy) return;
                            await addDoc(collection(db, 'notifications'), {
                                userId: meeting.createdBy,
                                type: 'online_access_issue',
                                title: 'Possível problema no link do evento',
                                body: `Um participante informou dificuldade para acessar "${meeting.title}". Alguns links só ficam disponíveis perto do horário; confira quando possível.`,
                                meetingId: id,
                                fromUserId: reporterId,
                                createdAt: serverTimestamp(),
                                read: false
                            });
                            Alert.alert('Aviso enviado', 'O criador foi avisado para conferir o acesso ao evento.');
                        } catch (error) {
                            console.error('[Event] Erro ao avisar criador sobre link:', error);
                            Alert.alert('Erro', 'Não foi possível enviar o aviso agora.');
                        }
                    }
                }
            ]
        );
    };

    if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;
    if (!meeting) return null;

    const currentUid = auth.currentUser?.uid;
    const isAttending = currentUid ? meeting.attendees?.includes(currentUid) : false;
    const hasCheckedIn = currentUid ? meeting.checkedIn?.includes(currentUid) : false;
    const isToday = isEventDay(meeting.date);
    const isCreator = currentUid ? meeting.createdBy === currentUid : false;
    const isCompleted = meeting.status === 'completed';

    return (
        <>
            <Stack.Screen options={{ title: 'Detalhes do Evento', headerBackTitle: 'Voltar' }} />
            <ScrollView style={styles.container} contentContainerStyle={styles.content}>
                <Text style={styles.theme}>{meeting.theme}</Text>
                <Text style={styles.title}>{meeting.title}</Text>

                {/* Criador do Evento */}
                {meeting.createdBy && (
                    <TouchableOpacity 
                        style={styles.creatorCard} 
                        onPress={() => router.push(`/public-profile/${meeting.createdBy}` as never)}
                    >
                        <View style={styles.creatorAvatar}>
                            <Text style={{color: '#fff', fontWeight: 'bold'}}>{(meeting as any).creatorName?.charAt(0) || 'U'}</Text>
                        </View>
                        <View>
                            <Text style={styles.creatorLabel}>Organizado por</Text>
                            <Text style={styles.creatorName}>{(meeting as any).creatorName || 'Usuário'}</Text>
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
                    <Text style={styles.infoText}>{meeting.time}</Text>
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
                    params: { meetingId: id as string, meetingTitle: meeting.title }
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

            {/* Check-in Stats - só mostra se houver check-ins */}
            {meeting.checkedIn && meeting.checkedIn.length > 0 && (
                <View style={styles.checkInStats}>
                    <FontAwesome name="check-circle" size={16} color="#10b981" />
                    <Text style={styles.checkInStatsText}>
                        {meeting.checkedIn.length} pessoa(s) fizeram check-in
                    </Text>
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
                    <View style={styles.waitingCheckIn}>
                        <FontAwesome name="flag-checkered" size={24} color="#6b7280" />
                        <Text style={styles.waitingText}>Evento Encerrado</Text>
                        <Text style={styles.waitingSubtext}>Este evento já foi finalizado pelo criador.</Text>
                    </View>
                ) : (
                    <>
                        {/* Botão de RSVP / Presença (escondido para o criador) */}
                        {!isAttending && !isCreator ? (
                            <StyledButton
                                title="Confirmar Presença"
                                onPress={handleRSVP}
                                isLoading={rsvpLoading}
                            />
                        ) : hasCheckedIn ? (
                            <View style={styles.checkedInContainer}>
                                <FontAwesome name="check-circle" size={24} color="#10b981" />
                                <Text style={styles.checkedInText}>Check-in realizado! ✅</Text>
                                <Text style={styles.checkedInSubtext}>Você confirmou sua presença neste evento</Text>
                            </View>
                        ) : isToday ? (
                            <StyledButton
                                title="📍 Fazer Check-in"
                                onPress={handleCheckIn}
                                isLoading={checkInLoading}
                                colors={['#10b981', '#34d399']}
                            />
                        ) : (
                            <View style={styles.waitingCheckIn}>
                                <FontAwesome name="clock-o" size={20} color="#6b7280" />
                                <Text style={styles.waitingText}>Presença confirmada</Text>
                                <Text style={styles.waitingSubtext}>
                                    O check-in estará disponível no dia do evento ({formatDateDisplay(meeting.date)})
                                </Text>
                            </View>
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
                                {!isCreator && (
                                    <TouchableOpacity style={styles.reportButton} onPress={handleReportOnlineAccessIssue}>
                                        <FontAwesome name="life-ring" size={16} color="#2563eb" />
                                        <Text style={[styles.reportText, { color: '#2563eb' }]}>Informar problema de acesso</Text>
                                    </TouchableOpacity>
                                )}
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
            <ReportReasonModal
                visible={showReportReasonModal}
                targetType="event"
                onClose={() => setShowReportReasonModal(false)}
                onSelectReason={submitEventReport}
            />
        </>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    content: { padding: 24, paddingBottom: 40 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    theme: { color: '#6366f1', fontWeight: 'bold', fontSize: 14, textTransform: 'uppercase', marginBottom: 4 },
    title: { fontSize: 28, fontWeight: 'bold', color: '#111', marginBottom: 16 },
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
});

