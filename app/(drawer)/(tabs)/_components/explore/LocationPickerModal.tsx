import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker } from '../../../../../src/components/MapView';
import * as Location from 'expo-location';

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
    return (
        <Modal visible={visible} animationType="fade">
            <SafeAreaView style={{ flex: 1 }}>
                <View style={styles.mapPickerHeader}>
                    <TouchableOpacity onPress={onClose}>
                        <Ionicons name="arrow-back" size={24} color="#111827" />
                    </TouchableOpacity>
                    <Text style={styles.mapPickerTitle}>Arraste o marcador até o local</Text>
                    <TouchableOpacity onPress={onClose} style={styles.confirmPin}>
                        <Text style={styles.confirmPinText}>Confirmar</Text>
                    </TouchableOpacity>
                </View>
                <MapView
                    style={{ flex: 1 }}
                    initialRegion={location ? {
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude,
                        latitudeDelta: 0.01,
                        longitudeDelta: 0.01,
                    } : {
                        latitude: -23.5505,
                        longitude: -46.6333,
                        latitudeDelta: 0.01,
                        longitudeDelta: 0.01,
                    }}
                    onPress={(e: any) => {
                        onLocationChange(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude);
                    }}
                >
                    <Marker
                        draggable
                        coordinate={{
                            latitude: currentLat || (location?.coords.latitude || -23.5505),
                            longitude: currentLng || (location?.coords.longitude || -46.6333)
                        }}
                        onDragEnd={(e: any) => {
                            onLocationChange(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude);
                        }}
                    />
                </MapView>
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    mapPickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
    mapPickerTitle: { fontSize: 16, fontWeight: 'bold', color: '#111827' },
    confirmPin: { backgroundColor: '#4F46E5', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
    confirmPinText: { color: '#fff', fontWeight: 'bold' },
});

export default function Ignore() { return null; }
