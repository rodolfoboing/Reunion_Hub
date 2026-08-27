import { Ionicons } from '@expo/vector-icons';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type ReputationFeedbackModalProps = {
    visible: boolean;
    delta: number;
    title: string;
    body: string;
    onClose: () => void;
};

export function ReputationFeedbackModal({ visible, delta, title, body, onClose }: ReputationFeedbackModalProps) {
    const isGain = delta > 0;
    const accentColor = isGain ? '#15803D' : '#B91C1C';
    const softColor = isGain ? '#DCFCE7' : '#FEE2E2';
    const iconName = isGain ? 'trending-up-outline' : 'trending-down-outline';
    const formattedDelta = `${isGain ? '+' : ''}${delta}`;

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
                <View style={styles.dialog} accessibilityViewIsModal accessibilityRole="alert">
                    <View style={[styles.iconContainer, { backgroundColor: softColor }]}>
                        <Ionicons name={iconName} size={30} color={accentColor} />
                    </View>
                    <Text style={styles.eyebrow}>ALTERAÇÃO DE REPUTAÇÃO</Text>
                    <Text style={styles.title}>{title}</Text>
                    <View style={[styles.pointsBadge, { backgroundColor: softColor }]}>
                        <Text style={[styles.pointsText, { color: accentColor }]}>{formattedDelta} pontos</Text>
                    </View>
                    <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
                        <Text style={styles.body}>{body}</Text>
                        <Text style={styles.context}>
                            {isGain
                                ? 'Sua reputação ajuda a demonstrar participação responsável na comunidade.'
                                : 'Se você acredita que houve um erro, confira os detalhes do evento e use a opção de denúncia disponível nesta tela.'}
                        </Text>
                    </ScrollView>
                    <TouchableOpacity
                        style={[styles.button, { backgroundColor: accentColor }]}
                        onPress={onClose}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel="Entendi a alteração de reputação"
                    >
                        <Text style={styles.buttonText}>Entendi</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(15,23,42,0.62)' },
    dialog: { maxHeight: '82%', borderRadius: 24, padding: 22, backgroundColor: '#FFF', alignItems: 'center' },
    iconContainer: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
    eyebrow: { color: '#6B7280', fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: 0.8, textAlign: 'center' },
    title: { marginTop: 5, color: '#111827', fontSize: 22, lineHeight: 28, fontWeight: '900', textAlign: 'center' },
    pointsBadge: { marginTop: 12, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 7 },
    pointsText: { fontSize: 17, lineHeight: 22, fontWeight: '900' },
    bodyScroll: { flexGrow: 0, alignSelf: 'stretch', marginTop: 16 },
    bodyContent: { paddingBottom: 4 },
    body: { color: '#374151', fontSize: 15, lineHeight: 23, textAlign: 'center' },
    context: { marginTop: 14, padding: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: '#F3F4F6', color: '#4B5563', fontSize: 13, lineHeight: 19, textAlign: 'center' },
    button: { alignSelf: 'stretch', minHeight: 50, marginTop: 18, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    buttonText: { color: '#FFF', fontSize: 15, fontWeight: '900' },
});
