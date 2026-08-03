import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator, Image, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Place, User, Meeting } from '@/src/types';

interface PlaceModalProps {
    visible: boolean;
    onClose: () => void;
    place: Place | null;
    loadingProfiles: boolean;
    frequentersProfiles: User[];
    placeEvents?: Meeting[];
    onSaveHabit?: (periods: string[]) => void;
    onCreateEventPress: () => void;
}

export function PlaceModal({
    visible,
    onClose,
    place,
    loadingProfiles,
    frequentersProfiles,
    placeEvents = [],
    onSaveHabit,
    onCreateEventPress
}: PlaceModalProps) {
    const [isPickingHabit, setIsPickingHabit] = React.useState(false);
    const [selectedPeriods, setSelectedPeriods] = React.useState<string[]>([]);
    
    // Reset state when modal opens/closes
    React.useEffect(() => {
        setIsPickingHabit(false);
        setSelectedPeriods([]);
    }, [visible, place]);

    if (!place) return null;

    return (
        <Modal
            animationType="slide"
            transparent={true}
            visible={visible}
            onRequestClose={onClose}
        >
            <SafeAreaView style={styles.modalOverlay} edges={['bottom']}>
                <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentInner} showsVerticalScrollIndicator={false}>
                    <View style={styles.modalHeader}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.modalTitle}>{place.name}</Text>
                            <Text style={{ color: '#6B7280', fontSize: 13, marginTop: 4 }}>
                                {place.vocations?.join(', ') || 'Local de encontro'}
                            </Text>
                        </View>
                        <TouchableOpacity onPress={onClose}>
                            <Ionicons name="close" size={24} color="#6B7280" />
                        </TouchableOpacity>
                    </View>

                    {/* Mostrar Fundador se houver */}
                    {place.founderId && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7', padding: 12, borderRadius: 8, marginBottom: 16 }}>
                            <Ionicons name="star" size={20} color="#F59E0B" style={{ marginRight: 8 }} />
                            <Text style={{ color: '#92400E', fontWeight: 'bold' }}>
                                Lugar fundado por {place.founderName || 'um Pioneiro'}
                            </Text>
                        </View>
                    )}

                    {loadingProfiles ? (
                        <ActivityIndicator size="small" color="#4F46E5" style={{ marginBottom: 20 }} />
                    ) : frequentersProfiles.length > 0 ? (
                        <View style={{ marginBottom: 20 }}>
                            <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#374151', marginBottom: 12 }}>
                                Frequentadores
                            </Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                                {frequentersProfiles.map(prof => (
                                    <TouchableOpacity key={prof.uid} onPress={() => { onClose(); router.push(`/public-profile/${prof.uid}` as any); }} style={{ alignItems: 'center', width: 60 }}>
                                        {prof.photoURL ? (
                                            <Image source={{ uri: prof.photoURL }} style={{ width: 44, height: 44, borderRadius: 22 }} />
                                        ) : (
                                            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center' }}>
                                                <Text style={{ fontSize: 18, color: '#9CA3AF', fontWeight: 'bold' }}>{prof.displayName?.charAt(0) || 'U'}</Text>
                                            </View>
                                        )}
                                        <Text style={{ fontSize: 11, color: '#4B5563', marginTop: 4, textAlign: 'center' }} numberOfLines={1}>
                                            {(prof as any).nick || prof.displayName?.split(' ')[0]}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    ) : (
                        <View style={{ backgroundColor: '#F3F4F6', padding: 16, borderRadius: 12, marginBottom: 20, alignItems: 'center' }}>
                            <Ionicons name="planet" size={32} color="#9CA3AF" style={{ marginBottom: 8 }} />
                            <Text style={{ color: '#4B5563', textAlign: 'center', fontSize: 15 }}>
                                Este lugar ainda não tem frequentadores regulares.
                            </Text>
                        </View>
                    )}

                    {/* Habit Picker Inline */}
                    {!isPickingHabit ? (
                        <TouchableOpacity 
                            style={{ backgroundColor: '#DCFCE7', paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginBottom: 20 }}
                            onPress={() => setIsPickingHabit(true)}
                        >
                            <Text style={{ color: '#166534', fontWeight: 'bold' }}>Eu costumo frequentar este lugar</Text>
                        </TouchableOpacity>
                    ) : (
                        <View style={{ backgroundColor: '#F0FDF4', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#BBF7D0', marginBottom: 20 }}>
                            <Text style={{ color: '#15803D', fontWeight: 'bold', marginBottom: 8 }}>Quando você costuma vir aqui?</Text>
                            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                                {['Manhã', 'Tarde', 'Noite'].map(period => (
                                    <TouchableOpacity 
                                        key={period} 
                                        style={[styles.periodChip, selectedPeriods.includes(period) && styles.periodChipSelected]}
                                        onPress={() => {
                                            setSelectedPeriods(prev => 
                                                prev.includes(period) ? prev.filter(p => p !== period) : [...prev, period]
                                            );
                                        }}
                                    >
                                        <Text style={[styles.periodText, selectedPeriods.includes(period) && styles.periodTextSelected]}>{period}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                                <TouchableOpacity 
                                    style={{ flex: 1, padding: 10, alignItems: 'center' }}
                                    onPress={() => setIsPickingHabit(false)}
                                >
                                    <Text style={{ color: '#6B7280', fontWeight: 'bold' }}>Cancelar</Text>
                                </TouchableOpacity>
                                <TouchableOpacity 
                                    style={{ flex: 1, backgroundColor: '#16A34A', padding: 10, borderRadius: 8, alignItems: 'center', opacity: selectedPeriods.length > 0 ? 1 : 0.5 }}
                                    disabled={selectedPeriods.length === 0}
                                    onPress={() => {
                                        if (onSaveHabit) onSaveHabit(selectedPeriods);
                                        setIsPickingHabit(false);
                                    }}
                                >
                                    <Text style={{ color: '#fff', fontWeight: 'bold' }}>Salvar Rotina</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}

                    {/* Eventos Futuros Neste Local */}
                    {placeEvents.length > 0 && (
                        <View style={{ marginBottom: 20 }}>
                            <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#374151', marginBottom: 12 }}>
                                Eventos Futuros Aqui
                            </Text>
                            {placeEvents.map(evt => (
                                <TouchableOpacity key={evt.id} onPress={() => { onClose(); router.push(`/event/${evt.id}`); }} style={styles.eventItem}>
                                    <View style={styles.eventDateBox}>
                                        <Text style={styles.eventDay}>{evt.date?.split('-')[2] || '?'}</Text>
                                        <Text style={styles.eventMonth}>{evt.date?.split('-')[1] || '?'}</Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.eventTitle} numberOfLines={1}>{evt.title}</Text>
                                        <Text style={styles.eventTime}>{evt.time || 'Sem horário'} • {evt.attendees?.length || 0} confirmados</Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}

                    <TouchableOpacity 
                        style={{ marginTop: 16, alignSelf: 'center', backgroundColor: '#EEF2FF', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 }}
                        onPress={onCreateEventPress}
                    >
                        <Text style={{ color: '#4F46E5', fontWeight: 'bold', fontSize: 16 }}>Criar Evento Neste Local</Text>
                    </TouchableOpacity>
                </ScrollView>
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalContent: { width: '100%', maxHeight: '88%', backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
    modalContentInner: { padding: 24, paddingBottom: 28 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#111827' },
    eventItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', padding: 12, borderRadius: 12, marginBottom: 8 },
    eventDateBox: { backgroundColor: '#EEF2FF', width: 44, height: 44, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    eventDay: { fontSize: 16, fontWeight: 'bold', color: '#4F46E5', lineHeight: 18 },
    eventMonth: { fontSize: 10, color: '#4F46E5', textTransform: 'uppercase' },
    eventTitle: { fontSize: 15, fontWeight: '600', color: '#1F2937', marginBottom: 4 },
    eventTime: { fontSize: 13, color: '#6B7280' },
    periodChip: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#86EFAC', alignItems: 'center' },
    periodChipSelected: { backgroundColor: '#16A34A', borderColor: '#16A34A' },
    periodText: { fontSize: 14, color: '#166534' },
    periodTextSelected: { color: '#fff', fontWeight: 'bold' },
});
