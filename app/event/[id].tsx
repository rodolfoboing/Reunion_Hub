import { useLocalSearchParams, router } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator, TouchableOpacity, Linking } from 'react-native';
import { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc, arrayUnion, increment, addDoc, collection, writeBatch } from 'firebase/firestore';
import { db, auth } from '../../src/services/firebaseConfig';
import { Meeting } from '../../src/types';
import { StyledButton } from '@/src/components/StyledButton';
import { FontAwesome } from '@expo/vector-icons';

// Helper para verificar se hoje é o dia do evento
const isEventDay = (eventDate: string | undefined): boolean => {
    if (!eventDate) return false;

    try {
        // Normaliza a data do evento (YYYY-MM-DD ou YYYY/MM/DD)
        const normalized = eventDate.trim().replace(/\//g, '-');

        // Pega a data de hoje no formato YYYY-MM-DD
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        return normalized === todayStr;
    } catch (e) {
        console.warn('Error comparing dates:', e);
        return false;
    }
};

// Formata a data para exibição amigável
const formatDateDisplay = (dateString: string | undefined): string => {
    if (!dateString) return 'Data a definir';

    try {
        const normalized = dateString.trim().replace(/\//g, '-');
        const [year, month, day] = normalized.split('-');
        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const monthName = months[parseInt(month, 10) - 1] || month;
        return `${day} de ${monthName} de ${year}`;
    } catch (e) {
        return dateString;
    }
};

export default function MeetingDetailsScreen() {
    const { id } = useLocalSearchParams();
    const [meeting, setMeeting] = useState<Meeting | null>(null);
    const [loading, setLoading] = useState(true);
    const [rsvpLoading, setRsvpLoading] = useState(false);
    const [checkInLoading, setCheckInLoading] = useState(false);

    useEffect(() => {
        fetchMeeting();
    }, [id]);

    const fetchMeeting = async () => {
        try {
            const docRef = doc(db, 'meetings', id as string);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                setMeeting({ id: docSnap.id, ...docSnap.data() } as Meeting);
            } else {
                Alert.alert('Erro', 'Evento não encontrado.');
                router.back();
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleRSVP = async () => {
        if (!auth.currentUser || !meeting) {
            Alert.alert('Erro', 'Faça login para confirmar presença.');
            return;
        }
        setRsvpLoading(true);
        try {
            // VERIFICAR REPUTAÇÃO DO USUÁRIO (Prevenção de Tóxicos)
            const userRef = doc(db, 'users', auth.currentUser.uid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                const rep = userSnap.data().reputation || 0;
                if (rep <= -50) {
                    Alert.alert('Bloqueado', 'Você tem muitas faltas (No-Show). Sua reputação está muito baixa para confirmar presença em novos eventos.');
                    setRsvpLoading(false);
                    return;
                }
            }

            const docRef = doc(db, 'meetings', id as string);
            await updateDoc(docRef, {
                attendees: arrayUnion(auth.currentUser.uid)
            });

            // Notify Event Creator
            if (meeting.createdBy && meeting.createdBy !== auth.currentUser.uid) {
                try {
                    await addDoc(collection(db, 'notifications'), {
                        userId: meeting.createdBy,
                        type: 'new_attendee',
                        title: 'Novo Participante!',
                        body: `${auth.currentUser.displayName || 'Alguém'} confirmou presença no evento "${meeting.title}"`,
                        meetingId: id,
                        createdAt: new Date(),
                        read: false,
                        fromUserId: auth.currentUser.uid
                    });
                } catch (notifError) {
                    console.error('Error sending notification:', notifError);
                }
            }

            Alert.alert('Sucesso', 'Presença confirmada! Não esqueça de fazer check-in no dia do evento.');
            fetchMeeting(); // Refresh UI
        } catch (error) {
            console.error(error);
            Alert.alert('Erro', 'Falha ao confirmar presença.');
        } finally {
            setRsvpLoading(false);
        }
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
            const currentUid = auth.currentUser.uid;

            // 1. Registrar check-in no evento
            const meetingRef = doc(db, 'meetings', id as string);
            await updateDoc(meetingRef, {
                checkedIn: arrayUnion(currentUid)
            });

            // 2. Atualizar o perfil do usuário (reputação e contagem de eventos)
            const userRef = doc(db, 'users', currentUid);
            await updateDoc(userRef, {
                reputation: increment(10), // +10 pontos por check-in
                eventsAttended: increment(1), // +1 evento confirmado
            });

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
                            
                            // Encontrar Faltosos (No-Show)
                            const noShows = attendees.filter((uid: string) => !checkedIn.includes(uid));
                            
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

    if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;
    if (!meeting) return null;

    const currentUid = auth.currentUser?.uid;
    const isAttending = currentUid ? meeting.attendees?.includes(currentUid) : false;
    const hasCheckedIn = currentUid ? meeting.checkedIn?.includes(currentUid) : false;
    const isToday = isEventDay(meeting.date);
    const isCreator = currentUid ? meeting.createdBy === currentUid : false;
    const isCompleted = meeting.status === 'completed';

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <Text style={styles.theme}>{meeting.theme}</Text>
            <Text style={styles.title}>{meeting.title}</Text>

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
                {isCompleted ? (
                    <View style={styles.waitingCheckIn}>
                        <FontAwesome name="flag-checkered" size={24} color="#6b7280" />
                        <Text style={styles.waitingText}>Evento Encerrado</Text>
                        <Text style={styles.waitingSubtext}>Este evento já foi finalizado pelo criador.</Text>
                    </View>
                ) : (
                    <>
                        {/* Botão de RSVP / Presença */}
                        {!isAttending ? (
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
                        ) : null}

                        {isCreator && (
                            <View style={{ marginTop: 24 }}>
                                <StyledButton
                                    title="Encerrar Evento & Calcular Presenças"
                                    onPress={handleEndEvent}
                                    colors={['#ef4444', '#f87171']}
                                />
                                <Text style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
                                    Apenas você, como criador, pode ver este botão.
                                </Text>
                            </View>
                        )}
                    </>
                )}
            </View>
        </ScrollView>
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

