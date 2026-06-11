import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Place, User } from '../../../../../src/types';

interface PlaceModalProps {
    visible: boolean;
    onClose: () => void;
    place: Place | null;
    loadingProfiles: boolean;
    frequentersProfiles: User[];
    onCreateEventPress: () => void;
}

export function PlaceModal({
    visible,
    onClose,
    place,
    loadingProfiles,
    frequentersProfiles,
    onCreateEventPress
}: PlaceModalProps) {
    if (!place) return null;

    return (
        <Modal
            animationType="slide"
            transparent={true}
            visible={visible}
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
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
                                Este lugar ainda não tem frequentadores regulares. Quer ser o primeiro?
                            </Text>
                        </View>
                    )}

                    <TouchableOpacity 
                        style={{ marginTop: 16, alignSelf: 'center' }}
                        onPress={() => {
                            onClose();
                            onCreateEventPress();
                        }}
                    >
                        <Text style={{ color: '#4F46E5', fontWeight: 'bold', fontSize: 16 }}>Criar Evento Neste Local</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '90%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#111827' },
});

export default function Ignore() { return null; }
