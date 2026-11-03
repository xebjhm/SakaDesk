/**
 * Follows syncs that the backend started on its own (AutoSyncScheduler, tray
 * "Sync now") so the UI shows them like user-started ones.
 *
 * Every `intervalMs` while the window is visible (and immediately when it becomes
 * visible again) it reads `/api/sync/progress` for each service that is not already
 * being polled:
 * - `running`: hand over to `follow`, which attaches the normal progress poller;
 * - `run_id` changed and the state is `complete`/`idle`: the sync finished while
 *   nobody was looking, so call `onMissedCompletion` once to refresh messages.
 * The first observation of a service only records its `run_id`.
 *
 * @module useBackendSyncWatcher
 */

import { useEffect, useRef } from 'react';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';
import { clientLog } from '../../utils/clientLog';

export interface UseBackendSyncWatcherOptions {
    /** Connected service IDs to watch */
    services: string[];
    /** Whether a progress poll is already running for the service */
    isPolling: (service: string) => boolean;
    /** Attach the progress poller to a backend-started sync */
    follow: (service: string) => void;
    /** A sync finished while it was not being followed; refresh messages */
    onMissedCompletion: (service: string) => void;
    /** Check period while visible (default 5000 ms) */
    intervalMs?: number;
}

interface ProgressResponse {
    state?: string;
    run_id?: number;
}

export function useBackendSyncWatcher({
    services,
    isPolling,
    follow,
    onMissedCompletion,
    intervalMs = 5000,
}: UseBackendSyncWatcherOptions): void {
    const lastRunIdRef = useRef<Record<string, number>>({});
    const aliveRef = useRef(true);
    const isPollingRef = useRef(isPolling);
    const followRef = useRef(follow);
    const missedRef = useRef(onMissedCompletion);
    isPollingRef.current = isPolling;
    followRef.current = follow;
    missedRef.current = onMissedCompletion;

    useEffect(() => {
        aliveRef.current = true;
        return () => { aliveRef.current = false; };
    }, []);

    const checkService = async (service: string) => {
        if (isPollingRef.current(service)) {
            // The active poller handles this run's completion itself. Forget the
            // recorded run_id so the run is not reported as missed afterwards.
            delete lastRunIdRef.current[service];
            return;
        }
        let data: ProgressResponse;
        try {
            const res = await fetch(`/api/sync/progress?service=${encodeURIComponent(service)}`);
            if (!res.ok) return;
            data = await res.json();
        } catch (err) {
            console.debug('[useBackendSyncWatcher] progress check failed', service, err);
            return;
        }
        if (!aliveRef.current || isPollingRef.current(service)) return;

        const runId = typeof data.run_id === 'number' ? data.run_id : undefined;
        const previous = lastRunIdRef.current[service];
        if (runId !== undefined) lastRunIdRef.current[service] = runId;

        if (data.state === 'running') {
            clientLog('backend_sync_followed', { service });
            followRef.current(service);
        } else if (
            (data.state === 'complete' || data.state === 'idle') &&
            previous !== undefined && runId !== undefined && runId !== previous
        ) {
            missedRef.current(service);
        }
    };

    useVisiblePolling(
        () => { services.forEach(s => { void checkService(s); }); },
        intervalMs,
        [services.join('|')],
    );
}
