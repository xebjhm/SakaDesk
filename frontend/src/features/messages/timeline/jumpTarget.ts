import type { RowKey, Timeline } from './buildTimeline';

/** Where the target row should sit in the viewport after a jump. */
export type JumpAlign = 'start' | 'center' | 'end';

/** Every way the chat timeline can be jumped. `date` is a local YYYY-MM-DD (toLocalDateStr). */
export type JumpTarget =
    | { kind: 'message'; id: number; align?: 'start' | 'center' }
    | { kind: 'letter'; id: number }
    | { kind: 'date'; date: string }
    | { kind: 'firstUnread' }
    | { kind: 'top' }
    | { kind: 'bottom' };

export interface ResolvedJump {
    /** Item index in the timeline (group headers not counted). */
    index: number;
    /** The row's DOM id and highlight key; corrections re-find the row by it. */
    rowKey: RowKey;
    align: JumpAlign;
    /** Flash the landed row (message, letter and date jumps). */
    highlight: boolean;
    /** Measure and correct after landing (skipped for top/bottom, which Virtuoso lands exactly). */
    verify: boolean;
    /** Set for date jumps once the list is grouped: scroll to the day's group (GroupedVirtuoso `groupIndex`). */
    groupIndex?: number;
}

/** Index of the first unread message row; letters are never unread. -1 when nothing is unread. */
export function firstUnreadIndex(timeline: Timeline, isUnread: (id: number) => boolean): number {
    return timeline.items.findIndex((item) => item.kind === 'message' && isUnread(item.message.id));
}

function at(timeline: Timeline, index: number, align: JumpAlign, highlight: boolean, verify: boolean): ResolvedJump | null {
    const rowKey = index < 0 ? null : timeline.rowKeyAt(index);
    return rowKey === null ? null : { index, rowKey, align, highlight, verify };
}

/** Resolve a jump target to a timeline row, or null when there is nothing to jump to. */
export function resolveJump(
    timeline: Timeline,
    target: JumpTarget,
    isUnread: (id: number) => boolean,
): ResolvedJump | null {
    switch (target.kind) {
        case 'message':
            return at(timeline, timeline.indexOfMessage(target.id), target.align ?? 'start', true, true);
        case 'letter':
            return at(timeline, timeline.indexOfLetter(target.id), 'start', true, true);
        case 'date':
            return at(timeline, timeline.indexOfDate(target.date), 'start', true, true);
        case 'firstUnread':
            return at(timeline, firstUnreadIndex(timeline, isUnread), 'center', false, true);
        case 'top':
            return at(timeline, 0, 'start', false, false);
        case 'bottom':
            return at(timeline, timeline.items.length - 1, 'end', false, false);
    }
}

/** Log-safe code for a target kind (the client-log whitelist only takes [a-z0-9_]). */
export function jumpTargetCode(target: JumpTarget): 'message' | 'letter' | 'date' | 'first_unread' | 'top' | 'bottom' {
    return target.kind === 'firstUnread' ? 'first_unread' : target.kind;
}
