import { useCallback, useSyncExternalStore } from 'react';

const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** Whether `query` matches now, kept current; false where `matchMedia` is missing (tests, SSR). */
export function useMediaQuery(query: string): boolean {
    const subscribe = useCallback((onChange: () => void) => {
        if (!hasMatchMedia()) return () => {};
        const list = window.matchMedia(query);
        list.addEventListener('change', onChange);
        return () => list.removeEventListener('change', onChange);
    }, [query]);
    const read = () => (hasMatchMedia() ? window.matchMedia(query).matches : false);
    return useSyncExternalStore(subscribe, read, () => false);
}
