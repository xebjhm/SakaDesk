import type { Message } from '../../../types';
import { toLocalDateStr } from '../../../utils/dateFormatters';
import type { Letter } from '../letters';

/** Messages from the same sender on the same local day, at most this far apart, form one run. */
export const RUN_GAP_MS = 5 * 60 * 1000;

/** DOM id and highlight key of a row. Message and letter ids can collide, row keys cannot. */
export type RowKey = `msg-${number}` | `letter-${number}`;

export type TimelineItem =
    | { kind: 'message'; message: Message; runStart: boolean }
    | { kind: 'letter'; letter: Letter; runStart: true };

/**
 * The chat timeline as data: the one index source for the list, jumps, scroll restore,
 * unread navigation and the panel-visibility registry. Indices are item indices (group
 * headers are not counted).
 */
export interface Timeline {
    /** Chronological rows; letters merged by created_at (a tie puts the message first). */
    items: TimelineItem[];
    /** Rows per local day, for GroupedVirtuoso's `groupCounts`. */
    groupCounts: number[];
    /** Local YYYY-MM-DD (toLocalDateStr) of each group. */
    groupDates: string[];
    /** Index of each group's first row. */
    groupStarts: number[];
    indexOfMessage: (id: number) => number;
    indexOfLetter: (id: number) => number;
    /** First row of that local day, or -1. */
    indexOfDate: (date: string) => number;
    groupIndexOfDate: (date: string) => number;
    groupOfIndex: (index: number) => number;
    indexOfRowKey: (key: RowKey) => number;
    rowKeyAt: (index: number) => RowKey | null;
    /** Id of the nearest message at or above `index`, else the nearest below; null without messages. */
    messageIdNear: (index: number) => number | null;
}

export const messageRowKey = (id: number): RowKey => `msg-${id}`;
export const letterRowKey = (id: number): RowKey => `letter-${id}`;
export const rowKeyOf = (item: TimelineItem): RowKey =>
    item.kind === 'message' ? messageRowKey(item.message.id) : letterRowKey(item.letter.id);

function timeOf(iso: string): number | null {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : t;
}

interface Previous { kind: 'message' | 'letter'; day: string; sender: string; time: number | null }

/** Build the timeline. `messages` must be chronological (the backend sorts them); letters may come in any order. */
export function buildTimeline(messages: readonly Message[], letters: readonly Letter[]): Timeline {
    const dated = letters
        .map((letter) => ({ letter, time: timeOf(letter.created_at) }))
        .filter((l): l is { letter: Letter; time: number } => l.time !== null)
        .sort((a, b) => a.time - b.time);

    const items: TimelineItem[] = [];
    const groupCounts: number[] = [];
    const groupDates: string[] = [];
    const groupStarts: number[] = [];
    const groupOf: number[] = [];
    const add = (item: TimelineItem, day: string) => {
        if (groupDates.length === 0 || groupDates[groupDates.length - 1] !== day) {
            groupDates.push(day);
            groupCounts.push(0);
            groupStarts.push(items.length);
        }
        groupCounts[groupCounts.length - 1] += 1;
        groupOf.push(groupDates.length - 1);
        items.push(item);
    };
    const addLetter = (letter: Letter): Previous => {
        const day = toLocalDateStr(letter.created_at);
        add({ kind: 'letter', letter, runStart: true }, day);
        return { kind: 'letter', day, sender: '', time: null };
    };

    let prev: Previous | null = null;
    let next = 0;
    for (const message of messages) {
        const time = timeOf(message.timestamp);
        // Ties go to the message: only letters strictly earlier are placed before it.
        while (next < dated.length && time !== null && dated[next].time < time) {
            prev = addLetter(dated[next].letter);
            next += 1;
        }
        const day = toLocalDateStr(message.timestamp);
        const sender = String(message.member_id ?? '');
        const continues = prev !== null && prev.kind === 'message' && prev.day === day && prev.sender === sender
            && prev.time !== null && time !== null && time >= prev.time && time - prev.time <= RUN_GAP_MS;
        add({ kind: 'message', message, runStart: !continues }, day);
        prev = { kind: 'message', day, sender, time };
    }
    for (; next < dated.length; next += 1) addLetter(dated[next].letter);

    const byKey = new Map<RowKey, number>();
    items.forEach((item, i) => byKey.set(rowKeyOf(item), i));
    const groupByDate = new Map<string, number>();
    groupDates.forEach((date, g) => {
        if (!groupByDate.has(date)) groupByDate.set(date, g);
    });

    return {
        items,
        groupCounts,
        groupDates,
        groupStarts,
        indexOfMessage: (id) => byKey.get(messageRowKey(id)) ?? -1,
        indexOfLetter: (id) => byKey.get(letterRowKey(id)) ?? -1,
        indexOfRowKey: (key) => byKey.get(key) ?? -1,
        groupIndexOfDate: (date) => groupByDate.get(date) ?? -1,
        indexOfDate: (date) => {
            const g = groupByDate.get(date);
            return g === undefined ? -1 : groupStarts[g];
        },
        groupOfIndex: (index) => groupOf[index] ?? -1,
        rowKeyAt: (index) => {
            const item = items[index];
            return item ? rowKeyOf(item) : null;
        },
        messageIdNear: (index) => {
            for (let i = Math.min(index, items.length - 1); i >= 0; i -= 1) {
                const item = items[i];
                if (item.kind === 'message') return item.message.id;
            }
            for (let i = Math.max(index + 1, 0); i < items.length; i += 1) {
                const item = items[i];
                if (item.kind === 'message') return item.message.id;
            }
            return null;
        },
    };
}
