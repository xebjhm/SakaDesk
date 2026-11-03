import { useEffect, useRef, type DependencyList } from 'react';

/**
 * Poll `callback` every `intervalMs`, skipping ticks while the window is hidden
 * (minimized / background tab) and refreshing once as soon as it is visible
 * again. Runs `callback` immediately on mount and whenever `deps` change.
 *
 * `deps` must keep a constant length across renders (they are spread into the
 * effect's dependency array, like any other hook dependency list).
 */
export function useVisiblePolling(callback: () => void, intervalMs: number, deps: DependencyList): void {
    const cbRef = useRef(callback);
    cbRef.current = callback;

    useEffect(() => {
        cbRef.current();
        const interval = setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            cbRef.current();
        }, intervalMs);
        const onVisibility = () => {
            if (document.visibilityState === 'visible') cbRef.current();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-controlled deps
    }, [intervalMs, ...deps]);
}
