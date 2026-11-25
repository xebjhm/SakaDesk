export interface RoomCacheLimits {
    /** Rooms kept. */
    rooms: number;
    /** Messages kept across all rooms. */
    messages: number;
}

/** 20 rooms (as before) and at most 60 000 messages in all: whole histories are large. */
export const ROOM_CACHE_LIMITS: RoomCacheLimits = { rooms: 20, messages: 60_000 };

/**
 * Store `entry` under `key` as the most recently used room, then evict the least recently used
 * rooms until both limits hold. The room just stored always stays, even alone over the bound.
 */
export function storeRoom<E extends { messages: readonly unknown[] }>(
    cache: Map<string, E>, key: string, entry: E, limits: RoomCacheLimits = ROOM_CACHE_LIMITS,
): void {
    cache.delete(key); // Map keeps insertion order: re-inserting makes it the newest
    cache.set(key, entry);
    let total = 0;
    for (const e of cache.values()) total += e.messages.length;
    for (const [k, e] of cache) {
        if (cache.size <= limits.rooms && total <= limits.messages) break;
        if (k === key) continue;
        cache.delete(k);
        total -= e.messages.length;
    }
}
