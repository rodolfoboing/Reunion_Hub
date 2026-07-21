import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Modal, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { auth, db } from '../../src/services/firebaseConfig';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, limit, increment, arrayUnion, deleteDoc } from 'firebase/firestore';
import { Message } from '../../src/types';

export default function ChatScreen() {
    const { id, name } = useLocalSearchParams();
    const router = useRouter();
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState('');
    const [loading, setLoading] = useState(true);
    const flatListRef = useRef<FlatList>(null);
    
    // Novas dependências para opções e lidas/não-lidas
    const [conversationData, setConversationData] = useState<any>(null);
    const [showOptionsModal, setShowOptionsModal] = useState(false);
    const [otherUserExists, setOtherUserExists] = useState(true);

    useEffect(() => {
        if (!id || !auth.currentUser) return;

        // Assinar mensagens
        const messagesRef = collection(db, 'conversations', id as string, 'messages');
        const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(50));

        const unsubscribeMsgs = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...(doc.data() as Omit<Message, 'id'>)
            }));
            setMessages(msgs.reverse());
            setLoading(false);
            // Scroll to bottom on new message
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        });

        // Assinar conversa para ler status e resetar unreadCount
        const convRef = doc(db, 'conversations', id as string);
        const unsubscribeConv = onSnapshot(convRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setConversationData(data);

                // Se eu tiver mensagens não lidas, zero-as imediatamente porque estou com o chat aberto
                const myUid = auth.currentUser!.uid;
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
        const otherUid = conversationData.participants.find((p: string) => p !== auth.currentUser?.uid);
        if (!otherUid) return;

        const unsubscribeOtherUser = onSnapshot(doc(db, 'users', otherUid), (userSnap) => {
            setOtherUserExists(userSnap.exists());
        });

        return () => unsubscribeOtherUser();
    }, [conversationData?.participants]);

    const sendMessage = async () => {
        if (!inputText.trim() || !auth.currentUser || !id) return;

        const text = inputText.trim();
        setInputText('');

        try {
            // 1. Add message to subcollection
            const messagesRef = collection(db, 'conversations', id as string, 'messages');
            await addDoc(messagesRef, {
                text,
                senderId: auth.currentUser.uid,
                createdAt: serverTimestamp(),
            });

            // Identifica o outro usuário para incrementar a contagem de não-lidas dele
            let otherUid = '';
            if (conversationData && conversationData.participants) {
                otherUid = conversationData.participants.find((p: string) => p !== auth.currentUser?.uid) || '';
            }

            // 2. Update conversation summary (last message)
            const conversationRef = doc(db, 'conversations', id as string);
            const updates: any = {
                lastMessage: text,
                lastMessageTimestamp: serverTimestamp(),
                lastSenderId: auth.currentUser.uid,
                deletedBy: [] // Resuscita a conversa se foi deletada por alguém
            };
            if (otherUid) {
                updates[`unreadCounts.${otherUid}`] = increment(1);
            }

            await updateDoc(conversationRef, updates);

        } catch (error) {
            console.error("Error sending message: ", error);
        }
    };

    const handleDeleteChat = () => {
        Alert.alert('Apagar Conversa', 'Tem certeza que deseja apagar esta conversa para sempre?', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Apagar', style: 'destructive', onPress: async () => {
                setShowOptionsModal(false);
                try {
                    await deleteDoc(doc(db, 'conversations', id as string));
                    router.back();
                } catch (e) {
                    Alert.alert('Erro', 'Não foi possível apagar a conversa.');
                }
            }}
        ]);
    };

    const handleBlockUser = () => {
        if (!conversationData || !auth.currentUser) return;
        const otherUid = conversationData.participants.find((p: string) => p !== auth.currentUser?.uid);
        const otherName = conversationData.participantNames?.[otherUid] || 'Usuário';

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
        const otherUid = conversationData.participants.find((p: string) => p !== auth.currentUser?.uid);
        setShowOptionsModal(false);

        Alert.alert(
            'Denunciar Usuário',
            'Deseja denunciar este usuário por comportamento impróprio?',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Denunciar',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await addDoc(collection(db, 'reports'), {
                                type: 'user',
                                targetId: otherUid,
                                reportedBy: auth.currentUser?.uid,
                                createdAt: serverTimestamp()
                            });
                            Alert.alert('Denúncia Recebida', 'Nossa equipe de moderação analisará este usuário em breve.');
                        } catch (error) {
                            Alert.alert('Erro', 'Não foi possível enviar a denúncia. Tente novamente.');
                        }
                    }
                }
            ]
        );
    };

    const renderMessage = ({ item, index }: { item: Message, index: number }) => {
        const isMe = item.senderId === auth.currentUser?.uid;
        const isLastMessage = index === messages.length - 1; // Array is reversed natively, wait no it's normally sorted but we appended. Wait, the array is reversed? No, the array is in normal chronological order because we reversed the firebase result `msgs.reverse()`. So the last item is messages.length - 1.

        let timeString = '';
        if (item.createdAt?.seconds) {
            timeString = new Date(item.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        // Determinar status de leitura para a última mensagem enviada por mim
        let isRead = false;
        if (isMe && isLastMessage && conversationData) {
            const otherUid = conversationData.participants?.find((p: string) => p !== auth.currentUser?.uid);
            if (otherUid && conversationData.unreadCounts?.[otherUid] === 0) {
                isRead = true; // Se o outro tem 0 não-lidas, ele já leu!
            }
        }

        return (
            <View style={[styles.messageRow, isMe ? styles.myMessageRow : styles.otherMessageRow]}>
                {!isMe && (
                    <View style={styles.avatarPlaceholder}>
                        <FontAwesome name="user" size={12} color="#fff" />
                    </View>
                )}
                <View style={[styles.bubble, isMe ? styles.myBubble : styles.otherBubble]}>
                    <Text style={[styles.messageText, isMe ? styles.myMessageText : styles.otherMessageText]}>
                        {item.text}
                    </Text>
                    <View style={styles.messageFooter}>
                        <Text style={[styles.timeText, isMe ? styles.myTimeText : styles.otherTimeText]}>
                            {timeString}
                        </Text>
                        {isMe && isLastMessage && (
                            <Ionicons 
                                name={isRead ? "checkmark-done" : "checkmark"} 
                                size={14} 
                                color={isRead ? "#60a5fa" : "rgba(255,255,255,0.7)"} 
                                style={{ marginLeft: 4 }}
                            />
                        )}
                    </View>
                </View>
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            <Stack.Screen
                options={{
                    title: otherUserExists ? (name as string || 'Chat') : 'Usuário Excluído',
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
                        data={messages}
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
                            editable={otherUserExists}
                        />
                        <TouchableOpacity 
                            onPress={sendMessage} 
                            style={[styles.sendButton, (!inputText.trim() || !otherUserExists) && styles.sendButtonDisabled]} 
                            disabled={!inputText.trim() || !otherUserExists}
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
                        
                        <TouchableOpacity style={styles.optionItem} onPress={handleDeleteChat}>
                            <View style={[styles.optionIcon, { backgroundColor: '#fee2e2' }]}>
                                <Ionicons name="trash-outline" size={20} color="#ef4444" />
                            </View>
                            <Text style={styles.optionTextRed}>Apagar Conversa</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.optionItem} onPress={handleBlockUser}>
                            <View style={[styles.optionIcon, { backgroundColor: '#ffedd5' }]}>
                                <Ionicons name="ban-outline" size={20} color="#f97316" />
                            </View>
                            <Text style={styles.optionTextOrange}>Bloquear Usuário</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.optionItem} onPress={handleReportUser}>
                            <View style={[styles.optionIcon, { backgroundColor: '#f3f4f6' }]}>
                                <Ionicons name="warning-outline" size={20} color="#4b5563" />
                            </View>
                            <Text style={styles.optionText}>Denunciar</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>
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
