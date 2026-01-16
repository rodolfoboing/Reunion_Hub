import { useLocalSearchParams, router } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../../firebaseConfig';
import { StyledButton } from '@/components/StyledButton';
import { FontAwesome } from '@expo/vector-icons';

export default function MeetingDetailsScreen() {
    const { id } = useLocalSearchParams();
    const [meeting, setMeeting] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [rsvpLoading, setRsvpLoading] = useState(false);

    useEffect(() => {
        fetchMeeting();
    }, [id]);

    const fetchMeeting = async () => {
        try {
            const docRef = doc(db, 'meetings', id as string);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                setMeeting({ id: docSnap.id, ...docSnap.data() });
            } else {
                Alert.alert('Erro', 'Evento não encontrado.');
                router.back();
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleRSVP = async () => {
        if (!auth.currentUser) {
            Alert.alert('Erro', 'Faça login para confirmar presença.');
            return;
        }
        setRsvpLoading(true);
        try {
            const docRef = doc(db, 'meetings', id as string);
            await updateDoc(docRef, {
                attendees: arrayUnion(auth.currentUser.uid)
            });
            Alert.alert('Sucesso', 'Presença confirmada! +10 pontos de reputação (simulado).');
            fetchMeeting(); // Refresh UI
        } catch (error) {
            console.error(error);
            Alert.alert('Erro', 'Falha ao confirmar presença.');
        } finally {
            setRsvpLoading(false);
        }
    };

    if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;
    if (!meeting) return null;

    const isAttending = meeting.attendees?.includes(auth.currentUser?.uid);

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <Text style={styles.theme}>{meeting.theme}</Text>
            <Text style={styles.title}>{meeting.title}</Text>

            <View style={styles.infoRow}>
                <FontAwesome name="map-marker" size={18} color="#6b7280" />
                <Text style={styles.infoText}>{meeting.locationName}</Text>
            </View>

            <View style={styles.infoRow}>
                <FontAwesome name="calendar" size={18} color="#6b7280" />
                <Text style={styles.infoText}>{meeting.date}</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Sobre</Text>
                <Text style={styles.description}>{meeting.description}</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Participantes</Text>
                <Text style={styles.description}>
                    {meeting.attendees?.length || 0} confirmados
                </Text>
            </View>

            <View style={styles.footer}>
                {isAttending ? (
                    <StyledButton
                        title="Presença Confirmada ✅"
                        onPress={() => { }}
                        colors={['#10b981', '#34d399']}
                    />
                ) : (
                    <StyledButton
                        title="Confirmar Presença"
                        onPress={handleRSVP}
                        isLoading={rsvpLoading}
                    />
                )}

                <View style={{ height: 10 }} />

                <StyledButton
                    title="Link da Reunião Online (Jitsi)"
                    onPress={() => Alert.alert('Jitsi Meet', 'Abriria a sala: jitsi.meet/reunion_hub_' + id)}
                    colors={['#3b82f6', '#60a5fa']} // Azul para video
                />
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    content: { padding: 24 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    theme: { color: '#6366f1', fontWeight: 'bold', fontSize: 14, textTransform: 'uppercase', marginBottom: 4 },
    title: { fontSize: 28, fontWeight: 'bold', color: '#111', marginBottom: 16 },
    infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    infoText: { marginLeft: 8, color: '#374151', fontSize: 16 },
    section: { marginTop: 24 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8, color: '#1f2937' },
    description: { fontSize: 16, color: '#4b5563', lineHeight: 24 },
    footer: { marginTop: 40 },
});
