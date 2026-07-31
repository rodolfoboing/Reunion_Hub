import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, TextInput, Alert, ActivityIndicator, Linking } from 'react-native';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { auth, db } from '../../../src/services/firebaseConfig';
import { collection, query, where, onSnapshot, doc, getDoc, setDoc, serverTimestamp, getDocs, orderBy, deleteDoc, updateDoc, arrayUnion, addDoc, limit } from 'firebase/firestore';
import { LinearGradient } from 'expo-linear-gradient';
import { ReportReasonModal } from '@/src/components/ReportReasonModal';

export default function MessagesScreen() {
    const [conversations, setConversations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [userProfile, setUserProfile] = useState<any>(null);

    const [showNewChatModal, setShowNewChatModal] = useState(false);
    const [targetNick, setTargetNick] = useState('');
    const [creatingChat, setCreatingChat] = useState(false);

    const [selectedChat, setSelectedChat] = useState<any>(null);
    const [showOptionsModal, setShowOptionsModal] = useState(false);
    const [showReportReasonModal, setShowReportReasonModal] = useState(false);

    useEffect(() => {
        if (!auth.currentUser) return;

        const unsubUser = onSnapshot(doc(db, 'users', auth.currentUser.uid), (docSnap) => {
            if (docSnap.exists()) setUserProfile(docSnap.data());
        });

        const q = query(
            collection(db, 'conversations'),
            where('participants', 'array-contains', auth.currentUser.uid),
            orderBy('lastMessageTimestamp', 'desc'),
            limit(30)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const convs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            console.log(`[MessagesScreen] Encontradas ${convs.length} conversas.`);
            setConversations(convs);
            setLoading(false);
        }, (error) => {
            console.error("[MessagesScreen] Erro ao buscar conversas:", error);
            setLoading(false);
        });

        return () => {
            unsubUser();
            unsubscribe();
        };
    }, []);

    const blocked = userProfile?.blockedUsers || [];
    const visibleConversations = conversations.filter(c => {
        const otherUid = c.participants?.find((p: string) => p !== auth.currentUser?.uid);
        const isDeletedByMe = c.deletedBy?.includes(auth.currentUser?.uid);
        return !blocked.includes(otherUid) && !isDeletedByMe;
    });

    const startNewChat = async () => {
        const trimmedNick = targetNick.trim().toLowerCase();
        if (!trimmedNick) {
            Alert.alert('Erro', 'Por favor digite o Nick do usuário.');
            return;
        }

        setCreatingChat(true);

        try {
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

            if (blocked.includes(targetUid)) {
                Alert.alert('Erro', 'Você bloqueou este usuário.');
                setCreatingChat(false);
                return;
            }

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
            console.error("[MessagesScreen] Erro ao iniciar chat:", error);
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

    const openOptions = (chat: any) => {
        setSelectedChat(chat);
        setShowOptionsModal(true);
    };

    const handleDeleteChat = () => {
        if (!selectedChat) return;
        Alert.alert('Apagar Conversa', 'Tem certeza que deseja apagar esta conversa da sua lista?', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Apagar', style: 'destructive', onPress: async () => {
                setShowOptionsModal(false);
                try {
                    await updateDoc(doc(db, 'conversations', selectedChat.id), {
                        deletedBy: arrayUnion(auth.currentUser!.uid)
                    });
                } catch (e) {
                    Alert.alert('Erro', 'Não foi possível apagar a conversa.');
                }
            }}
        ]);
    };

    const handleBlockUser = () => {
        if (!selectedChat || !auth.currentUser) return;
        const otherUid = selectedChat.participants.find((p: string) => p !== auth.currentUser?.uid);
        const otherName = selectedChat.participantNames?.[otherUid] || 'Usuário';

        Alert.alert('Bloquear Usuário', `Tem certeza que deseja bloquear ${otherName}? Vocês não poderão mais trocar mensagens.`, [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Bloquear', style: 'destructive', onPress: async () => {
                setShowOptionsModal(false);
                try {
                    await updateDoc(doc(db, 'users', auth.currentUser!.uid), {
                        blockedUsers: arrayUnion(otherUid)
                    });
                } catch (e) {
                    Alert.alert('Erro', 'Não foi possível bloquear o usuário.');
                }
            }}
        ]);
    };

    const handleReportUser = () => {
        if (!selectedChat || !auth.currentUser) return;
        setShowOptionsModal(false);
        setShowReportReasonModal(true);
    };

    const submitUserReport = async (reason: string) => {
        const reporterId = auth.currentUser?.uid;
        const otherUid = selectedChat?.participants?.find((participant: string) => participant !== reporterId);
        if (!reporterId || !otherUid) return;

        setShowReportReasonModal(false);
        try {
            await addDoc(collection(db, 'reports'), {
                type: 'user',
                targetId: otherUid,
                reportedBy: reporterId,
                reason,
                createdAt: serverTimestamp()
            });
            Alert.alert('Denúncia recebida', 'Nossa equipe de moderação analisará este usuário em breve.');
        } catch (error) {
            console.error('[MessagesScreen] Erro ao enviar denúncia:', error);
            Alert.alert('Erro', 'Não foi possível enviar a denúncia. Tente novamente.');
        }
    };

    const renderItem = ({ item }: { item: any }) => {
        const otherName = getOtherParticipantName(item);
        const unreadCount = item.unreadCounts?.[auth.currentUser?.uid || ''] || 0;
        const isUnread = unreadCount > 0;

        // Status do Visto na lista
        const isMyLastMessage = item.lastSenderId === auth.currentUser?.uid;
        let isReadByOther = false;
        if (isMyLastMessage) {
            const otherUid = item.participants?.find((p: string) => p !== auth.currentUser?.uid);
            if (otherUid && item.unreadCounts?.[otherUid] === 0) {
                isReadByOther = true;
            }
        }

        return (
            <TouchableOpacity
                style={styles.conversationItem}
                onPress={() => router.push({
                    pathname: '/conversation/[id]',
                    params: { id: item.id, name: otherName }
                })}
            >
                <View style={styles.avatarContainer}>
                    <LinearGradient
                        colors={['#818cf8', '#6366f1']}
                        style={styles.avatarPlaceholder}
                    >
                        <FontAwesome name="user" size={20} color="#fff" />
                    </LinearGradient>
                    {isUnread && <View style={styles.onlineBadge} />}
                </View>

                <View style={styles.contentContainer}>
                    <View style={styles.rowTop}>
                        <Text style={[styles.name, isUnread && styles.nameUnread]}>{otherName}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {item.lastMessageTimestamp?.seconds && (
                                <Text style={[styles.time, isUnread && styles.timeUnread]}>
                                    {new Date(item.lastMessageTimestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </Text>
                            )}
                            <TouchableOpacity style={styles.optionsBtn} onPress={() => openOptions(item)}>
                                <FontAwesome name="ellipsis-v" size={16} color="#9ca3af" />
                            </TouchableOpacity>
                        </View>
                    </View>
                    <View style={styles.rowBottom}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
                            {isMyLastMessage && (
                                <Ionicons 
                                    name={isReadByOther ? "checkmark-done" : "checkmark"} 
                                    size={16} 
                                    color={isReadByOther ? "#6366f1" : "#9ca3af"} 
                                    style={{ marginRight: 4 }}
                                />
                            )}
                            <Text style={[styles.lastMessage, isUnread && styles.lastMessageUnread]} numberOfLines={1}>
                                {item.lastMessage}
                            </Text>
                        </View>
                        {isUnread && (
                            <View style={styles.unreadBadge}>
                                <Text style={styles.unreadText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                            </View>
                        )}
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={['#6366f1', '#8b5cf6']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.headerWrapper}
            >
                <View style={styles.blobOne} />
                <View style={styles.blobTwo} />
                
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>Mensagens</Text>
                    <TouchableOpacity style={styles.newMessageBtn} onPress={() => setShowNewChatModal(true)}>
                        <FontAwesome name="pencil-square-o" size={20} color="#6366f1" />
                    </TouchableOpacity>
                </View>
            </LinearGradient>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#6366f1" />
                </View>
            ) : (
                <FlatList
                    data={visibleConversations}
                    renderItem={renderItem}
                    keyExtractor={item => item.id}
                    contentContainerStyle={styles.list}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <View style={styles.emptyIconBox}>
                                <Ionicons name="chatbubbles-outline" size={48} color="#c7ccf0" />
                            </View>
                            <Text style={styles.emptyText}>Nenhuma conversa ainda.</Text>
                            <Text style={styles.emptySubText}>Toque no ícone acima para iniciar um chat com seus amigos.</Text>
                        </View>
                    }
                />
            )}

            {/* New Chat Modal */}
            <Modal
                visible={showNewChatModal}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setShowNewChatModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Nova Mensagem</Text>
                            <TouchableOpacity onPress={() => setShowNewChatModal(false)}>
                                <Ionicons name="close" size={24} color="#6b7280" />
                            </TouchableOpacity>
                        </View>
                        <Text style={styles.modalSubtitle}>Digite o Nick do usuário para iniciar uma nova conversa.</Text>

                        <TextInput
                            style={styles.input}
                            placeholder="Ex: joaosilva"
                            value={targetNick}
                            onChangeText={setTargetNick}
                            autoCapitalize="none"
                            autoCorrect={false}
                            placeholderTextColor="#9ca3af"
                        />

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.confirmButton]}
                                onPress={startNewChat}
                                disabled={creatingChat}
                            >
                                {creatingChat ? (
                                    <ActivityIndicator color="#fff" size="small" />
                                ) : (
                                    <Text style={styles.confirmButtonText}>Iniciar Conversa</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

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

            <ReportReasonModal
                visible={showReportReasonModal}
                targetType="user"
                onClose={() => setShowReportReasonModal(false)}
                onSelectReason={submitUserReport}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f3f4fa',
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center'
    },
    headerWrapper: {
        paddingTop: 60,
        paddingHorizontal: 24,
        paddingBottom: 24,
        borderBottomLeftRadius: 32,
        borderBottomRightRadius: 32,
        overflow: 'hidden',
        position: 'relative',
        shadowColor: '#4f46e5',
        shadowOpacity: 0.3,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
        marginBottom: 16,
    },
    blobOne: {
        position: 'absolute',
        top: -60,
        right: -40,
        width: 180,
        height: 180,
        borderRadius: 90,
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    blobTwo: {
        position: 'absolute',
        bottom: -70,
        left: -50,
        width: 160,
        height: 160,
        borderRadius: 80,
        backgroundColor: 'rgba(255,255,255,0.06)',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: '800',
        color: '#fff'
    },
    newMessageBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#fff',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 5,
    },
    list: {
        paddingBottom: 20,
        paddingHorizontal: 20,
        flexGrow: 1
    },
    conversationItem: {
        flexDirection: 'row',
        padding: 16,
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 20,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#f0f1f8',
        shadowColor: '#4b4b76',
        shadowOpacity: 0.05,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
    },
    avatarContainer: {
        marginRight: 16,
        position: 'relative',
    },
    avatarPlaceholder: {
        width: 54,
        height: 54,
        borderRadius: 27,
        justifyContent: 'center',
        alignItems: 'center',
    },
    onlineBadge: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: '#ef4444',
        borderWidth: 2,
        borderColor: '#fff',
    },
    contentContainer: {
        flex: 1,
    },
    rowTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    name: {
        fontSize: 16,
        fontWeight: '600',
        color: '#374151',
    },
    nameUnread: {
        fontWeight: '800',
        color: '#1f2937',
    },
    time: {
        fontSize: 12,
        color: '#9ca3af',
    },
    timeUnread: {
        color: '#6366f1',
        fontWeight: '700',
    },
    optionsBtn: {
        paddingLeft: 12,
        paddingVertical: 4,
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
    },
    lastMessageUnread: {
        color: '#4b5563',
        fontWeight: '600',
    },
    unreadBadge: {
        backgroundColor: '#ef4444',
        borderRadius: 12,
        minWidth: 24,
        height: 24,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 6,
    },
    unreadText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: 'bold',
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 60,
    },
    emptyIconBox: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#eef2ff',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
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
        textAlign: 'center',
        paddingHorizontal: 40,
    },
    // Modal Styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'center',
        alignItems: 'center'
    },
    modalContent: {
        width: '85%',
        backgroundColor: '#fff',
        borderRadius: 24,
        padding: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 5
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1f2937'
    },
    modalSubtitle: {
        fontSize: 14,
        color: '#6b7280',
        marginBottom: 20
    },
    input: {
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 12,
        padding: 14,
        fontSize: 16,
        marginBottom: 24,
        backgroundColor: '#f9fafb',
        color: '#1f2937'
    },
    modalButtons: {
        flexDirection: 'row',
    },
    modalButton: {
        paddingVertical: 14,
        borderRadius: 12,
        flex: 1,
        alignItems: 'center',
    },
    confirmButton: {
        backgroundColor: '#6366f1'
    },
    confirmButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
    // Options Modal
    optionsContent: {
        width: '80%',
        backgroundColor: '#fff',
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
