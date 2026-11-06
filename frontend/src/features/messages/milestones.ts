import { useEffect, useRef, useState } from 'react';
import { persisted } from '../../core/persistence/persisted';
import { clientLog } from '../../utils/clientLog';

/** Message counts a member chat celebrates (spec §9). */
export const MESSAGE_MILESTONES = [1000, 5000, 10000] as const;
/** Celebrated (and seeded) milestones per room: `{ "<service>|<room dir>": { messages: [...], days: [...] } }`. */
export const MILESTONES_PREF = 'celebrated_milestones';

export type MilestoneKind = 'messages' | 'days';
export interface Milestone { kind: MilestoneKind; value: number }
export type MilestoneStore = Record<string, Partial<Record<MilestoneKind, number[]>>>;

const DAYS_PER_YEAR = 365;

export function reachedMessageMilestones(total: number): number[] {
    return MESSAGE_MILESTONES.filter((n) => total >= n);
}

/** Subscription day 100, then every full year (spec §9). */
export function reachedDayMilestones(days: number): number[] {
    const reached: number[] = days >= 100 ? [100] : [];
    for (let d = DAYS_PER_YEAR; d <= days; d += DAYS_PER_YEAR) reached.push(d);
    return reached;
}

/**
 * What one chat open celebrates, and the store to save (decision D10). A kind seen for the
 * first time in a room is seeded silently: only milestones reached from then on are celebrated.
 * At most one card per open: a new messages milestone first, else a new days one; the highest
 * new value of that kind shows and every lower new value is recorded with it. A kind given as
 * `null` (its data is not known yet) is left alone. With `canShow` false (a card was already
 * shown for this open) new milestones are neither shown nor recorded, so a later open
 * celebrates them; seeding still happens.
 */
export function decideMilestone(
    roomKey: string,
    reached: Record<MilestoneKind, number[] | null>,
    store: MilestoneStore,
    canShow = true,
): { show: Milestone | null; seeded: MilestoneKind[]; next: MilestoneStore } {
    const room: Partial<Record<MilestoneKind, number[]>> = { ...(store[roomKey] ?? {}) };
    const seeded: MilestoneKind[] = [];
    let show: Milestone | null = null;
    for (const kind of ['messages', 'days'] as const) {
        const values = reached[kind];
        if (values === null) continue;
        const seen = room[kind];
        if (seen === undefined) {
            room[kind] = [...values];
            seeded.push(kind);
            continue;
        }
        const fresh = values.filter((v) => !seen.includes(v));
        if (fresh.length === 0 || show || !canShow) continue;
        show = { kind, value: Math.max(...fresh) };
        room[kind] = [...seen, ...fresh].sort((a, b) => a - b);
    }
    return { show, seeded, next: { ...store, [roomKey]: room } };
}

interface UseMilestoneArgs {
    /** `<service>|<room dir>` of a member chat; null for a group chat or no chat. */
    roomKey: string | null;
    /** The room's message count once loaded for this room, else null (0 is treated as not known: an empty room is not seeded). */
    totalMessages: number | null;
    /** The subscription day count once loaded for this room, else null. */
    streakDays: number | null;
}

/**
 * The milestone card for the open chat, decided once per kind per open (spec §9: "the next time
 * that chat opens"), recorded in `celebrated_milestones` and logged as `celebration`.
 */
export function useMilestone({ roomKey, totalMessages, streakDays }: UseMilestoneArgs): Milestone | null {
    const [shown, setShown] = useState<{ roomKey: string; milestone: Milestone } | null>(null);
    const evaluated = useRef(new Set<string>());
    // Room keys that already showed a card during the current open.
    const shownThisOpen = useRef(new Set<string>());
    // Room keys whose empty-room skip was already logged during the current open.
    const skipLogged = useRef(new Set<string>());

    // Leaving a room ends its open: the next open decides again.
    useEffect(() => () => {
        if (!roomKey) return;
        evaluated.current.delete(`${roomKey}|messages`);
        evaluated.current.delete(`${roomKey}|days`);
        shownThisOpen.current.delete(roomKey);
        skipLogged.current.delete(roomKey);
        setShown(null);
    }, [roomKey]);

    useEffect(() => {
        if (!roomKey) return;
        if (totalMessages === 0 && !skipLogged.current.has(roomKey)) {
            skipLogged.current.add(roomKey);
            clientLog('celebration', { target: 'milestone_messages', outcome: 'skipped', reason: 'no_messages' });
        }
        const messagesDue = totalMessages !== null && totalMessages > 0 && !evaluated.current.has(`${roomKey}|messages`);
        const daysDue = streakDays !== null && !evaluated.current.has(`${roomKey}|days`);
        if (!messagesDue && !daysDue) return;
        if (messagesDue) evaluated.current.add(`${roomKey}|messages`);
        if (daysDue) evaluated.current.add(`${roomKey}|days`);
        const { show, seeded, next } = decideMilestone(
            roomKey,
            {
                messages: messagesDue ? reachedMessageMilestones(totalMessages as number) : null,
                days: daysDue ? reachedDayMilestones(streakDays as number) : null,
            },
            persisted.getPref<MilestoneStore>(MILESTONES_PREF, {}),
            !shownThisOpen.current.has(roomKey),
        );
        if (show || seeded.length > 0) persisted.setPref(MILESTONES_PREF, next);
        for (const kind of seeded) clientLog('celebration', { target: `milestone_${kind}`, outcome: 'seeded' });
        if (show) {
            shownThisOpen.current.add(roomKey);
            setShown({ roomKey, milestone: show });
            clientLog('celebration', { target: `milestone_${show.kind}`, outcome: 'shown', count: show.value });
        }
    }, [roomKey, totalMessages, streakDays]);

    return shown && shown.roomKey === roomKey ? shown.milestone : null;
}
