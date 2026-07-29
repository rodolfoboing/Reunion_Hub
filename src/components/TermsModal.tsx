import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type TermsModalProps = { visible: boolean; onClose: () => void };

const Section = ({ title, children }: { title: string; children: string }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <Text style={styles.sectionText}>{children}</Text>
  </View>
);

export function TermsModal({ visible, onClose }: TermsModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.icon}><Ionicons name="document-text-outline" size={22} color="#4F46E5" /></View>
            <Text style={styles.title}>Regras e Termos de Uso</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Fechar termos"><Ionicons name="close" size={26} color="#6B7280" /></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <Text style={styles.updated}>Última atualização: julho de 2026</Text>
            <Section title="1. Finalidade do Reunion Hub">
              O Reunion Hub ajuda pessoas adultas a descobrir eventos, locais comunitários e interesses em comum. O aplicativo facilita conexões; não garante a identidade, conduta, segurança, qualidade ou comparecimento de qualquer usuário, evento ou estabelecimento.
            </Section>
            <Section title="2. Conta e informações verdadeiras">
              Você deve ter 18 anos ou mais, manter seus dados corretos e proteger sua conta. Não crie contas falsas, não se passe por outra pessoa, não tente obter privilégios administrativos e não use o aplicativo para fins ilegais, comerciais não autorizados ou enganosos.
            </Section>
            <Section title="3. Eventos e encontros presenciais">
              Antes de comparecer, confirme data, local e organizador. Prefira locais públicos, informe alguém de confiança sobre seu deslocamento e não se sinta obrigado a permanecer em situações desconfortáveis. Organizadores são responsáveis pela precisão do evento e por cancelá-lo quando necessário.
            </Section>
            <Section title="4. Conteúdo, respeito e moderação">
              É proibido publicar ou enviar conteúdo ofensivo, discriminatório, sexualmente explícito, violento, fraudulento, ilegal, que incentive autolesão, assédio, perseguição ou divulgação de dados pessoais de terceiros. Denuncie usuários e eventos suspeitos; podemos limitar, remover conteúdo, suspender contas ou colaborar com autoridades quando exigido por lei.
            </Section>
            <Section title="5. Mensagens, bloqueio e links">
              Use mensagens com respeito. Nunca envie senhas, dados de cartão, dinheiro ou códigos de autenticação. Você pode bloquear usuários; bloqueios impedem novas conversas entre as partes. Links de eventos online são fornecidos por usuários: confirme o domínio antes de abri-los.
            </Section>
            <Section title="6. Locais, hábitos e privacidade">
              Ao marcar que frequenta um local, você compartilha essa informação com o app para formar comunidades e sugestões. A exibição no perfil público é opcional e fica desativada por padrão; você pode ativá-la ou ocultá-la em Perfil › Privacidade. Não publique endereço residencial, rotina detalhada ou dados de terceiros.
            </Section>
            <Section title="7. Reputação e presença">
              Check-ins, cancelamentos e faltas podem afetar indicadores de reputação. Tentativas de manipular presença, reputação, eventos ou locais podem resultar em reversão, bloqueio de recursos ou suspensão de conta.
            </Section>
            <Section title="8. Dados e exclusão de conta">
              Tratamos dados de conta, perfil, interesses, eventos, mensagens, localização quando autorizada e preferências necessárias ao funcionamento. Você pode solicitar exclusão no app; a exclusão remove sua conta e dados pessoais diretos, preservando apenas registros que precisem ser anonimizados para proteger outros participantes ou cumprir obrigações legais.
            </Section>
            <Section title="9. Alterações e contato">
              Podemos atualizar estes termos conforme o aplicativo evoluir. O uso contínuo após a atualização representa concordância com a versão vigente. Em caso de dúvida, denúncia urgente ou solicitação sobre dados, use os canais de suporte exibidos no perfil.
            </Section>
          </ScrollView>
          <TouchableOpacity style={styles.button} onPress={onClose}><Text style={styles.buttonText}>Li e entendi</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(17,24,39,0.55)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  icon: { padding: 8, borderRadius: 12, backgroundColor: '#EEF2FF' }, title: { flex: 1, fontSize: 19, fontWeight: '800', color: '#111827' },
  content: { paddingBottom: 12 }, updated: { color: '#6B7280', fontSize: 12, marginBottom: 8 }, section: { marginTop: 14 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#312E81', marginBottom: 5 }, sectionText: { fontSize: 14, lineHeight: 20, color: '#374151' },
  button: { backgroundColor: '#4F46E5', borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 8 }, buttonText: { color: '#FFF', fontSize: 16, fontWeight: '800' }
});
