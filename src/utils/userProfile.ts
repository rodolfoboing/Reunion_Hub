import { User } from '@/src/types';

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}

export function toUserProfile(uid: string, data: Record<string, unknown>): User {
    const role = data.role === 'admin' || data.role === 'moderator' ? data.role : undefined;

    return {
        uid,
        nick: stringValue(data.nick),
        displayName: stringValue(data.displayName),
        email: stringValue(data.email),
        photoURL: stringValue(data.photoURL),
        bio: stringValue(data.bio),
        searchName: stringValue(data.searchName),
        createdAt: stringValue(data.createdAt),
        isProfileComplete: booleanValue(data.isProfileComplete),
        expoPushToken: stringValue(data.expoPushToken),
        reputation: numberValue(data.reputation),
        eventsAttended: numberValue(data.eventsAttended),
        foundedPlacesCount: numberValue(data.foundedPlacesCount),
        interests: stringArrayValue(data.interests),
        showPopularOutsideInterests: booleanValue(data.showPopularOutsideInterests),
        shareFrequentedPlaces: booleanValue(data.shareFrequentedPlaces),
        favorites: stringArrayValue(data.favorites),
        blockedUsers: stringArrayValue(data.blockedUsers),
        role,
    };
}
