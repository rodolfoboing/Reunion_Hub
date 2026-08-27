import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator, Image, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { HabitSchedule, HabitWeekday, Place, User, Meeting } from '@/src/types';
import { auth } from '@/src/services/firebaseConfig';

const WEEKDAYS: { key: HabitWeekday; label: string }[] = [
    { key: 'monday', label: 'Seg' },
    { key: 'tuesday', label: 'Ter' },
    { key: 'wednesday', label: 'Qua' },
    { key: 'thursday', label: 'Qui' },
    { key: 'friday', label: 'Sex' },
    { key: 'saturday', label: 'Sáb' },
    { key: 'sunday', label: 'Dom' },
];
const PERIODS = ['Manhã', 'Tarde', 'Noite'] as const;

type AttendanceProfile = {
    profile: User;
    scheduleLines: string[];
};

function currentWeekday(): HabitWeekday {
    const days: HabitWeekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[new Date().getDay()];
}

function configuredDayCount(schedule: HabitSchedule): number {
    return WEEKDAYS.filter(({ key }) => (schedule[key]?.length || 0) > 0).length;
}

function orderedPeriods(periods: string[]): string[] {
    return [...new Set(periods)].sort((first, second) => {
        const firstIndex = PERIODS.findIndex((period) => period === first);
        const secondIndex = PERIODS.findIndex((period) => period === second);
        return (firstIndex < 0 ? PERIODS.length : firstIndex)
            - (secondIndex < 0 ? PERIODS.length : secondIndex);
    });
}

