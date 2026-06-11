import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { auth, db } from '../../../src/services/firebaseConfig';
import { collection, query, where, onSnapshot, doc, getDoc, setDoc, serverTimestamp, getDocs, orderBy, limit } from 'firebase/firestore';

export default function MessagesScreen() {
    const [conversations, setConversations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // New Chat State
    const [showNewChatModal, setShowNewChatModal] = useState(false);
    const [targetNick, setTargetNick] = useState('');
    const [creatingChat, setCreatingChat] = useState(false);

    useEffect(() => {
        if (!auth.currentUser) return;

        const q = query(
            collection(db, 'conversations'),
            where('participants', 'array-contains', auth.currentUser.uid),
            orderBy('lastMessageTimestamp', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const convs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            setConversations(convs);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching conversations:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    /**
     * Inicia uma nova conversa baseada no Nick informado.
     * Busca o usuário pelo nick único e cria/abre a conversa determinística.
     */
    const startNewChat = async () => {
        const trimmedNick = targetNick.trim().toLowerCase();
        if (!trimmedNick) {
            Alert.alert('Erro', 'Por favor digite o Nick do usuário.');
            return;
        }

        setCreatingChat(true);

        try {
            // 1. Localizar Usuário pelo Nick (searchName é indexado e case-insensitive)
            const usersRef = collection(db, 'users');
            const qUsers = query(usersRef, where('searchName', '==', trimmedNick));
            const querySnapshot = await getDocs(qUsers);

            if (querySnapshot.empty) {
                Alert.alert('Erro', 'Usuário não encontrado. Verifique o Nick e tente novamente.');
                setCreatingChat(false);
                return;
            }

            const targetUserDoc = querySnapshot.docs[0];
            const targetUser = targetUserDoc.data();
            const targetUid = targetUserDoc.id;

            if (targetUid === auth.currentUser?.uid) {
                Alert.alert('Erro', 'Você não pode iniciar um chat com você mesmo.');
                setCreatingChat(false);
                return;
            }

            // 2. Criar ou Obter Conversa
            // Usamos um ID determinístico baseado na ordenação alfabética dos UIDs
            const uids = [auth.currentUser!.uid, targetUid].sort();
            const chatId = `${uids[0]}_${uids[1]}`;
            const chatRef = doc(db, 'conversations', chatId);

            const chatDoc = await getDoc(chatRef);

            if (!chatDoc.exists()) {
                await setDoc(chatRef, {
                    participants: uids,
                    participantNames: {
                        [auth.currentUser!.uid]: auth.currentUser?.displayName || 'Eu',
                        [targetUid]: targetUser.nick || targetUser.displayName || 'Usuário'
                    },
                    lastMessage: 'Conversa iniciada',
                    lastMessageTimestamp: serverTimestamp(),
                    unreadCounts: { [auth.currentUser!.uid]: 0, [targetUid]: 0 }
                });
            }

            // 3. Navegar para o Chat
            setShowNewChatModal(false);
            setTargetNick('');
            router.push({
                pathname: '/conversation/[id]',
                params: {
                    id: chatId,
                    name: targetUser.nick || targetUser.displayName || 'Usuário'
                }
            });

        } catch (error) {
            console.error("Error creating chat:", error);
            Alert.alert('Erro', 'Não foi possível iniciar a conversa. Verifique sua conexão.');
        } finally {
            setCreatingChat(false);
        }
    };

    const getOtherParticipantName = (conversation: any) => {
        if (!auth.currentUser) return 'Chat';
        const otherUid = conversation.participants.find((p: string) => p !== auth.currentUser?.uid);
        return conversation.participantNames?.[otherUid] || 'Usuário';
    };

    const renderItem = ({ item }: { item: any }) => {
        const otherName = getOtherParticipantName(item);
        return (
            <TouchableOpacity
                style={styles.conversationItem}
                onPress={() => router.push({
                    pathname: '/conversation/[id]',
                    params: { id: item.id, name: otherName }
                })}
            >
                <View style={styles.avatarContainer}>
                    <View style={[styles.avatarPlaceholder, { backgroundColor: '#e0e7ff' }]}>
                        <FontAwesome name="user" size={20} color="#4f46e5" />
                    </View>
                </View>

                <View style={styles.contentContainer}>
                    <View style={styles.rowTop}>
                        <Text style={styles.name}>{otherName}</Text>
                        {item.lastMessageTimestamp?.seconds && (
                            <Text style={styles.time}>
                                {new Date(item.lastMessageTimestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </Text>
                        )}
                    </View>
                    <View style={styles.rowBottom}>
                        <Text style={styles.lastMessage} numberOfLines={1}>
                            {item.lastMessage}
                        </Text>
                        {/* Unread badge logic would go here */}
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Mensagens</Text>
                <TouchableOpacity style={styles.newMessageBtn} onPress={() => setShowNewChatModal(true)}>
                    <FontAwesome name="edit" size={24} color="#4f46e5" />
                </TouchableOpacity>
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#4f46e5" />
                </View>
            ) : (
                <FlatList
                    data={conversations}
                    renderItem={renderItem}
                    keyExtractor={item => item.id}
                    contentContainerStyle={styles.list}
                    ItemSeparatorComponent={() => <View style={styles.separator} />}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Text style={styles.emptyText}>Nenhuma conversa ainda.</Text>
                            <Text style={styles.emptySubText}>Toque no ícone acima para iniciar um chat.</Text>
                        </View>
                    }
                />
            )}

            {/* New Chat Modal */}
            <Modal
                visible={showNewChatModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowNewChatModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>Nova Mensagem</Text>
                        <Text style={styles.modalSubtitle}>Digite o Nick do usuário</Text>

                        <TextInput
                            style={styles.input}
                            placeholder="Ex: joaosilva"
                            value={targetNick}
                            onChangeText={setTargetNick}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.cancelButton]}
                                onPress={() => setShowNewChatModal(false)}
                            >
                                <Text style={styles.cancelButtonText}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.confirmButton]}
                                onPress={startNewChat}
                                disabled={creatingChat}
                            >
                                {creatingChat ? (
                                    <ActivityIndicator color="#fff" size="small" />
                                ) : (
                                    <Text style={styles.confirmButtonText}>Iniciar</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center'
    },
    header: {
        paddingTop: 60,
        paddingHorizontal: 20,
        paddingBottom: 15,
        backgroundColor: '#fff',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6'
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#1f2937'
    },
    newMessageBtn: {
        padding: 8,
    },
    list: {
        paddingBottom: 20,
        flexGrow: 1
    },
    conversationItem: {
        flexDirection: 'row',
        padding: 16,
        alignItems: 'center',
    },
    avatarContainer: {
        marginRight: 16,
    },
    avatarPlaceholder: {
        width: 50,
        height: 50,
        borderRadius: 25,
        justifyContent: 'center',
        alignItems: 'center',
    },
    contentContainer: {
        flex: 1,
    },
    rowTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    name: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1f2937',
    },
    time: {
        fontSize: 12,
        color: '#6b7280',
    },
    rowBottom: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    lastMessage: {
        fontSize: 14,
        color: '#6b7280',
        flex: 1,
        marginRight: 8,
    },
    separator: {
        height: 1,
        backgroundColor: '#f3f4f6',
        marginLeft: 82,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        marginTop: 50,
        paddingHorizontal: 30
    },
    emptyText: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#374151',
        marginBottom: 8
    },
    emptySubText: {
        fontSize: 14,
        color: '#9ca3af',
        textAlign: 'center'
    },
    // Modal Styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center'
    },
    modalContent: {
        width: '85%',
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 8,
        color: '#1f2937'
    },
    modalSubtitle: {
        fontSize: 14,
        color: '#6b7280',
        marginBottom: 16
    },
    input: {
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        marginBottom: 24,
        backgroundColor: '#f9fafb'
    },
    modalButtons: {
        flexDirection: 'row',
        justifyContent: 'flex-end'
    },
    modalButton: {
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 8,
        marginLeft: 12
    },
    cancelButton: {
        backgroundColor: '#f3f4f6'
    },
    confirmButton: {
        backgroundColor: '#4f46e5'
    },
    cancelButtonText: {
        color: '#4b5563',
        fontWeight: '600'
    },
    confirmButtonText: {
        color: '#fff',
        fontWeight: '600'
    }
});
