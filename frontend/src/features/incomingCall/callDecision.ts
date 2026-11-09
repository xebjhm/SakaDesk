import type { Message } from '../../types';

/**
 * Why a call did not ring. Logged verbatim as the `reason` breadcrumb field.
 * `popup_active` is produced only by useIncomingCall's isCallElsewhere check, never by decideCall.
 */
export type CallSkipReason =
    | 'disabled' | 'group_chat' | 'no_voice' | 'already_read'
    | 'no_photo' | 'dismissed_this_visit' | 'call_active' | 'popup_active';

export interface CallDecisionInput {
    enabled: boolean;
    isGroupChat: boolean;
    messages: Message[];
    isUnread: (id: number) => boolean;
    photoUrl: string | undefined;
    dismissedIds: ReadonlySet<number>;
    callActive: boolean;
}

export type CallDecision =
    | { ring: true; message: Message }
    | { ring: false; reason: CallSkipReason; messageId?: number };

function timeOf(m: Message): number {
    const t = Date.parse(m.timestamp);
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** The newest voice message by timestamp; ties go to the larger id. */
export function pickCandidate(messages: Message[]): Message | undefined {
    let best: Message | undefined;
    for (const m of messages) {
        if (m.type !== 'voice') continue;
        if (!best) {
            best = m;
            continue;
        }
        const a = timeOf(m);
        const b = timeOf(best);
        if (a > b || (a === b && m.id > best.id)) best = m;
    }
    return best;
}

/** Decide whether to ring. Conditions are checked in spec order; the first failure is the reason. */
export function decideCall(input: CallDecisionInput): CallDecision {
    if (!input.enabled) return { ring: false, reason: 'disabled' };
    if (input.isGroupChat) return { ring: false, reason: 'group_chat' };
    const candidate = pickCandidate(input.messages);
    if (!candidate) return { ring: false, reason: 'no_voice' };
    const messageId = candidate.id;
    if (!input.isUnread(messageId)) return { ring: false, reason: 'already_read', messageId };
    if (!input.photoUrl) return { ring: false, reason: 'no_photo', messageId };
    if (input.dismissedIds.has(messageId)) return { ring: false, reason: 'dismissed_this_visit', messageId };
    if (input.callActive) return { ring: false, reason: 'call_active', messageId };
    return { ring: true, message: candidate };
}
