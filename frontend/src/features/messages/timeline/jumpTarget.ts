import type { Message } from '../../../types';
import { toLocalDateStr } from '../../../utils/dateFormatters';

/** Where the target row should sit in the viewport after a jump. */
export type JumpAlign = 'start' | 'center' | 'end';

/** Every way the chat timeline can be jumped. `date` is a local YYYY-MM-DD (toLocalDateStr). */
export type JumpTarget =
    | { kind: 'message'; id: number; align?: 'start' | 'center' }
    | { kind: 'date'; date: string }
    | { kind: 'firstUnread' }
    | { kind: 'top' }
    | { kind: 'bottom' };

export interface ResolvedJump {
    index: number;
    messageId: number;
    align: JumpAlign;
    /** Flash the landed row (message and date jumps). */
    highlight: boolean;
    /** Measure and correct after landing (skipped for top/bottom, which Virtuoso lands exactly). */
    verify: boolean;
}

type JumpMessage = Pick<Message, 'id' | 'timestamp'>;

const at = (messages: readonly JumpMessage[], index: number, align: JumpAlign, highlight: boolean, verify: boolean): ResolvedJump | null =>
    index < 0 || index >= messages.length ? null : { index, messageId: messages[index].id, align, highlight, verify };

/** Resolve a jump target to a row of `messages`, or null when there is nothing to jump to. */
export function resolveJump(
    messages: readonly JumpMessage[],
    target: JumpTarget,
    isUnread: (id: number) => boolean,
): ResolvedJump | null {
    switch (target.kind) {
        case 'message':
            return at(messages, messages.findIndex(m => m.id === target.id), target.align ?? 'start', true, true);
        case 'date':
            return at(messages, messages.findIndex(m => toLocalDateStr(m.timestamp) === target.date), 'start', true, true);
        case 'firstUnread':
            return at(messages, messages.findIndex(m => isUnread(m.id)), 'center', false, true);
        case 'top':
            return at(messages, 0, 'start', false, false);
        case 'bottom':
            return at(messages, messages.length - 1, 'end', false, false);
    }
}

/** Log-safe code for a target kind (the client-log whitelist only takes [a-z0-9_]). */
export function jumpTargetCode(target: JumpTarget): 'message' | 'date' | 'first_unread' | 'top' | 'bottom' {
    return target.kind === 'firstUnread' ? 'first_unread' : target.kind;
}
