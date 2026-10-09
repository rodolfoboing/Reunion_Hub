import React from 'react';
import { Alert, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { ExternalEvent } from '@/src/services/ticketmasterEventService';
import { STRINGS } from '@/src/constants/strings';

type Props = {
    event: ExternalEvent | null;
    onClose: () => void;
    onCreateMeeting: (event: ExternalEvent) => void;
};

export function ExternalEventModal({ event, onClose, onCreateMeeting }: Props) {
    if (!event) return null;
    const [year, month, day] = event.localDate.split('-');
    const [suggestedYear, suggestedMonth, suggestedDay] = event.suggestedDate.split('-');
    const showConvertedTime = Boolean(event.suggestedTime
        && (event.suggestedDate !== event.localDate || event.suggestedTime !== event.localTime));
    const openSource = () => {
        if (!event.externalUrl) return;
        Linking.openURL(event.externalUrl).catch(() => {
            Alert.alert('Link indisponível', 'Não foi possível abrir a página do evento.');
        });
    };
    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
                    <Pressable style={styles.card} onPress={() => undefined}>
                        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.cardContent}>
                        <View style={styles.header}>
                            <Text style={styles.source}>EVENTO EXTERNO · VIA TICKETMASTER</Text>
                            <TouchableOpacity onPress={onClose} accessibilityLabel="Fechar detalhes do evento externo">
                                <Ionicons name="close" size={24} color="#475569" />
                            </TouchableOpacity>
                        </View>
                        {event.imageUrl && <Image source={{ uri: event.imageUrl }} style={styles.image} resizeMode="cover" />}
                        {event.imageAttribution && <Text style={styles.attribution}>Imagem: {event.imageAttribution}</Text>}
                        <Text style={styles.title}>{event.title}</Text>
                        <Text style={styles.detail}><Ionicons name="calendar-outline" size={16} /> {day}/{month}/{year} · {event.localTime || 'Horário a confirmar'}{event.localTime ? ` (${STRINGS.EXTERNAL_EVENT_LOCAL_TIME_LABEL})` : ''}</Text>
                        {showConvertedTime && <Text style={styles.detail}>{STRINGS.EXTERNAL_EVENT_APP_TIME_LABEL}: {suggestedDay}/{suggestedMonth}/{suggestedYear} · {event.suggestedTime}</Text>}
                        <Text style={styles.detail}><Ionicons name="location-outline" size={16} /> {event.venueName}</Text>
                        {event.category && <Text style={styles.category}>{event.category}</Text>}
                        <Text style={styles.note}>{event.suggestedTime ? STRINGS.EXTERNAL_EVENT_WITH_TIME_NOTE : STRINGS.EXTERNAL_EVENT_WITHOUT_TIME_NOTE}</Text>
                        <TouchableOpacity style={styles.createButton} onPress={() => onCreateMeeting(event)} accessibilityRole="button">
                            <Text style={styles.createText}>Criar encontro no Reunion Hub</Text>
                        </TouchableOpacity>
                        {event.externalUrl && (
                            <TouchableOpacity style={styles.linkButton} onPress={openSource} accessibilityRole="link">
                                <Text style={styles.linkText}>Ver página do evento</Text>
                                <Ionicons name="open-outline" size={16} color="#6D28D9" />
                            </TouchableOpacity>
                        )}
                        </ScrollView>
                    </Pressable>
                </SafeAreaView>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.55)' },
    safeArea: { flex: 1, width: '100%', justifyContent: 'flex-end' },
    card: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' },
    scroll: { flexShrink: 1 },
    cardContent: { padding: 20, paddingBottom: 32, gap: 10 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    source: { color: '#7C3AED', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
    image: { width: '100%', height: 160, borderRadius: 12 },
    attribution: { color: '#64748B', fontSize: 11 },
    title: { color: '#111827', fontSize: 21, fontWeight: '700' },
    detail: { color: '#334155', fontSize: 15 },
    category: { alignSelf: 'flex-start', color: '#6D28D9', backgroundColor: '#F3E8FF', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, fontSize: 12 },
    note: { color: '#475569', fontSize: 13, lineHeight: 19 },
    createButton: { backgroundColor: '#7C3AED', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 4 },
    createText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    linkButton: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', padding: 8 },
    linkText: { color: '#6D28D9', fontSize: 14, fontWeight: '600' },
});
