import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { FontAwesome, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

interface ManualModalProps {
    visible: boolean;
    onClose: () => void;
    isFirstTime?: boolean;
}

export function ManualModal({ visible, onClose, isFirstTime = false }: ManualModalProps) {
    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={isFirstTime ? () => {} : onClose}
        >
            <View style={styles.modalContainer}>
                <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Manual do Usuário</Text>
                    {!isFirstTime && (
                        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                            <FontAwesome name="times" size={24} color="#6b7280" />
                        </TouchableOpacity>
                    )}
                </View>
                
                <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
                    <Text style={styles.welcomeTitle}>Bem-vindo ao Reunion Hub! 👋</Text>
                    <Text style={styles.introText}>
                        O Reunion Hub é o seu ponto de encontro para descobrir, criar e participar de eventos sociais (meetups). Aqui vai um guia rápido de como aproveitar ao máximo e evitar punições na nossa comunidade.
                    </Text>

                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <View style={[styles.iconContainer, { backgroundColor: '#fee2e2' }]}>
                                <MaterialCommunityIcons name="heart-broken" size={20} color="#ef4444" />
                            </View>
                            <Text style={styles.sectionTitle}>1. Sistema Anti-Furo (Atenção!)</Text>
                        </View>
                        <Text style={styles.sectionText}>
                            Para garantir que as pessoas compareçam aos eventos, temos um sistema rigoroso de reputação:
                        </Text>
                        <View style={styles.bulletPoint}>
                            <FontAwesome name="check-circle" size={16} color="#10b981" />
                            <Text style={styles.bulletText}><Text style={styles.bold}>Check-in (+10 pts):</Text> No dia do evento, confirme sua chegada fazendo Check-in pelo app.</Text>
                        </View>
                        <View style={styles.bulletPoint}>
                            <FontAwesome name="times-circle" size={16} color="#ef4444" />
                            <Text style={styles.bulletText}><Text style={styles.bold}>No-Show (-20 pts):</Text> Confirmou presença e não fez Check-in? Você perderá pontos pesados quando o evento acabar.</Text>
                        </View>
                        <View style={styles.bulletPoint}>
                            <FontAwesome name="ban" size={16} color="#6b7280" />
                            <Text style={styles.bulletText}><Text style={styles.bold}>Bloqueio (-50 pts):</Text> Usuários que furam muitos eventos perdem o direito de confirmar presença em novos encontros.</Text>
                        </View>
                    </View>

                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <View style={[styles.iconContainer, { backgroundColor: '#dbeafe' }]}>
                                <FontAwesome name="map-marker" size={20} color="#3b82f6" />
                            </View>
                            <Text style={styles.sectionTitle}>2. Explorar e Descobrir</Text>
                        </View>
                        <Text style={styles.sectionText}>
                            Na aba <Text style={styles.bold}>Explorar</Text>, você vê o mapa interativo com duas possibilidades principais:
                        </Text>
                        <View style={styles.bulletPoint}>
                            <FontAwesome name="users" size={16} color="#8b5cf6" />
                            <Text style={styles.bulletText}><Text style={styles.bold}>Eventos da Comunidade:</Text> Use os filtros de categoria no topo para encontrar meetups criados por outros usuários, ou veja eventos acontecendo AGORA (eles pulsam com fogo no mapa!).</Text>
                        </View>
                        <View style={styles.bulletPoint}>
                            <FontAwesome name="building" size={16} color="#10b981" />
                            <Text style={styles.bulletText}><Text style={styles.bold}>Descobrir Locais (Google/Overpass):</Text> Você pode ativar a busca por locais "vagos" (praças, quadras, bares) que vêm do Google Maps. Perfeito para você conhecer lugares novos e organizar seu próprio evento lá!</Text>
                        </View>
                    </View>

                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <View style={[styles.iconContainer, { backgroundColor: '#fef3c7' }]}>
                                <FontAwesome name="trophy" size={20} color="#d97706" />
                            </View>
                            <Text style={styles.sectionTitle}>3. Seja um Pioneiro (Fundador)</Text>
                        </View>
                        <Text style={styles.sectionText}>
                            Ao criar um evento em um "Local de Interesse" (ex: um bar ou parque) e finalizá-lo com sucesso pela primeira vez, você ganha o título eterno de <Text style={styles.bold}>Fundador</Text> daquele local no app!
                        </Text>
                    </View>

                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <View style={[styles.iconContainer, { backgroundColor: '#f3e8ff' }]}>
                                <FontAwesome name="calendar" size={20} color="#a855f7" />
                            </View>
                            <Text style={styles.sectionTitle}>4. Agenda Inteligente</Text>
                        </View>
                        <Text style={styles.sectionText}>
                            Sua <Text style={styles.bold}>Agenda</Text> não mostra apenas onde você vai. Se você estiver sem eventos, o app vai sugerir encontros com base nos seus interesses e na sua localização!
                        </Text>
                    </View>

                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <View style={[styles.iconContainer, { backgroundColor: '#e0e7ff' }]}>
                                <Ionicons name="chatbubbles" size={20} color="#4338ca" />
                            </View>
                            <Text style={styles.sectionTitle}>5. Mensagens e Segurança</Text>
                        </View>
                        <Text style={styles.sectionText}>
                            No menu Mensagens, você pode conversar em modo privado com outros participantes. Basta buscar pelo Nickname!
                        </Text>
                        <View style={styles.bulletPoint}>
                            <FontAwesome name="shield" size={16} color="#10b981" />
                            <Text style={styles.bulletText}>Use os botões de <Text style={styles.bold}>Bloquear</Text> e <Text style={styles.bold}>Denunciar</Text> no menu do chat para reportar assédio ou abusos.</Text>
                        </View>
                    </View>

                    {isFirstTime && (
                        <View style={styles.firstTimeContainer}>
                            <Text style={styles.firstTimeNote}>Você pode consultar este manual a qualquer momento acessando a aba Perfil.</Text>
                            <TouchableOpacity onPress={onClose} activeOpacity={0.8} style={{width: '100%'}}>
                                <LinearGradient
                                    colors={['#6366f1', '#4f46e5']}
                                    style={styles.understandButton}
                                >
                                    <Text style={styles.understandButtonText}>Li e Entendi as Regras</Text>
                                </LinearGradient>
                            </TouchableOpacity>
                        </View>
                    )}
                </ScrollView>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalContainer: {
        flex: 1,
        backgroundColor: '#f9fafb',
        paddingTop: 50
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        backgroundColor: '#fff'
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1f2937'
    },
    closeBtn: {
        padding: 4,
    },
    modalContent: {
        padding: 24
    },
    welcomeTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#4338ca',
        marginBottom: 12
    },
    introText: {
        fontSize: 15,
        color: '#4b5563',
        lineHeight: 22,
        marginBottom: 32
    },
    section: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 20,
        marginBottom: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12
    },
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12
    },
    sectionTitle: {
        fontSize: 17,
        fontWeight: 'bold',
        color: '#1f2937',
        flex: 1
    },
    sectionText: {
        fontSize: 15,
        color: '#4b5563',
        lineHeight: 22,
        marginBottom: 12
    },
    bulletPoint: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 10,
        paddingRight: 12
    },
    bulletText: {
        fontSize: 14,
        color: '#4b5563',
        lineHeight: 20,
        marginLeft: 10,
        flex: 1
    },
    bold: {
        fontWeight: 'bold',
        color: '#1f2937'
    },
    firstTimeContainer: {
        marginTop: 16,
        marginBottom: 32,
        alignItems: 'center',
        width: '100%',
    },
    firstTimeNote: {
        fontSize: 13,
        color: '#6b7280',
        textAlign: 'center',
        marginBottom: 16
    },
    understandButton: {
        paddingVertical: 16,
        paddingHorizontal: 32,
        borderRadius: 30,
        width: '100%',
        alignItems: 'center',
        shadowColor: '#4f46e5',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5
    },
    understandButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold'
    }
});
