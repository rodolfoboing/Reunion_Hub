import { Ionicons } from '@expo/vector-icons';
import { Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { TutorialScreen } from '@/src/hooks/useFirstVisitTutorial';
import { STRINGS } from '@/src/constants/strings';
import { isTicketmasterConfigured } from '@/src/services/ticketmasterEventService';

const hasExternalEvents = isTicketmasterConfigured && Platform.OS !== 'web';

type TutorialTopic = {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    text: string;
    color?: string;
};

type TutorialContent = {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    intro: string;
    topics: TutorialTopic[];
};

const externalExploreTopic: TutorialTopic = {
    icon: 'ticket', title: 'Ingresso', text: STRINGS.EXPLORE_TUTORIAL_EXTERNAL_EVENT, color: '#7C3AED',
};

/**
 * Conteúdo curto por tela, mostrado uma única vez na primeira visita.
 * O Explorar usa uma legenda de ícones; o manual completo continua disponível
 * no Início e pelo Perfil.
 */
const TUTORIALS: Record<TutorialScreen, TutorialContent> = {
    inicio: {
        icon: 'home',
        title: 'Bem-vindo ao Reunion Hub',
        intro: hasExternalEvents
            ? STRINGS.HOME_TUTORIAL_INTRO_EXTERNAL
            : 'Esta é a sua tela inicial. Ela reúne três listas, e você passa o dedo para o lado em cada uma.',
        topics: [
            { icon: 'sparkles-outline', title: 'Eventos do seu interesse', text: 'Escolhidos pelas tags do seu perfil. Quanto mais interesses você marcar, melhores ficam as sugestões.' },
            { icon: 'calendar-outline', title: 'Seus próximos eventos', text: 'O que você já confirmou. O selo mostra se é hoje, em breve ou se já começou.' },
            { icon: 'location-outline', title: 'Perto de você', text: 'Eventos presenciais em até 10 km, se você permitir a localização.' },
        ],
    },
    explorar: {
        icon: 'compass',
        title: 'Explorar',
        intro: STRINGS.EXPLORE_TUTORIAL_INTRO,
        topics: [
            { icon: 'calendar', title: 'Calendário', text: STRINGS.EXPLORE_TUTORIAL_APP_EVENT, color: '#F59E0B' },
            ...(hasExternalEvents ? [externalExploreTopic] : []),
            { icon: 'people', title: 'Pessoas', text: STRINGS.EXPLORE_TUTORIAL_COMMUNITY_PLACE, color: '#6366F1' },
            { icon: 'earth', title: 'Globo', text: STRINGS.EXPLORE_TUTORIAL_OSM_PLACE, color: '#10B981' },
            { icon: 'location', title: 'Pino rosa', text: STRINGS.EXPLORE_TUTORIAL_GOOGLE_POI, color: '#EC4899' },
        ],
    },
    agenda: {
        icon: 'calendar',
        title: 'Minha Agenda',
        intro: 'Quatro seções organizam tudo que você tem marcado.',
        topics: [
            { icon: 'calendar-number-outline', title: 'Agenda', text: 'O calendário. A barra embaixo do dia marca um compromisso seu; o ponto marca uma sugestão dos próximos dias. Toque num dia para ver o que há nele.' },
            { icon: 'list-outline', title: 'Próximos', text: 'A lista corrida do que você confirmou, do mais próximo ao mais distante.' },
            { icon: 'heart-outline', title: 'Histórico e Favoritos', text: 'Eventos que já aconteceram e os que você salvou depois de participar.' },
        ],
    },
    mensagens: {
        icon: 'chatbubbles',
        title: 'Mensagens',
        intro: 'Converse em privado ou com o grupo de um evento.',
        topics: [
            { icon: 'people-outline', title: 'Chats de eventos', text: 'Aparecem enquanto o evento está ativo. Um selo indica novidades; o grupo sai da lista ao terminar.' },
            { icon: 'at-outline', title: 'Comece pelo nick', text: 'Busque a pessoa pelo nick para abrir uma conversa, ou toque no perfil dela em qualquer evento.' },
            { icon: 'shield-checkmark-outline', title: 'Bloquear e denunciar', text: 'Pelo menu dentro da conversa. Enquanto o bloqueio estiver ativo, nenhuma das partes envia mensagem.' },
            { icon: 'warning-outline', title: 'Nunca envie dinheiro', text: 'Nem senhas, dados de cartão ou códigos de verificação. Ninguém do Reunion Hub vai pedir isso.' },
        ],
    },
    perfil: {
        icon: 'person-circle',
        title: 'Seu perfil',
        intro: 'É daqui que saem suas recomendações e é aqui que você controla o que os outros veem.',
        topics: [
            { icon: 'pricetags-outline', title: 'Interesses', text: 'São eles que alimentam as sugestões no Início, no Explorar e na Agenda. Escolha até 10.' },
            { icon: 'lock-closed-outline', title: 'Privacidade', text: 'Em Editar Perfil você decide se mostra os lugares que frequenta e os que fundou. Os dois começam visíveis.' },
            { icon: 'star-outline', title: 'Reputação', text: 'Toque no número para entender como ela sobe e desce. Presença confirmada soma; faltar subtrai.' },
        ],
    },
    evento: {
        icon: 'calendar-outline',
        title: 'Página do evento',
        intro: 'Tudo para se organizar e encontrar outras pessoas está aqui.',
        topics: [
            { icon: 'people-outline', title: 'Participantes', text: 'Veja quem confirmou presença e abra o perfil das pessoas.' },
            { icon: 'chatbubbles-outline', title: 'Chat do evento', text: 'Ao participar, combine detalhes com o grupo. No chat, você pode desligar os avisos deste evento.' },
            { icon: 'person-add-outline', title: 'Convites', text: 'Convide pessoas para participar e compartilhe o evento.' },
            { icon: 'checkmark-circle-outline', title: 'Presença', text: 'Confirme participação e faça check-in durante o evento. Depois, acompanhe o resultado.' },
            { icon: 'ellipsis-horizontal', title: 'Outras ações', text: 'O organizador pode gerenciar o evento. Você também pode denunciar problemas.' },
        ],
    },
};

type ScreenTutorialModalProps = {
    screen: TutorialScreen;
    visible: boolean;
    onClose: () => void;
    /** Ação opcional no rodapé — hoje só o Início usa, para o manual completo. */
    secondaryActionLabel?: string;
    onSecondaryAction?: () => void;
};

export function ScreenTutorialModal({
    screen,
    visible,
    onClose,
    secondaryActionLabel,
    onSecondaryAction,
}: ScreenTutorialModalProps) {
    const content = TUTORIALS[screen];

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <View style={styles.overlay}>
                <View style={styles.card}>
                    <View style={styles.iconCircle}>
                        <Ionicons name={content.icon} size={26} color="#4F46E5" />
                    </View>
                    <Text style={styles.title}>{content.title}</Text>
                    <Text style={styles.intro}>{content.intro}</Text>

                    <ScrollView style={styles.topicsScroll} contentContainerStyle={styles.topics} showsVerticalScrollIndicator={false}>
                        {content.topics.map((topic) => (
                            <View key={topic.title} style={styles.topic}>
                                <View style={[styles.topicIcon, topic.color && { backgroundColor: `${topic.color}1A` }]}>
                                    <Ionicons name={topic.icon} size={16} color={topic.color || '#4F46E5'} />
                                </View>
                                <View style={styles.topicText}>
                                    <Text style={styles.topicTitle}>{topic.title}</Text>
                                    <Text style={styles.topicBody}>{topic.text}</Text>
                                </View>
                            </View>
                        ))}
                    </ScrollView>

                    <TouchableOpacity
                        style={styles.button}
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel={`Fechar tutorial de ${content.title}`}
                    >
                        <Text style={styles.buttonText}>Entendi</Text>
                    </TouchableOpacity>

                    {secondaryActionLabel && onSecondaryAction && (
                        <TouchableOpacity
                            style={styles.secondaryButton}
                            onPress={onSecondaryAction}
                            accessibilityRole="button"
                            accessibilityLabel={secondaryActionLabel}
                        >
                            <Text style={styles.secondaryButtonText}>{secondaryActionLabel}</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(17,24,39,0.6)', justifyContent: 'center', padding: 24 },
    card: { maxHeight: '84%', backgroundColor: '#FFF', borderRadius: 24, padding: 22 },
    iconCircle: { alignSelf: 'center', width: 54, height: 54, borderRadius: 27, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
    title: { marginTop: 12, fontSize: 20, fontWeight: '900', color: '#111827', textAlign: 'center' },
    intro: { marginTop: 6, fontSize: 14, lineHeight: 20, color: '#4B5563', textAlign: 'center' },
    topicsScroll: { flexGrow: 0, flexShrink: 1, minHeight: 0, marginTop: 12 },
    topics: { paddingBottom: 2 },
    topic: { flexDirection: 'row', gap: 11, paddingVertical: 6 },
    topicIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: '#F5F3FF', alignItems: 'center', justifyContent: 'center' },
    topicText: { flex: 1 },
    topicTitle: { fontSize: 14, fontWeight: '800', color: '#312E81', marginBottom: 2 },
    topicBody: { fontSize: 13, lineHeight: 18, color: '#4B5563' },
    button: { marginTop: 16, backgroundColor: '#4F46E5', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
    buttonText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
    secondaryButton: { marginTop: 10, paddingVertical: 6, alignItems: 'center' },
    secondaryButtonText: { color: '#4F46E5', fontSize: 13, fontWeight: '700' },
});
