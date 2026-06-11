import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, Image, TextInput } from 'react-native';
import { useState, useEffect } from 'react';
import { auth, db } from '../../src/services/firebaseConfig';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { storage } from '../../src/services/firebaseConfig';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { FontAwesome } from '@expo/vector-icons';
import { StyledButton } from '@/src/components/StyledButton';
import { router } from 'expo-router';

import { INTERESTS_OPTIONS } from '../../src/constants/Interests';

export default function ProfileScreen() {
    const [userProfile, setUserProfile] = useState<any>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editBio, setEditBio] = useState('');
    const [editNick, setEditNick] = useState('');
    const [editInterests, setEditInterests] = useState<string[]>([]);
    const [editPhotoURL, setEditPhotoURL] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (auth.currentUser) {
            const docRef = doc(db, 'users', auth.currentUser.uid);
            getDoc(docRef).then(snap => {
                if (snap.exists()) {
                    const data = snap.data();
                    setUserProfile(data);
                    // Default nick to display name part if not set (fallback)
                    if (!data.nick && auth.currentUser?.displayName) {
                        setEditNick(auth.currentUser.displayName.replace(/\s/g, '').toLowerCase());
                    } else {
                        setEditNick(data.nick || '');
                    }
                }
            });
        }
    }, []);

    const startEditing = () => {
        setEditBio(userProfile?.bio || '');
        setEditNick(userProfile?.nick || auth.currentUser?.displayName?.replace(/\s/g, '').toLowerCase() || '');
        setEditInterests(userProfile?.interests || []);
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

            let finalPhotoURL = userProfile?.photoURL || auth.currentUser.photoURL || null;
            if (editPhotoURL && editPhotoURL !== finalPhotoURL && !editPhotoURL.startsWith('http')) {
                finalPhotoURL = await uploadImageAsync(editPhotoURL);
            }

            // Update local state immediately
            setUserProfile({
                ...userProfile,
                nick: editNick.trim(),
                bio: editBio,
                interests: editInterests,
                photoURL: finalPhotoURL
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
                interests: editInterests,
                searchName: editNick.trim().toLowerCase(),
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

    const handleLogout = async () => {
        try {
            await auth.signOut();
            router.replace('/login');
        } catch (error) {
            Alert.alert('Erro', 'Falha ao sair.');
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
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
                <Text style={styles.email}>{auth.currentUser.email}</Text>

                {!isEditing && (
                    <TouchableOpacity onPress={startEditing} style={styles.editBtn}>
                        <FontAwesome name="pencil" size={14} color="#6366f1" />
                        <Text style={styles.editBtnText}>Editar Perfil</Text>
                    </TouchableOpacity>
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
                    <Text style={styles.statLabel}>Eventos</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.statItem}>
                    <FontAwesome name="flag" size={24} color="#10b981" />
                    <Text style={styles.statValue}>{userProfile?.foundedPlacesCount || 0}</Text>
                    <Text style={styles.statLabel}>Fundador</Text>
                </View>
            </View>


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

            <View style={styles.logoutContainer}>
                {isEditing ? (
                    <View style={styles.actionButtons}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                            <StyledButton title="Cancelar" onPress={cancelEditing} colors={['#9ca3af', '#d1d5db']} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <StyledButton title="Salvar" onPress={saveProfile} isLoading={loading} />
                        </View>
                    </View>
                ) : (
                    <StyledButton title="Sair" onPress={handleLogout} colors={['#ef4444', '#f87171']} />
                )}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    content: { padding: 24, alignItems: 'center' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    header: { alignItems: 'center', marginBottom: 32 },
    avatar: {
        width: 100, height: 100, borderRadius: 50, backgroundColor: '#e5e7eb',
        justifyContent: 'center', alignItems: 'center', marginBottom: 16
    },
    avatarText: { fontSize: 40, fontWeight: 'bold', color: '#6b7280' },
    name: { fontSize: 24, fontWeight: 'bold', color: '#1f2937' },
    email: { fontSize: 16, color: '#6b7280' },
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
    }
});

