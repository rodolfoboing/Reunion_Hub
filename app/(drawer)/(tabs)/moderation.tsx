import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { db } from '../../../src/services/firebaseConfig';
import { collection, getDocs, query, orderBy, deleteDoc, doc, getDoc } from 'firebase/firestore';

type AggregatedReport = {
    targetId: string;
    targetName: string;
    type: 'user' | 'event';
    reportIds: string[];
    count: number;
    lastReportDate: any;
};

export default function ModerationScreen() {
    const [aggregatedUsers, setAggregatedUsers] = useState<AggregatedReport[]>([]);
    const [aggregatedEvents, setAggregatedEvents] = useState<AggregatedReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'users' | 'events'>('users');

    const fetchReports = async () => {
        setLoading(true);
        try {
            const q = query(collection(db, 'reports'), orderBy('createdAt', 'desc'));
            const querySnapshot = await getDocs(q);
            
            const userGroups: Record<string, AggregatedReport> = {};
            const eventGroups: Record<string, AggregatedReport> = {};

            // Fetch target names dynamically
            // Note: In a production app, fetching names per ID inside a loop should be batched
            // but for MVP moderation panel this is fine.
            const fetchTargetName = async (type: string, id: string) => {
                try {
                    const col = type === 'user' ? 'users' : 'meetings';
                    const snap = await getDoc(doc(db, col, id));
                    if (snap.exists()) {
                        return type === 'user' 
                            ? (snap.data().nick || snap.data().displayName || 'Usuário Desconhecido')
                            : (snap.data().title || 'Evento Desconhecido');
                    }
                } catch(e) {}
                return type === 'user' ? 'Usuário Desconhecido' : 'Evento Desconhecido';
            };

            for (const document of querySnapshot.docs) {
                const data = document.data();
                const targetId = data.targetId;
                const type = data.type; // 'user' or 'event'
                
                if (!targetId || !type) continue;

                if (type === 'user') {
                    if (!userGroups[targetId]) {
                        userGroups[targetId] = {
                            targetId,
                            targetName: await fetchTargetName('user', targetId),
                            type: 'user',
                            reportIds: [],
                            count: 0,
                            lastReportDate: data.createdAt
                        };
                    }
                    userGroups[targetId].reportIds.push(document.id);
                    userGroups[targetId].count += 1;
                } else if (type === 'event') {
                    if (!eventGroups[targetId]) {
                        eventGroups[targetId] = {
                            targetId,
                            targetName: await fetchTargetName('event', targetId),
                            type: 'event',
                            reportIds: [],
                            count: 0,
                            lastReportDate: data.createdAt
                        };
                    }
                    eventGroups[targetId].reportIds.push(document.id);
                    eventGroups[targetId].count += 1;
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
        fetchReports();
    }, []);

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

    const handleViewTarget = (type: string, targetId: string) => {
        if (type === 'user') {
            router.push(`/public-profile/${targetId}`);
        } else if (type === 'event') {
            router.push(`/event/${targetId}`);
        }
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
                
                <View style={styles.actionsContainer}>
                    <TouchableOpacity 
                        style={styles.viewButton}
                        onPress={() => handleViewTarget(item.type, item.targetId)}
                    >
                        <Ionicons name="eye-outline" size={20} color="#fff" />
                        <Text style={styles.viewButtonText}>Ver {isUser ? 'Perfil' : 'Evento'}</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                        style={styles.deleteButton}
                        onPress={() => handleResolveGroup(item)}
                    >
                        <Ionicons name="checkmark-done-circle-outline" size={20} color="#059669" />
                        <Text style={styles.deleteButtonText}>Ignorar Denúncia</Text>
                    </TouchableOpacity>
                </View>
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
                <TouchableOpacity onPress={fetchReports}>
                    <Ionicons name="refresh" size={24} color="#4f46e5" />
                </TouchableOpacity>
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

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#4f46e5" />
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
    deleteButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ecfdf5',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 12,
        flex: 1,
        marginLeft: 8,
        borderWidth: 1,
        borderColor: '#059669',
    },
    deleteButtonText: {
        color: '#059669',
        fontWeight: 'bold',
        marginLeft: 8,
    },
});
