import { useEffect, useRef, type DependencyList } from 'react';

/**
 * Poll `callback` every `intervalMs`, skipping ticks while the window is hidden
 * (minimized / background tab) and refreshing once as soon as it is visible
 * again. Runs `callback` immediately on mount and whenever `deps` change; the
 * callback receives the trigger so event-driven runs can supersede a pending request.
 *
 * `deps` must keep a constant length across renders (they are spread into the
 * effect's dependency array, like any other hook dependency list).
 */
/** Why the callback runs: mount / deps change, an interval tick, or the window becoming visible. */
export type PollTrigger = 'immediate' | 'tick' | 'visible';

export function useVisiblePolling(callback: (trigger: PollTrigger) => void, intervalMs: number, deps: DependencyList): void {
    const cbRef = useRef(callback);
    cbRef.current = callback;

    useEffect(() => {
        cbRef.current('immediate');
        const interval = setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            cbRef.current('tick');
        }, intervalMs);
        const onVisibility = () => {
            if (document.visibilityState === 'visible') cbRef.current('visible');
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-controlled deps
    }, [intervalMs, ...deps]);
}
