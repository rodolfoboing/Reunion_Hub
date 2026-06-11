import { useState } from 'react';
import { StyleSheet, View, Text, Alert, ScrollView, Platform, KeyboardAvoidingView } from 'react-native';
import { router } from 'expo-router';
import { addDoc, collection } from 'firebase/firestore';
import { db, auth } from '../src/services/firebaseConfig';
import { StyledInput } from '@/src/components/StyledInput';
import { StyledButton } from '@/src/components/StyledButton';
import { StatusBar } from 'expo-status-bar';

export default function CreateMeetingScreen() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [theme, setTheme] = useState('');
  const [locationName, setLocationName] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!title || !description || !theme || !date || !locationName) {
      Alert.alert('Atenção', 'Preencha todos os campos para criar o evento.');
      return;
    }

    if (!auth.currentUser) {
      Alert.alert('Erro', 'Você precisa estar logado.');
      return;
    }

    setLoading(true);
    try {
      await addDoc(collection(db, 'meetings'), {
        title,
        description,
        theme,
        locationName, // Em um app real, seria um Geopoint também
        date,
        hostId: auth.currentUser.uid,
        hostName: auth.currentUser.displayName || 'Anônimo',
        attendees: [auth.currentUser.uid], // O criador já vai
        createdAt: new Date().toISOString(),
      });

      Alert.alert('Sucesso', 'Reunião criada! Esperando a aprovação da galera.', [
        { text: 'OK', onPress: () => router.back() } // Fechar modal
      ]);
    } catch (error: any) {
      console.error(error);
      Alert.alert('Erro', 'Não foi possível criar o evento no momento.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Novo Evento</Text>
        <StyledInput
          label="Título"
          placeholder="Ex: Encontro de Board Games"
          value={title}
          onChangeText={setTitle}
        />
        <StyledInput
          label="Tema / Interesse"
          placeholder="Ex: Jogos, Tech, Yoga"
          value={theme}
          onChangeText={setTheme}
        />
        <StyledInput
          label="Descrição"
          placeholder="Detalhes do encontro..."
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          style={{ height: 80, textAlignVertical: 'top' }} // Ajuste para multiline
        />
        <StyledInput
          label="Local (Nome)"
          placeholder="Ex: Parque Ibirapuera"
          value={locationName}
          onChangeText={setLocationName}
        />
        <StyledInput
          label="Data/Hora"
          placeholder="Ex: 25/12 às 14h"
          value={date}
          onChangeText={setDate}
        />

        <StyledButton
          title="Criar Reunião"
          onPress={handleCreate}
          isLoading={loading}
        />
      </ScrollView>
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
    color: '#1f2937',
    textAlign: 'center',
  },
});
