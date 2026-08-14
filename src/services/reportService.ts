import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/src/services/firebaseConfig';
import type { ReportTargetType } from '@/src/types';

type SubmitReportInput = {
    type: ReportTargetType;
    targetId: string;
    reason: string;
    conversationId?: string;
};

export async function submitReport(input: SubmitReportInput): Promise<{ alreadyReported: boolean }> {
    const reporterId = auth.currentUser?.uid;
    const targetId = input.targetId.trim();
    const reason = input.reason.trim();
    if (!reporterId) throw new Error('not-authenticated');
    if (!targetId || targetId.includes('/') || targetId.length > 200 || !reason || reason.length > 120) {
        throw new Error('invalid-report');
    }
    if (input.type === 'user' && targetId === reporterId) throw new Error('self-report');

    const reportRef = doc(db, 'reports', `${input.type}_${targetId}_${reporterId}`);
    if ((await getDoc(reportRef)).exists()) return { alreadyReported: true };

    await setDoc(reportRef, {
        type: input.type,
        targetId,
        reportedBy: reporterId,
        reason,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        createdAt: serverTimestamp(),
    });
    return { alreadyReported: false };
}
