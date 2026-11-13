/**
 * Sync hook for managing message synchronization across services.
 *
 * Handles:
 * - Starting/stopping sync for individual or all services
 * - Polling for sync progress updates
 * - Session expiry detection and re-authentication flow
 * - Sync state management (idle, queued, running, complete, error), following the
 *   backend sync queue (one job at a time; start-all sequences via GET /api/sync/queue)
 * - Driving the verify/fix media flow (scanning for missing media and repairing gaps)
 *
 * @example
 * ```tsx
 * function SyncButton() {
 *   const { syncProgress, startSync } = useSync({
 *     isAuthenticated: true,
 *     appSettings: settings,
 *     connectedServices: ['hinatazaka46'],
 *     setAuthError: setError,
 *     setIsAuthenticated: setAuth,
 *   });
 *
 *   return (
 *     <button onClick={() => startSync(true)}>
 *       {syncProgress.state === 'running' ? 'Syncing...' : 'Sync Now'}
 *     </button>
 *   );
 * }
 * ```
 *
 * @module useSync
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { SyncProgress, AppSettings } from '../../features/messages/MessagesFeature';
import { useAppStore } from '../../store/appStore';
import i18n from '../../i18n';
import { clientLog } from '../../utils/clientLog';
import { pollJson, pollLogKey, useUnmountSignal } from '../../utils/pollJson';

// Debug flag - set localStorage.setItem('DEBUG_SYNC', 'true') to enable
const SYNC_DEBUG = typeof localStorage !== 'undefined' && localStorage.getItem('DEBUG_SYNC') === 'true';
const log = SYNC_DEBUG
    ? (...args: unknown[]) => console.log('[Sync]', ...args)
    : () => {};

// SD-CONTRACT-11: distinguish "sync already running" from every other 4xx.
// The old code treated ANY 400 as "already running" and started polling — so an
// invalid-service 400 (or any future 400 variant) sent the UI into a progress
// poll for a service the backend rejected. Only a genuine "already running"
// response should poll. Accepts:
//   - HTTP 409 (the intended status once the backend uses it), or
//   - HTTP 400 whose body detail matches the current "already running" text
//     (backend/api/sync.py: "Sync already running for {service}").
// Any other 4xx is a real error.
function isAlreadyRunning(status: number, body: { detail?: unknown } | null): boolean {
    if (status === 409) return true;
    if (status === 400 && typeof body?.detail === 'string') {
        return /already running/i.test(body.detail);
    }
    return false;
}

// SD-FE-GAP-B-08: the backend's `detail` field doubles as human-readable
// progress text AND (for sync errors) a machine sentinel like "SESSION_EXPIRED".
// Known sentinels are mapped to localized strings at their handling sites, but
// an UNKNOWN sentinel would otherwise render verbatim in the modal (e.g. in the
// running-state detail line). Detect the sentinel shape (ALL_CAPS_UNDERSCORE,
// no spaces) and fall back to a friendly generic so a raw code never reaches
// the user. Ordinary progress text ("Fetching page 3") passes through unchanged.
// Exported for unit testing.
export function friendlySyncDetail(detail: unknown, fallback: string): string | undefined {
    if (typeof detail !== 'string' || detail.length === 0) return undefined;
    if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(detail)) return fallback;
    return detail;
}

/**
 * How a sequential sync ended. `completed` counts services that reached `complete`;
 * `failed` counts the rest (error, idle, failed start, and, after a cancel, the
 * cancelled service plus every service the cancel skipped). `cancelled` is true
 * when the user's Cancel ended the sequence early. `lost` is true when the
 * followed sequence disappeared from the backend (restart, replaced): the counts
 * are those of the last queue read.
 */
export interface SequentialSyncOutcome {
    completed: number;
    failed: number;
    cancelled: boolean;
    lost?: boolean;
}

/** Info about an ongoing sequential (multi-service) sync */
export interface SequentialSyncInfo {
    /** Total number of services being synced */
    total: number;
    /** Zero-based index of the currently syncing service */
    currentIndex: number;
    /** Service ID currently being synced */
    currentService: string;
    /** Every service of the sequence, in sync order (the dialog's step row shows one marker each). */
    services: string[];
}

/** Return type for the useSync hook. */
export interface UseSyncReturn {
    /** Current sync progress for the active service */
    syncProgress: SyncProgress;
    /** Sync progress for each service by ID */
    syncProgressByService: Record<string, SyncProgress>;
    /** Whether the sync modal is visible */
    showSyncModal: boolean;
    /** Toggle sync modal visibility */
    setShowSyncModal: (show: boolean) => void;
    /** Increments when sync completes (triggers message refresh) */
    syncVersion: number;
    /** Start sync for a specific service (or active service if not specified) */
    startSync: (blocking: boolean, service?: string, forceResync?: boolean) => Promise<void>;
    /** Verify downloaded media and re-download any missing files (or active service if not specified) */
    verifyAndFix: (service?: string) => Promise<void>;
    /**
     * Cancel a running or queued sync/verify and make the modal dismissible
     * (SD-FE-GAP-B-08). Without a service it targets the sequential sync's current
     * service, else the active service. During a followed sequential sync, calling
     * it without a service (or with the current service) ends the whole sequence
     * in the backend, also when the start-all has not answered yet.
     */
    cancelSync: (service?: string) => Promise<void>;
    /** Start sync for all connected services */
    startSyncAllServices: (blocking: boolean) => Promise<void>;
    /** Start a sequential sync (one backend sequence in the backend's fixed service order,
     *  one at a time, with the blocking modal); a second call while one runs joins it. */
    startSequentialSync: (services: string[]) => Promise<SequentialSyncOutcome>;
    /** Info about the current sequential sync (null if not running) */
    sequentialSyncInfo: SequentialSyncInfo | null;
    /** Ref tracking whether initial sync has started */
    hasStartedSyncRef: React.MutableRefObject<boolean>;
    /** Service ID that triggered session expiry (shows LoginModal) */
    sessionExpiredService: string | null;
    /** Clear the session expiry state */
    clearSessionExpired: (reconnectedService?: string) => void;
    /** Whether a progress poll is currently running for the service */
    isPolling: (service: string) => boolean;
    /** Follow a sync that is already running (started by the backend) without blocking the UI */
    followSync: (service: string) => void;
    /** `run_id` of the last progress response a poller handled for the service (undefined if none) */
    lastHandledRunId: (service: string) => number | undefined;
}

