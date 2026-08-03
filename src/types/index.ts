export interface User {
    uid: string;
    nick?: string;
    displayName?: string;
    email?: string;
    photoURL?: string;
    reputation?: number;
    eventsAttended?: number;
    foundedPlacesCount?: number;
    interests?: string[];
    showPopularOutsideInterests?: boolean;
    blockedUsers?: string[];
}

export interface Meeting {
    id: string;
    title: string;
    theme?: string;
    interests?: string[];
    description?: string;
    locationName?: string;
    date?: string;
    time?: string;
    lat?: number;
    lng?: number;
    type?: 'in-person' | 'online';
    meetingLink?: string;
    placeId?: string;
    createdBy?: string;
    creatorName?: string;
    createdAt?: string;
    isRepeated?: boolean;
    attendees?: string[];
    checkedIn?: string[];
    status?: 'active' | 'completed' | 'cancelled';
    distance?: number; // local helper
}

export interface Place {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    vocations?: string[];
    founderId?: string;
    founderName?: string;
    frequenters?: string[];
    habits?: Record<string, string[]>;
    isCommunity?: boolean;
}

export interface Message {
    id: string;
    text: string;
    senderId: string;
    createdAt: any; // Firestore Timestamp
}

export interface Notification {
    id: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    meetingId?: string;
    conversationId?: string;
    createdAt: any;
    read: boolean;
    fromUserId?: string;
}

export type ReportTargetType = 'user' | 'event';

export interface Report {
    id: string;
    type: ReportTargetType;
    targetId: string;
    reportedBy: string;
    reason?: string;
    createdAt?: unknown;
}
