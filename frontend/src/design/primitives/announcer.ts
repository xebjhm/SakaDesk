/**
 * The announcer's store (UI health A-D2): the latest transient message, announced politely by
 * `LiveRegionHost`. Kept apart from the component so LiveRegion.tsx exports only components.
 */
export interface Announcement { message: string; seq: number; at: number }
let current: Announcement = { message: '', seq: 0, at: 0 };
const listeners = new Set<() => void>();

/** Announces `message` politely (an empty message does nothing). */
export function announce(message: string): void {
    if (!message) return;
    current = { message, seq: current.seq + 1, at: Date.now() };
    for (const listener of Array.from(listeners)) listener();
}

/** useSyncExternalStore subscription to the latest announcement. */
export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
/** The latest announcement (a stable object until the next `announce`). */
export const getAnnouncement = () => current;