/** Consecutive timed-out / failed progress reads tolerated (when not running) before "lost connection". */
const MAX_PROGRESS_RETRIES = 3;
/** Spacing between progress read retries. */
const PROGRESS_RETRY_MS = 1000;

/** `/api/sync/progress` body (every field optional: an unknown state is handled). */
interface SyncProgressResponse {
    run_id?: number;
    state?: string;
    phase?: string;
    phase_name?: string;
    phase_number?: number;
    completed?: number;
    total?: number;
    elapsed_seconds?: number;
    run_elapsed_seconds?: number;
    eta_seconds?: number;
    eta_reason?: SyncProgress['eta_reason'];
    failed?: number;
    queue_position?: number | null;
    /** Kind of the job the tracker shows ("sync" / "verify"). */
    job_kind?: string | null;
    speed?: number;
    speed_unit?: string;
    detail?: string;
    detail_extra?: string;
    error_code?: string;
    result?: SyncProgress['result'];
}

/** `GET /api/sync/queue` body: the backend sync queue (spec 2026-11-10 S1). */
interface SyncQueueSnapshot {
    running?: { service: string; kind: string } | null;
    sequence?: {
        id: string;
        services: string[];
        current_index: number;
        blocking: boolean;
        state: 'running' | 'complete' | 'cancelled';
        completed: string[];
        failed: string[];
    } | null;
}

/** Spacing between reads of the backend sync queue while a sequence runs. */
const QUEUE_POLL_MS = 1000;

/** Options for the useSync hook. */
interface UseSyncOptions {
    /** Whether any service is authenticated */
    isAuthenticated: boolean | null;
    /** App settings (needed for output directory) */
    appSettings: AppSettings | null;
    /** List of connected service IDs */
    connectedServices: string[];
    /** Callback to set auth error (kept for interface compatibility) */
    setAuthError: (error: string | null) => void;
    /** Callback to update auth state (kept for interface compatibility) */
    setIsAuthenticated: (auth: boolean) => void;
    /** Called when sync completes successfully */
    onSyncComplete?: () => void;
    /** Called when a service's session expires */
    markServiceDisconnected?: (serviceId: string, error?: string) => void;
}

