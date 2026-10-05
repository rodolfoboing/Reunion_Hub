import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { db, functions } from '../../../src/services/firebaseConfig';
import { collection, getDocs, query, orderBy, deleteDoc, doc, getDoc, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Report, ReportTargetType } from '../../../src/types';
import { useUserProfile } from '@/src/hooks/useUserProfile';

const REPORTS_FETCH_LIMIT = 100;
const LEGACY_REPORT_REASON = 'Motivo não informado';

type ReportReasonSummary = {
    label: string;
    count: number;
};

type AggregatedReport = {
    targetId: string;
    targetName: string;
    type: ReportTargetType;
    reportIds: string[];
    count: number;
    lastReportDate?: { seconds: number };
    reasons: ReportReasonSummary[];
};

export default function ModerationScreen() {
    const [aggregatedUsers, setAggregatedUsers] = useState<AggregatedReport[]>([]);
    const [aggregatedEvents, setAggregatedEvents] = useState<AggregatedReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'users' | 'events'>('users');
    // Papel e estado de verificação derivam do perfil compartilhado. Esta tela
    // mantinha um `onSnapshot` próprio em `users/{uid}` para ler o MESMO `role`
    // que o layout das abas já lia — dois listeners para um campo.
    const profile = useUserProfile();
    const isStaff = profile?.role === 'admin' || profile?.role === 'moderator';
    // `null` = perfil ainda não chegou. Sem sessão o portão já redireciona ao
    // login, então não há como ficar preso neste estado.
    const checkingAccess = profile === null;

    // Sem acesso não há relatório para carregar: encerra o spinner que começa true.
    useEffect(() => {
        if (!checkingAccess && !isStaff) setLoading(false);
    }, [checkingAccess, isStaff]);

    const fetchReports = async () => {
        setLoading(true);
        try {
            const q = query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(REPORTS_FETCH_LIMIT));
            const querySnapshot = await getDocs(q);
            
            const userGroups: Record<string, AggregatedReport> = {};
            const eventGroups: Record<string, AggregatedReport> = {};

            // Fetch target names dynamically
            // Note: In a production app, fetching names per ID inside a loop should be batched
            // but for MVP moderation panel this is fine.
            const targetNameCache = new Map<string, string>();
            const fetchTargetName = async (type: ReportTargetType, id: string): Promise<string> => {
                const cacheKey = `${type}:${id}`;
                const cachedName = targetNameCache.get(cacheKey);
                if (cachedName) return cachedName;

                try {
                    const col = type === 'user' ? 'users' : 'meetings';
                    const snap = await getDoc(doc(db, col, id));
                    if (snap.exists()) {
                        const name = type === 'user'
                            ? (snap.data().nick || snap.data().displayName || 'Usuário Desconhecido')
                            : (snap.data().title || 'Evento Desconhecido');
                        targetNameCache.set(cacheKey, name);
                        return name;
                    }
                } catch (error) {
                    console.warn('[Moderation] Não foi possível carregar alvo da denúncia:', error);
                }
                const fallbackName = type === 'user' ? 'Usuário Desconhecido' : 'Evento Desconhecido';
                targetNameCache.set(cacheKey, fallbackName);
                return fallbackName;
            };

            for (const document of querySnapshot.docs) {
                const data = document.data() as Omit<Report, 'id'>;
                const targetId = data.targetId;
                const type = data.type;
                
                if (!targetId || (type !== 'user' && type !== 'event')) continue;

                const reportReason = data.reason?.trim() || LEGACY_REPORT_REASON;
                const groups = type === 'user' ? userGroups : eventGroups;

                if (!groups[targetId]) {
                    groups[targetId] = {
                            targetId,
                            targetName: await fetchTargetName(type, targetId),
                            type,
                            reportIds: [],
                            count: 0,
                            lastReportDate: data.createdAt as { seconds: number } | undefined,
                            reasons: []
                        };
                }

                const group = groups[targetId];
                group.reportIds.push(document.id);
                group.count += 1;
                const existingReason = group.reasons.find(({ label }) => label === reportReason);
                if (existingReason) {
                    existingReason.count += 1;
                } else {
                    group.reasons.push({ label: reportReason, count: 1 });
                }
            }
            
            setAggregatedUsers(Object.values(userGroups).sort((a, b) => b.count - a.count));
            setAggregatedEvents(Object.values(eventGroups).sort((a, b) => b.count - a.count));

        } catch (error) {
            console.error('[Moderation] Erro ao buscar denúncias', error);
            Alert.alert('Erro', 'Não foi possível carregar as denúncias.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!isStaff) return;
        fetchReports();
    }, [isStaff]);

    const handleResolveGroup = async (group: AggregatedReport) => {
        Alert.alert(
            'Resolver Denúncias',
            `Deseja deletar permanentemente todas as ${group.count} denúncia(s) contra "${group.targetName}"?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                { 
                    text: 'Resolver', 
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            const deletePromises = group.reportIds.map(id => deleteDoc(doc(db, 'reports', id)));
                            await Promise.all(deletePromises);
                            
                            if (group.type === 'user') {
                                setAggregatedUsers(prev => prev.filter(r => r.targetId !== group.targetId));
                            } else {
                                setAggregatedEvents(prev => prev.filter(r => r.targetId !== group.targetId));
                            }
                        } catch (error) {
                            Alert.alert('Erro', 'Não foi possível deletar as denúncias.');
                        }
                    }
                }
            ]
        );
    };

    const handleViewTarget = (type: ReportTargetType, targetId: string) => {
        if (type === 'user') {
            router.push(`/public-profile/${targetId}`);
        } else if (type === 'event') {
            router.push(`/event/${targetId}`);
        }
    };

    const handleRemoveReportedEvent = (group: AggregatedReport) => {
        Alert.alert(
            'Remover evento',
            `Remover "${group.targetName}" do app? Os participantes serão avisados e o evento deixará de aparecer nas telas públicas.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Remover evento',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            const removeEvent = httpsCallable<{ eventId: string }, { ok: boolean }>(functions, 'removeReportedEvent');
                            await removeEvent({ eventId: group.targetId });
                            setAggregatedEvents((current) => current.filter((item) => item.targetId !== group.targetId));
                            Alert.alert('Evento removido', 'O evento foi removido das áreas públicas e os participantes foram avisados.');
                        } catch (error) {
                            console.error('[Moderation] remove_reported_event_failed', error);
                            Alert.alert('Erro', 'Não foi possível remover este evento.');
                        }
                    },
                },
            ],
        );
    };

    const handleBanUser = (group: AggregatedReport) => {
        Alert.alert(
            'Banir usuário',
            `Banir "${group.targetName}"? A conta será desativada, a sessão será encerrada e a participação dela em eventos, conversas, convites e locais será removida.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Banir usuário',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            const banUser = httpsCallable<{ targetUserId: string }, { ok: boolean }>(functions, 'banUser');
                            await banUser({ targetUserId: group.targetId });
                            setAggregatedUsers((current) => current.filter((item) => item.targetId !== group.targetId));
                            Alert.alert('Usuário banido', 'A conta foi desativada e os dados de participação foram removidos.');
                        } catch (error) {
                            console.error('[Moderation] ban_user_failed', error);
                            Alert.alert('Erro', 'Não foi possível banir este usuário.');
                        }
                    },
                },
            ],
        );
    };

    const renderReportGroup = ({ item }: { item: AggregatedReport }) => {
        const isUser = item.type === 'user';
        const dateStr = item.lastReportDate?.seconds 
            ? new Date(item.lastReportDate.seconds * 1000).toLocaleDateString() 
            : 'Data desconhecida';

        return (
            <View style={styles.reportCard}>
                <View style={styles.reportHeader}>
                    <View style={styles.typeTag}>
                        <Ionicons 
                            name={isUser ? 'person-circle' : 'calendar'} 
                            size={16} 
                            color={isUser ? '#4f46e5' : '#e11d48'} 
                        />
                        <Text style={[styles.typeText, { color: isUser ? '#4f46e5' : '#e11d48' }]}>
                            {isUser ? 'Usuário Reportado' : 'Evento Reportado'}
                        </Text>
                    </View>
                    <Text style={styles.dateText}>Última: {dateStr}</Text>
                </View>

                <Text style={styles.targetName}>{item.targetName}</Text>
                <View style={styles.countBadge}>
                    <Ionicons name="warning" size={16} color="#b91c1c" />
                    <Text style={styles.countText}>
                        {item.count} {item.count === 1 ? 'denúncia' : 'denúncias'}
                    </Text>
                </View>
                <View style={styles.reasonsContainer}>
                    <Text style={styles.reasonsTitle}>Motivos informados</Text>
                    {item.reasons.map((reason) => (
                        <Text key={reason.label} style={styles.reasonText}>
                            {reason.count}× {reason.label}
                        </Text>
                    ))}
                </View>
                
                <View style={styles.actionsContainer}>
                    <TouchableOpacity 
                        style={styles.viewButton}
                        onPress={() => handleViewTarget(item.type, item.targetId)}
                    >
                        <Ionicons name="eye-outline" size={20} color="#fff" />
                        <Text style={styles.viewButtonText}>Ver {isUser ? 'Perfil' : 'Evento'}</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                        style={isUser ? styles.banButton : styles.removeEventButton}
                        onPress={() => isUser ? handleBanUser(item) : handleRemoveReportedEvent(item)}
                    >
                        <Ionicons name={isUser ? "ban-outline" : "trash-outline"} size={20} color="#fff" />
                        <Text style={styles.destructiveButtonText}>{isUser ? 'Banir usuário' : 'Remover evento'}</Text>
                    </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.resolveButton} onPress={() => handleResolveGroup(item)}>
                    <Ionicons name="checkmark-done-circle-outline" size={18} color="#059669" />
                    <Text style={styles.resolveButtonText}>Ignorar denúncias</Text>
                </TouchableOpacity>
            </View>
        );
    };

    const currentData = activeTab === 'users' ? aggregatedUsers : aggregatedEvents;

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#1f2937" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Central de Moderação</Text>
                {isStaff ? (
                    <TouchableOpacity onPress={fetchReports} disabled={loading}>
                        <Ionicons name="refresh" size={24} color={loading ? '#A5B4FC' : '#4f46e5'} />
                    </TouchableOpacity>
                ) : <View style={styles.headerActionPlaceholder} />}
            </View>

            <View style={styles.tabsContainer}>
                <TouchableOpacity 
                    style={[styles.tab, activeTab === 'users' && styles.activeTab]}
                    onPress={() => setActiveTab('users')}
                >
                    <Ionicons name="people" size={20} color={activeTab === 'users' ? '#4f46e5' : '#6b7280'} />
                    <Text style={[styles.tabText, activeTab === 'users' && styles.activeTabText]}>Usuários</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                    style={[styles.tab, activeTab === 'events' && styles.activeTab]}
                    onPress={() => setActiveTab('events')}
                >
                    <Ionicons name="calendar" size={20} color={activeTab === 'events' ? '#4f46e5' : '#6b7280'} />
                    <Text style={[styles.tabText, activeTab === 'events' && styles.activeTabText]}>Eventos</Text>
                </TouchableOpacity>
            </View>

            {checkingAccess || loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#4f46e5" />
                </View>
            ) : !isStaff ? (
                <View style={styles.center}>
                    <MaterialIcons name="lock-outline" size={64} color="#d1d5db" />
                    <Text style={styles.emptyText}>Acesso restrito</Text>
                    <Text style={styles.emptySubtext}>Esta área está disponível somente para a equipe de moderação.</Text>
                </View>
            ) : currentData.length === 0 ? (
                <View style={styles.center}>
                    <MaterialIcons name="security" size={64} color="#d1d5db" />
                    <Text style={styles.emptyText}>Tudo tranquilo por aqui!</Text>
                    <Text style={styles.emptySubtext}>Nenhuma denúncia de {activeTab === 'users' ? 'usuário' : 'evento'} pendente.</Text>
                </View>
            ) : (
                <FlatList
                    data={currentData}
                    keyExtractor={item => item.targetId}
                    renderItem={renderReportGroup}
                    contentContainerStyle={styles.listContainer}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f3f4f6',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        backgroundColor: '#fff',
    },
    backButton: {
        padding: 4,
    },
    headerActionPlaceholder: {
        width: 32,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    tabsContainer: {
        flexDirection: 'row',
        backgroundColor: '#fff',
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    tab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: '#f9fafb',
        marginHorizontal: 4,
    },
    activeTab: {
        backgroundColor: '#eef2ff',
    },
    tabText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6b7280',
        marginLeft: 8,
    },
    activeTabText: {
        color: '#4f46e5',
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#4b5563',
        marginTop: 16,
    },
    emptySubtext: {
        fontSize: 14,
        color: '#6b7280',
        marginTop: 8,
    },
    listContainer: {
        padding: 16,
    },
    reportCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    reportHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    typeTag: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f3f4f6',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    typeText: {
        fontSize: 12,
        fontWeight: 'bold',
        marginLeft: 6,
    },
    dateText: {
        fontSize: 12,
        color: '#9ca3af',
    },
    targetName: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 8,
    },
    countBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fef2f2',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        alignSelf: 'flex-start',
        marginBottom: 16,
    },
    countText: {
        color: '#b91c1c',
        fontWeight: 'bold',
        marginLeft: 6,
        fontSize: 13,
    },
    reasonsContainer: {
        marginBottom: 16,
        padding: 12,
        borderRadius: 10,
        backgroundColor: '#F9FAFB',
    },
    reasonsTitle: {
        marginBottom: 6,
        fontSize: 12,
        fontWeight: '700',
        color: '#4B5563',
        textTransform: 'uppercase',
    },
    reasonText: {
        fontSize: 13,
        lineHeight: 19,
        color: '#374151',
    },
    actionsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    viewButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#4f46e5',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 12,
        flex: 1,
        marginRight: 8,
    },
    viewButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        marginLeft: 8,
    },
    banButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#B91C1C',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 12,
        flex: 1,
        marginLeft: 8,
    },
    removeEventButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#DC2626',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 12,
        flex: 1,
        marginLeft: 8,
    },
    destructiveButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        marginLeft: 8,
    },
    resolveButton: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 10,
        paddingVertical: 8,
    },
    resolveButtonText: {
        color: '#059669',
        fontSize: 13,
        fontWeight: '700',
        marginLeft: 6,
    },
});
