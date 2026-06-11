import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { sendLocalNotification } from '../../src/utils/Notifications';
import { LinearGradient } from 'expo-linear-gradient';

// Mock Data
const MOCK_NOTIFICATIONS = [
    {
        id: '1',
        title: 'Bem-vindo ao Reunion Hub!',
        body: 'Complete seu perfil para encontrar eventos incríveis.',
        time: 'Há 2 horas',
        read: false,
        icon: 'person-add-outline'
    },
    {
        id: '2',
        title: 'Evento Próximo',
        body: 'O evento "Tech Meetup" começa em 30 minutos.',
        time: 'Há 5 horas',
        read: true,
        icon: 'calendar-outline'
    },
    {
        id: '3',
        title: 'Nova Conexão',
        body: 'João Silva aceitou seu convite.',
        time: 'Ontem',
        read: true,
        icon: 'people-outline'
    }
];

export default function NotificationsScreen() {
    const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);

    const handleTestNotification = async () => {
        await sendLocalNotification(
            'Teste de Notificação 🔔',
            'Esta é uma notificação de teste do Reunion Hub! Funciona mesmo com o app fechado (se configurado).',
            2 // 2 segundos de delay
        );
    };

    const renderItem = ({ item }: { item: typeof MOCK_NOTIFICATIONS[0] }) => (
        <View style={[styles.card, !item.read && styles.unreadCard]}>
            <View style={[styles.iconContainer, !item.read && styles.unreadIconContainer]}>
                <Ionicons name={item.icon as any} size={24} color={item.read ? '#6B7280' : '#4F46E5'} />
            </View>
            <View style={styles.contentContainer}>
                <View style={styles.headerRow}>
                    <Text style={[styles.cardTitle, !item.read && styles.unreadText]}>{item.title}</Text>
                    <Text style={styles.timeText}>{item.time}</Text>
                </View>
                <Text style={styles.cardBody} numberOfLines={2}>{item.body}</Text>
            </View>
            {!item.read && <View style={styles.dot} />}
        </View>
    );

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Notificações</Text>
                <TouchableOpacity>
                    <Ionicons name="settings-outline" size={24} color="#1F2937" />
                </TouchableOpacity>
            </View>

            <FlatList
                data={notifications}
                renderItem={renderItem}
                keyExtractor={item => item.id}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Ionicons name="notifications-off-outline" size={48} color="#9CA3AF" />
                        <Text style={styles.emptyText}>Nenhuma notificação por enquanto</Text>
                    </View>
                }
            />

            <View style={styles.footer}>
                <TouchableOpacity style={styles.button} onPress={handleTestNotification}>
                    <LinearGradient
                        colors={['#4F46E5', '#4338CA']}
                        style={styles.gradientButton}
                    >
                        <Ionicons name="notifications-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
                        <Text style={styles.buttonText}>Testar Notificação</Text>
                    </LinearGradient>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F3F4F6',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        backgroundColor: '#FFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
    },
    listContent: {
        padding: 16,
        paddingBottom: 100,
    },
    card: {
        flexDirection: 'row',
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
        borderLeftWidth: 4,
        borderLeftColor: 'transparent',
    },
    unreadCard: {
        borderLeftColor: '#4F46E5',
        backgroundColor: '#EEF2FF',
    },
    iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#F3F4F6',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    unreadIconContainer: {
        backgroundColor: '#E0E7FF',
    },
    contentContainer: {
        flex: 1,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#374151',
        flex: 1,
        marginRight: 8,
    },
    unreadText: {
        color: '#111827',
        fontWeight: '700',
    },
    cardBody: {
        fontSize: 14,
        color: '#6B7280',
        lineHeight: 20,
    },
    timeText: {
        fontSize: 12,
        color: '#9CA3AF',
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#4F46E5',
        marginLeft: 8,
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 60,
    },
    emptyText: {
        marginTop: 16,
        fontSize: 16,
        color: '#6B7280',
    },
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 20,
        backgroundColor: 'transparent', // Gradient implies custom button, footer container can be transparent or have blur
    },
    button: {
        shadowColor: '#4F46E5',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    gradientButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        borderRadius: 16,
    },
    buttonText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: 'bold',
    },
});
