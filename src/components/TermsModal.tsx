import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CURRENT_TERMS_UPDATED_LABEL } from '@/src/constants/legal';

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
      <SafeAreaView style={styles.overlay} edges={['bottom']}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.icon}><Ionicons name="document-text-outline" size={22} color="#4F46E5" /></View>
            <Text style={styles.title}>Regras e Termos de Uso</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Fechar termos"><Ionicons name="close" size={26} color="#6B7280" /></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <Text style={styles.updated}>Última atualização: {CURRENT_TERMS_UPDATED_LABEL}</Text>
            <Section title="1. Finalidade do Reunion Hub">
              O Reunion Hub ajuda pessoas adultas a descobrir eventos, locais comunitários e interesses em comum. O aplicativo facilita conexões; não garante a identidade, conduta, segurança, qualidade ou comparecimento de qualquer usuário, evento ou estabelecimento.
            </Section>
            <Section title="2. Conta e informações verdadeiras">
              Você deve ter 18 anos ou mais, manter seus dados corretos e proteger sua conta e senha. A criação de eventos exige e-mail verificado, e a troca do seu nick exige a confirmação da senha atual. Não crie contas falsas, não se passe por outra pessoa, não tente obter privilégios administrativos e não use o aplicativo para fins ilegais, comerciais não autorizados ou enganosos. A senha pode ser alterada em Editar Perfil ou recuperada por e-mail na tela de entrada.
            </Section>
            <Section title="3. Eventos e encontros presenciais">
              Antes de comparecer, confirme data, horários, local e organizador. Prefira locais públicos, informe alguém de confiança sobre seu deslocamento e não se sinta obrigado a permanecer em situações desconfortáveis. Organizadores são responsáveis pela precisão do evento e por cancelá-lo quando necessário. Um convite é apenas uma notificação e não confirma automaticamente a presença do convidado.
            </Section>
            <Section title="4. Conteúdo, respeito e moderação">
              É proibido publicar ou enviar conteúdo ofensivo, discriminatório, sexualmente explícito, violento, fraudulento, ilegal, que incentive autolesão, assédio, perseguição ou divulgação de dados pessoais de terceiros. Denuncie usuários e eventos suspeitos; podemos limitar, remover conteúdo, suspender contas ou colaborar com autoridades quando exigido por lei.
            </Section>
            <Section title="5. Mensagens, bloqueio e links">
              Use mensagens com respeito. Nunca envie senhas, dados de cartão, dinheiro ou códigos de autenticação. Você pode bloquear usuários; enquanto o bloqueio estiver ativo, novas mensagens entre as partes não serão permitidas. Links de eventos online são fornecidos por usuários: confirme o domínio antes de abri-los e avise o organizador pelo recurso do evento quando um link não funcionar.
            </Section>
            <Section title="6. Locais, hábitos e privacidade">
              Ao marcar que frequenta um local, você compartilha no próprio local os dias e períodos escolhidos para formar comunidades e facilitar encontros. A exibição desses lugares no seu perfil público começa ativa, mas é opcional e pode ser ocultada em Perfil › Privacidade. Quando recomendações estão ativas, uma localização aproximada e recente pode ser usada para selecionar eventos presenciais próximos; ela não é exibida publicamente e é removida ao desativar a preferência. Não publique endereço residencial, rotina excessivamente detalhada ou dados de terceiros.
            </Section>
            <Section title="7. Reputação e presença">
              Check-ins, cancelamentos e faltas podem afetar a reputação. O check-in só pode ser solicitado entre o início e o término do evento. Participantes ficam pendentes até a revisão; o organizador precisa registrar o próprio check-in para aprovar ou rejeitar presenças e recebe, ao término, até 2 horas para concluir essa revisão. Se o organizador não fizer check-in ou deixar o prazo terminar, solicitações pendentes válidas podem ser aprovadas automaticamente. Quando existe ao menos um check-in confirmado, inscritos ausentes, inclusive o organizador, podem perder 20 pontos. Se ninguém fizer check-in, cada inscrito perde somente 1 ponto, pois o encontro não foi comprovado. Cancelar um evento pode reduzir a reputação do organizador quando já houver outros participantes. Contas abaixo do nível mínimo de confiança podem ficar impedidas de criar eventos e confirmar presença. Tentativas de manipular presença, reputação, eventos ou locais podem resultar em reversão, bloqueio de recursos ou suspensão.
            </Section>
            <Section title="8. Agenda, histórico e favoritos">
              A Agenda organiza próximos eventos, histórico e favoritos. Eventos concluídos podem ser favoritados por quem teve presença confirmada. O favorito mantém uma referência do evento até ser removido; eventos comuns do histórico podem ser eliminados após o período de retenção do aplicativo. Se você não for o criador, repetir um favorito envia uma proposta ao organizador, sem criar automaticamente outro evento.
            </Section>
            <Section title="9. Notificações e recomendações">
              Notificações e recomendações começam ativas e podem ser desativadas individualmente no Perfil. As opções distinguem notificações push de mensagens e eventos, lembretes locais do ciclo do evento e recomendações. Desativar o push ou um lembrete não remove avisos importantes já disponíveis no sino do aplicativo. Recomendações opcionais podem considerar interesses, popularidade, data e proximidade; desativá-las interrompe esse uso para novas sugestões. O sistema limita alertas promocionais para reduzir repetições.
            </Section>
            <Section title="10. Dados e exclusão de conta">
              Tratamos dados de conta, perfil, interesses, eventos, mensagens, localização quando autorizada e preferências necessárias ao funcionamento. Você pode excluir permanentemente sua conta pelo app após confirmar a senha atual; a exclusão remove a conta e os dados pessoais diretos, preservando apenas registros que precisem ser anonimizados para proteger outros participantes, manter a coerência de interações ou cumprir obrigações legais.
            </Section>
            <Section title="11. Alterações e contato">
              Podemos atualizar estes termos conforme o aplicativo evoluir. O uso contínuo após a atualização representa concordância com a versão vigente. Em caso de dúvida, denúncia urgente ou solicitação sobre dados, use os canais de suporte exibidos no perfil.
            </Section>
          </ScrollView>
          <TouchableOpacity style={styles.button} onPress={onClose}><Text style={styles.buttonText}>Li e entendi</Text></TouchableOpacity>
        </View>
      </SafeAreaView>
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
