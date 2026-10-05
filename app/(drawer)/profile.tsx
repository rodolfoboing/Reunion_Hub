import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, Image, TextInput, Linking, Switch, AppState, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import { auth, db, functions } from '../../src/services/firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import { deleteField, doc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential, sendEmailVerification, updatePassword, updateProfile } from 'firebase/auth';
import { storage } from '../../src/services/firebaseConfig';
import * as ImagePicker from 'expo-image-picker';
import { FontAwesome } from '@expo/vector-icons';
import { StyledButton } from '@/src/components/StyledButton';
import { TermsModal } from '@/src/components/TermsModal';
import { ManualModal } from '@/src/components/ManualModal';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { INTERESTS_OPTIONS, MAX_PROFILE_INTERESTS, normalizeInterests } from '../../src/constants/Interests';
import { User } from '../../src/types';
import { BIO_MAX_LENGTH, NICK_MAX_LENGTH, PASSWORD_MAX_LENGTH } from '@/src/constants/textLimits';
import { ScreenTutorialModal } from '@/src/components/ScreenTutorialModal';
import { useUserProfile } from '@/src/hooks/useUserProfile';
import { useFirstVisitTutorial } from '@/src/hooks/useFirstVisitTutorial';
import { unregisterCurrentPushDevice } from '@/src/services/pushRegistrationService';
import { setEventRemindersEnabled, setReengagementReminderEnabled } from '@/src/utils/Notifications';
import { clearRecommendationLocationCache } from '@/src/services/recommendationLocationService';
import { syncOwnEventReminders } from '@/src/services/eventReminderSyncService';
import { isValidNickname, NicknameUnavailableError, normalizeNickname, updateOwnProfile, uploadProfileImage } from '@/src/services/profileService';
import { DEFAULT_NOTIFICATION_SETTINGS } from '@/src/constants/userPreferences';
import { getFirebaseErrorCode } from '@/src/utils/authError';

const VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;
// BIO_MAX_LENGTH vinha declarado aqui E em onboarding.tsx, com o mesmo valor:
// dois lugares para mudar e nenhuma garantia de que mudariam juntos.

function profileLog(event: string, context: Record<string, boolean | number> = {}) {
    if (__DEV__) console.info(`[Profile] ${event}`, context);
}

