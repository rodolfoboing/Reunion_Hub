import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, Image, TextInput, Linking, Switch, AppState } from 'react-native';
import { useState, useEffect } from 'react';
import { auth, db, functions } from '../../src/services/firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import { doc, setDoc, collection, query, where, getDocs, deleteDoc, onSnapshot } from 'firebase/firestore';
import { updateProfile, deleteUser, sendEmailVerification } from 'firebase/auth';
import { storage } from '../../src/services/firebaseConfig';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { FontAwesome } from '@expo/vector-icons';
import { StyledButton } from '@/src/components/StyledButton';
import { TermsModal } from '@/src/components/TermsModal';
import { ManualModal } from '@/src/components/ManualModal';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { INTERESTS_OPTIONS, normalizeInterests } from '../../src/constants/Interests';

export default function ProfileScreen() {
    const [userProfile, setUserProfile] = useState<any>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editBio, setEditBio] = useState('');
    const [editNick, setEditNick] = useState('');
    const [editInterests, setEditInterests] = useState<string[]>([]);
    const [shareFrequentedPlaces, setShareFrequentedPlaces] = useState(false);
    const [showPopularOutsideInterests, setShowPopularOutsideInterests] = useState(true);
    const [editPhotoURL, setEditPhotoURL] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [showTermsModal, setShowTermsModal] = useState(false);
    const [showManualModal, setShowManualModal] = useState(false);
    const [isEmailVerified, setIsEmailVerified] = useState(auth.currentUser?.emailVerified ?? false);
    const [emailVerificationSent, setEmailVerificationSent] = useState(false);
    const [checkingEmailVerification, setCheckingEmailVerification] = useState(false);

    useEffect(() => {
        const user = auth.currentUser;
        if (!user) return;

        const docRef = doc(db, 'users', user.uid);
        return onSnapshot(docRef, (snap) => {
                if (snap.exists()) {
                    const data = snap.data();
                    setUserProfile({ ...data, interests: normalizeInterests(data.interests) });
                    // Default nick to display name part if not set (fallback)
                    if (!data.nick && auth.currentUser?.displayName) {
                        setEditNick(auth.currentUser.displayName.replace(/\s/g, '').toLowerCase());
                    } else {
                        setEditNick(data.nick || '');
                    }
                }
            }, (profileError) => {
                console.error('[Profile] Erro ao atualizar perfil:', profileError);
            });
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
                await setDoc(doc(db, 'users', user.uid), { emailVerified: true }, { merge: true });
                Alert.alert('E-mail verificado', 'Sua conta foi confirmada com sucesso.');
            }
        } catch (error) {
            console.error('[Profile] Erro ao atualizar verificação de e-mail:', error);
        } finally {
            setCheckingEmailVerification(false);
        }
    };

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active' && emailVerificationSent) {
                refreshEmailVerification();
            }
        });
        return () => subscription.remove();
    }, [emailVerificationSent]);

    const startEditing = () => {
        setEditBio(userProfile?.bio || '');
        setEditNick(userProfile?.nick || auth.currentUser?.displayName?.replace(/\s/g, '').toLowerCase() || '');
        setEditInterests(normalizeInterests(userProfile?.interests));
        setShareFrequentedPlaces(userProfile?.shareFrequentedPlaces === true);
        setShowPopularOutsideInterests(userProfile?.showPopularOutsideInterests !== false);
        setEditPhotoURL(userProfile?.photoURL || auth.currentUser?.photoURL || null);
        setIsEditing(true);
    };

    const cancelEditing = () => {
        setIsEditing(false);
    };

    const toggleEditSelection = (item: string, list: string[], setList: any) => {
        if (list.includes(item)) {
            setList(list.filter((i: string) => i !== item));
        } else {
            setList([...list, item]);
        }
    };

    const checkNickAvailability = async (nick: string) => {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('nick', '==', nick));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) return true;

        // If matches, check if it's me
        const isMe = querySnapshot.docs.find(d => d.id === auth.currentUser?.uid);
        return !!isMe; // Available if the only match is me, or if no match
    };

    const pickImage = async () => {
        let result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.5,
            base64: true,
        });

        if (!result.canceled) {
            setEditPhotoURL(result.assets[0].uri);
        }
    };

    const uploadImageAsync = async (uri: string) => {
        const response = await fetch(uri);
        const blob = await response.blob();
        
        const fileRef = ref(storage, `avatars/${auth.currentUser?.uid}_${Date.now()}`);
        await uploadBytes(fileRef, blob);
        return await getDownloadURL(fileRef);
    };

    const saveProfile = async () => {
        if (!auth.currentUser) return;

        if (!editNick.trim()) {
            Alert.alert('Erro', 'O Nickname não pode ser vazio.');
            return;
        }

        setLoading(true);

        try {
            // Check Nick Uniqueness se mudou
            if (editNick.trim() !== userProfile?.nick) {
                const isAvailable = await checkNickAvailability(editNick.trim());
                if (!isAvailable) {
                    setLoading(false);
                    Alert.alert('Erro', 'Este Nickname já está em uso. Escolha outro.');
                    return;
                }
            }
            if (editNick.trim().length < 3) {
                Alert.alert('Atenção', 'O Nickname deve ter pelo menos 3 caracteres.');
                setLoading(false);
                return;
            }

            const searchName = editNick.trim().toLowerCase();

            // Validate nick uniqueness
            if (searchName !== userProfile?.searchName) {
                const usersRef = collection(db, 'users');
                const q = query(usersRef, where('searchName', '==', searchName));
                const querySnapshot = await getDocs(q);

                const isTaken = querySnapshot.docs.some(d => d.id !== auth.currentUser?.uid);
                if (isTaken) {
                    Alert.alert('Erro', 'Este Nickname já está em uso. Por favor, escolha outro.');
                    setLoading(false);
                    return;
                }
            }

            let finalPhotoURL = userProfile?.photoURL || auth.currentUser.photoURL || null;
            if (editPhotoURL && editPhotoURL !== finalPhotoURL && !editPhotoURL.startsWith('http')) {
                finalPhotoURL = await uploadImageAsync(editPhotoURL);
            }

            const normalizedInterests = normalizeInterests(editInterests);

            // Update local state immediately
            setUserProfile({
                ...userProfile,
                nick: editNick.trim(),
                bio: editBio,
                interests: normalizedInterests,
                shareFrequentedPlaces,
                showPopularOutsideInterests,
                photoURL: finalPhotoURL,
                searchName: searchName
            });

            // Update Auth Profile Display Name & Photo
            await updateProfile(auth.currentUser, { 
                displayName: editNick.trim(),
                photoURL: finalPhotoURL 
            });

            // Update Firestore
            const docRef = doc(db, 'users', auth.currentUser.uid);
            await setDoc(docRef, {
                nick: editNick.trim(),
                bio: editBio,
                interests: normalizedInterests,
                shareFrequentedPlaces,
                showPopularOutsideInterests,
                searchName: searchName,
                displayName: editNick.trim(),
                photoURL: finalPhotoURL
            }, { merge: true });

            setIsEditing(false);
            Alert.alert('Sucesso', 'Perfil atualizado!');
        } catch (error) {
            console.error('Save Profile error:', error);
            Alert.alert('Erro', 'Falha ao salvar o perfil.');
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyEmail = async () => {
        const user = auth.currentUser;
        if (!user || emailVerificationSent || isEmailVerified) return;
        try {
            await sendEmailVerification(user);
            setEmailVerificationSent(true);
            Alert.alert('E-mail enviado', 'Abra o link recebido. Ao voltar ao app, a confirmação será atualizada automaticamente.');
        } catch (error) {
            console.error(error);
            Alert.alert('Erro', 'Não foi possível enviar o e-mail. Aguarde um momento e tente novamente.');
        }
    };

    const handleLogout = async () => {
        try {
            await auth.signOut();
            router.replace('/login');
        } catch (error) {
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
                    text: "Excluir Conta",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            const user = auth.currentUser;
                            if (user) {
                                setLoading(true);
                                await httpsCallable(functions, 'deleteMyAccount')({});
                                await auth.signOut();
                            }
                        } catch (error: any) {
                            setLoading(false);
                            if (error.code === 'auth/requires-recent-login') {
                                Alert.alert("Atenção", "Por motivos de segurança, você precisa sair e fazer login novamente antes de excluir sua conta.");
                            } else {
                                Alert.alert("Erro", "Ocorreu um erro ao tentar excluir a conta. Tente novamente mais tarde.");
                            }
                        }
                    }
                }
            ]
        );
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
            <ScrollView contentContainerStyle={styles.content}>
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
                <Text style={styles.name}>{auth.currentUser.displayName}</Text>
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
                            disabled={emailVerificationSent}
                            style={{ marginLeft: 8, backgroundColor: emailVerificationSent ? '#F3F4F6' : '#FEF2F2', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 }}
                        >
                            <Text style={{fontSize: 10, color: emailVerificationSent ? '#6B7280' : '#EF4444', fontWeight: 'bold'}}>{emailVerificationSent ? 'E-mail enviado' : 'Verificar e-mail'}</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {!isEmailVerified && emailVerificationSent && (
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
                            <StyledButton title="Salvar" onPress={saveProfile} isLoading={loading} />
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
                    />
                ) : (
                    userProfile?.bio && <Text style={styles.bio}>{userProfile.bio}</Text>
                )}
            </View>

            {!isEditing && (
            <View style={styles.statsCard}>
                <View style={styles.statItem}>
                    <FontAwesome name="star" size={24} color="#fbbf24" />
                    <Text style={styles.statValue}>{userProfile?.reputation || 0}</Text>
                    <Text style={styles.statLabel}>Reputação</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.statItem}>
                    <FontAwesome name="calendar-check-o" size={24} color="#6366f1" />
                    <Text style={styles.statValue}>{userProfile?.eventsAttended || 0}</Text>
                    <Text style={styles.statLabel}>Participações</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.statItem}>
                    <FontAwesome name="flag" size={24} color="#10b981" />
                    <Text style={styles.statValue}>{userProfile?.foundedPlacesCount || 0}</Text>
                    <Text style={styles.statLabel}>Fundador</Text>
                </View>
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
                        <Text style={styles.privacyTitle}>Mostrar lugares que frequento</Text>
                        <Text style={styles.privacyDescription}>Permite que outras pessoas vejam os locais comunitários que você acompanha.</Text>
                    </View>
                    <Switch
                        value={shareFrequentedPlaces}
                        onValueChange={setShareFrequentedPlaces}
                        trackColor={{ false: '#D1D5DB', true: '#A5B4FC' }}
                        thumbColor={shareFrequentedPlaces ? '#4F46E5' : '#F9FAFB'}
                    />
                </View>
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
                            <Text style={[styles.menuText, { color: '#ef4444' }]}>Solicitar Exclusão da Conta</Text>
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
            </ScrollView>
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
    divider: { width: 1, backgroundColor: '#e5e7eb' },
    statValue: { fontSize: 24, fontWeight: 'bold', color: '#1f2937', marginTop: 8 },
    statLabel: { fontSize: 14, color: '#6b7280' },
    section: { width: '100%', marginBottom: 32 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 16, color: '#1f2937' },
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
    editBtn: {
        flexDirection: 'row', alignItems: 'center', marginTop: 8,
        padding: 8, borderRadius: 20, backgroundColor: '#eff6ff'
    },
    editBtnText: {
        fontSize: 12, fontWeight: 'bold', color: '#6366f1', marginLeft: 6
    },
    actionButtons: {
        flexDirection: 'row', justifyContent: 'space-between'
    },
    // Menu Legal/Suporte
    menuContainer: { backgroundColor: '#f9fafb', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#f3f4f6' },
    menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
    menuItemLeft: { flexDirection: 'row', alignItems: 'center' },
    menuIconContainer: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    menuText: { fontSize: 15, fontWeight: '600', color: '#374151' },
});

