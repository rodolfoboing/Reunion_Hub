import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EventInviteCandidate } from '@/src/types';
import { getEventInviteCandidates, inviteUserToEvent } from '@/src/services/eventInvitationService';
import { NICK_MAX_LENGTH } from '@/src/constants/textLimits';
import { STRINGS } from '@/src/constants/strings';
import { isValidNickname, normalizeNickname } from '@/src/services/profileService';
import { getFirebaseErrorCode } from '@/src/utils/authError';

type EventInviteModalProps = {
    visible: boolean;
    eventId: string;
    onClose: () => void;
};

function inviteLog(event: string, context: Record<string, number | boolean | string> = {}) {
    if (__DEV__) console.info(`[EventInvite] ${event}`, context);
}

/**
 * Traduz o erro da callable `inviteUserToEvent` no motivo real. Antes toda falha
 * virava "a pessoa pode ter bloqueado contatos" — inclusive nick digitado errado.
 * As mensagens de `failed-precondition`, `resource-exhausted` e `permission-denied`
 * já vêm em pt-BR do servidor; a de bloqueio é neutra de propósito e é mantida assim.
 */
function getInviteErrorAlert(error: unknown, targetNick: string | null): { title: string; message: string } {
    const code = getFirebaseErrorCode(error)?.replace(/^functions\//, '');
    const serverMessage = error instanceof Error ? error.message : '';

    if (code === 'not-found') {
        if (serverMessage.startsWith('Evento')) return { title: 'Evento indisponível', message: STRINGS.EVENT_INVITE_EVENT_GONE };
        return targetNick
            ? { title: 'Nick não encontrado', message: `Não encontramos ninguém com o nick "@${targetNick}". ${STRINGS.EVENT_INVITE_NICK_HINT}` }
            : { title: 'Pessoa indisponível', message: STRINGS.EVENT_INVITE_USER_GONE };
    }
    if ((code === 'failed-precondition' || code === 'resource-exhausted' || code === 'permission-denied') && serverMessage) {
        return { title: 'Convite não enviado', message: serverMessage };
    }
    if (code === 'unavailable' || code === 'deadline-exceeded') {
        return { title: 'Sem conexão', message: STRINGS.ERROR_NETWORK };
    }
    return { title: 'Convite não enviado', message: STRINGS.EVENT_INVITE_FAILED };
}

export function EventInviteModal({ visible, eventId, onClose }: EventInviteModalProps) {
    const [candidates, setCandidates] = useState<EventInviteCandidate[]>([]);
    const [loadingCandidates, setLoadingCandidates] = useState(false);
    const [sending, setSending] = useState(false);
    const [nick, setNick] = useState('');

    useEffect(() => {
        if (!visible || !eventId) return;
        let active = true;
        setLoadingCandidates(true);
        getEventInviteCandidates(eventId)
            .then((result) => {
                if (!active) return;
                setCandidates(result);
                inviteLog('candidates_loaded', { count: result.length });
            })
            .catch(() => {
                if (!active) return;
                setCandidates([]);
                Alert.alert('Não foi possível carregar', 'Tente novamente para ver pessoas com quem você já participou de eventos.');
            })
            .finally(() => {
                if (active) setLoadingCandidates(false);
            });
        return () => { active = false; };
    }, [eventId, visible]);

    const sendInvite = async (candidate?: EventInviteCandidate) => {
        // Quem copia o nick do perfil costuma trazer o "@" junto.
        const targetNick = normalizeNickname(nick).replace(/^@+/, '');
        if (!candidate && !targetNick) {
            Alert.alert('Informe um nick', 'Digite o nick da pessoa que deseja convidar.');
            return;
        }
        // Nick fora do formato não pode existir: avisa sem invocar a Function.
        if (!candidate && !isValidNickname(targetNick)) {
            Alert.alert('Nick inválido', `${STRINGS.EVENT_INVITE_NICK_INVALID} ${STRINGS.EVENT_INVITE_NICK_HINT}`);
            return;
        }

        setSending(true);
        try {
            const result = candidate
                ? await inviteUserToEvent({ eventId, targetUserId: candidate.uid })
                : await inviteUserToEvent({ eventId, targetNick });
            if (result.alreadyInvited) {
                Alert.alert('Convite já enviado', 'Esta pessoa já recebeu um convite para este evento.');
                return;
            }
            if (candidate) setCandidates((current) => current.filter((item) => item.uid !== candidate.uid));
            setNick('');
            inviteLog('invite_sent', { fromRecentList: Boolean(candidate) });
            Alert.alert('Convite enviado', 'A pessoa receberá uma notificação e poderá confirmar presença se quiser participar.');
        } catch (error) {
            const code = getFirebaseErrorCode(error) ?? 'unknown';
            inviteLog('invite_failed', { code, fromRecentList: Boolean(candidate) });
            const { title, message } = getInviteErrorAlert(error, candidate ? null : targetNick);
            Alert.alert(title, message);
        } finally {
            setSending(false);
        }
    };

    const renderCandidate = ({ item }: { item: EventInviteCandidate }) => (
        <View style={styles.candidateCard}>
            {item.photoURL ? <Image source={{ uri: item.photoURL }} style={styles.avatar} /> : <View style={styles.avatarPlaceholder}><Text style={styles.avatarText}>{item.displayName.charAt(0).toUpperCase()}</Text></View>}
            <View style={styles.candidateInfo}>
                <Text style={styles.candidateName} numberOfLines={1}>{item.displayName}</Text>
                {item.nick && <Text style={styles.candidateNick} numberOfLines={1}>@{item.nick}</Text>}
                <Text style={styles.sharedEvents}>
                    {item.sharedEventsCount > 0
                        ? `${item.sharedEventsCount} evento(s) em comum`
                        : item.previousParticipant
                            ? 'Participou de uma edição anterior'
                            : 'Contato sugerido'}
                </Text>
            </View>
            <TouchableOpacity disabled={sending} style={[styles.inviteButton, sending && styles.inviteButtonDisabled]} onPress={() => sendInvite(item)}>
                <Text style={styles.inviteButtonText}>Convidar</Text>
            </TouchableOpacity>
        </View>
    );

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                <SafeAreaView style={styles.safeArea} edges={['bottom']}>
                <View style={styles.sheet}>
                    <View style={styles.header}>
                        <View><Text style={styles.title}>Convidar pessoas</Text><Text style={styles.subtitle}>Envie até 10 convites por evento.</Text></View>
                        <TouchableOpacity onPress={onClose} accessibilityLabel="Fechar convites"><Ionicons name="close" size={26} color="#6B7280" /></TouchableOpacity>
                    </View>
                    <View style={styles.manualInvite}>
                        <TextInput value={nick} onChangeText={setNick} placeholder="Digite o nick" autoCapitalize="none" autoCorrect={false} maxLength={NICK_MAX_LENGTH} style={styles.nickInput} editable={!sending} />
                        <TouchableOpacity disabled={sending} style={[styles.manualButton, sending && styles.inviteButtonDisabled]} onPress={() => sendInvite()}>
                            {sending ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="send" size={18} color="#FFF" />}
                        </TouchableOpacity>
                    </View>
                    <Text style={styles.sectionTitle}>Pessoas de eventos em comum</Text>
                    {loadingCandidates ? <View style={styles.loading}><ActivityIndicator color="#4F46E5" /></View> : <FlatList data={candidates} renderItem={renderCandidate} keyExtractor={(item) => item.uid} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>Ainda não há co-participantes recentes disponíveis.</Text>} />}
                </View>
                </SafeAreaView>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,39,0.55)' },
    safeArea: { justifyContent: 'flex-end' },
    sheet: { maxHeight: '85%', minHeight: 360, backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
    title: { fontSize: 20, fontWeight: '800', color: '#111827' }, subtitle: { marginTop: 3, fontSize: 13, color: '#6B7280' },
    manualInvite: { flexDirection: 'row', gap: 8, marginBottom: 20 }, nickInput: { flex: 1, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12, paddingHorizontal: 14, color: '#111827' },
    manualButton: { width: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4F46E5' },
    sectionTitle: { fontSize: 15, fontWeight: '800', color: '#374151', marginBottom: 10 }, loading: { paddingVertical: 36, alignItems: 'center' }, list: { paddingBottom: 12 }, empty: { paddingTop: 20, textAlign: 'center', color: '#6B7280', lineHeight: 20 },
    candidateCard: { flexDirection: 'row', alignItems: 'center', padding: 12, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, marginBottom: 9 },
    avatar: { width: 42, height: 42, borderRadius: 21 }, avatarPlaceholder: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' }, avatarText: { color: '#4338CA', fontWeight: '800' },
    candidateInfo: { flex: 1, marginLeft: 10 }, candidateName: { color: '#1F2937', fontWeight: '700' }, candidateNick: { marginTop: 1, color: '#6366F1', fontSize: 12 }, sharedEvents: { marginTop: 2, color: '#6B7280', fontSize: 11 },
    inviteButton: { backgroundColor: '#EEF2FF', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 }, inviteButtonDisabled: { opacity: 0.55 }, inviteButtonText: { color: '#4338CA', fontWeight: '800', fontSize: 12 },
});
