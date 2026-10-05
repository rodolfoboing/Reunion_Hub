export const STRINGS = {
    // Erros Gerais
    ERROR_DEFAULT: 'Ocorreu um erro inesperado. Tente novamente mais tarde.',
    ERROR_NETWORK: 'Sua conexão caiu ou está instável. Verifique sua internet e tente novamente.',
    ERROR_TIMEOUT: 'A solicitação demorou muito para responder. Tente novamente.',
    ERROR_UNAUTHORIZED: 'Sua sessão expirou. Por favor, faça login novamente.',

    // Erros de Banco de Dados (Para Debug / Logs Internos)
    LOG_DB_READ: '[Firestore READ Error]',
    LOG_DB_WRITE: '[Firestore WRITE Error]',
    LOG_AUTH: '[Auth Error]',

    // Autenticação
    AUTH_LOGIN_SUCCESS: 'Login efetuado com sucesso!',
    AUTH_REGISTER_SUCCESS: 'Conta criada com sucesso!',
    AUTH_ERROR_EMPTY_FIELDS: 'Por favor, preencha todos os campos.',
    AUTH_ERROR_INVALID_CREDS: 'Email ou senha inválidos.',
    AUTH_ERROR_NICK_EXISTS: 'Esse Nick já está em uso. Por favor, escolha outro.',
    AUTH_ERROR_TERMS: 'Você precisa aceitar os Termos de Uso para continuar.',
    AUTH_ERROR_ACCOUNT_DISABLED: 'Esta conta foi suspensa pela moderação e não pode mais ser acessada. Se você acha que houve engano, fale com o suporte pelo Contato e Feedback.',
    AUTH_ERROR_TOO_MANY_ATTEMPTS: 'Muitas tentativas seguidas. Aguarde alguns minutos antes de tentar entrar novamente.',

    // Eventos
    EVENT_CREATE_SUCCESS: 'Seu evento foi criado e já está disponível para a comunidade!',
    EVENT_CREATE_ERROR: 'Ocorreu um problema ao salvar seu evento.',
    EVENT_DELETE_CONFIRM: 'Tem certeza que deseja apagar este evento?',
    EVENT_DELETE_SUCCESS: 'Evento apagado com sucesso.',
    EVENT_INVITE_NICK_HINT: 'Confira se digitou certo: é o nick (apelido único, ex.: joao_silva), não o nome exibido no perfil.',
    EVENT_INVITE_NICK_INVALID: 'O nick tem de 3 a 20 caracteres: letras, números, ponto, hífen ou sublinhado.',
    EVENT_INVITE_USER_GONE: 'Esta conta não está mais disponível.',
    EVENT_INVITE_EVENT_GONE: 'Este evento não existe mais.',
    EVENT_INVITE_FAILED: 'Não foi possível enviar este convite agora. Tente novamente.',

    // Chat
    CHAT_MESSAGE_BLOCKED: 'Você bloqueou esta pessoa e não pode enviar mensagens para ela.',

    // UI Global
    BTN_RETRY: 'Tentar Novamente',
    BTN_CANCEL: 'Cancelar',
    BTN_CONFIRM: 'Confirmar',
    BTN_BACK: 'Voltar',
    
    // Error Boundary
    BOUNDARY_TITLE: 'Ops! Ocorreu um problema.',
    BOUNDARY_SUBTITLE: 'O aplicativo encontrou um erro inesperado e precisou ser interrompido.',
};
