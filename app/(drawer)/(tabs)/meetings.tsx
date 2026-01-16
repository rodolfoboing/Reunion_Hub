import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useState, useEffect } from 'react';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../../../firebaseConfig';
import { router } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';

export default function MeetingsScreen() {
    const [meetings, setMeetings] = useState<any[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    const fetchMeetings = async () => {
        setRefreshing(true);
        try {
            const q = query(collection(db, 'meetings')); // Ideally orderBy 'createdAt' or 'date'
            const querySnapshot = await getDocs(q);
            const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMeetings(data);
        } catch (error) {
            console.error(error);
        } finally {
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchMeetings();
    }, []);

    const renderItem = ({ item }: { item: any }) => (
        <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/meeting/${item.id}`)}
        >
            <View style={styles.cardHeader}>
                <Text style={styles.theme}>{item.theme}</Text>
                <Text style={styles.date}>{item.date}</Text>
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <View style={styles.locationRow}>
                <FontAwesome name="map-marker" size={14} color="#6b7280" />
                <Text style={styles.location}>{item.locationName}</Text>
            </View>
        </TouchableOpacity>
    );

    return (
        <View style={styles.container}>
            <FlatList
                data={meetings}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                contentContainerStyle={styles.list}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={fetchMeetings} />
                }
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <Text style={styles.emptyText}>Nenhum evento encontrado.</Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f3f4f6' },
    list: { padding: 16 },
    card: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    theme: { fontSize: 12, color: '#6366f1', fontWeight: 'bold', textTransform: 'uppercase' },
    date: { fontSize: 12, color: '#6b7280' },
    title: { fontSize: 18, fontWeight: 'bold', color: '#1f2937', marginBottom: 4 },
    locationRow: { flexDirection: 'row', alignItems: 'center' },
    location: { fontSize: 14, color: '#4b5563', marginLeft: 4 },
    empty: { padding: 32, alignItems: 'center' },
    emptyText: { color: '#9ca3af' },
});
