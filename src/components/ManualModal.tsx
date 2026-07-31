import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

type ManualModalProps = { visible: boolean; onClose: () => void; isFirstTime?: boolean };
const Step = ({ icon, title, text }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }) => <View style={styles.step}><View style={styles.icon}><Ionicons name={icon} size={20} color="#4F46E5" /></View><View style={styles.stepText}><Text style={styles.stepTitle}>{title}</Text><Text style={styles.stepBody}>{text}</Text></View></View>;

export function ManualModal({ visible, onClose }: ManualModalProps) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><SafeAreaView style={styles.overlay} edges={['bottom']}><View style={styles.sheet}>
    <View style={styles.header}><Text style={styles.title}>Manual de Uso do App</Text><TouchableOpacity onPress={onClose}><Ionicons name="close" size={26} color="#6B7280" /></TouchableOpacity></View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>Use o Reunion Hub para sair de casa com mais segurança e encontrar pessoas por interesses em comum.</Text>
      <Step icon="map-outline" title="Explore o mapa" text="Veja eventos e locais comunitários. Use filtros para escolher categorias e alterne entre mapa e lista." />
      <Step icon="calendar-outline" title="Crie ou confirme um evento" text="Informe título, data, horário e localização correta. Confirme presença apenas quando realmente pretender ir." />
      <Step icon="repeat-outline" title="Marque seus hábitos" text="Em um local, registre períodos em que costuma frequentá-lo. Esses dados ajudam sugestões; a exibição no seu perfil público é opcional." />
      <Step icon="chatbubbles-outline" title="Converse com responsabilidade" text="Abra o perfil da pessoa pelo menu do chat, bloqueie contatos indesejados e denuncie comportamentos ou eventos suspeitos." />
      <Step icon="shield-checkmark-outline" title="Cuide da sua segurança" text="Prefira locais públicos, confirme detalhes antes de sair, não envie dinheiro ou dados pessoais e saia de qualquer situação desconfortável." />
      <Step icon="person-circle-outline" title="Ajuste sua privacidade" text="Em Perfil › Privacidade, escolha se os lugares que você frequenta podem aparecer para outras pessoas." />
      <Step icon="trash-outline" title="Gerencie sua conta" text="No Perfil você pode editar dados, sair e solicitar exclusão de conta. A exclusão é permanente." />
    </ScrollView>
    <TouchableOpacity style={styles.button} onPress={onClose}><Text style={styles.buttonText}>Começar a usar</Text></TouchableOpacity>
  </View></SafeAreaView></Modal>;
}
const styles = StyleSheet.create({ overlay: { flex: 1, backgroundColor: 'rgba(17,24,39,0.55)', justifyContent: 'flex-end' }, sheet: { maxHeight: '88%', backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, title: { fontSize: 20, fontWeight: '800', color: '#111827' }, content: { paddingTop: 14 }, intro: { fontSize: 14, lineHeight: 20, color: '#4B5563', marginBottom: 16 }, step: { flexDirection: 'row', gap: 12, paddingVertical: 10 }, icon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' }, stepText: { flex: 1 }, stepTitle: { fontSize: 15, fontWeight: '800', color: '#312E81', marginBottom: 3 }, stepBody: { fontSize: 13, lineHeight: 18, color: '#4B5563' }, button: { backgroundColor: '#4F46E5', borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 10 }, buttonText: { color: '#FFF', fontWeight: '800', fontSize: 16 } });
