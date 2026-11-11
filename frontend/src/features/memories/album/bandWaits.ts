/**
 * The album's loading bands, for the one page-level wait line (`AlbumWaitLine`). A tiny external
 * store, so a band starting or finishing re-renders only the line, never the album grid or its
 * bands (nothing on the album's open path waits for it).
 */
export interface BandWaits {
    /** The month's band is (or is no longer) waiting for its grid. */
    set: (month: string, waiting: boolean) => void;
    subscribe: (onChange: () => void) => () => void;
    /** At least one band is waiting. */
    any: () => boolean;
}

export function createBandWaits(): BandWaits {
    const months = new Set<string>();
    const listeners = new Set<() => void>();
    return {
        set(month, waiting) {
            if (months.has(month) === waiting) return;
            if (waiting) months.add(month); else months.delete(month);
            listeners.forEach((listener) => listener());
        },
        subscribe(onChange) {
            listeners.add(onChange);
            return () => { listeners.delete(onChange); };
        },
        any: () => months.size > 0,
    };
}