interface PlaceModalProps {
    visible: boolean;
    onClose: () => void;
    place: Place | null;
    loadingProfiles: boolean;
    frequentersProfiles: User[];
    placeEvents?: Meeting[];
    onSaveHabit?: (schedule: HabitSchedule) => Promise<void>;
    onRemoveHabit?: () => Promise<void>;
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
    onRemoveHabit,
    onCreateEventPress
}: PlaceModalProps) {
    const [isPickingHabit, setIsPickingHabit] = React.useState(false);
    const [selectedWeekday, setSelectedWeekday] = React.useState<HabitWeekday>(currentWeekday);
    const [selectedSchedule, setSelectedSchedule] = React.useState<HabitSchedule>({});
    const [savingHabit, setSavingHabit] = React.useState(false);
    const [showFrequenters, setShowFrequenters] = React.useState(false);

    const ownSchedule = place?.currentUserHabitSchedule
        || (auth.currentUser?.uid ? place?.habitSchedules?.[auth.currentUser.uid] : undefined)
        || {};
    const isCurrentUserFrequenting = place?.isCurrentUserFrequenting === true || configuredDayCount(ownSchedule) > 0;
    const attendanceSummary = React.useMemo(() => {
        const activeWeekdays = new Set<HabitWeekday>();
        const profiles = frequentersProfiles.map((profile): AttendanceProfile => {
            const schedule = place?.habitSchedules?.[profile.uid];
            const scheduleLines = WEEKDAYS.flatMap(({ key: weekday, label }) => {
                const periods = orderedPeriods(schedule?.[weekday] || []);
                if (periods.length === 0) return [];

                activeWeekdays.add(weekday);
                return [`${label}: ${periods.join(', ')}`];
            });

            if (scheduleLines.length === 0) {
                const legacyPeriods = orderedPeriods(place?.habits?.[profile.uid] || []);
                if (legacyPeriods.length > 0) {
                    scheduleLines.push(`Dia não informado: ${legacyPeriods.join(', ')}`);
                }
            }

            return { profile, scheduleLines };
        }).sort((first, second) => {
            const firstName = first.profile.nick || first.profile.displayName || '';
            const secondName = second.profile.nick || second.profile.displayName || '';
            return firstName.localeCompare(secondName, 'pt-BR');
        });

        const activeDayLabels = WEEKDAYS
            .filter(({ key }) => activeWeekdays.has(key))
            .map(({ label }) => label);

        return {
            profiles,
            daysLabel: activeDayLabels.length > 0 ? activeDayLabels.join(', ') : 'Dias não informados',
        };
    }, [frequentersProfiles, place]);
    
    // Reset state when modal opens/closes
    React.useEffect(() => {
        setIsPickingHabit(false);
        setSelectedSchedule(ownSchedule);
        setSelectedWeekday(WEEKDAYS.find(({ key }) => (ownSchedule[key]?.length || 0) > 0)?.key || currentWeekday());
        setShowFrequenters(false);
    }, [visible, place?.id]);

    const cancelHabitEditing = () => {
        setSelectedSchedule(ownSchedule);
        setIsPickingHabit(false);
    };

    const saveHabit = async () => {
        if (!onSaveHabit || configuredDayCount(selectedSchedule) === 0) return;
        setSavingHabit(true);
        try {
            await onSaveHabit(selectedSchedule);
            setIsPickingHabit(false);
        } catch {
            // O chamador apresenta a mensagem específica e mantém o editor aberto.
        } finally {
            setSavingHabit(false);
        }
    };

    const confirmRemoveHabit = () => {
        if (!onRemoveHabit || savingHabit) return;
        Alert.alert('Deixar de frequentar', 'Remover seus dias e horários deste local? O reconhecimento de descobridor ou fundador será mantido.', [
            { text: 'Cancelar', style: 'cancel' },
            {
                text: 'Remover rotina',
                style: 'destructive',
                onPress: async () => {
                    setSavingHabit(true);
                    try {
                        await onRemoveHabit();
                        setSelectedSchedule({});
                        setIsPickingHabit(false);
                    } catch {
                        // O chamador apresenta a mensagem específica e preserva a rotina atual.
                    } finally {
                        setSavingHabit(false);
                    }
                },
            },
        ]);
    };

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

                    {(place.discovererId || place.discovererName) && (
                        <View style={styles.discovererBanner}>
                            <Ionicons name="compass" size={20} color="#4338CA" style={{ marginRight: 8 }} />
                            <Text style={styles.discovererText}>
                                Descoberto no Reunion Hub por {place.discovererName || 'um Pioneiro'}
                            </Text>
                        </View>
                    )}

                    {loadingProfiles ? (
                        <ActivityIndicator size="small" color="#4F46E5" style={{ marginBottom: 20 }} />
                    ) : frequentersProfiles.length > 0 ? (
                        <View style={{ marginBottom: 20 }}>
                            <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#374151', marginBottom: 12 }}>
                                Quando este lugar costuma ser frequentado
                            </Text>
                            <Text style={styles.attendanceHelper}>Toque no indicador para ver as pessoas e seus horários.</Text>
                            <View style={styles.attendanceCard}>
                                <TouchableOpacity
                                    style={styles.attendanceHeader}
                                    onPress={() => setShowFrequenters((current) => !current)}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Ver frequentadores presentes em ${attendanceSummary.daysLabel}`}
                                    accessibilityState={{ expanded: showFrequenters }}
                                >
                                    <View style={styles.attendanceIcon}>
                                        <Ionicons name="people" size={19} color="#4F46E5" />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.attendanceLabel}>Presença em {attendanceSummary.daysLabel}</Text>
                                        <Text style={styles.attendanceCount}>
                                            {attendanceSummary.profiles.length} {attendanceSummary.profiles.length === 1 ? 'frequentador' : 'frequentadores'}
                                        </Text>
                                    </View>
                                    <Ionicons name={showFrequenters ? 'chevron-up' : 'chevron-down'} size={20} color="#64748B" />
                                </TouchableOpacity>

                                {showFrequenters && (
                                    <View style={styles.attendanceProfiles}>
                                        {attendanceSummary.profiles.map(({ profile, scheduleLines }, index) => (
                                            <TouchableOpacity
                                                key={profile.uid}
                                                onPress={() => {
                                                    onClose();
                                                    router.push({ pathname: '/public-profile/[id]', params: { id: profile.uid } });
                                                }}
                                                style={[
                                                    styles.attendanceProfile,
                                                    index === attendanceSummary.profiles.length - 1 && styles.attendanceProfileLast,
                                                ]}
                                            >
                                                {profile.photoURL ? (
                                                    <Image source={{ uri: profile.photoURL }} style={styles.attendanceAvatar} />
                                                ) : (
                                                    <View style={[styles.attendanceAvatar, styles.attendanceAvatarFallback]}>
                                                        <Text style={styles.attendanceAvatarText}>{(profile.nick || profile.displayName || 'U').charAt(0).toUpperCase()}</Text>
                                                    </View>
                                                )}
                                                <View style={styles.attendanceProfileDetails}>
                                                    <Text style={styles.attendanceProfileName}>{profile.nick || profile.displayName || 'Usuário'}</Text>
                                                    <Text style={styles.attendanceProfileSchedule}>
                                                        {scheduleLines.length > 0 ? scheduleLines.join(' • ') : 'Dias e períodos não informados'}
                                                    </Text>
                                                </View>
                                                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                )}
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
                            <Text style={{ color: '#166534', fontWeight: 'bold' }}>{isCurrentUserFrequenting ? 'Editar minha rotina neste lugar' : 'Eu costumo frequentar este lugar'}</Text>
                        </TouchableOpacity>
                    ) : (
                        <View style={{ backgroundColor: '#F0FDF4', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#BBF7D0', marginBottom: 20 }}>
                            <Text style={{ color: '#15803D', fontWeight: 'bold', marginBottom: 4 }}>Em quais dias e períodos você costuma vir?</Text>
                            <Text style={styles.habitHelper}>Você pode marcar vários períodos e vários dias. Ao trocar de dia, as escolhas anteriores continuam salvas.</Text>
                            <View style={styles.weekdayContainer}>
                                {WEEKDAYS.map(({ key, label }) => (
                                    <TouchableOpacity
                                        key={key}
                                        style={[
                                            styles.weekdayChip,
                                            (selectedSchedule[key]?.length || 0) > 0 && styles.weekdayChipConfigured,
                                            selectedWeekday === key && styles.weekdayChipSelected,
                                        ]}
                                        onPress={() => setSelectedWeekday(key)}
                                    >
                                        <Text style={[styles.weekdayText, selectedWeekday === key && styles.weekdayTextSelected]}>{label}</Text>
                                        {(selectedSchedule[key]?.length || 0) > 0 && <View style={styles.weekdayConfiguredDot} />}
                                    </TouchableOpacity>
                                ))}
                            </View>
                            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                                {PERIODS.map(period => (
                                    <TouchableOpacity 
                                        key={period} 
                                        style={[styles.periodChip, selectedSchedule[selectedWeekday]?.includes(period) && styles.periodChipSelected]}
                                        onPress={() => {
                                            setSelectedSchedule((currentSchedule) => {
                                                const currentPeriods = currentSchedule[selectedWeekday] || [];
                                                const nextPeriods = currentPeriods.includes(period)
                                                    ? currentPeriods.filter((currentPeriod) => currentPeriod !== period)
                                                    : [...currentPeriods, period];
                                                const nextSchedule = { ...currentSchedule };
                                                if (nextPeriods.length > 0) nextSchedule[selectedWeekday] = nextPeriods;
                                                else delete nextSchedule[selectedWeekday];
                                                return nextSchedule;
                                            });
                                        }}
                                    >
                                        <Text style={[styles.periodText, selectedSchedule[selectedWeekday]?.includes(period) && styles.periodTextSelected]}>{period}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                            <Text style={styles.configuredDaysText}>{configuredDayCount(selectedSchedule)} dia(s) configurado(s)</Text>
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                                <TouchableOpacity 
                                    style={{ flex: 1, padding: 10, alignItems: 'center' }}
                                    onPress={cancelHabitEditing}
                                    disabled={savingHabit}
                                >
                                    <Text style={{ color: '#6B7280', fontWeight: 'bold' }}>Cancelar</Text>
                                </TouchableOpacity>
                                <TouchableOpacity 
                                    style={{ flex: 1, backgroundColor: '#16A34A', padding: 10, borderRadius: 8, alignItems: 'center', opacity: configuredDayCount(selectedSchedule) > 0 ? 1 : 0.5 }}
                                    onPress={saveHabit}
                                    disabled={configuredDayCount(selectedSchedule) === 0 || savingHabit}
                                >
                                    {savingHabit ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={{ color: '#fff', fontWeight: 'bold' }}>Salvar Rotina</Text>}
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}

                    {isCurrentUserFrequenting && !isPickingHabit && (
                        <TouchableOpacity style={styles.removeHabitButton} onPress={confirmRemoveHabit} disabled={savingHabit}>
                            <Ionicons name="close-circle-outline" size={18} color="#B91C1C" />
                            <Text style={styles.removeHabitText}>Deixar de frequentar este local</Text>
                        </TouchableOpacity>
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
    discovererBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EEF2FF', padding: 12, borderRadius: 8, marginBottom: 16 },
    discovererText: { flex: 1, color: '#3730A3', fontWeight: 'bold' },
    attendanceHelper: { color: '#64748B', fontSize: 12, lineHeight: 17, marginTop: -6, marginBottom: 10 },
    attendanceCard: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, overflow: 'hidden', backgroundColor: '#F8FAFC' },
    attendanceHeader: { flexDirection: 'row', alignItems: 'center', padding: 12 },
    attendanceIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#EEF2FF', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
    attendanceLabel: { color: '#334155', fontSize: 14, fontWeight: '800', lineHeight: 19 },
    attendanceCount: { color: '#64748B', fontSize: 12, marginTop: 2 },
    attendanceProfiles: { paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
    attendanceProfile: { minHeight: 66, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#CBD5E1', paddingVertical: 10 },
    attendanceProfileLast: { borderBottomWidth: 0 },
    attendanceAvatar: { width: 42, height: 42, borderRadius: 21 },
    attendanceAvatarFallback: { backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center' },
    attendanceAvatarText: { color: '#64748B', fontWeight: '800', fontSize: 17 },
    attendanceProfileDetails: { flex: 1, marginHorizontal: 10 },
    attendanceProfileName: { color: '#334155', fontSize: 14, fontWeight: '700', lineHeight: 19 },
    attendanceProfileSchedule: { color: '#64748B', fontSize: 12, lineHeight: 17, marginTop: 2 },
    habitHelper: { color: '#4B7C5C', fontSize: 12, lineHeight: 17, marginBottom: 10 },
    configuredDaysText: { color: '#15803D', fontSize: 12, fontWeight: '700', marginBottom: 10 },
    removeHabitButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: -10, marginBottom: 20, paddingVertical: 10 },
    removeHabitText: { color: '#B91C1C', fontSize: 13, fontWeight: '700' },
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
    weekdayContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    weekdayChip: { minWidth: 44, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#86EFAC', alignItems: 'center' },
    weekdayChipConfigured: { backgroundColor: '#DCFCE7', borderColor: '#22C55E' },
    weekdayChipSelected: { backgroundColor: '#16A34A', borderColor: '#16A34A' },
    weekdayText: { fontSize: 13, color: '#166534' },
    weekdayTextSelected: { color: '#fff', fontWeight: 'bold' },
    weekdayConfiguredDot: { position: 'absolute', top: 3, right: 3, width: 5, height: 5, borderRadius: 3, backgroundColor: '#FDE047' },
});
