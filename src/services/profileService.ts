import { FirebaseStorage, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
    collection,
    doc,
    getDocs,
    limit,
    query,
    runTransaction,
    serverTimestamp,
    where,
    writeBatch,
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import { CURRENT_TERMS_VERSION } from '@/src/constants/legal';

const NICK_PATTERN = /^[a-z0-9._-]{3,20}$/;
const CONVERSATION_NAME_SYNC_LIMIT = 400;

export class NicknameUnavailableError extends Error {
    constructor() {
        super('Nickname indisponível.');
        this.name = 'NicknameUnavailableError';
    }
}

export function normalizeNickname(nick: string): string {
    return nick.trim().toLowerCase().replace(/\s+/g, '');
}

export function isValidNickname(nick: string): boolean {
    return NICK_PATTERN.test(normalizeNickname(nick));
}

async function assertNoLegacyNicknameOwner(searchName: string, userId: string): Promise<void> {
    const existingUsers = await getDocs(query(
        collection(db, 'users'),
        where('searchName', '==', searchName),
        limit(2),
    ));
    if (existingUsers.docs.some((profile) => profile.id !== userId)) {
        throw new NicknameUnavailableError();
    }
}

export async function createInitialUserProfile(input: {
    userId: string;
    nick: string;
    email: string;
}): Promise<void> {
    const searchName = normalizeNickname(input.nick);
    if (!isValidNickname(searchName)) throw new Error('invalid-nickname');

    await assertNoLegacyNicknameOwner(searchName, input.userId);
    const userRef = doc(db, 'users', input.userId);
    const nicknameRef = doc(db, 'nicknames', searchName);

    await runTransaction(db, async (transaction) => {
        const nicknameSnapshot = await transaction.get(nicknameRef);
        if (nicknameSnapshot.exists() && nicknameSnapshot.data().uid !== input.userId) {
            throw new NicknameUnavailableError();
        }

        transaction.set(nicknameRef, {
            uid: input.userId,
            updatedAt: serverTimestamp(),
        });
        transaction.set(userRef, {
            uid: input.userId,
            displayName: input.nick.trim(),
            nick: searchName,
            searchName,
            email: input.email,
            reputation: 0,
            eventsAttended: 0,
            foundedPlacesCount: 0,
            showPopularOutsideInterests: true,
            isProfileComplete: false,
            createdAt: new Date().toISOString(),
            termsVersion: CURRENT_TERMS_VERSION,
            termsAcceptedAt: serverTimestamp(),
        });
    });
}

async function syncConversationParticipantName(userId: string, displayName: string): Promise<void> {
    const conversations = await getDocs(query(
        collection(db, 'conversations'),
        where('participants', 'array-contains', userId),
        limit(CONVERSATION_NAME_SYNC_LIMIT),
    ));
    if (conversations.empty) return;

    const batch = writeBatch(db);
    conversations.docs.forEach((conversation) => {
        batch.update(conversation.ref, {
            [`participantNames.${userId}`]: displayName,
        });
    });
    await batch.commit();
    if (__DEV__ && conversations.size === CONVERSATION_NAME_SYNC_LIMIT) {
        console.warn('[ProfileService] conversation_name_sync_limit_reached');
    }
}

export async function updateOwnProfile(input: {
    userId: string;
    previousSearchName?: string;
    nick: string;
    bio: string;
    interests: string[];
    photoURL: string | null;
    showPopularOutsideInterests: boolean;
}): Promise<{ nickChanged: boolean }> {
    const searchName = normalizeNickname(input.nick);
    if (!isValidNickname(searchName)) throw new Error('invalid-nickname');

    await assertNoLegacyNicknameOwner(searchName, input.userId);
    const previousSearchName = input.previousSearchName
        ? normalizeNickname(input.previousSearchName)
        : undefined;
    const userRef = doc(db, 'users', input.userId);
    const nicknameRef = doc(db, 'nicknames', searchName);
    const previousNicknameRef = previousSearchName && previousSearchName !== searchName
        ? doc(db, 'nicknames', previousSearchName)
        : null;

    await runTransaction(db, async (transaction) => {
        const nicknameSnapshot = await transaction.get(nicknameRef);
        const previousNicknameSnapshot = previousNicknameRef
            ? await transaction.get(previousNicknameRef)
            : null;
        if (nicknameSnapshot.exists() && nicknameSnapshot.data().uid !== input.userId) {
            throw new NicknameUnavailableError();
        }

        transaction.set(nicknameRef, {
            uid: input.userId,
            updatedAt: serverTimestamp(),
        });
        transaction.set(userRef, {
            nick: input.nick.trim(),
            searchName,
            displayName: input.nick.trim(),
            bio: input.bio,
            interests: input.interests,
            photoURL: input.photoURL,
            showPopularOutsideInterests: input.showPopularOutsideInterests,
        }, { merge: true });
        if (previousNicknameRef && previousNicknameSnapshot?.data()?.uid === input.userId) {
            transaction.delete(previousNicknameRef);
        }
    });

    const nickChanged = searchName !== previousSearchName;
    if (nickChanged) await syncConversationParticipantName(input.userId, input.nick.trim());
    return { nickChanged };
}

export async function uploadProfileImage(storage: FirebaseStorage, userId: string, uri: string): Promise<string> {
    const response = await fetch(uri);
    const blob = await response.blob();
    const fileRef = ref(storage, `avatars/${userId}_${Date.now()}`);
    await uploadBytes(fileRef, blob);
    return getDownloadURL(fileRef);
}
