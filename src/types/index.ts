import type { Timestamp } from 'firebase/firestore';

export interface User {
    uid: string;
    nick?: string;
    displayName?: string;
    email?: string;
    photoURL?: string;
    bio?: string;
    searchName?: string;
    createdAt?: string;
    termsVersion?: string;
    termsAcceptedAt?: Timestamp | null;
    isProfileComplete?: boolean;
    expoPushToken?: string;
    reputation?: number;
    eventsAttended?: number;
    foundedPlacesCount?: number;
    interests?: string[];
    showPopularOutsideInterests?: boolean;
    shareFrequentedPlaces?: boolean;
    /** Ausente = público. Só `false` esconde a lista de lugares fundados. */
    showFoundedPlaces?: boolean;
    favorites?: string[];
    blockedUsers?: string[];
    role?: 'admin' | 'moderator';
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
    endDate?: string;
    endTime?: string;
    startsAt?: Timestamp | null;
    endsAt?: Timestamp | null;
    lat?: number;
    lng?: number;
    type?: 'in-person' | 'online';
    meetingLink?: string;
    placeId?: string;
    createdBy?: string;
    creatorName?: string;
    createdAt?: string | Timestamp | null;
    isRepeated?: boolean;
    seriesId?: string | null;
    attendees?: string[];
    checkedIn?: string[];
    pendingCheckIns?: CheckInRequest[];
    checkInReviewStartedAt?: Timestamp | null;
    checkInReviewDeadlineAt?: Timestamp | null;
    checkInReviewCompletedAt?: Timestamp | null;
    suggestedInviteeIds?: string[];
    status?: 'active' | 'awaiting_review' | 'completed' | 'cancelled';
    distance?: number; // local helper
}

export interface CheckInRequest {
    userId: string;
    displayName: string;
    requestedAt?: Timestamp | null;
}

export interface FavoriteEventSnapshot extends Meeting {
    sourceEventId: string;
    favoritedAt?: Timestamp | null;
    isFavoriteSnapshot: true;
}

export type HabitWeekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type HabitSchedule = Partial<Record<HabitWeekday, string[]>>;

export interface Place {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    vocations?: string[];
    founderId?: string;
    founderName?: string;
    discovererId?: string;
    discovererName?: string;
    discoveredAt?: Timestamp | null;
    frequenters?: string[];
    habitSchedules?: Record<string, HabitSchedule>;
    habits?: Record<string, string[]>;
    isCommunity?: boolean;
    currentUserHabitSchedule?: HabitSchedule;
    isCurrentUserFrequenting?: boolean;
}

export type CreateMeetingDraft = {
    title: string;
    interests: string[];
    description: string;
    locationName: string;
    date: string;
    time: string;
    endDate: string;
    endTime: string;
    lat: number;
    lng: number;
    type: 'in-person' | 'online';
    meetingLink: string;
    placeId: string;
};

export interface Message {
    id: string;
    text: string;
    senderId: string;
    createdAt?: Timestamp | null;
}

export interface Notification {
    id: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    meetingId?: string;
    eventChatId?: string;
    conversationId?: string;
    path?: string;
    createdAt?: Timestamp | null;
    read: boolean;
    fromUserId?: string;
    reputationDelta?: number;
    detailTitle?: string;
    detailBody?: string;
}

export interface EventInviteCandidate {
    uid: string;
    displayName: string;
    nick?: string;
    photoURL?: string;
    sharedEventsCount: number;
    previousParticipant: boolean;
}

export interface EventInviteResult {
    ok: boolean;
    alreadyInvited: boolean;
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
