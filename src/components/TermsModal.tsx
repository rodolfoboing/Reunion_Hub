import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Linking } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';

interface TermsModalProps {
    visible: boolean;
    onClose: () => void;
}

export function TermsModal({ visible, onClose }: TermsModalProps) {
    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <View style={styles.modalContainer}>
                <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Regras de Uso</Text>
                    <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                        <FontAwesome name="times" size={24} color="#6b7280" />
                    </TouchableOpacity>
                </View>
                <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
                    <Text style={styles.termsTitle}>Termos de Uso e Regras da Comunidade</Text>
                    <Text style={styles.termsText}>
                        O Reunion Hub é uma plataforma tecnológica de facilitação social. Ao utilizar nosso aplicativo, você concorda com as seguintes regras e isenções legais:
                    </Text>
                    
                    <Text style={styles.termsSubtitle}>1. Isenção de Responsabilidade (Assumption of Risk)</Text>
                    <Text style={styles.termsText}>
                        O Reunion Hub atua ÚNICA e EXCLUSIVAMENTE como uma ferramenta para conectar pessoas com interesses comuns. Não somos organizadores, anfitriões ou responsáveis por qualquer evento, encontro ou atividade criada pelos usuários. O aplicativo NÃO se responsabiliza civil ou criminalmente por acidentes, danos, prejuízos, assédios ou qualquer incidente ocorrido no mundo offline em decorrência do uso do app. Você assume integralmente o risco ao participar ou organizar eventos.
                    </Text>

                    <Text style={styles.termsSubtitle}>2. Maioridade Legal e Segurança</Text>
                    <Text style={styles.termsText}>
                        O uso deste aplicativo é restrito a maiores de 18 anos. Recomendamos fortemente que os encontros ocorram em locais públicos e seguros. Nunca compartilhe informações financeiras ou documentos pessoais no chat.
                    </Text>

                    <Text style={styles.termsSubtitle}>3. Conteúdo Ilegal e Imagens</Text>
                    <Text style={styles.termsText}>
                        É ESTRITAMENTE PROIBIDO o upload de imagens (perfil ou eventos) e o envio de mensagens contendo: pornografia, nudez, violência, apologia às drogas, prostituição, crimes, direitos autorais de terceiros ou qualquer conteúdo ilícito. Infratores serão banidos permanentemente sem aviso prévio.
                    </Text>

                    <Text style={styles.termsSubtitle}>4. Uso do Chat e Assédio</Text>
                    <Text style={styles.termsText}>
                        Temos tolerância ZERO para assédio, extorsão, bullying, ameaças ou discursos de ódio. O chat privado é para networking. Caso sofra qualquer tipo de abuso, utilize o recurso de "Denunciar".
                    </Text>

                    <Text style={styles.termsSubtitle}>5. Spam e Marketing</Text>
                    <Text style={styles.termsText}>
                        O Reunion Hub é para CONEXÕES REAIS. É proibido o uso da plataforma para panfletagem digital, pirâmides financeiras, envio massivo de spam, ou criação de eventos com intuito puramente comercial e agressivo sem valor de networking.
                    </Text>

                    <TouchableOpacity 
                        style={styles.privacyButton}
                        onPress={() => Linking.openURL('https://sites.google.com/view/sosfiber-softwares/politica-de-privacidade')}
                    >
                        <FontAwesome name="external-link" size={16} color="#4f46e5" />
                        <Text style={styles.privacyButtonText}>Ler Política de Privacidade Externa</Text>
                    </TouchableOpacity>
                    
                    <View style={{ height: 60 }} />
                </ScrollView>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalContainer: { 
        flex: 1, 
        backgroundColor: '#fff', 
        paddingTop: 50 
    },
    modalHeader: { 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        paddingHorizontal: 24, 
        paddingBottom: 16, 
        borderBottomWidth: 1, 
        borderBottomColor: '#f3f4f6' 
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
    termsTitle: { 
        fontSize: 18, 
        fontWeight: 'bold', 
        color: '#4f46e5', 
        marginBottom: 12 
    },
    termsSubtitle: { 
        fontSize: 16, 
        fontWeight: 'bold', 
        color: '#1f2937', 
        marginTop: 24, 
        marginBottom: 8 
    },
    termsText: { 
        fontSize: 15, 
        color: '#4b5563', 
        lineHeight: 22 
    },
    privacyButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#e0e7ff',
        padding: 16,
        borderRadius: 12,
        marginTop: 32,
        marginBottom: 16
    },
    privacyButtonText: {
        color: '#4f46e5',
        fontWeight: 'bold',
        marginLeft: 8,
        fontSize: 15
    }
});
