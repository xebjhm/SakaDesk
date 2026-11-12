import type { AlbumMonthPayload, MemoryMessage } from '../types';
import { albumItemKey } from './albumViewer';

/** Bursts smaller than this stay single tiles (the backend's rule, checked again here). */
const BURST_MIN = 3;

export type GridEntry =
    | { kind: 'tile'; item: MemoryMessage }
    | { kind: 'burst'; key: string; items: MemoryMessage[] };

/**
 * A month's grid entries: its items in time order, each burst with at least {@link BURST_MIN}
 * of its items present collapsed into one entry at its first item (bursts are keyed by room).
 */
export function gridEntries(data: AlbumMonthPayload): GridEntry[] {
    const present = new Set(data.items.map(albumItemKey));
    const burstOf = new Map<string, string>();
    for (const b of data.bursts) {
        const keys = b.ids.map((id) => albumItemKey({ room: b.room, id })).filter((k) => present.has(k));
        if (keys.length < BURST_MIN) continue;
        for (const k of keys) burstOf.set(k, `${b.room}|b${b.burst_id}`);
    }
    const bursts = new Map<string, MemoryMessage[]>();
    const entries: GridEntry[] = [];
    for (const item of data.items) {
        const burst = burstOf.get(albumItemKey(item));
        if (burst === undefined) {
            entries.push({ kind: 'tile', item });
            continue;
        }
        const members = bursts.get(burst);
        if (members) {
            members.push(item);
        } else {
            const first = [item];
            bursts.set(burst, first);
            entries.push({ kind: 'burst', key: burst, items: first });
        }
    }
    return entries;
}
