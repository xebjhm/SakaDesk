import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { clientLog } from '../utils/clientLog';
import { breadcrumbCode } from '../utils/breadcrumbCode';

const DEBOUNCE_MS = 1000;

/**
 * Mirrors the oshi list (`favorites`: blog member ids per service) to backend
 * settings so the backend knows the user's oshi. Debounced; `enabled` gates it
 * until persisted state has hydrated, so an empty startup map never overwrites
 * the backend. Posts once when enabled, then on every `favorites` change.
 */
export function useOshiMirror(enabled: boolean = true): void {
    useEffect(() => {
        if (!enabled) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const schedule = () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(async () => {
                try {
                    const res = await fetch('/api/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ oshi_members: useAppStore.getState().favorites }),
                    });
                    if (!res.ok) throw new Error(`http_${res.status}`);
                } catch (err) {
                    console.warn('[oshiMirror] failed', err);
                    clientLog('oshi_mirror_failed', { error_type: breadcrumbCode(err) });
                }
            }, DEBOUNCE_MS);
        };
        const unsubscribe = useAppStore.subscribe((state, prev) => {
            if (state.favorites !== prev.favorites) schedule();
        });
        schedule();
        return () => {
            unsubscribe();
            if (timer !== undefined) clearTimeout(timer);
        };
    }, [enabled]);
}
