import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapView, { PROVIDER_GOOGLE, PROVIDER_DEFAULT } from '@/src/components/MapView';
import * as Location from 'expo-location';
import type { Region } from 'react-native-maps';

interface LocationPickerModalProps {
    visible: boolean;
    onClose: () => void;
    location: Location.LocationObject | null;
    currentLat: number;
    currentLng: number;
    onLocationChange: (lat: number, lng: number) => void;
}

export function LocationPickerModal({
    visible,
    onClose,
    location,
    currentLat,
    currentLng,
    onLocationChange
}: LocationPickerModalProps) {
    const fallbackLatitude = currentLat || location?.coords.latitude || -23.5505;
    const fallbackLongitude = currentLng || location?.coords.longitude || -46.6333;
    const [pendingCoordinate, setPendingCoordinate] = useState({ latitude: fallbackLatitude, longitude: fallbackLongitude });

    useEffect(() => {
        if (!visible) return;
        setPendingCoordinate({
            latitude: currentLat || location?.coords.latitude || -23.5505,
            longitude: currentLng || location?.coords.longitude || -46.6333,
        });
    }, [visible, currentLat, currentLng, location?.coords.latitude, location?.coords.longitude]);

    const confirmLocation = () => {
        onLocationChange(pendingCoordinate.latitude, pendingCoordinate.longitude);
        onClose();
    };

    return (
        <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
            <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
                <View style={styles.mapPickerHeader}>
                    <TouchableOpacity onPress={onClose}>
                        <Ionicons name="arrow-back" size={24} color="#111827" />
                    </TouchableOpacity>
                    <Text style={styles.mapPickerTitle}>Arraste o marcador até o local</Text>
                    <TouchableOpacity onPress={confirmLocation} style={styles.confirmPin}>
                        <Text style={styles.confirmPinText}>Confirmar</Text>
                    </TouchableOpacity>
                </View>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <MapView
                        style={{ ...StyleSheet.absoluteFillObject }}
                        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
                        initialRegion={{
                            latitude: pendingCoordinate.latitude,
                            longitude: pendingCoordinate.longitude,
                            latitudeDelta: 0.005,
                            longitudeDelta: 0.005,
                        }}
                        onRegionChangeComplete={(region: Region) => {
                            setPendingCoordinate({ latitude: region.latitude, longitude: region.longitude });
                        }}
                        showsUserLocation
                    />
                    <View style={styles.fixedMarker} pointerEvents="none">
                        <Ionicons name="location" size={48} color="#4F46E5" style={{ marginBottom: 24 }} />
                    </View>
                </View>
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    mapPickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
    mapPickerTitle: { fontSize: 16, fontWeight: 'bold', color: '#111827' },
    confirmPin: { backgroundColor: '#4F46E5', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
    confirmPinText: { color: '#fff', fontWeight: 'bold' },
    fixedMarker: { position: 'absolute', justifyContent: 'center', alignItems: 'center', zIndex: 1 },
});
