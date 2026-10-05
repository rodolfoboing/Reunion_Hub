import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Modal, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { auth, db, functions } from '../../src/services/firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, limit, arrayUnion } from 'firebase/firestore';
import { Message } from '../../src/types';
import { ReportReasonModal } from '@/src/components/ReportReasonModal';
import { markRelatedNotificationsAsRead } from '@/src/services/notificationReadService';
import { submitReport } from '@/src/services/reportService';
import { setActiveNotificationTarget } from '@/src/utils/Notifications';
import { getDateStr, formatConversationDateHeader } from '@/src/utils/dateUtils';
import { CHAT_MESSAGE_MAX_LENGTH } from '@/src/constants/textLimits';
import { STRINGS } from '@/src/constants/strings';
import { useFocusEffect } from '@react-navigation/native';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '';
}

type PendingMessage = { id: string; text: string; failed: boolean };

/** Mensagem na lista: vinda do banco, ou local aguardando confirmação. */
type DisplayMessage = Message & { pendingState?: 'sending' | 'failed' };

type ConversationData = {
    participants: string[];
    participantNames: Record<string, string>;
    unreadCounts: Record<string, number>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function parseConversationData(value: unknown): ConversationData | null {
    if (!isRecord(value) || !Array.isArray(value.participants)) return null;
    const participants = value.participants.filter((participant): participant is string => typeof participant === 'string');
    const participantNames = isRecord(value.participantNames)
        ? Object.fromEntries(Object.entries(value.participantNames).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : {};
    const unreadCounts = isRecord(value.unreadCounts)
        ? Object.fromEntries(Object.entries(value.unreadCounts).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
        : {};
    return { participants, participantNames, unreadCounts };
}

export default function ChatScreen() {
    const { id, name } = useLocalSearchParams<{ id?: string; name?: string }>();
    const router = useRouter();
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState('');
    const [loading, setLoading] = useState(true);
    /**
     * Mensagens já escritas pela pessoa e ainda não confirmadas pelo servidor.
     *
     * A gravação acontece na callable `sendChatMessage` (o Admin SDK precisa
     * checar bloqueio, contador de não-lidas e limite de push, coisas que as
     * regras não fazem). Como a escrita é do servidor, o Firestore do aparelho
     * NÃO tem compensação de latência: a mensagem só aparecia depois da ida e
     * volta HTTPS + transação + entrega do push. Daí a demora percebida.
     *
     * Estas bolhas locais cobrem essa janela. Elas somem sozinhas quando o
     * listener entrega a mensagem real com o mesmo id — o id é gerado aqui antes
     * do envio, e a callable é idempotente sobre ele, então reenviar não duplica.
     */
    const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
    const flatListRef = useRef<FlatList>(null);
    
    // Novas dependências para opções e lidas/não-lidas
    const [conversationData, setConversationData] = useState<ConversationData | null>(null);
    const [showOptionsModal, setShowOptionsModal] = useState(false);
    const [showReportReasonModal, setShowReportReasonModal] = useState(false);
    const [otherUserExists, setOtherUserExists] = useState(true);
    const [otherUserName, setOtherUserName] = useState(typeof name === 'string' && name.trim() ? name : 'Chat');

    useFocusEffect(React.useCallback(() => {
        if (!id) return;
        setActiveNotificationTarget({ conversationId: id });
        return () => setActiveNotificationTarget(null);
    }, [id]));

    useEffect(() => {
        if (!id || !auth.currentUser) return;

        markRelatedNotificationsAsRead({ conversationId: id }).catch((error) => {
            console.error('[Conversation] Erro ao marcar notificações como lidas:', error);
        });

        // Assinar mensagens
        const messagesRef = collection(db, 'conversations', id, 'messages');
        const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(50));

        const unsubscribeMsgs = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...(doc.data() as Omit<Message, 'id'>)
            }));
            setMessages(msgs.reverse());
            // A bolha local sai daqui, não do sucesso do envio: remover antes de a
            // mensagem real chegar abriria um vão em que ela não aparece em lugar
            // nenhum. Este é também o único ponto que limpa o estado pendente.
            setPendingMessages((current) => current.filter(
                (pending) => !msgs.some((message) => message.id === pending.id)
            ));
            setLoading(false);
            // Scroll to bottom on new message
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        });

        // Assinar conversa para ler status e resetar unreadCount
        const convRef = doc(db, 'conversations', id);
        const unsubscribeConv = onSnapshot(convRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = parseConversationData(docSnap.data());
                if (!data) return;
                setConversationData(data);

                // Se eu tiver mensagens não lidas, zero-as imediatamente porque estou com o chat aberto
                const myUid = auth.currentUser?.uid;
                if (!myUid) return;
                if (data.unreadCounts && data.unreadCounts[myUid] > 0) {
                    updateDoc(convRef, {
                        [`unreadCounts.${myUid}`]: 0
                    }).catch(err => console.log('Erro ao zerar não-lidas', err));
                }
            }
        });

        return () => {
            unsubscribeMsgs();
            unsubscribeConv();
        };
    }, [id]);

    useEffect(() => {
        if (!conversationData?.participants || !auth.currentUser) return;
        const otherUid = conversationData.participants.find((participant) => participant !== auth.currentUser?.uid);
        // Sem outro participante: conversa gravada pela versão antiga da Function
        // de exclusão de conta, que removia o uid de `participants`. O `return`
        // silencioso daqui deixava `otherUserExists` no valor inicial `true`, e o
        // campo de mensagem seguia habilitado para um destinatário inexistente.
        if (!otherUid) {
            setOtherUserExists(false);
            return;
        }

        const unsubscribeOtherUser = onSnapshot(doc(db, 'users', otherUid), (userSnap) => {
            setOtherUserExists(userSnap.exists());
            if (userSnap.exists()) {
                const profile = userSnap.data();
                const currentName = typeof profile.nick === 'string' && profile.nick.trim()
                    ? profile.nick
                    : typeof profile.displayName === 'string' && profile.displayName.trim()
                        ? profile.displayName
                        : 'Usuário';
                setOtherUserName(currentName);
            }
        });

        return () => unsubscribeOtherUser();
    }, [conversationData?.participants]);

    const sendMessage = async (retryOf?: PendingMessage) => {
        if (!auth.currentUser || !id) return;
        const text = retryOf ? retryOf.text : inputText.trim();
        if (!text) return;

        const messageId = retryOf ? retryOf.id : doc(collection(db, 'conversations', id, 'messages')).id;
        // Campo limpo ANTES da rede: é o que faz o envio parecer instantâneo e
        // libera a pessoa para escrever a próxima sem esperar.
        if (!retryOf) setInputText('');
        setPendingMessages((current) => [
            ...current.filter((pending) => pending.id !== messageId),
            { id: messageId, text, failed: false },
        ]);

        try {
            await httpsCallable<{ conversationId: string; text: string; messageId: string }, { ok: boolean; alreadySent: boolean; messageId: string }>(functions, 'sendChatMessage')({
                conversationId: id,
                text,
                messageId,
            });
        } catch (error) {
            const message = getErrorMessage(error);
            const isBlocked = message.includes('bloqueou você') || message.includes('Você bloqueou');
            if (isBlocked) {
                if (__DEV__) console.info('[Conversation] message_rejected_by_block');
                // Bloqueio é definitivo: reenviar nunca vai funcionar, então a
                // bolha sai da lista e o texto volta para o campo.
                setPendingMessages((current) => current.filter((pending) => pending.id !== messageId));
                setInputText((current) => current || text);
                Alert.alert(
                    'Mensagem não enviada',
                    message.includes('bloqueou você')
                        ? 'Esta pessoa bloqueou você e não pode receber suas mensagens.'
                        : STRINGS.CHAT_MESSAGE_BLOCKED
                );
                return;
            }
            // Falha transitória: sem Alert. A bolha marcada já comunica, e o toque
            // nela reenvia com o MESMO id — a callable é idempotente, então se a
            // primeira tentativa tinha chegado ao servidor, nada é duplicado.
            console.error('[Conversation] message_send_failed');
            setPendingMessages((current) => current.map(
                (pending) => (pending.id === messageId ? { ...pending, failed: true } : pending)
            ));
        }
    };

    const handleDeleteChat = () => {
        Alert.alert('Apagar Conversa', 'A conversa será removida apenas da sua lista. O outro participante continuará com o histórico.', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Apagar', style: 'destructive', onPress: async () => {
                setShowOptionsModal(false);
                try {
                    await updateDoc(doc(db, 'conversations', id as string), {
                        deletedBy: arrayUnion(auth.currentUser!.uid)
                    });
                    router.back();
                } catch (e) {
                    Alert.alert('Erro', 'Não foi possível apagar a conversa.');
                }
            }}
        ]);
    };

    const handleViewProfile = () => {
        const otherUid = conversationData?.participants.find((participant) => participant !== auth.currentUser?.uid);
        if (!otherUid) return;
        setShowOptionsModal(false);
        router.push(`/public-profile/${otherUid}` as never);
    };

    const handleBlockUser = () => {
        if (!conversationData || !auth.currentUser) return;
        const otherUid = conversationData.participants.find((participant) => participant !== auth.currentUser?.uid);
        if (!otherUid) return;
        const otherName = otherUserName || conversationData.participantNames?.[otherUid] || 'Usuário';

        Alert.alert('Bloquear Usuário', `Tem certeza que deseja bloquear ${otherName}?`, [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Bloquear', style: 'destructive', onPress: async () => {
                setShowOptionsModal(false);
                try {
                    await updateDoc(doc(db, 'users', auth.currentUser!.uid), {
                        blockedUsers: arrayUnion(otherUid)
                    });
                    router.back();
                } catch (e) {
                    Alert.alert('Erro', 'Não foi possível bloquear o usuário.');
                }
            }}
        ]);
    };

    const handleReportUser = () => {
        if (!conversationData || !auth.currentUser) return;
        setShowOptionsModal(false);
        setShowReportReasonModal(true);
    };

    const submitUserReport = async (reason: string) => {
        const reporterId = auth.currentUser?.uid;
        const otherUid = conversationData?.participants.find((participant) => participant !== reporterId);
        if (!reporterId || !otherUid) return;
        setShowReportReasonModal(false);
        try {
            const result = await submitReport({
                type: 'user',
                targetId: otherUid,
                reason,
                conversationId: typeof id === 'string' ? id : undefined,
            });
            Alert.alert(result.alreadyReported ? 'Denúncia já registrada' : 'Denúncia recebida', result.alreadyReported
                ? 'Você já denunciou este usuário.'
                : 'Nossa equipe de moderação analisará este usuário em breve.');
        } catch (error) {
            console.error('[Conversation] Erro ao enviar denúncia:', error);
            Alert.alert('Erro', 'Não foi possível enviar a denúncia. Tente novamente.');
        }
    };

    // Pendentes entram no fim, que é a posição cronológica delas. Uma pendente
    // cujo id já existe em `messages` não é filtrada aqui: o listener já a removeu
    // do estado pendente, então não há risco de a mesma mensagem aparecer duas vezes.
    const displayedMessages: DisplayMessage[] = [
        ...messages,
        ...pendingMessages.map((pending): DisplayMessage => ({
            id: pending.id,
            text: pending.text,
            senderId: auth.currentUser?.uid ?? '',
            pendingState: pending.failed ? 'failed' : 'sending',
        })),
    ];

    const renderMessage = ({ item, index }: { item: DisplayMessage, index: number }) => {
        const isMe = item.senderId === auth.currentUser?.uid;
        // displayedMessages está em ordem cronológica ascendente, com as pendentes
        // no fim — então o último item é sempre o mais recente.
        const isLastMessage = index === displayedMessages.length - 1;
        const isPending = Boolean(item.pendingState);

        const messageDate = item.createdAt?.seconds ? new Date(item.createdAt.seconds * 1000) : null;
        let timeString = '';
        if (messageDate) {
            timeString = messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        // Separador de data quando o dia muda em relação à mensagem anterior
        // (ou na primeira mensagem carregada) — evita uma lista inteira só com
        // horas, sem indicar quando cada grupo de mensagens aconteceu.
        const previousMessage = index > 0 ? displayedMessages[index - 1] : undefined;
        const previousMessageDate = previousMessage?.createdAt?.seconds
            ? new Date(previousMessage.createdAt.seconds * 1000)
            : null;
        const showDateHeader = Boolean(messageDate)
            && (!previousMessageDate || getDateStr(messageDate!) !== getDateStr(previousMessageDate));

        // Determinar status de leitura para a última mensagem enviada por mim
        let isRead = false;
        if (isMe && isLastMessage && !isPending && conversationData) {
            const otherUid = conversationData.participants.find((participant) => participant !== auth.currentUser?.uid);
            if (otherUid && conversationData.unreadCounts?.[otherUid] === 0) {
                isRead = true; // Se o outro tem 0 não-lidas, ele já leu!
            }
        }

        return (
            <>
                {showDateHeader && messageDate && (
                    <View style={styles.dateHeaderRow}>
                        <View style={styles.dateHeaderPill}>
                            <Text style={styles.dateHeaderText}>{formatConversationDateHeader(messageDate)}</Text>
                        </View>
                    </View>
                )}
                <View style={[styles.messageRow, isMe ? styles.myMessageRow : styles.otherMessageRow]}>
                    {!isMe && (
                        <View style={styles.avatarPlaceholder}>
                            <FontAwesome name="user" size={12} color="#fff" />
                        </View>
                    )}
                    <TouchableOpacity
                        activeOpacity={item.pendingState === 'failed' ? 0.7 : 1}
                        disabled={item.pendingState !== 'failed'}
                        onPress={() => {
                            const failed = pendingMessages.find((pending) => pending.id === item.id);
                            if (failed) void sendMessage(failed);
                        }}
                        accessibilityRole={item.pendingState === 'failed' ? 'button' : undefined}
                        accessibilityLabel={item.pendingState === 'failed' ? 'Tentar enviar esta mensagem de novo' : undefined}
                        style={[
                            styles.bubble,
                            isMe ? styles.myBubble : styles.otherBubble,
                            item.pendingState === 'sending' && styles.sendingBubble,
                            item.pendingState === 'failed' && styles.failedBubble,
                        ]}
                    >
                        <Text style={[styles.messageText, isMe ? styles.myMessageText : styles.otherMessageText]}>
                            {item.text}
                        </Text>
                        <View style={styles.messageFooter}>
                            <Text style={[styles.timeText, isMe ? styles.myTimeText : styles.otherTimeText]}>
                                {item.pendingState === 'failed' ? 'Toque para reenviar' : item.pendingState === 'sending' ? 'Enviando...' : timeString}
                            </Text>
                            {item.pendingState === 'failed' ? (
                                <Ionicons name="alert-circle" size={14} color="#FEE2E2" style={{ marginLeft: 4 }} />
                            ) : item.pendingState === 'sending' ? (
                                <Ionicons name="time-outline" size={14} color="rgba(255,255,255,0.7)" style={{ marginLeft: 4 }} />
                            ) : isMe && isLastMessage ? (
                                <Ionicons
                                    name={isRead ? "checkmark-done" : "checkmark"}
                                    size={14}
                                    color={isRead ? "#60a5fa" : "rgba(255,255,255,0.7)"}
                                    style={{ marginLeft: 4 }}
                                />
                            ) : null}
                        </View>
                    </TouchableOpacity>
                </View>
            </>
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            <Stack.Screen
                options={{
                    title: otherUserExists ? otherUserName : 'Usuário Excluído',
                    headerBackTitle: 'Voltar',
                    headerRight: () => (
                        <TouchableOpacity onPress={() => setShowOptionsModal(true)} style={{ padding: 8 }}>
                            <FontAwesome name="ellipsis-v" size={20} color="#6366f1" />
                        </TouchableOpacity>
                    )
                }}
            />

            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "padding"}
                keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 80}
                style={{ flex: 1 }}
            >
                {loading ? (
                    <View style={styles.center}>
                        <ActivityIndicator size="large" color="#4f46e5" />
                    </View>
                ) : (
                    <FlatList
                        ref={flatListRef}
                        data={displayedMessages}
                        renderItem={renderMessage}
                        keyExtractor={item => item.id}
                        contentContainerStyle={styles.listContent}
                        ListHeaderComponent={
                            <View style={styles.safetyTipContainer}>
                                <FontAwesome name="shield" size={20} color="#6366f1" style={{ marginRight: 12 }} />
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.safetyTipTitle}>Dica de Segurança</Text>
                                    <Text style={styles.safetyTipText}>
                                        Nunca envie dinheiro, dados de cartão ou senhas. O Reunion Hub nunca pedirá sua senha por aqui.
                                    </Text>
                                </View>
                            </View>
                        }
                        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
                        keyboardShouldPersistTaps="handled"
                    />
                )}

                <View style={styles.inputContainerWrapper}>
                    <View style={styles.inputContainer}>
                        <TextInput
                            style={styles.input}
                            placeholder={otherUserExists ? "Digite uma mensagem..." : "Usuário excluído."}
                            placeholderTextColor="#9ca3af"
                            value={inputText}
                            onChangeText={setInputText}
                            multiline
                            // O servidor recusa acima de 2000 em sendChatMessage.
                            // Sem o limite aqui, o usuário escrevia um texto longo
                            // e só descobria no toque em enviar, perdendo o que
                            // tinha escrito.
                            maxLength={CHAT_MESSAGE_MAX_LENGTH}
                            editable={otherUserExists}
                        />
                        {/* Sem spinner e sem trava: com a bolha otimista, quem envia
                            não espera a rede para escrever a próxima mensagem. */}
                        <TouchableOpacity
                            onPress={() => void sendMessage()}
                            style={[styles.sendButton, (!inputText.trim() || !otherUserExists) && styles.sendButtonDisabled]}
                            disabled={!inputText.trim() || !otherUserExists}
                            accessibilityRole="button"
                            accessibilityLabel="Enviar mensagem"
                        >
                            <Ionicons name="send" size={20} color="#fff" />
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>

            {/* Options Modal */}
            <Modal
                visible={showOptionsModal}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setShowOptionsModal(false)}
            >
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowOptionsModal(false)}>
                    <View style={styles.optionsContent}>
                        <Text style={styles.optionsTitle}>Opções do Chat</Text>

                        {/* Ver perfil, bloquear e denunciar exigem alguém do outro
                            lado: com a conta excluída seus handlers já retornavam
                            sem fazer nada, o que na tela vira botão morto. Só
                            "Apagar da Minha Lista" continua fazendo sentido. */}
                        {otherUserExists && (
                        <TouchableOpacity style={styles.optionItem} onPress={handleViewProfile}>
                            <View style={[styles.optionIcon, { backgroundColor: '#eef2ff' }]}>
                                <Ionicons name="person-outline" size={20} color="#4f46e5" />
                            </View>
                            <Text style={styles.optionText}>Ver Perfil</Text>
                        </TouchableOpacity>
                        )}

                        <TouchableOpacity style={styles.optionItem} onPress={handleDeleteChat}>
                            <View style={[styles.optionIcon, { backgroundColor: '#fee2e2' }]}>
                                <Ionicons name="trash-outline" size={20} color="#ef4444" />
                            </View>
                            <Text style={styles.optionTextRed}>Apagar da Minha Lista</Text>
                        </TouchableOpacity>

                        {otherUserExists && (
                        <TouchableOpacity style={styles.optionItem} onPress={handleBlockUser}>
                            <View style={[styles.optionIcon, { backgroundColor: '#ffedd5' }]}>
                                <Ionicons name="ban-outline" size={20} color="#f97316" />
                            </View>
                            <Text style={styles.optionTextOrange}>Bloquear Usuário</Text>
                        </TouchableOpacity>
                        )}

                        {otherUserExists && (
                        <TouchableOpacity style={styles.optionItem} onPress={handleReportUser}>
                            <View style={[styles.optionIcon, { backgroundColor: '#f3f4f6' }]}>
                                <Ionicons name="warning-outline" size={20} color="#4b5563" />
                            </View>
                            <Text style={styles.optionText}>Denunciar</Text>
                        </TouchableOpacity>
                        )}
                    </View>
                </TouchableOpacity>
            </Modal>
            <ReportReasonModal
                visible={showReportReasonModal}
                targetType="user"
                onClose={() => setShowReportReasonModal(false)}
                onSelectReason={submitUserReport}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f3f4f6',
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center'
    },
    listContent: {
        paddingVertical: 16,
        paddingHorizontal: 16,
    },
    dateHeaderRow: {
        alignItems: 'center',
        marginBottom: 12,
    },
    dateHeaderPill: {
        backgroundColor: '#E5E7EB',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 4,
    },
    dateHeaderText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#6B7280',
    },
    messageRow: {
        flexDirection: 'row',
        marginBottom: 12,
        alignItems: 'flex-end',
    },
    myMessageRow: {
        justifyContent: 'flex-end',
    },
    otherMessageRow: {
        justifyContent: 'flex-start',
    },
    avatarPlaceholder: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: '#9ca3af',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 8,
        marginBottom: 4
    },
    bubble: {
        maxWidth: '80%',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 16,
    },
    myBubble: {
        backgroundColor: '#4f46e5',
        borderBottomRightRadius: 2,
    },
    otherBubble: {
        backgroundColor: '#fff',
        borderBottomLeftRadius: 2,
    },
    // Enviando: mesma cor, levemente translúcida — a diferença é discreta de
    // propósito, porque na maioria dos envios ela vai durar menos de um segundo.
    sendingBubble: { opacity: 0.72 },
    failedBubble: { backgroundColor: '#B91C1C', opacity: 1 },
    messageText: {
        fontSize: 16,
    },
    myMessageText: {
        color: '#fff',
    },
    otherMessageText: {
        color: '#1f2937',
    },
    timeText: {
        fontSize: 10,
        marginTop: 4,
        alignSelf: 'flex-end',
    },
    myTimeText: {
        color: 'rgba(255,255,255,0.7)',
    },
    otherTimeText: {
        color: '#9ca3af',
    },
    safetyTipContainer: {
        flexDirection: 'row',
        backgroundColor: '#e0e7ff',
        padding: 16,
        borderRadius: 12,
        marginBottom: 24,
    },
    safetyTipTitle: {
        color: '#4338ca',
        fontWeight: 'bold',
        fontSize: 14,
        marginBottom: 4,
    },
    safetyTipText: {
        color: '#4f46e5',
        fontSize: 13,
        lineHeight: 18,
    },
    inputContainerWrapper: {
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
    },
    inputContainer: {
        flexDirection: 'row',
        padding: 12,
        alignItems: 'flex-end',
    },
    input: {
        flex: 1,
        backgroundColor: '#f9fafb',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 10,
        marginRight: 8,
        maxHeight: 100,
        fontSize: 16,
    },
    sendButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#4f46e5',
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendButtonDisabled: {
        backgroundColor: '#9ca3af',
    },
    messageFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-end',
        marginTop: 4,
    },
    // Modal Styles
    modalOverlay: {
        flex: 1,
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0,0,0,0.25)',
        justifyContent: 'center',
        alignItems: 'center'
    },
    optionsContent: {
        width: '80%',
        backgroundColor: '#ffffff',
        borderRadius: 24,
        padding: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 5
    },
    optionsTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#1f2937',
        marginBottom: 20,
        textAlign: 'center',
    },
    optionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    optionIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    optionTextRed: {
        fontSize: 16,
        fontWeight: '600',
        color: '#ef4444',
    },
    optionTextOrange: {
        fontSize: 16,
        fontWeight: '600',
        color: '#f97316',
    },
    optionText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#4b5563',
    }
});
