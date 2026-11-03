/**
 * Follows syncs that the backend started on its own (AutoSyncScheduler, tray
 * "Sync now") so the UI shows them like user-started ones.
 *
 * Every `intervalMs` while the window is visible (and immediately when it becomes
 * visible again) it reads `/api/sync/progress` for each service that is not already
 * being polled:
 * - `running`: hand over to `follow`, which attaches the normal progress poller;
 * - `run_id` changed and the state is `complete`/`idle`/`error`: the sync ended
 *   while nobody was looking, so call `follow` once. Its single progress check
 *   runs the normal terminal branch (message refresh, profile refresh, and for a
 *   failed sync the session-expired modal and disconnected marking) and stops.
 * The first observation of a service only records its `run_id`.
 * A terminal run whose `run_id` the frontend poller already handled (reported by
 * `lastHandledRunId`, e.g. a short frontend-started sync that began and ended
 * between two checks) is not followed again.
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
    /** `run_id` of the last progress response the frontend poller handled for the service */
    lastHandledRunId?: (service: string) => number | undefined;
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
    lastHandledRunId,
    intervalMs = 5000,
}: UseBackendSyncWatcherOptions): void {
    const lastRunIdRef = useRef<Record<string, number>>({});
    const aliveRef = useRef(true);
    const isPollingRef = useRef(isPolling);
    const followRef = useRef(follow);
    const lastHandledRunIdRef = useRef(lastHandledRunId);
    isPollingRef.current = isPolling;
    followRef.current = follow;
    lastHandledRunIdRef.current = lastHandledRunId;

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
            if (!res.ok) {
                console.debug('[backendSyncWatcher] progress rejected', service, res.status);
                return;
            }
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
            (data.state === 'complete' || data.state === 'idle' || data.state === 'error') &&
            previous !== undefined && runId !== undefined && runId !== previous
        ) {
            if (lastHandledRunIdRef.current?.(service) === runId) {
                // The frontend poller already processed this run (it started and
                // ended between two checks): handling it again would bump
                // syncVersion and refresh the profile a second time.
                clientLog('backend_sync_skipped', { service, reason: 'already_handled' });
                return;
            }
            // Finished between two checks: let the normal poller process the
            // terminal state once (it is not polling, and the guard above just
            // confirmed nothing started one in the meantime).
            clientLog('backend_sync_followed', { service, reason: `finished_${data.state}` });
            followRef.current(service);
        }
    };

    useVisiblePolling(
        () => { services.forEach(s => { void checkService(s); }); },
        intervalMs,
        [services.join('|')],
    );
}
