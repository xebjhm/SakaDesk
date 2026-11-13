import type { Message } from '../../types';

/**
 * ★ changes made in the open room since its last fresh load: message id → starred.
 * The list reads them per bubble, so a toggle never rebuilds the timeline (UI health #1).
 */
export const EMPTY_FAVORITES: ReadonlyMap<number, boolean> = new Map();

export function withFavorite(map: ReadonlyMap<number, boolean>, id: number, starred: boolean): ReadonlyMap<number, boolean> {
    const next = new Map(map);
    next.set(id, starred);
    return next;
}

/** Drops overrides the loaded room now agrees with (or whose message is gone); `map` itself when none. */
export function pruneFavoriteOverrides(map: ReadonlyMap<number, boolean>, messages: readonly Message[]): ReadonlyMap<number, boolean> {
    if (map.size === 0) return map;
    const loaded = new Map<number, boolean>();
    for (const msg of messages) if (map.has(msg.id)) loaded.set(msg.id, msg.is_favorite);
    let changed = false;
    const next = new Map<number, boolean>();
    for (const [id, starred] of map) {
        if (loaded.has(id) && loaded.get(id) !== starred) next.set(id, starred);
        else changed = true;
    }
    return changed ? next : map;
}

/** The messages as the user sees them (dialogs that list stars); the same array when there is nothing to apply. */
export function applyFavoriteOverrides(messages: Message[], map: ReadonlyMap<number, boolean>): Message[] {
    if (map.size === 0) return messages;
    return messages.map((msg) => {
        const starred = map.get(msg.id);
        return starred === undefined || starred === msg.is_favorite ? msg : { ...msg, is_favorite: starred };
    });
}

/** `messages` with one message's star set (the cached copy after a save); the same array when absent. */
export function setFavoriteIn(messages: Message[], id: number, starred: boolean): Message[] {
    const at = messages.findIndex((msg) => msg.id === id);
    if (at === -1) return messages;
    const next = messages.slice();
    next[at] = { ...messages[at], is_favorite: starred };
    return next;
}
