import { Ionicons } from '@expo/vector-icons';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ReportTargetType } from '@/src/types';

export type { ReportTargetType } from '@/src/types';

type ReportReasonModalProps = {
    visible: boolean;
    targetType: ReportTargetType;
    onClose: () => void;
    onSelectReason: (reason: string) => void;
};

const REPORT_REASONS: Record<ReportTargetType, readonly string[]> = {
    event: [
        'Informação enganosa ou incorreta',
        'Local, data ou link inadequado',
        'Fraude ou pedido de dinheiro',
        'Risco à segurança ou atividade ilegal',
        'Conteúdo ofensivo ou discriminatório',
        'Outro motivo',
    ],
    user: [
        'Assédio, ameaça ou perseguição',
        'Discurso de ódio ou discriminação',
        'Fraude ou pedido de dinheiro',
        'Conteúdo sexual ou inadequado',
        'Spam ou publicidade não solicitada',
        'Outro motivo',
    ],
};

export function ReportReasonModal({ visible, targetType, onClose, onSelectReason }: ReportReasonModalProps) {
    const title = targetType === 'event' ? 'Denunciar evento' : 'Denunciar usuário';

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <SafeAreaView style={styles.overlay} edges={['bottom']}>
                <View style={styles.sheet}>
                    <View style={styles.header}>
                        <View style={styles.iconContainer}>
                            <Ionicons name="flag-outline" size={20} color="#DC2626" />
                        </View>
                        <Text style={styles.title}>{title}</Text>
                        <TouchableOpacity onPress={onClose} accessibilityLabel="Fechar motivos de denúncia">
                            <Ionicons name="close" size={24} color="#6B7280" />
                        </TouchableOpacity>
                    </View>
                    <Text style={styles.description}>Selecione o motivo que melhor descreve a denúncia.</Text>
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.reasons}>
                        {REPORT_REASONS[targetType].map((reason) => (
                            <TouchableOpacity key={reason} style={styles.reasonButton} onPress={() => onSelectReason(reason)}>
                                <Text style={styles.reasonText}>{reason}</Text>
                                <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                    <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                        <Text style={styles.cancelText}>Cancelar</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,39,0.55)' },
    sheet: { maxHeight: '82%', backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    iconContainer: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2' },
    title: { flex: 1, fontSize: 19, fontWeight: '800', color: '#111827' },
    description: { marginTop: 12, marginBottom: 10, fontSize: 14, lineHeight: 20, color: '#6B7280' },
    reasons: { gap: 8 },
    reasonButton: { minHeight: 52, paddingHorizontal: 14, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    reasonText: { flex: 1, paddingRight: 10, fontSize: 14, fontWeight: '600', color: '#374151' },
    cancelButton: { marginTop: 12, padding: 14, alignItems: 'center', borderRadius: 14, backgroundColor: '#F3F4F6' },
    cancelText: { fontSize: 15, fontWeight: '700', color: '#4B5563' },
});
