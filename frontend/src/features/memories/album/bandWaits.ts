/**
 * The album's loading bands, for the one page-level wait line (`AlbumWaitLine`). A tiny external
 * store, so a band starting or finishing re-renders only the line, never the album grid or its
 * bands (nothing on the album's open path waits for it).
 */
export interface BandWaits {
    /** The month's band is (or is no longer) waiting for its grid; a new wait starts its clock now. */
    set: (month: string, waiting: boolean) => void;
    subscribe: (onChange: () => void) => () => void;
    /**
     * When the oldest band still waiting began (`Date.now()`), or null when none waits. A stream of
     * fast bands handing over to each other never ages past its newest members.
     */
    oldest: () => number | null;
}

export function createBandWaits(): BandWaits {
    const since = new Map<string, number>();
    const listeners = new Set<() => void>();
    let oldest: number | null = null;
    const recompute = () => {
        let next: number | null = null;
        for (const at of since.values()) if (next === null || at < next) next = at;
        if (next === oldest) return;
        oldest = next;
        listeners.forEach((listener) => listener());
    };
    return {
        set(month, waiting) {
            if (since.has(month) === waiting) return;
            if (waiting) since.set(month, Date.now()); else since.delete(month);
            recompute();
        },
        subscribe(onChange) {
            listeners.add(onChange);
            return () => { listeners.delete(onChange); };
        },
        oldest: () => oldest,
    };
}