export function useSync({
    isAuthenticated,
    appSettings,
    connectedServices,
    setAuthError: _setAuthError,  // Kept for interface compatibility
    setIsAuthenticated: _setIsAuthenticated,  // Kept for interface compatibility
    onSyncComplete,
    markServiceDisconnected,
}: UseSyncOptions): UseSyncReturn {
    const { activeService } = useAppStore();

    // Per-service sync progress
    const [syncProgressByService, setSyncProgressByService] = useState<Record<string, SyncProgress>>({});

    // Legacy: single progress for active service (for backwards compat with UI)
    const [syncProgress, setSyncProgress] = useState<SyncProgress>({ state: 'idle' });
    const [showSyncModal, setShowSyncModal] = useState(false);
    const [syncVersion, setSyncVersion] = useState(0);

    // Track which service triggered session expiry (for showing LoginModal)
    const [sessionExpiredService, setSessionExpiredService] = useState<string | null>(null);

    // Cooldown: suppress SESSION_EXPIRED re-trigger for services that just reconnected.
    // Maps service ID → timestamp of successful reconnection.
    const recentlyReconnectedRef = useRef<Record<string, number>>({});
    const RECONNECT_COOLDOWN_MS = 10_000; // 10 seconds

    const clearSessionExpired = useCallback((reconnectedService?: string) => {
        setSessionExpiredService(null);
        if (reconnectedService) {
            recentlyReconnectedRef.current[reconnectedService] = Date.now();
        }
    }, []);

    // Sequential sync state (for onboarding multi-service sync)
    const [sequentialSyncInfo, setSequentialSyncInfo] = useState<SequentialSyncInfo | null>(null);
    const sequentialSyncServiceRef = useRef<string | null>(null);
    // Set by cancelSync during a sequential sync: the watcher ends the sequence at once.
    const sequenceCancelledRef = useRef(false);
    // Backend id of the sequence this window follows (start-all / resumed on mount).
    const sequenceIdRef = useRef<string | null>(null);
    // The followed sequence's outcome promise: a second request (the startup effect
    // racing the setup wizard) joins it instead of posting another start-all.
    const activeSequenceRef = useRef<Promise<SequentialSyncOutcome> | null>(null);

    const unmountSignal = useUnmountSignal();
    // Per-service generation of the progress chain: a chain that was cancelled and
    // replaced by a restart (while one of its reads was pending) must stop.
    const pollGenRef = useRef<Record<string, number>>({});
    const isPollingRef = useRef<Record<string, boolean>>({});
    // Per-service "a blocking modal owns this poll": set (never cleared) by any
    // pollSyncProgress(service, true) call, even one that returns early because a
    // non-blocking poll (e.g. the backend-sync watcher's follow) already runs, so
    // the poller closes the modal on completion. Cleared on terminal states.
    const blockingRef = useRef<Record<string, boolean>>({});
    // startSync's POST /api/sync/start is in flight for the service; isPolling()
    // reports true meanwhile so the backend-sync watcher does not attach a poller.
    const startingRef = useRef<Record<string, boolean>>({});
    // Kind of job ("sync" / "verify") a blocking start waits for: a queued verify
    // behind a sync of the same service must not end on the sync's completion.
    const expectedKindRef = useRef<Record<string, 'sync' | 'verify'>>({});
    // Per-service run_id of the last /api/sync/progress response a poller handled;
    // lets the backend-sync watcher skip runs the frontend already processed.
    const handledRunIdRef = useRef<Record<string, number>>({});
    const hasStartedSyncRef = useRef(false);
    // Track which services have already been synced on startup (to sync newly connected services)
    const syncedServicesRef = useRef<Set<string>>(new Set());
    const syncProgressRef = useRef(syncProgress);

    useEffect(() => { syncProgressRef.current = syncProgress; }, [syncProgress]);

    // --- Refs to break dependency cascades ---
    // These allow callbacks and effects to read the latest values
    // without including them in dependency arrays, preventing the
    // cascading effect re-runs that cause rapid re-syncing.
    const activeServiceRef = useRef(activeService);
    useEffect(() => { activeServiceRef.current = activeService; }, [activeService]);

    const syncProgressByServiceRef = useRef(syncProgressByService);
    useEffect(() => { syncProgressByServiceRef.current = syncProgressByService; }, [syncProgressByService]);

    const markServiceDisconnectedRef = useRef(markServiceDisconnected);
    useEffect(() => { markServiceDisconnectedRef.current = markServiceDisconnected; }, [markServiceDisconnected]);

    // Update legacy syncProgress when activeService changes
    useEffect(() => {
        if (activeService && syncProgressByService[activeService]) {
            setSyncProgress(syncProgressByService[activeService]);
        }
    }, [activeService, syncProgressByService]);

    // During sequential sync, keep syncProgress in sync with the current service's
    // progress. This is needed because pollSyncProgress may hold stale closures
    // that only update syncProgressByService but not the legacy syncProgress.
    useEffect(() => {
        const currentService = sequentialSyncInfo?.currentService;
        if (currentService && syncProgressByService[currentService]) {
            setSyncProgress(syncProgressByService[currentService]);
        }
    }, [sequentialSyncInfo, syncProgressByService]);

    const refreshUserProfile = useCallback(async (service: string) => {
        if (!service) {
            console.error('refreshUserProfile: No service specified');
            return;
        }
        try {
            const res = await fetch(`/api/profile/refresh?service=${encodeURIComponent(service)}`, { method: 'POST' });
            const data = await res.json();
            if (data.nickname) {
                onSyncComplete?.();
            }
        } catch (e) {
            console.error('Failed to refresh profile:', e);
        }
    }, [onSyncComplete]);


    // pollSyncProgress: reads activeService and syncProgressByService from refs
    // to avoid recreating this callback on every progress tick.
    const pollSyncProgress = useCallback(async (service: string, blocking: boolean) => {
        // Upgrade in place before the guard so a blocking request is never lost.
        if (blocking) blockingRef.current[service] = true;
        if (isPollingRef.current[service]) return;
        isPollingRef.current[service] = true;
        const gen = (pollGenRef.current[service] ?? 0) + 1;
        pollGenRef.current[service] = gen;
        const superseded = () => pollGenRef.current[service] !== gen;
        const progressKey = `sync_progress_${service}`;
        let failures = 0;

        const declareLostConnection = () => {
            const blocking = !!blockingRef.current[service];
            setSyncProgressByService(prev => ({
                ...prev,
                [service]: { state: 'error', detail: i18n.t('sync.lostConnection') }
            }));
            const currentActiveService = activeServiceRef.current;
            if (service === currentActiveService) {
                setSyncProgress({ state: 'error', detail: i18n.t('sync.lostConnection') });
            }
            isPollingRef.current[service] = false;
            blockingRef.current[service] = false;
            useAppStore.getState().removeInitialSyncService(service);
            if (blocking && service === currentActiveService) setShowSyncModal(false);
        };

        const check = async () => {
            if (superseded()) return;
            try {
                // Uncached, 4 s timeout, aborted on unmount. `replace`: a restarted
                // chain supersedes a read still pending from the cancelled one.
                const result = await pollJson<SyncProgressResponse>(
                    progressKey,
                    `/api/sync/progress?service=${encodeURIComponent(service)}`,
                    { signal: unmountSignal(), replace: true },
                );
                // Aborted: unmounted or superseded by a newer chain. (`skipped`
                // cannot happen with `replace`.) No state updates either way.
                if (result.status === 'aborted' || result.status === 'skipped' || superseded()) return;
                // Stopped while this read was in flight (cancelSync): its answer must
                // not overwrite the cancelled state the user just saw.
                if (!isPollingRef.current[service]) return;
                if (result.status !== 'ok') {
                    // Timeout / network error / non-2xx: pollJson logged why. A missed
                    // read must not end the check. While the service is known to be
                    // running (a long sync on a busy backend) keep retrying as long as
                    // it takes; otherwise (follow / terminal checks) retry a bounded
                    // number of times before declaring the connection lost.
                    failures += 1;
                    const state = syncProgressByServiceRef.current[service]?.state;
                    const running = state === 'running' || state === 'queued';
                    if (running || failures <= MAX_PROGRESS_RETRIES) {
                        // Rate-limited while running: the first few, then every 10th.
                        if (failures <= MAX_PROGRESS_RETRIES || failures % 10 === 0) {
                            clientLog('poll_retry', { key: pollLogKey(progressKey), count: failures });
                        }
                        if (isPollingRef.current[service]) setTimeout(check, PROGRESS_RETRY_MS);
                    } else {
                        clientLog('poll_gave_up', { key: pollLogKey(progressKey), count: MAX_PROGRESS_RETRIES });
                        declareLostConnection();
                    }
                    return;
                }
                failures = 0;
                const data = result.data;
                if (typeof data.run_id === 'number') handledRunIdRef.current[service] = data.run_id;

                const currentActiveService = activeServiceRef.current;
                // Read at completion time (not the call argument): the modal may
                // have been requested by a later call. Cleared on terminal states.
                const blocking = !!blockingRef.current[service];

                const updateProgress = (progress: SyncProgress) => {
                    setSyncProgressByService(prev => ({ ...prev, [service]: progress }));
                    if (service === currentActiveService || service === sequentialSyncServiceRef.current) {
                        setSyncProgress(progress);
                    }
                };

                if (data.state === 'idle') {
                    delete expectedKindRef.current[service];
                    updateProgress({ state: 'idle' });
                    isPollingRef.current[service] = false;
                    blockingRef.current[service] = false;
                    useAppStore.getState().removeInitialSyncService(service);
                    if (blocking && service === currentActiveService) setShowSyncModal(false);
                    setSyncVersion(v => v + 1);
                    if (service === currentActiveService) refreshUserProfile(service);
                } else if (
                    data.state === 'complete'
                    && expectedKindRef.current[service]
                    && data.job_kind
                    && data.job_kind !== expectedKindRef.current[service]
                ) {
                    // Another job of this service (e.g. the sync a queued verify
                    // waits behind) ended: keep waiting for ours.
                    updateProgress({ state: 'queued', phase: 'queued', queue_position: 1 });
                    if (isPollingRef.current[service]) setTimeout(check, 1000);
                } else if (data.state === 'complete') {
                    delete expectedKindRef.current[service];
                    updateProgress({
                        state: 'complete',
                        phase: 'complete',
                        phase_name: i18n.t('sync.complete'),
                        phase_number: data.phase_number,
                        completed: data.total || data.completed,
                        total: data.total,
                        elapsed_seconds: data.elapsed_seconds,
                        eta_seconds: 0,
                        speed: data.speed,
                        speed_unit: data.speed_unit,
                        detail: i18n.t('sync.syncComplete'),
                        detail_extra: '',
                        result: data.result ?? null
                    });
                    isPollingRef.current[service] = false;
                    blockingRef.current[service] = false;
                    useAppStore.getState().removeInitialSyncService(service);
                    setSyncVersion(v => v + 1);
                    if (service === currentActiveService) refreshUserProfile(service);
                    // Auto-close only normal syncs. A verify/validation carries a
                    // `result` payload whose findings the user should be able to
                    // read — keep it open until they dismiss it (Done button).
                    if (blocking && service === currentActiveService && !data.result) {
                        setTimeout(() => setShowSyncModal(false), 2000);
                    }
                } else if (data.state === 'running') {
                    updateProgress({
                        state: 'running',
                        phase: data.phase,
                        phase_name: data.phase_name,
                        phase_number: data.phase_number,
                        completed: data.completed,
                        total: data.total,
                        elapsed_seconds: data.elapsed_seconds,
                        run_elapsed_seconds: data.run_elapsed_seconds,
                        eta_seconds: data.eta_seconds,
                        eta_reason: data.eta_reason ?? null,
                        failed: data.failed ?? 0,
                        speed: data.speed,
                        speed_unit: data.speed_unit,
                        // SD-FE-GAP-B-08: never let an unknown machine sentinel
                        // reach the running-state detail line verbatim.
                        detail: friendlySyncDetail(data.detail, i18n.t('sync.processing')),
                        detail_extra: data.detail_extra
                    });
                    // SD-FE-GAP-B-08: stop re-scheduling once cancelled (the
                    // cancel path clears this flag) so the poller can't revive a
                    // modal the user dismissed.
                    if (isPollingRef.current[service]) setTimeout(check, 1000);
                } else if (data.state === 'queued') {
                    // Waiting in the backend sync queue (one sync runs at a time).
                    updateProgress({
                        state: 'queued',
                        phase: 'queued',
                        queue_position: data.queue_position ?? null,
                    });
                    if (isPollingRef.current[service]) setTimeout(check, 1000);
                } else if (data.state === 'error') {
                    delete expectedKindRef.current[service];
                    // Check cooldown: if the service was recently reconnected,
                    // suppress re-triggering the login modal to avoid a race
                    // where the sync started immediately after login picks up
                    // a stale session state.
                    const reconnectedAt = recentlyReconnectedRef.current[service];
                    const inCooldown = reconnectedAt && (Date.now() - reconnectedAt) < RECONNECT_COOLDOWN_MS;

                    if (data.error_code === 'session_expired' || data.detail === 'SESSION_EXPIRED') {
                        log(`${service}: session expired detected${inCooldown ? ' (suppressed - reconnect cooldown)' : ''}`);
                        if (!inCooldown) {
                            markServiceDisconnectedRef.current?.(service, 'Session expired');
                            if (service === currentActiveService) {
                                setSessionExpiredService(service);
                            }
                        }
                        updateProgress({ state: 'error', detail: i18n.t('sync.sessionExpired') });
                        useAppStore.getState().removeInitialSyncService(service);
                        hasStartedSyncRef.current = false;
                    } else if (data.error_code === 'refresh_failed' || data.detail === 'REFRESH_FAILED') {
                        log(`${service}: refresh failed detected - possible bug${inCooldown ? ' (suppressed - reconnect cooldown)' : ''}`);
                        if (!inCooldown) {
                            markServiceDisconnectedRef.current?.(service, 'Refresh failed');
                            if (service === currentActiveService) {
                                setSessionExpiredService(service);
                            }
                        }
                        updateProgress({ state: 'error', detail: i18n.t('sync.refreshFailed') });
                        useAppStore.getState().removeInitialSyncService(service);
                        hasStartedSyncRef.current = false;
                    } else if (data.error_code === 'cancelled' || data.detail === 'CANCELLED') {
                        updateProgress({ state: 'error', detail: i18n.t('sync.cancelled') });
                    } else {
                        // Prefer the structured error_code (SD-CONTRACT-07): any
                        // present code is a machine sentinel, so show a friendly
                        // generic rather than the raw text. Otherwise pass ordinary
                        // progress text through (friendlySyncDetail still masks any
                        // legacy underscore-sentinel in the detail field).
                        const generic = i18n.t('sync.error');
                        updateProgress({ state: 'error', detail: data.error_code ? generic : (friendlySyncDetail(data.detail, generic) || generic) });
                    }
                    isPollingRef.current[service] = false;
                    blockingRef.current[service] = false;
                    useAppStore.getState().removeInitialSyncService(service);
                    if (blocking && service === currentActiveService) setShowSyncModal(false);
                } else {
                    updateProgress({ state: 'error', detail: data.detail || i18n.t('sync.unknownError') });
                    isPollingRef.current[service] = false;
                    blockingRef.current[service] = false;
                    useAppStore.getState().removeInitialSyncService(service);
                    if (blocking && service === currentActiveService) setShowSyncModal(false);
                }
            } catch {
                const currentServiceProgress = syncProgressByServiceRef.current[service];
                if (currentServiceProgress?.state === 'running' || currentServiceProgress?.state === 'queued') {
                    setTimeout(check, 1000);
                } else {
                    declareLostConnection();
                }
            }
        };
        check();
    }, [refreshUserProfile, unmountSignal]);

    // startSync: reads activeService and syncProgressByService from refs
    // to avoid recreating on every progress update.
    const startSync = useCallback(async (blocking: boolean, service?: string, forceResync?: boolean) => {
        const targetService = service || activeServiceRef.current;

        if (!targetService) {
            console.error('startSync: No service specified and no active service');
            return;
        }

        // Skip if this service is already polling or its start POST is in flight: a second start
        // would hit the official API twice on a single-session token. A blocking caller still
        // gets the modal, and the live poller closes it (blockingRef is read at completion).
        if (isPollingRef.current[targetService] || startingRef.current[targetService]) {
            if (blocking) {
                blockingRef.current[targetService] = true;
                if (targetService === activeServiceRef.current) setShowSyncModal(true);
            }
            // A pending sequential callback is not settled here: the owner settles it. A live
            // poller resolves it on its terminal state, and an in-flight start resolves it on a
            // refused or failed start, or hands it to the poller it attaches.
            clientLog('sync_start_skipped', { reason: isPollingRef.current[targetService] ? 'polling' : 'starting' });
            log(`${targetService}: already polling or starting, skipping startSync`);
            return;
        }

        if (blocking && targetService === activeServiceRef.current) setShowSyncModal(true);

        const currentProgress = syncProgressByServiceRef.current[targetService];
        if (currentProgress?.state !== 'running') {
            const initialProgress: SyncProgress = {
                state: 'running',
                phase: 'starting',
                phase_name: i18n.t('sync.starting'),
                detail: i18n.t('sync.initializing')
            };
            setSyncProgressByService(prev => ({ ...prev, [targetService]: initialProgress }));
            if (targetService === activeServiceRef.current) {
                setSyncProgress(initialProgress);
            }
        }

        // In flight until the poll-or-error decision is made (not only during the POST), so a second
        // start that lands while a refused answer is still being read is skipped too.
        startingRef.current[targetService] = true;
        expectedKindRef.current[targetService] = 'sync';
        try {
            const startUrl = `/api/sync/start?service=${encodeURIComponent(targetService)}${forceResync ? '&force_resync=true' : ''}`;
            const response = await fetch(startUrl, { method: 'POST' });
            if (response.ok) {
                // Sync started successfully
                pollSyncProgress(targetService, blocking);
            } else {
                // SD-CONTRACT-11: only poll if the backend genuinely reports the
                // sync is already running; any other 4xx (e.g. invalid service,
                // shutting down) is surfaced as an error rather than polling a
                // service the backend rejected.
                const data = await response.json().catch(() => ({ detail: i18n.t('sync.unknownError') }));
                if (isAlreadyRunning(response.status, data)) {
                    log(`${targetService}: sync already running, polling existing progress`);
                    pollSyncProgress(targetService, blocking);
                } else {
                    log(`${targetService}: failed to start`, data.detail);
                    // No poller owns this start: a modal request from a skipped start ends here.
                    blockingRef.current[targetService] = false;
                    if (currentProgress?.state !== 'running') {
                        const errorProgress: SyncProgress = { state: 'error', detail: data.detail || i18n.t('sync.failedToStart') };
                        setSyncProgressByService(prev => ({ ...prev, [targetService]: errorProgress }));
                        if (targetService === activeServiceRef.current) {
                            setSyncProgress(errorProgress);
                        }
                    }
                }
            }
        } catch {
            blockingRef.current[targetService] = false;
            if (currentProgress?.state !== 'running') {
                const errorProgress: SyncProgress = { state: 'error', detail: i18n.t('sync.failedToStart') };
                setSyncProgressByService(prev => ({ ...prev, [targetService]: errorProgress }));
                if (targetService === activeServiceRef.current) {
                    setSyncProgress(errorProgress);
                }
            }
        } finally {
            startingRef.current[targetService] = false;
        }
    }, [pollSyncProgress]);

    // verifyAndFix: scans downloaded messages for missing media and re-downloads
    // any gaps. Reuses the same sync progress modal + poller as startSync.
    const verifyAndFix = useCallback(async (service?: string) => {
        const targetService = service || activeServiceRef.current;
        if (!targetService) {
            console.error('verifyAndFix: No service specified and no active service');
            return;
        }
        if (targetService === activeServiceRef.current) setShowSyncModal(true);

        const initialProgress: SyncProgress = {
            state: 'running',
            phase: 'starting',
            phase_name: i18n.t('settings.verifyFixRunning'),
            detail: i18n.t('sync.initializing'),
        };
        setSyncProgressByService(prev => ({ ...prev, [targetService]: initialProgress }));
        if (targetService === activeServiceRef.current) setSyncProgress(initialProgress);

        expectedKindRef.current[targetService] = 'verify';
        try {
            const response = await fetch(
                `/api/sync/verify?service=${encodeURIComponent(targetService)}`,
                { method: 'POST' },
            );
            if (response.ok) {
                pollSyncProgress(targetService, true);
            } else {
                // SD-CONTRACT-11: poll only on a genuine "already running"
                // response; other 4xx (invalid service, etc.) become an error
                // instead of polling a service the backend rejected.
                const data = await response.json().catch(() => ({ detail: i18n.t('sync.unknownError') }));
                if (isAlreadyRunning(response.status, data)) {
                    pollSyncProgress(targetService, true);
                } else {
                    const errorProgress: SyncProgress = { state: 'error', detail: data.detail || i18n.t('sync.failedToStart') };
                    setSyncProgressByService(prev => ({ ...prev, [targetService]: errorProgress }));
                    if (targetService === activeServiceRef.current) setSyncProgress(errorProgress);
                }
            }
        } catch {
            const errorProgress: SyncProgress = { state: 'error', detail: i18n.t('sync.failedToStart') };
            setSyncProgressByService(prev => ({ ...prev, [targetService]: errorProgress }));
            if (targetService === activeServiceRef.current) setSyncProgress(errorProgress);
        }
    }, [pollSyncProgress]);

    // POST a cancel and leave a breadcrumb when it did not take effect (the
    // backend then keeps syncing although the dialog was dismissed).
    const postCancel = useCallback(async (url: string, target: 'service' | 'sequence') => {
        try {
            const res = await fetch(url, { method: 'POST' });
            if (!res.ok) {
                clientLog('sync_cancel_failed', { target, reason: `http_${res.status}` });
                return;
            }
            const body = await res.json().catch(() => null) as { status?: string } | null;
            if (body?.status === 'not_found') clientLog('sync_cancel_failed', { target, reason: 'not_found' });
        } catch {
            clientLog('sync_cancel_failed', { target, reason: 'network' });
        }
    }, []);

    // SD-FE-GAP-B-08: cancel a running or queued sync/verify and make the modal
    // dismissible. The backend `/cancel` cancels the service's running job and
    // drops its queued ones (`?sequence=` ends a whole sequence), but we still
    // OPTIMISTICALLY transition to a terminal state so the user can always leave
    // the modal even if the cancel request fails or races the poller.
    const cancelSync = useCallback(async (service?: string) => {
        const sequenceService = sequentialSyncServiceRef.current;
        const targetService = service || sequenceService || activeServiceRef.current;

        // Cancel during a followed sequence (no service given, or its current
        // service) ends the whole sequence in the backend; the watcher ends at once.
        const inSequence = activeSequenceRef.current !== null
            && (service === undefined || service === sequenceService);
        const sequenceId = sequenceIdRef.current;
        if (inSequence) sequenceCancelledRef.current = true;

        if (targetService) {
            // Stop the local poller so it can't overwrite the terminal state below.
            isPollingRef.current[targetService] = false;
            blockingRef.current[targetService] = false;
            delete expectedKindRef.current[targetService];
            useAppStore.getState().removeInitialSyncService(targetService);

            // Optimistically mark the sync cancelled so the modal shows its dismiss
            // button even if the cancel request fails or races the poller.
            const cancelledProgress: SyncProgress = { state: 'error', detail: i18n.t('sync.cancelled') };
            setSyncProgressByService(prev => ({ ...prev, [targetService]: cancelledProgress }));
            if (targetService === activeServiceRef.current || targetService === sequenceService) setSyncProgress(cancelledProgress);
        }

        if (inSequence) {
            // Before the start-all answered there is no id yet: runSequentialSync
            // cancels the sequence as soon as it gets one.
            if (sequenceId !== null) {
                await postCancel(`/api/sync/cancel?sequence=${encodeURIComponent(sequenceId)}`, 'sequence');
            }
            return;
        }
        if (targetService) {
            await postCancel(`/api/sync/cancel?service=${encodeURIComponent(targetService)}`, 'service');
        }
    }, [postCancel]);

    // Follow a backend sequence (start-all) until it ends: GET /api/sync/queue each
    // second drives sequentialSyncInfo (the backend is the single source of truth),
    // and the current service's progress poller feeds the dialog.
    const watchSequence = useCallback((sequenceId: string): Promise<SequentialSyncOutcome> => {
        return new Promise((resolve) => {
            let failures = 0;
            // Last queue read: a cancel ends the watch at once and reports its
            // counts (every service not completed yet counts as failed, as the
            // backend logs it).
            let last: { completed: number; total: number } = { completed: 0, total: 0 };
            const cancelledOutcome = (): SequentialSyncOutcome => ({
                completed: last.completed,
                failed: last.total - last.completed,
                cancelled: true,
            });
            const tick = async () => {
                if (sequenceIdRef.current !== sequenceId || sequenceCancelledRef.current) {
                    resolve(cancelledOutcome());
                    return;
                }
                const result = await pollJson<SyncQueueSnapshot>(
                    'sync_queue',
                    '/api/sync/queue',
                    { signal: unmountSignal(), replace: true },
                );
                if (result.status === 'aborted' || result.status === 'skipped') return;
                if (result.status !== 'ok') {
                    failures += 1;
                    if (failures <= MAX_PROGRESS_RETRIES || failures % 10 === 0) {
                        clientLog('poll_retry', { key: 'sync_queue', count: failures });
                    }
                    setTimeout(tick, QUEUE_POLL_MS);
                    return;
                }
                failures = 0;
                const seq = result.data.sequence;
                if (sequenceCancelledRef.current) {
                    // Cancelled while this read was in flight.
                    resolve(cancelledOutcome());
                    return;
                }
                if (!seq || seq.id !== sequenceId) {
                    // Replaced by a newer sequence (or the backend restarted): stop
                    // following, and say so (never as a successful run).
                    resolve({
                        completed: last.completed,
                        failed: last.total - last.completed,
                        cancelled: false,
                        lost: true,
                    });
                    return;
                }
                last = { completed: seq.completed.length, total: seq.services.length };
                const current = seq.services[seq.current_index] ?? seq.services[seq.services.length - 1];
                if (current && current !== sequentialSyncServiceRef.current) {
                    sequentialSyncServiceRef.current = current;
                    const known = syncProgressByServiceRef.current[current];
                    if (known) setSyncProgress(known);
                    void pollSyncProgress(current, false);
                }
                if (current) {
                    setSequentialSyncInfo({
                        total: seq.services.length,
                        currentIndex: seq.current_index,
                        currentService: current,
                        services: seq.services,
                    });
                }
                if (seq.state !== 'running') {
                    resolve({
                        completed: seq.completed.length,
                        failed: seq.failed.length,
                        cancelled: seq.state === 'cancelled',
                    });
                    return;
                }
                setTimeout(tick, QUEUE_POLL_MS);
            };
            void tick();
        });
    }, [pollSyncProgress, unmountSignal]);

    // End of a followed sequence: clear its state and close the dialog.
    const endSequence = useCallback((outcome: SequentialSyncOutcome) => {
        sequenceCancelledRef.current = false;
        sequenceIdRef.current = null;
        sequentialSyncServiceRef.current = null;
        setSequentialSyncInfo(null);
        if (outcome.lost) setSyncProgress({ state: 'error', detail: i18n.t('sync.lostConnection') });
        // The user asked to stop: leave the dialog now. Otherwise show the result briefly.
        if (outcome.cancelled) setShowSyncModal(false);
        else setTimeout(() => setShowSyncModal(false), 2000);
        clientLog('sync_sequence', {
            outcome: outcome.cancelled
                ? 'cancelled'
                : outcome.lost
                    ? 'lost'
                    : outcome.failed === 0 ? 'all_complete' : outcome.completed === 0 ? 'none' : 'partial',
            count: outcome.completed,
        });
    }, []);

    // POST /api/sync/start-all: the backend queues the services in its fixed order
    // (乃木坂46, 櫻坂46, 日向坂46, Yodel) and runs one at a time.
    const postStartAll = useCallback(async (services: string[], blocking: boolean): Promise<string | null> => {
        try {
            const res = await fetch('/api/sync/start-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ services, blocking }),
            });
            if (!res.ok) {
                clientLog('sync_start_all_failed', { reason: `http_${res.status}` });
                return null;
            }
            const data = await res.json().catch(() => null) as { sequence_id?: unknown } | null;
            if (typeof data?.sequence_id !== 'string') {
                clientLog('sync_start_all_failed', { reason: 'bad_response' });
                return null;
            }
            return data.sequence_id;
        } catch {
            clientLog('sync_start_all_failed', { reason: 'network' });
            return null;
        }
    }, []);

    // Non-blocking: queue every service as one backend sequence and follow each
    // service's progress (queued, then running) without the dialog. A service that is
    // already polling or starting (e.g. App's own startSync right after a login) is left
    // out: a second start would hit the official API twice on a single-session token.
    // The queued services count as starting until their pollers attach, so a startSync
    // that lands meanwhile is skipped too.
    const startAllInBackground = useCallback(async (services: string[]) => {
        if (services.length === 0) return;
        if (activeSequenceRef.current) {
            // The followed sequence already queues them (the backend would join anyway).
            clientLog('sync_start_skipped', { reason: 'sequence' });
            return;
        }
        const fresh = services.filter(s => !isPollingRef.current[s] && !startingRef.current[s]);
        if (fresh.length < services.length) {
            clientLog('sync_start_skipped', { reason: 'starting', count: services.length - fresh.length });
        }
        if (fresh.length === 0) return;
        fresh.forEach(s => { startingRef.current[s] = true; });
        try {
            const sequenceId = await postStartAll(fresh, false);
            if (sequenceId === null) {
                // Say so per service (a manual Sync now retries; no automatic retry,
                // which could loop while the backend keeps refusing).
                const errorProgress: SyncProgress = { state: 'error', detail: i18n.t('sync.failedToStart') };
                setSyncProgressByService(prev => {
                    const next = { ...prev };
                    fresh.forEach(s => { next[s] = errorProgress; });
                    return next;
                });
                return;
            }
            // pollSyncProgress marks isPollingRef synchronously, before its first await.
            fresh.forEach(service => { void pollSyncProgress(service, false); });
        } finally {
            fresh.forEach(s => { startingRef.current[s] = false; });
        }
    }, [postStartAll, pollSyncProgress]);

    const runSequentialSync = useCallback(async (services: string[]): Promise<SequentialSyncOutcome> => {
        // Prevent startup sync effect from also triggering these services
        services.forEach(s => syncedServicesRef.current.add(s));
        hasStartedSyncRef.current = true;

        setShowSyncModal(true);
        sequenceCancelledRef.current = false;
        const initialProgress: SyncProgress = {
            state: 'running',
            phase: 'starting',
            phase_name: i18n.t('sync.starting'),
            detail: i18n.t('sync.initializing'),
        };
        setSyncProgress(initialProgress);

        const sequenceId = await postStartAll(services, true);
        if (sequenceId === null) {
            setSyncProgress({ state: 'error', detail: i18n.t('sync.failedToStart') });
            const outcome = { completed: 0, failed: services.length, cancelled: false };
            endSequence(outcome);
            return outcome;
        }
        sequenceIdRef.current = sequenceId;
        if (sequenceCancelledRef.current) {
            // Cancel was pressed while the start-all was in flight.
            await postCancel(`/api/sync/cancel?sequence=${encodeURIComponent(sequenceId)}`, 'sequence');
            const outcome = { completed: 0, failed: services.length, cancelled: true };
            endSequence(outcome);
            return outcome;
        }
        const outcome = await watchSequence(sequenceId);
        endSequence(outcome);
        return outcome;
    }, [postStartAll, postCancel, watchSequence, endSequence]);

    const startSequentialSync = useCallback((services: string[]): Promise<SequentialSyncOutcome> => {
        if (services.length === 0) return Promise.resolve({ completed: 0, failed: 0, cancelled: false });
        if (activeSequenceRef.current) return activeSequenceRef.current;
        // Same rule as startAllInBackground: a service already polling or starting (App's own
        // startSync right after a login) is left out; a second start would hit the official API
        // twice on a single-session token.
        const fresh = services.filter(s => !isPollingRef.current[s] && !startingRef.current[s]);
        if (fresh.length < services.length) {
            clientLog('sync_start_skipped', { reason: 'starting', count: services.length - fresh.length });
        }
        if (fresh.length === 0) return Promise.resolve({ completed: 0, failed: 0, cancelled: false });
        fresh.forEach(s => { startingRef.current[s] = true; });
        const run = runSequentialSync(fresh).finally(() => {
            fresh.forEach(s => { startingRef.current[s] = false; });
            activeSequenceRef.current = null;
        });
        activeSequenceRef.current = run;
        return run;
    }, [runSequentialSync]);

    const startSyncAllServices = useCallback(async (blocking: boolean) => {
        if (connectedServices.length === 0) return;
        if (blocking) await startSequentialSync(connectedServices);
        else await startAllInBackground(connectedServices);
    }, [connectedServices, startSequentialSync, startAllInBackground]);

    // A blocking sequence still running in the backend (window reload, crash):
    // reopen its dialog and follow it to the end.
    // Checked once, after login and setup (before that no sync can exist).
    const resumeCheckedRef = useRef(false);
    const canResume = !!isAuthenticated && !!appSettings?.is_configured;
    useEffect(() => {
        if (!canResume || resumeCheckedRef.current) return;
        resumeCheckedRef.current = true;
        let cancelled = false;
        void (async () => {
            const result = await pollJson<SyncQueueSnapshot>(
                'sync_queue_resume',
                '/api/sync/queue',
                { signal: unmountSignal(), replace: true },
            );
            if (cancelled || result.status !== 'ok') return;
            const seq = result.data.sequence;
            if (!seq || seq.state !== 'running' || !seq.blocking || sequenceIdRef.current !== null) return;
            if (activeSequenceRef.current) return;
            clientLog('sync_sequence_resumed', { count: seq.services.length });
            seq.services.forEach(s => syncedServicesRef.current.add(s));
            hasStartedSyncRef.current = true;
            sequenceIdRef.current = seq.id;
            setShowSyncModal(true);
            const run = watchSequence(seq.id).then((outcome) => { endSequence(outcome); return outcome; });
            activeSequenceRef.current = run.finally(() => { activeSequenceRef.current = null; });
        })();
        return () => { cancelled = true; };
    }, [canResume, watchSequence, endSequence, unmountSignal]);

    // Stable refs for startSequentialSync / startAllInBackground so Effect 1 can call
    // them without depending on them (no re-run when they are recreated).
    const startSequentialSyncRef = useRef(startSequentialSync);
    useEffect(() => { startSequentialSyncRef.current = startSequentialSync; }, [startSequentialSync]);
    const startAllInBackgroundRef = useRef(startAllInBackground);
    useEffect(() => { startAllInBackgroundRef.current = startAllInBackground; }, [startAllInBackground]);

    // Effect 1: Startup sync — one-time per newly connected service
    // Only fires when app is fully configured (output_dir set) to avoid premature sync
    // that triggers SESSION_EXPIRED errors during onboarding.
    useEffect(() => {
        if (!isAuthenticated || !appSettings || connectedServices.length === 0) return;
        // Don't start sync until app is fully configured (prevents re-login dialog during onboarding)
        if (!appSettings.is_configured) return;
        // Don't start sync while sequential sync is running
        if (sequentialSyncServiceRef.current !== null || activeSequenceRef.current !== null) return;

        const newServices = connectedServices.filter(s => !syncedServicesRef.current.has(s));
        if (newServices.length === 0) return;

        newServices.forEach(s => syncedServicesRef.current.add(s));
        log(`Startup sync for new services: ${newServices.join(', ')}`);

        const isFirstSync = !hasStartedSyncRef.current;
        hasStartedSyncRef.current = true;

        // One backend sequence (S1, spec 2026-11-10), never N parallel starts:
        // a fresh output folder gets the blocking dialog, otherwise it runs quietly.
        if (isFirstSync) {
            fetch('/api/settings/fresh')
                .then(res => res.json())
                .then(data => {
                    if (data.is_fresh) void startSequentialSyncRef.current(newServices);
                    else void startAllInBackgroundRef.current(newServices);
                })
                .catch((err) => {
                    log('Failed to check fresh status, starting non-blocking sync:', err);
                    void startAllInBackgroundRef.current(newServices);
                });
        } else {
            void startAllInBackgroundRef.current(newServices);
        }
    }, [isAuthenticated, appSettings, connectedServices]);

    // Backend-started syncs (the AutoSyncScheduler, tray "Sync now") are followed by
    // useBackendSyncWatcher through these two helpers; the frontend no longer
    // schedules syncs itself.
    const isPolling = useCallback(
        (service: string) => !!isPollingRef.current[service] || !!startingRef.current[service],
        [],
    );
    const lastHandledRunId = useCallback(
        (service: string): number | undefined => handledRunIdRef.current[service],
        [],
    );
    const followSync = useCallback((service: string) => {
        void pollSyncProgress(service, false);
    }, [pollSyncProgress]);

    return {
        syncProgress,
        syncProgressByService,
        showSyncModal,
        setShowSyncModal,
        syncVersion,
        startSync,
        verifyAndFix,
        cancelSync,
        startSyncAllServices,
        startSequentialSync,
        sequentialSyncInfo,
        hasStartedSyncRef,
        sessionExpiredService,
        clearSessionExpired,
        isPolling,
        followSync,
        lastHandledRunId,
    };
}
