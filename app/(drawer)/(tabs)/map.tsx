import { router } from 'expo-router';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../../../firebaseConfig';
import MapView, { Marker, Callout, PROVIDER_GOOGLE, PROVIDER_DEFAULT } from 'react-native-maps';
import { StyleSheet, View, Text, Dimensions, Platform, TouchableOpacity, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

export default function MapScreen() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<any[]>([]);

  useEffect(() => {
    // 1. Localização
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permissão de localização negada');
        return;
      }
      let location = await Location.getCurrentPositionAsync({});
      setLocation(location);
    })();

    // 2. Assinar Eventos em Tempo Real
    const q = query(collection(db, 'meetings')); // Pode adicionar orderBy('createdAt') se indexado
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const meetingsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        // Fallback lat/lng se não salvarmos geopoint ainda (mock para demo)
        // Simulando espalhamento ao redor de SP se não tiver coords
        lat: doc.data().lat || -23.5505 + (Math.random() - 0.5) * 0.05,
        lng: doc.data().lng || -46.6333 + (Math.random() - 0.5) * 0.05,
      }));
      setMeetings(meetingsData);
    });

    return () => unsubscribe();
  }, []);

  const initialRegion = {
    latitude: location?.coords.latitude || -23.5505,
    longitude: location?.coords.longitude || -46.6333,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  };

  return (
    <View style={styles.container}>
      {/* Search Bar FAKE para estética */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <FontAwesome name="search" size={20} color="#6b7280" />
          <Text style={styles.searchText}>Buscar eventos...</Text>
        </View>
      </View>

      <MapView
        style={styles.map}
        region={location ? {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        } : initialRegion}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        showsUserLocation={true}
        showsMyLocationButton={false} // Custom button below
      >
        {meetings.map((meeting) => (
          <Marker
            key={meeting.id}
            coordinate={{ latitude: meeting.lat, longitude: meeting.lng }}
            title={meeting.title}
            description={meeting.description}
          >
            <View style={styles.markerContainer}>
              <View style={styles.markerBubble}>
                <Text style={styles.markerText}>📍</Text>
              </View>
              <View style={styles.markerArrow} />
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Floating Action Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.fab} onPress={() => {
          // Centralizar
          if (location) {
            // Lógica de recentralizar (necessita ref do mapa, simplificado aqui)
          }
        }}>
          <FontAwesome name="crosshairs" size={24} color="#374151" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.createButton} onPress={() => Alert.alert('Novo Evento', 'Abrir modal de criação')}>
          <LinearGradient
            colors={['#6366f1', '#a855f7']}
            style={styles.gradientButton}
          >
            <FontAwesome name="plus" size={24} color="#fff" />
            <Text style={styles.createButtonText}>Criar</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  map: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  searchContainer: {
    position: 'absolute',
    top: 50, // Ajustar para SafeArea
    left: 20,
    right: 20,
    zIndex: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 25,
    padding: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  searchText: {
    marginLeft: 10,
    color: '#9ca3af',
    fontSize: 16,
  },
  actions: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    alignItems: 'center',
  },
  fab: {
    backgroundColor: '#fff',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  createButton: {
    borderRadius: 30,
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 30,
  },
  createButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 8,
  },
  markerContainer: {
    alignItems: 'center',
  },
  markerBubble: {
    backgroundColor: '#fff',
    padding: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#eee',
  },
  markerText: {
    fontSize: 20,
  },
  markerArrow: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderTopColor: '#fff',
    borderWidth: 5,
    alignSelf: 'center',
    marginTop: -0.5,
  },
  callout: {
    width: 150,
    padding: 5,
    alignItems: 'center',
  },
  calloutTitle: {
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 4,
  },
  calloutDesc: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  calloutBtn: {
    color: '#6366f1',
    fontWeight: 'bold',
    fontSize: 12,
  },
});