export default function ProfileScreen() {
    const sharedProfile = useUserProfile();
    // Continua em estado local: a tela mostra os interesses já normalizados, e o
    // formulário de edição trabalha sobre essa cópia.
    const [userProfile, setUserProfile] = useState<User | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editBio, setEditBio] = useState('');
    const [editNick, setEditNick] = useState('');
    const [editInterests, setEditInterests] = useState<string[]>([]);
    const [shareFrequentedPlaces, setShareFrequentedPlaces] = useState(true);
    const [showFoundedPlaces, setShowFoundedPlaces] = useState(true);
    const [showPopularOutsideInterests, setShowPopularOutsideInterests] = useState(true);
    const [notifyMessages, setNotifyMessages] = useState(true);
    const [notifyEventUpdates, setNotifyEventUpdates] = useState(true);
    const [notifyEventReminders, setNotifyEventReminders] = useState(true);
    const [notifyRecommendations, setNotifyRecommendations] = useState(true);
    const [savedNotificationSettings, setSavedNotificationSettings] = useState({ ...DEFAULT_NOTIFICATION_SETTINGS });
    const [editPhotoURL, setEditPhotoURL] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [showTermsModal, setShowTermsModal] = useState(false);
    const [showManualModal, setShowManualModal] = useState(false);
    const { visible: showTutorial, dismiss: dismissTutorial } = useFirstVisitTutorial('perfil');
    const [isEmailVerified, setIsEmailVerified] = useState(auth.currentUser?.emailVerified ?? false);
    const [emailVerificationSent, setEmailVerificationSent] = useState(false);
    const [checkingEmailVerification, setCheckingEmailVerification] = useState(false);
    const [showPasswordEditor, setShowPasswordEditor] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [changingPassword, setChangingPassword] = useState(false);
    const [showProfileSaveConfirmation, setShowProfileSaveConfirmation] = useState(false);
    const [profileConfirmationPassword, setProfileConfirmationPassword] = useState('');
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [deleteConfirmationPassword, setDeleteConfirmationPassword] = useState('');
    const [verificationResendCooldown, setVerificationResendCooldown] = useState(0);

    // O listener de notificationSettings roda com deps [] e não enxergaria um
    // isEditing novo. O ref mantém o valor atual acessível dentro do snapshot.
    const isEditingRef = useRef(isEditing);
    useEffect(() => {
        isEditingRef.current = isEditing;
    }, [isEditing]);

    const resetPasswordEditor = () => {
        setShowPasswordEditor(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
    };

    const resetProfileSaveConfirmation = () => {
        setShowProfileSaveConfirmation(false);
        setProfileConfirmationPassword('');
    };

    const reauthenticateCurrentUser = async (password: string): Promise<boolean> => {
        const user = auth.currentUser;
        if (!user?.email) {
            Alert.alert('Confirmação indisponível', 'Não foi possível identificar o e-mail desta conta. Entre novamente e tente de novo.');
            return false;
        }
        if (!user.providerData.some(provider => provider.providerId === EmailAuthProvider.PROVIDER_ID)) {
            Alert.alert('Conta vinculada', 'Esta conta não usa senha do Firebase. Confirme sua identidade pelo provedor usado para entrar.');
            return false;
        }

        const credential = EmailAuthProvider.credential(user.email, password);
        await reauthenticateWithCredential(user, credential);
        return true;
    };

    const showReauthenticationError = (error: unknown) => {
        const code = getFirebaseErrorCode(error);
        if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
            Alert.alert('Senha atual incorreta', 'Confira a senha atual e tente novamente.');
        } else if (code === 'auth/too-many-requests') {
            Alert.alert('Muitas tentativas', 'Aguarde alguns minutos antes de tentar novamente.');
        } else if (code === 'auth/network-request-failed') {
            Alert.alert('Sem conexão', 'Verifique sua internet e tente novamente.');
        } else if (code === 'auth/requires-recent-login') {
            Alert.alert('Sessão expirada', 'Saia da conta, entre novamente e repita a alteração.');
        } else {
            Alert.alert('Não foi possível confirmar', 'Sua identidade não foi confirmada. Tente novamente.');
        }
    };

    // O perfil vem do Context: esta tela mantinha o sétimo `onSnapshot` em
    // `users/{uid}`. A normalização dos interesses fica aqui porque é a única
    // tela que os edita — o resto do app consome a taxonomia canônica direto.
    useEffect(() => {
        if (!sharedProfile) return;
        setUserProfile({ ...sharedProfile, interests: normalizeInterests(sharedProfile.interests) });
        // Nick ausente (perfil antigo): cai para o displayName do Auth.
        setEditNick(sharedProfile.nick || auth.currentUser?.displayName?.replace(/\s/g, '').toLowerCase() || '');
    }, [sharedProfile]);

    useEffect(() => {
        const user = auth.currentUser;
        if (!user) return;
        return onSnapshot(doc(db, 'notificationSettings', user.uid), (snapshot) => {
            const data = snapshot.data();
            const settings = {
                notifyMessages: data?.notifyMessages !== false,
                notifyEventUpdates: data?.notifyEventUpdates !== false,
                notifyEventReminders: data?.notifyEventReminders !== false,
                notifyRecommendations: data?.notifyRecommendations !== false,
            };
            setSavedNotificationSettings(settings);
            // Não sobrescreve o que está sendo editado: este mesmo documento também
            // recebe escrita em segundo plano (recommendationLocation, gravado pela
            // aba Explorar), e o snapshot resultante descartava os switches do usuário.
            if (isEditingRef.current) return;
            setNotifyMessages(settings.notifyMessages);
            setNotifyEventUpdates(settings.notifyEventUpdates);
            setNotifyEventReminders(settings.notifyEventReminders);
            setNotifyRecommendations(settings.notifyRecommendations);
        }, () => console.error('[Profile] notification_settings_load_failed'));
    }, []);

    const refreshEmailVerification = async () => {
        const user = auth.currentUser;
        if (!user) return;

        setCheckingEmailVerification(true);
        try {
            await user.reload();
            const verified = auth.currentUser?.emailVerified === true;
            setIsEmailVerified(verified);
            if (verified) {
                setEmailVerificationSent(false);
                Alert.alert('E-mail verificado', 'Sua conta foi confirmada com sucesso.');
            }
        } catch (error) {
            console.error('[Profile] Erro ao atualizar verificação de e-mail:', error);
        } finally {
            setCheckingEmailVerification(false);
        }
    };

    // `emailVerified` vem do token em cache do Auth e só muda após um reload().
    // Antes isso dependia de `emailVerificationSent`, que vive só nesta sessão:
    // quem abria o link em outro aparelho, ou reabria o app depois, continuava
    // vendo "não verificado" — e bloqueado para criar evento — até relogar.
    // Agora tenta enquanto não estiver verificado, e para assim que estiver.
    useEffect(() => {
        if (isEmailVerified) return;
        refreshEmailVerification();
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') refreshEmailVerification();
        });
        return () => subscription.remove();
    }, [isEmailVerified]);

    const startEditing = () => {
        setEditBio(userProfile?.bio || '');
        setEditNick(userProfile?.nick || auth.currentUser?.displayName?.replace(/\s/g, '').toLowerCase() || '');
        setEditInterests(normalizeInterests(userProfile?.interests));
        setShareFrequentedPlaces(userProfile?.shareFrequentedPlaces !== false);
        setShowFoundedPlaces(userProfile?.showFoundedPlaces !== false);
        setShowPopularOutsideInterests(userProfile?.showPopularOutsideInterests !== false);
        setNotifyMessages(savedNotificationSettings.notifyMessages);
        setNotifyEventUpdates(savedNotificationSettings.notifyEventUpdates);
        setNotifyEventReminders(savedNotificationSettings.notifyEventReminders);
        setNotifyRecommendations(savedNotificationSettings.notifyRecommendations);
        setEditPhotoURL(userProfile?.photoURL || auth.currentUser?.photoURL || null);
        resetPasswordEditor();
        resetProfileSaveConfirmation();
        setIsEditing(true);
    };

    const cancelEditing = () => {
        resetPasswordEditor();
        resetProfileSaveConfirmation();
        setIsEditing(false);
    };

    const handleChangePassword = async () => {
        if (!currentPassword) {
            Alert.alert('Senha atual necessária', 'Digite sua senha atual para confirmar que esta conta é sua.');
            return;
        }
        if (newPassword.length < 6) {
            Alert.alert('Nova senha inválida', 'A nova senha deve ter pelo menos 6 caracteres.');
            return;
        }
        if (newPassword === currentPassword) {
            Alert.alert('Escolha outra senha', 'A nova senha deve ser diferente da senha atual.');
            return;
        }
        if (newPassword !== confirmNewPassword) {
            Alert.alert('Senhas diferentes', 'A confirmação não corresponde à nova senha.');
            return;
        }

        setChangingPassword(true);
        try {
            const reauthenticated = await reauthenticateCurrentUser(currentPassword);
            if (!reauthenticated || !auth.currentUser) return;
            const user = auth.currentUser;
            await updatePassword(user, newPassword);
            resetPasswordEditor();
            profileLog('password_changed');
            Alert.alert('Senha alterada', 'Sua nova senha já está ativa.');
        } catch (error) {
            const code = getFirebaseErrorCode(error);
            console.error('[Profile] password_change_failed', { code });
            setCurrentPassword('');
            if (code === 'auth/weak-password') {
                Alert.alert('Senha fraca', 'Use uma senha com pelo menos 6 caracteres.');
            } else {
                showReauthenticationError(error);
            }
        } finally {
            setChangingPassword(false);
        }
    };

    const toggleEditSelection = (item: string, list: string[], setList: Dispatch<SetStateAction<string[]>>) => {
        if (list.includes(item)) {
            setList(list.filter((i: string) => i !== item));
            return;
        }
        // Marcar tudo faz o perfil casar com qualquer evento e esvazia o sentido
        // da recomendação — mesmo teto de 10 usado na criação de evento.
        if (list.length >= MAX_PROFILE_INTERESTS) {
            Alert.alert('Limite de interesses', `Escolha até ${MAX_PROFILE_INTERESTS} interesses para manter as recomendações relevantes.`);
            return;
        }
        setList([...list, item]);
    };

    const pickImage = async () => {
        try {
            // Sem base64: só a uri é usada no upload, e pedir base64 alocava a
            // imagem inteira em memória à toa.
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.5,
            });

            if (!result.canceled) {
                setEditPhotoURL(result.assets[0].uri);
            }
        } catch (error) {
            console.error('[Profile] image_pick_failed', { code: getFirebaseErrorCode(error) });
            Alert.alert('Não foi possível abrir a galeria', 'Verifique a permissão de fotos do app e tente novamente.');
        }
    };

    const nickHasChanged = () => normalizeNickname(editNick) !== (userProfile?.searchName ?? '');

    const requestProfileSave = () => {
        if (!isValidNickname(editNick)) {
            Alert.alert('Nick inválido', 'O nick deve ter de 3 a 20 caracteres: letras, números, ponto, hífen ou sublinhado.');
            return;
        }
        // Senha só na troca de nick: é o único campo de identidade pública (risco
        // de impersonação). Bio, interesses, foto e preferências salvam direto —
        // nem o Firebase nem as firestore.rules exigiam reautenticação para eles,
        // era um portão só do cliente que cobrava senha para virar um switch.
        if (nickHasChanged()) {
            setProfileConfirmationPassword('');
            setShowProfileSaveConfirmation(true);
            return;
        }
        void persistProfile();
    };

    /** Handler do modal de senha: reautentica e então persiste. */
    const saveProfile = async () => {
        if (loading) return;
        if (!auth.currentUser) return;
        if (!profileConfirmationPassword) {
            Alert.alert('Senha necessária', 'Digite sua senha atual para confirmar a troca de nick.');
            return;
        }

        setLoading(true);
        let reauthenticated = false;
        try {
            reauthenticated = await reauthenticateCurrentUser(profileConfirmationPassword);
        } catch (error) {
            console.warn('[Profile] profile_reauthentication_failed', { code: getFirebaseErrorCode(error) });
            showReauthenticationError(error);
        } finally {
            setLoading(false);
        }

        setProfileConfirmationPassword('');
        if (!reauthenticated) return;
        resetProfileSaveConfirmation();
        await persistProfile();
    };

    const persistProfile = async () => {
        const user = auth.currentUser;
        if (!user) return;

        setLoading(true);
        try {
            profileLog('profile_save_started', { interestsCount: editInterests.length, hasPhoto: Boolean(editPhotoURL) });

            let finalPhotoURL = userProfile?.photoURL || user.photoURL || null;
            if (editPhotoURL && editPhotoURL !== finalPhotoURL && !editPhotoURL.startsWith('http')) {
                finalPhotoURL = await uploadProfileImage(storage, user.uid, editPhotoURL);
            }

            const normalizedInterests = normalizeInterests(editInterests);

            await updateOwnProfile({
                userId: user.uid,
                previousSearchName: userProfile?.searchName,
                nick: editNick.trim(),
                bio: editBio,
                interests: normalizedInterests,
                photoURL: finalPhotoURL,
                showPopularOutsideInterests,
                shareFrequentedPlaces,
                showFoundedPlaces,
            });
            await setDoc(doc(db, 'notificationSettings', user.uid), {
                notifyMessages,
                notifyEventUpdates,
                notifyEventReminders,
                notifyRecommendations,
                ...(!notifyRecommendations ? { recommendationLocation: deleteField() } : {}),
                updatedAt: serverTimestamp(),
            }, { merge: true });
            await setEventRemindersEnabled(user.uid, notifyEventReminders);
            if (notifyEventReminders && !savedNotificationSettings.notifyEventReminders) {
                await syncOwnEventReminders(user.uid, true);
            }
            await setReengagementReminderEnabled(user.uid, notifyRecommendations);
            if (notifyRecommendations !== savedNotificationSettings.notifyRecommendations) {
                await clearRecommendationLocationCache(user.uid);
            }

            // O Firestore é a fonte do perfil público. A sessão do Auth é atualizada
            // depois, sem permitir que uma falha nela descarte a alteração persistida.
            try {
                await updateProfile(user, {
                    displayName: editNick.trim(),
                    photoURL: finalPhotoURL
                });
            } catch (authProfileError) {
                console.warn('[Profile] auth_profile_sync_failed', { code: getFirebaseErrorCode(authProfileError) });
            }

            resetPasswordEditor();
            resetProfileSaveConfirmation();
            setIsEditing(false);
            profileLog('profile_saved', { interestsCount: normalizedInterests.length, hasPhoto: Boolean(finalPhotoURL) });
            Alert.alert('Sucesso', 'Perfil atualizado!');
        } catch (error) {
            // A reautenticação já aconteceu em saveProfile; aqui só sobram falhas
            // de escrita (Firestore/Storage) e a colisão de nick.
            if (error instanceof NicknameUnavailableError) {
                Alert.alert('Nick indisponível', 'Este nick já pertence a outra pessoa. Escolha outro.');
            } else {
                console.error('[Profile] profile_save_failed', { code: getFirebaseErrorCode(error) });
                Alert.alert('Erro', 'Não foi possível salvar o perfil. Tente novamente.');
            }
        } finally {
            setLoading(false);
        }
    };

    // Contagem regressiva do reenvio: antes, emailVerificationSent desabilitava o
    // botão para sempre — se o e-mail não chegasse, não havia como pedir de novo.
    useEffect(() => {
        if (verificationResendCooldown <= 0) return;
        const timer = setTimeout(() => setVerificationResendCooldown((current) => current - 1), 1000);
        return () => clearTimeout(timer);
    }, [verificationResendCooldown]);

    const handleVerifyEmail = async () => {
        const user = auth.currentUser;
        if (!user || isEmailVerified || verificationResendCooldown > 0) return;
        try {
            await sendEmailVerification(user);
            setEmailVerificationSent(true);
            setVerificationResendCooldown(VERIFICATION_RESEND_COOLDOWN_SECONDS);
            profileLog('email_verification_sent');
            Alert.alert('E-mail enviado', 'Abra o link recebido. Ao voltar ao app, a confirmação será atualizada automaticamente.');
        } catch (error) {
            const code = getFirebaseErrorCode(error);
            console.error('[Profile] email_verification_send_failed', { code });
            // Sem cooldown quando falhou: o usuário precisa poder tentar de novo.
            Alert.alert('Erro', code === 'auth/too-many-requests'
                ? 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.'
                : 'Não foi possível enviar o e-mail. Aguarde um momento e tente novamente.');
        }
    };

    const handleLogout = async () => {
        try {
            profileLog('logout_started');
            const uid = auth.currentUser?.uid;
            if (uid) {
                await unregisterCurrentPushDevice(uid).catch(() => {
                    console.warn('[Profile] push_device_cleanup_failed');
                });
            }
            await auth.signOut();
            profileLog('logout_completed');
            // O portão do RootLayout leva ao login ao ver a sessão encerrada;
            // navegar daqui também montava o login duas vezes.
        } catch (error) {
            console.error('[Profile] logout_failed', { code: getFirebaseErrorCode(error) });
            Alert.alert('Erro', 'Falha ao sair.');
        }
    };

    const handleDeleteAccount = () => {
        Alert.alert(
            "Excluir Conta Permanentemente",
            "Sua conta, perfil, histórico de eventos e interesses serão excluídos de forma irreversível.\n\nDeseja realmente excluir sua conta?",
            [
                { text: "Cancelar", style: "cancel" },
                {
                    text: "Continuar",
                    style: "destructive",
                    onPress: () => {
                        setDeleteConfirmationPassword('');
                        setShowDeleteConfirmation(true);
                    }
                }
            ]
        );
    };

    const confirmAccountDeletion = async () => {
        if (loading) return;
        const user = auth.currentUser;
        if (!user) return;
        if (!deleteConfirmationPassword) {
            Alert.alert('Senha necessária', 'Digite sua senha atual para excluir permanentemente a conta.');
            return;
        }

        setLoading(true);
        try {
            const reauthenticated = await reauthenticateCurrentUser(deleteConfirmationPassword);
            if (!reauthenticated) {
                setDeleteConfirmationPassword('');
                return;
            }
            await user.getIdToken(true);
            setDeleteConfirmationPassword('');
            profileLog('account_deletion_started');
            await httpsCallable<Record<string, never>, { ok: boolean }>(functions, 'deleteMyAccount')({});
            setShowDeleteConfirmation(false);
            await auth.signOut().catch((signOutError: unknown) => {
                console.warn('[Profile] account_deleted_local_signout_failed', { code: getFirebaseErrorCode(signOutError) });
            });
            profileLog('account_deletion_completed');
            // Login fica a cargo do portão do RootLayout (ver handleLogout).
        } catch (error) {
            const code = getFirebaseErrorCode(error);
            setDeleteConfirmationPassword('');
            if (code?.startsWith('auth/')) {
                console.warn('[Profile] account_deletion_reauthentication_failed', { code });
                showReauthenticationError(error);
            } else {
                console.error('[Profile] account_deletion_failed', { code });
                Alert.alert('Conta não excluída', 'Nenhum novo pedido será necessário. Confirme sua senha e tente novamente mais tarde.');
            }
        } finally {
            setLoading(false);
        }
    };

    if (!auth.currentUser) {
        return (
            <View style={styles.center}>
                <Text>Você não está logado.</Text>
                <StyledButton title="Entrar" onPress={() => router.replace('/login')} />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
                <View style={[styles.avatar, (isEditing ? editPhotoURL : userProfile?.photoURL) && { backgroundColor: 'transparent' }]}>
                    {(isEditing ? editPhotoURL : userProfile?.photoURL) ? (
                        <TouchableOpacity onPress={isEditing ? pickImage : undefined} disabled={!isEditing}>
                            <Image source={{ uri: (isEditing ? editPhotoURL : userProfile?.photoURL) || undefined }} style={{ width: 100, height: 100, borderRadius: 50 }} />
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity onPress={isEditing ? pickImage : undefined} disabled={!isEditing} style={{justifyContent: 'center', alignItems: 'center'}}>
                            <Text style={styles.avatarText}>
                                {auth.currentUser?.displayName?.charAt(0) || 'U'}
                            </Text>
                            {isEditing && <Text style={{fontSize: 12, color: '#6366f1', marginTop: 4}}>Trocar foto</Text>}
                        </TouchableOpacity>
                    )}
                </View>
                <Text style={styles.name}>{userProfile?.displayName || auth.currentUser.displayName || 'Usuário'}</Text>
                {isEmailVerified ? (
                    <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 4}}>
                        <FontAwesome name="check-circle" size={14} color="#10B981" />
                        <Text style={[styles.email, {marginLeft: 4, marginTop: 0}]}>{auth.currentUser.email}</Text>
                    </View>
                ) : (
                    <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 4}}>
                        <Text style={[styles.email, {marginTop: 0}]}>{auth.currentUser.email}</Text>
                        <TouchableOpacity
                            onPress={handleVerifyEmail}
                            disabled={verificationResendCooldown > 0}
                            accessibilityRole="button"
                            accessibilityLabel="Enviar e-mail de verificação"
                            style={{ marginLeft: 8, backgroundColor: verificationResendCooldown > 0 ? '#F3F4F6' : '#FEF2F2', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 }}
                        >
                            <Text style={{fontSize: 10, color: verificationResendCooldown > 0 ? '#6B7280' : '#EF4444', fontWeight: 'bold'}}>
                                {verificationResendCooldown > 0
                                    ? `Reenviar em ${verificationResendCooldown}s`
                                    : emailVerificationSent ? 'Reenviar e-mail' : 'Verificar e-mail'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}

                {!isEmailVerified && (
                    <TouchableOpacity onPress={refreshEmailVerification} disabled={checkingEmailVerification} style={styles.refreshVerificationButton}>
                        <FontAwesome name="refresh" size={12} color="#4F46E5" />
                        <Text style={styles.refreshVerificationText}>{checkingEmailVerification ? 'Verificando...' : 'Já verifiquei'}</Text>
                    </TouchableOpacity>
                )}

                {!isEditing && (
                    <TouchableOpacity onPress={startEditing} style={styles.editBtn}>
                        <FontAwesome name="pencil" size={14} color="#6366f1" />
                        <Text style={styles.editBtnText}>Editar Perfil</Text>
                    </TouchableOpacity>
                )}

                {isEditing && (
                    <View style={styles.topEditActions}>
                        <View style={styles.topEditActionItem}>
                            <StyledButton title="Cancelar" onPress={cancelEditing} colors={['#9ca3af', '#d1d5db']} />
                        </View>
                        <View style={styles.topEditActionItem}>
                            <StyledButton title="Salvar perfil" onPress={requestProfileSave} isLoading={loading} />
                        </View>
                    </View>
                )}

                {isEditing ? (
                    <>
                        <Text style={styles.label}>Nickname (Único)</Text>
                        <TextInput
                            style={styles.nickInput}
                            placeholder="Seu Nick único"
                            value={editNick}
                            onChangeText={setEditNick}
                            autoCapitalize="none"
                            maxLength={NICK_MAX_LENGTH}
                        />
                        <Text style={styles.label}>Bio</Text>
                    </>
                ) : null}

                {isEditing ? (
                    <TextInput
                        style={styles.bioInput}
                        placeholder="Escreva algo sobre você..."
                        multiline
                        numberOfLines={3}
                        value={editBio}
                        onChangeText={setEditBio}
                        maxLength={BIO_MAX_LENGTH}
                    />
                ) : (
                    userProfile?.bio && <Text style={styles.bio}>{userProfile.bio}</Text>
                )}
            </View>

            {!isEditing && (
            <View style={styles.statsCard}>
                {/* A explicação da reputação já existe no Manual e nos Termos; aqui só
                    damos o atalho, em vez de manter uma terceira cópia da regra. */}
                <TouchableOpacity
                    style={styles.statItem}
                    onPress={() => setShowManualModal(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Entenda como funciona a reputação"
                >
                    <FontAwesome name="star" size={24} color="#fbbf24" />
                    <Text style={styles.statValue}>{userProfile?.reputation || 0}</Text>
                    <View style={styles.statLabelRow}>
                        <Text style={styles.statLabel}>Reputação</Text>
                        <FontAwesome name="question-circle" size={12} color="#9ca3af" />
                    </View>
                </TouchableOpacity>
                <View style={styles.divider} />
                <View style={styles.statItem}>
                    <FontAwesome name="calendar-check-o" size={24} color="#6366f1" />
                    <Text style={styles.statValue}>{userProfile?.eventsAttended || 0}</Text>
                    <Text style={styles.statLabel}>Participações</Text>
                </View>
                <View style={styles.divider} />
                {/* A bandeira abre a lista dos lugares inaugurados. O número sozinho
                    não dizia QUAIS lugares eram — e essa é a informação que dá
                    sentido ao título. */}
                <TouchableOpacity
                    style={styles.statItem}
                    onPress={() => auth.currentUser && router.push(`/founded-places/${auth.currentUser.uid}` as never)}
                    accessibilityRole="button"
                    accessibilityLabel="Ver os lugares que você fundou"
                >
                    <FontAwesome name="flag" size={24} color="#10b981" />
                    <Text style={styles.statValue}>{userProfile?.foundedPlacesCount || 0}</Text>
                    <View style={styles.statLabelRow}>
                        <Text style={styles.statLabel}>Fundador</Text>
                        <FontAwesome name="angle-right" size={13} color="#9ca3af" />
                    </View>
                </TouchableOpacity>
            </View>

            )}

            {isEditing && (
                <View style={styles.section}>
                    <View style={styles.securityHeader}>
                        <View style={styles.securityIcon}>
                            <FontAwesome name="lock" size={18} color="#4F46E5" />
                        </View>
                        <View style={styles.securityHeaderText}>
                            <Text style={styles.sectionTitleCompact}>Segurança</Text>
                            <Text style={styles.privacyDescription}>Sua senha atual é solicitada ao trocar o nick, já que é por ele que as pessoas te identificam. Você também pode alterá-la abaixo.</Text>
                        </View>
                    </View>

                    {!showPasswordEditor ? (
                        <TouchableOpacity
                            style={styles.passwordToggleButton}
                            onPress={() => setShowPasswordEditor(true)}
                            accessibilityRole="button"
                            accessibilityLabel="Alterar senha"
                        >
                            <Text style={styles.passwordToggleText}>Alterar senha</Text>
                            <FontAwesome name="angle-down" size={18} color="#4F46E5" />
                        </TouchableOpacity>
                    ) : (
                        <View style={styles.passwordForm}>
                            <Text style={styles.passwordLabel}>Senha atual</Text>
                            <TextInput
                                style={styles.passwordInput}
                                value={currentPassword}
                                onChangeText={setCurrentPassword}
                                placeholder="Digite sua senha atual"
                                secureTextEntry
                                autoCapitalize="none"
                                autoCorrect={false}
                                textContentType="password"
                                maxLength={PASSWORD_MAX_LENGTH}
                                editable={!changingPassword}
                            />
                            <Text style={styles.passwordLabel}>Nova senha</Text>
                            <TextInput
                                style={styles.passwordInput}
                                value={newPassword}
                                onChangeText={setNewPassword}
                                placeholder="Mínimo de 6 caracteres"
                                secureTextEntry
                                autoCapitalize="none"
                                autoCorrect={false}
                                textContentType="newPassword"
                                maxLength={PASSWORD_MAX_LENGTH}
                                editable={!changingPassword}
                            />
                            <Text style={styles.passwordLabel}>Confirmar nova senha</Text>
                            <TextInput
                                style={styles.passwordInput}
                                value={confirmNewPassword}
                                onChangeText={setConfirmNewPassword}
                                placeholder="Digite a nova senha novamente"
                                secureTextEntry
                                autoCapitalize="none"
                                autoCorrect={false}
                                textContentType="newPassword"
                                maxLength={PASSWORD_MAX_LENGTH}
                                editable={!changingPassword}
                            />
                            <StyledButton title="Confirmar nova senha" onPress={handleChangePassword} isLoading={changingPassword} />
                            <TouchableOpacity
                                style={styles.passwordCancelButton}
                                onPress={resetPasswordEditor}
                                disabled={changingPassword}
                                accessibilityRole="button"
                            >
                                <Text style={styles.passwordCancelText}>Cancelar alteração de senha</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            )}


            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Interesses</Text>
                <View style={styles.tagsContainer}>
                    {isEditing ? (
                        INTERESTS_OPTIONS.map(item => (
                            <TouchableOpacity
                                key={item}
                                style={[styles.tag, editInterests.includes(item) && styles.tagSelected]}
                                onPress={() => toggleEditSelection(item, editInterests, setEditInterests)}
                            >
                                <Text style={[styles.tagText, editInterests.includes(item) && styles.tagTextSelected]}>{item}</Text>
                            </TouchableOpacity>
                        ))
                    ) : (
                        userProfile?.interests && userProfile.interests.length > 0 ? (
                            userProfile.interests.map((tag: string) => (
                                <View key={tag} style={styles.tag}>
                                    <Text style={styles.tagText}>{tag}</Text>
                                </View>
                            ))
                        ) : (
                            <Text style={styles.placeholder}>Selecione seus interesses.</Text>
                        )
                    )}
                </View>
            </View>

            {isEditing && <View style={styles.section}>
                <Text style={styles.sectionTitle}>Privacidade</Text>
                <View style={styles.privacyRow}>
                    <View style={styles.privacyTextContainer}>
                        <Text style={styles.privacyTitle}>Mostrar lugares no perfil</Text>
                        <Text style={styles.privacyDescription}>Permite que outras pessoas vejam no seu perfil público quais locais comunitários você frequenta.</Text>
                    </View>
                    <Switch
                        value={shareFrequentedPlaces}
                        onValueChange={setShareFrequentedPlaces}
                        trackColor={{ false: '#D1D5DB', true: '#A5B4FC' }}
                        thumbColor={shareFrequentedPlaces ? '#4F46E5' : '#F9FAFB'}
                    />
                </View>
                <Text style={styles.privacyHint}>Esta opção altera somente a lista exibida no seu perfil. Seus dias e períodos continuam visíveis ao abrir o próprio local.</Text>

                <View style={styles.privacyRow}>
                    <View style={styles.privacyTextContainer}>
                        <Text style={styles.privacyTitle}>Mostrar lugares que fundei</Text>
                        <Text style={styles.privacyDescription}>Permite que outras pessoas abram, pelo seu perfil público, a lista dos locais que você inaugurou.</Text>
                    </View>
                    <Switch
                        value={showFoundedPlaces}
                        onValueChange={setShowFoundedPlaces}
                        trackColor={{ false: '#D1D5DB', true: '#A5B4FC' }}
                        thumbColor={showFoundedPlaces ? '#4F46E5' : '#F9FAFB'}
                    />
                </View>
                <Text style={styles.privacyHint}>O número de lugares fundados continua aparecendo no seu perfil; desligar esconde apenas a lista de quais são.</Text>
            </View>}

            {isEditing && <View style={styles.section}>
                <Text style={styles.sectionTitle}>Descoberta e recomendações</Text>
                <View style={styles.privacyRow}>
                    <View style={styles.privacyTextContainer}>
                        <Text style={styles.privacyTitle}>Eventos populares fora dos meus interesses</Text>
                        <Text style={styles.privacyDescription}>Inclui destaques populares próximos mesmo quando não combinam com suas tags.</Text>
                    </View>
                    <Switch
                        value={showPopularOutsideInterests}
                        onValueChange={setShowPopularOutsideInterests}
                        trackColor={{ false: '#D1D5DB', true: '#A5B4FC' }}
                        thumbColor={showPopularOutsideInterests ? '#4F46E5' : '#F9FAFB'}
                    />
                </View>
            </View>}

            {isEditing && <View style={styles.section}>
                <Text style={styles.sectionTitle}>Notificações</Text>
                <View style={styles.privacyRow}>
                    <View style={styles.privacyTextContainer}>
                        <Text style={styles.privacyTitle}>Mensagens</Text>
                        <Text style={styles.privacyDescription}>Receber notificações push quando alguém enviar uma mensagem.</Text>
                    </View>
                    <Switch value={notifyMessages} onValueChange={setNotifyMessages} />
                </View>
                <View style={styles.privacyRow}>
                    <View style={styles.privacyTextContainer}>
                        <Text style={styles.privacyTitle}>Atualizações de eventos</Text>
                        <Text style={styles.privacyDescription}>Receber push de convites, check-ins, cancelamentos e alterações de reputação.</Text>
                    </View>
                    <Switch value={notifyEventUpdates} onValueChange={setNotifyEventUpdates} />
                </View>
                <View style={styles.privacyRow}>
                    <View style={styles.privacyTextContainer}>
                        <Text style={styles.privacyTitle}>Lembretes de eventos</Text>
                        <Text style={styles.privacyDescription}>Lembretes locais duas horas antes, no início e no término dos eventos confirmados.</Text>
                    </View>
                    <Switch value={notifyEventReminders} onValueChange={setNotifyEventReminders} />
                </View>
                <View style={styles.privacyRow}>
                    <View style={styles.privacyTextContainer}>
                        <Text style={styles.privacyTitle}>Recomendações e novidades</Text>
                        <Text style={styles.privacyDescription}>Receba eventos relevantes do dia, com intervalo mínimo de três dias, e um lembrete após sete dias sem abrir o app.</Text>
                    </View>
                    <Switch value={notifyRecommendations} onValueChange={setNotifyRecommendations} />
                </View>
                <Text style={styles.privacyHint}>Desativar um push ou lembrete não apaga avisos importantes do sino. Eles permanecem no app para você consultar quando entrar.</Text>
            </View>}

            {!isEditing && (
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Suporte e Legal</Text>
                <View style={styles.menuContainer}>
                    <TouchableOpacity style={styles.menuItem} onPress={() => setShowTermsModal(true)}>
                        <View style={styles.menuItemLeft}>
                            <View style={[styles.menuIconContainer, { backgroundColor: '#eff6ff' }]}>
                                <FontAwesome name="file-text-o" size={16} color="#3b82f6" />
                            </View>
                            <Text style={styles.menuText}>Regras e Termos de Uso</Text>
                        </View>
                        <FontAwesome name="angle-right" size={20} color="#9ca3af" />
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.menuItem} onPress={() => setShowManualModal(true)}>
                        <View style={styles.menuItemLeft}>
                            <View style={[styles.menuIconContainer, { backgroundColor: '#fef3c7' }]}>
                                <FontAwesome name="book" size={16} color="#d97706" />
                            </View>
                            <Text style={styles.menuText}>Manual de Uso do App</Text>
                        </View>
                        <FontAwesome name="angle-right" size={20} color="#9ca3af" />
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.menuItem} onPress={() => {
                        Linking.openURL('https://sites.google.com/view/sosfiber-softwares/politica-de-privacidade');
                    }}>
                        <View style={styles.menuItemLeft}>
                            <View style={[styles.menuIconContainer, { backgroundColor: '#f0fdf4' }]}>
                                <FontAwesome name="lock" size={16} color="#16a34a" />
                            </View>
                            <Text style={styles.menuText}>Política de Privacidade</Text>
                        </View>
                        <FontAwesome name="angle-right" size={20} color="#9ca3af" />
                    </TouchableOpacity>
                    
                    <TouchableOpacity style={styles.menuItem} onPress={() => {
                        Linking.openURL('mailto:rodolfo.bm.reserva@gmail.com?subject=Contato%20e%20Feedback%20-%20Reunion%20Hub');
                    }}>
                        <View style={styles.menuItemLeft}>
                            <View style={[styles.menuIconContainer, { backgroundColor: '#fdf4ff' }]}>
                                <FontAwesome name="envelope-o" size={16} color="#d946ef" />
                            </View>
                            <Text style={styles.menuText}>Contato e Feedback</Text>
                        </View>
                        <FontAwesome name="angle-right" size={20} color="#9ca3af" />
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 0 }]} onPress={handleDeleteAccount}>
                        <View style={styles.menuItemLeft}>
                            <View style={[styles.menuIconContainer, { backgroundColor: '#fef2f2' }]}>
                                <FontAwesome name="trash-o" size={16} color="#ef4444" />
                            </View>
                            <Text style={[styles.menuText, { color: '#ef4444' }]}>Excluir Conta Permanentemente</Text>
                        </View>
                        <FontAwesome name="angle-right" size={20} color="#9ca3af" />
                    </TouchableOpacity>
                </View>
            </View>
            )}

            {!isEditing && (
                <View style={styles.logoutContainer}>
                    <StyledButton title="Sair" onPress={handleLogout} colors={['#ef4444', '#f87171']} />
                </View>
            )}

            {/* Modal de Termos de Uso */}
            <TermsModal visible={showTermsModal} onClose={() => setShowTermsModal(false)} />
            <ManualModal visible={showManualModal} onClose={() => setShowManualModal(false)} />
            <ScreenTutorialModal
                screen="perfil"
                visible={showTutorial}
                onClose={() => void dismissTutorial()}
            />
            </ScrollView>
            </KeyboardAvoidingView>

            <Modal
                visible={showProfileSaveConfirmation}
                transparent
                animationType="fade"
                onRequestClose={() => {
                    if (!loading) resetProfileSaveConfirmation();
                }}
            >
                <KeyboardAvoidingView
                    style={styles.confirmationOverlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                    <View style={styles.confirmationCard}>
                        <View style={styles.confirmationIcon}>
                            <FontAwesome name="shield" size={22} color="#4F46E5" />
                        </View>
                        <Text style={styles.confirmationTitle}>Confirme que é você</Text>
                        <Text style={styles.confirmationDescription}>Você está trocando seu nick, o nome pelo qual as pessoas te encontram. Digite sua senha atual para confirmar.</Text>
                        <TextInput
                            style={styles.passwordInput}
                            value={profileConfirmationPassword}
                            onChangeText={setProfileConfirmationPassword}
                            placeholder="Senha atual"
                            placeholderTextColor="#9CA3AF"
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                            textContentType="password"
                            maxLength={PASSWORD_MAX_LENGTH}
                            editable={!loading}
                            autoFocus
                            onSubmitEditing={saveProfile}
                            returnKeyType="done"
                            accessibilityLabel="Senha atual para confirmar a troca de nick"
                        />
                        <StyledButton title="Confirmar e salvar" onPress={saveProfile} isLoading={loading} />
                        <TouchableOpacity
                            style={styles.passwordCancelButton}
                            onPress={resetProfileSaveConfirmation}
                            disabled={loading}
                            accessibilityRole="button"
                            accessibilityLabel="Cancelar a troca de nick"
                        >
                            <Text style={styles.passwordCancelText}>Voltar à edição</Text>
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            <Modal
                visible={showDeleteConfirmation}
                transparent
                animationType="fade"
                onRequestClose={() => {
                    if (!loading) {
                        setShowDeleteConfirmation(false);
                        setDeleteConfirmationPassword('');
                    }
                }}
            >
                <KeyboardAvoidingView
                    style={styles.confirmationOverlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                    <View style={styles.confirmationCard}>
                        <View style={[styles.confirmationIcon, styles.deleteConfirmationIcon]}>
                            <FontAwesome name="trash" size={22} color="#DC2626" />
                        </View>
                        <Text style={styles.confirmationTitle}>Última confirmação</Text>
                        <Text style={styles.confirmationDescription}>Digite sua senha atual. Depois desta etapa, a conta e os dados vinculados serão excluídos permanentemente.</Text>
                        <TextInput
                            style={styles.passwordInput}
                            value={deleteConfirmationPassword}
                            onChangeText={setDeleteConfirmationPassword}
                            placeholder="Senha atual"
                            placeholderTextColor="#9CA3AF"
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                            textContentType="password"
                            maxLength={PASSWORD_MAX_LENGTH}
                            editable={!loading}
                            autoFocus
                            onSubmitEditing={confirmAccountDeletion}
                            returnKeyType="done"
                            accessibilityLabel="Senha atual para excluir a conta"
                        />
                        <StyledButton title="Excluir permanentemente" onPress={confirmAccountDeletion} isLoading={loading} colors={['#DC2626', '#EF4444']} />
                        <TouchableOpacity
                            style={styles.passwordCancelButton}
                            onPress={() => {
                                setShowDeleteConfirmation(false);
                                setDeleteConfirmationPassword('');
                            }}
                            disabled={loading}
                            accessibilityRole="button"
                        >
                            <Text style={styles.passwordCancelText}>Manter minha conta</Text>
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    content: { padding: 24, paddingBottom: 32, alignItems: 'center' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    header: { alignItems: 'center', marginBottom: 32 },
    avatar: {
        width: 100, height: 100, borderRadius: 50, backgroundColor: '#e5e7eb',
        justifyContent: 'center', alignItems: 'center', marginBottom: 16
    },
    avatarText: { fontSize: 40, fontWeight: 'bold', color: '#6b7280' },
    name: { fontSize: 24, fontWeight: 'bold', color: '#1f2937' },
    email: { fontSize: 16, color: '#6b7280' },
    refreshVerificationButton: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#EEF2FF' },
    refreshVerificationText: { fontSize: 12, fontWeight: '700', color: '#4F46E5' },
    topEditActions: { width: '100%', flexDirection: 'row', gap: 8, marginTop: 16 },
    topEditActionItem: { flex: 1 },
    statsCard: {
        flexDirection: 'row', backgroundColor: '#f9fafb', borderRadius: 16,
        padding: 24, width: '100%', marginBottom: 32,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05, shadowRadius: 4, elevation: 2
    },
    statItem: { flex: 1, alignItems: 'center' },
    statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    divider: { width: 1, backgroundColor: '#e5e7eb' },
    statValue: { fontSize: 24, fontWeight: 'bold', color: '#1f2937', marginTop: 8 },
    statLabel: { fontSize: 14, color: '#6b7280' },
    section: { width: '100%', marginBottom: 32 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 16, color: '#1f2937' },
    sectionTitleCompact: { fontSize: 18, fontWeight: 'bold', color: '#1f2937' },
    privacyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
    privacyTextContainer: { flex: 1 },
    privacyTitle: { fontSize: 15, fontWeight: '600', color: '#374151', marginBottom: 4 },
    privacyDescription: { fontSize: 13, color: '#6B7280', lineHeight: 18 },
    privacyHint: { fontSize: 12, color: '#9CA3AF', marginTop: 10 },
    placeholder: { fontSize: 14, color: '#9ca3af', fontStyle: 'italic' },
    logoutContainer: { width: '100%' },
    tagsContainer: { flexDirection: 'row', flexWrap: 'wrap' },
    tag: {
        paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f3f4f6',
        marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: '#e5e7eb'
    },
    tagSelected: { backgroundColor: '#e0e7ff', borderColor: '#6366f1' },
    tagText: { color: '#4b5563' },
    tagTextSelected: { color: '#4338ca', fontWeight: 'bold' },
    bio: {
        fontSize: 14,
        color: '#6b7280',
        textAlign: 'center',
        marginTop: 8,
        paddingHorizontal: 16,
    },
    label: {
        alignSelf: 'flex-start',
        marginLeft: 4,
        marginTop: 12,
        marginBottom: 4,
        fontSize: 14,
        fontWeight: 'bold',
        color: '#4b5563'
    },
    nickInput: {
        backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8,
        padding: 12, fontSize: 16, color: '#1f2937', width: '100%'
    },
    bioInput: {
        backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8,
        padding: 12, fontSize: 14, color: '#1f2937', textAlignVertical: 'top', minHeight: 80,
        width: '100%', marginTop: 4
    },
    securityHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
    securityIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
    securityHeaderText: { flex: 1 },
    passwordToggleButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#C7D2FE', backgroundColor: '#F5F7FF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
    passwordToggleText: { color: '#4338CA', fontSize: 15, fontWeight: '700' },
    passwordForm: { width: '100%' },
    passwordLabel: { fontSize: 14, fontWeight: '700', color: '#4B5563', marginTop: 10, marginBottom: 5 },
    passwordInput: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: '#1F2937', width: '100%' },
    passwordCancelButton: { alignItems: 'center', paddingVertical: 12 },
    passwordCancelText: { color: '#6B7280', fontSize: 14, fontWeight: '600' },
    confirmationOverlay: { flex: 1, backgroundColor: 'rgba(17, 24, 39, 0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    confirmationCard: { width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 22, alignItems: 'center' },
    confirmationIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
    deleteConfirmationIcon: { backgroundColor: '#FEE2E2' },
    confirmationTitle: { color: '#111827', fontSize: 20, fontWeight: '800', marginBottom: 6 },
    confirmationDescription: { color: '#6B7280', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 18 },
    editBtn: {
        flexDirection: 'row', alignItems: 'center', marginTop: 8,
        padding: 8, borderRadius: 20, backgroundColor: '#eff6ff'
    },
    editBtnText: {
        fontSize: 12, fontWeight: 'bold', color: '#6366f1', marginLeft: 6
    },
    // Menu Legal/Suporte
    menuContainer: { backgroundColor: '#f9fafb', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#f3f4f6' },
    menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
    menuItemLeft: { flexDirection: 'row', alignItems: 'center' },
    menuIconContainer: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    menuText: { fontSize: 15, fontWeight: '600', color: '#374151' },
});

