import { httpsCallable } from 'firebase/functions';
import { functions } from '@/src/services/firebaseConfig';
import { EventInviteCandidate, EventInviteResult } from '@/src/types';

type InviteCandidatesResponse = { candidates: EventInviteCandidate[] };
type InviteByIdRequest = { eventId: string; targetUserId: string };
type InviteByNickRequest = { eventId: string; targetNick: string };

export async function getEventInviteCandidates(eventId: string): Promise<EventInviteCandidate[]> {
    const callable = httpsCallable<{ eventId: string }, InviteCandidatesResponse>(functions, 'getEventInviteCandidates');
    const result = await callable({ eventId });
    return result.data.candidates;
}

export async function inviteUserToEvent(request: InviteByIdRequest | InviteByNickRequest): Promise<EventInviteResult> {
    const callable = httpsCallable<InviteByIdRequest | InviteByNickRequest, EventInviteResult>(functions, 'inviteUserToEvent');
    const result = await callable(request);
    return result.data;
}
