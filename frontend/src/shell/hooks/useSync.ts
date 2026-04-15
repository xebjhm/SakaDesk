/**
 * Sync hook for managing message synchronization across services.
 *
 * Handles:
 * - Starting/stopping sync for individual or all services
 * - Polling for sync progress updates
 * - Session expiry detection and re-authentication flow
 * - Sync state management (idle, syncing, complete, error)
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
 *       {syncProgress.state === 'syncing' ? 'Syncing...' : 'Sync Now'}
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

// Debug flag - set localStorage.setItem('DEBUG_SYNC', 'true') to enable
const SYNC_DEBUG = typeof localStorage !== 'undefined' && localStorage.getItem('DEBUG_SYNC') === 'true';
const log = SYNC_DEBUG
    ? (...args: unknown[]) => console.log('[Sync]', ...args)
    : () => {};

/** Info about an ongoing sequential (multi-service) sync */
export interface SequentialSyncInfo {
    /** Total number of services being synced */
    total: number;
    /** Zero-based index of the currently syncing service */
    currentIndex: number;
    /** Service ID currently being synced */
    currentService: string;
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
    startSync: (blocking: boolean, service?: string) => Promise<void>;
    /** Start sync for all connected services */
    startSyncAllServices: (blocking: boolean) => Promise<void>;
    /** Start sequential sync for a list of services (one at a time, with blocking modal) */
    startSequentialSync: (services: string[]) => Promise<void>;
    /** Info about the current sequential sync (null if not running) */
    sequentialSyncInfo: SequentialSyncInfo | null;
    /** Ref tracking whether initial sync has started */
    hasStartedSyncRef: React.MutableRefObject<boolean>;
    /** Service ID that triggered session expiry (shows LoginModal) */
    sessionExpiredService: string | null;
    /** Clear the session expiry state */
    clearSessionExpired: (reconnectedService?: string) => void;
}

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
    // Callbacks invoked when a service's sync polling finishes (used by startSequentialSync)
    const syncCompleteCallbacks = useRef<Record<string, () => void>>({});

    const syncIntervalRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});
    const syncTimeoutRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const isPollingRef = useRef<Record<string, boolean>>({});
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

    // Helper: resolve any pending sequential-sync callback for a service
    const resolveSyncCallback = useCallback((service: string) => {
        if (syncCompleteCallbacks.current[service]) {
            syncCompleteCallbacks.current[service]();
            delete syncCompleteCallbacks.current[service];
        }
    }, []);

    // pollSyncProgress: reads activeService and syncProgressByService from refs
    // to avoid recreating this callback on every progress tick.
    const pollSyncProgress = useCallback(async (service: string, blocking: boolean) => {
        if (isPollingRef.current[service]) return;
        isPollingRef.current[service] = true;

        const check = async () => {
            try {
                const res = await fetch(`/api/sync/progress?service=${encodeURIComponent(service)}`);
                const data = await res.json();

                const currentActiveService = activeServiceRef.current;

                const updateProgress = (progress: SyncProgress) => {
                    setSyncProgressByService(prev => ({ ...prev, [service]: progress }));
                    if (service === currentActiveService || service === sequentialSyncServiceRef.current) {
                        setSyncProgress(progress);
                    }
                };

                if (data.state === 'idle') {
                    updateProgress({ state: 'idle' });
                    isPollingRef.current[service] = false;
                    useAppStore.getState().removeInitialSyncService(service);
                    resolveSyncCallback(service);
                    if (blocking && service === currentActiveService) setShowSyncModal(false);
                    setSyncVersion(v => v + 1);
                    if (service === currentActiveService) refreshUserProfile(service);
                } else if (data.state === 'complete') {
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
                        detail_extra: ''
                    });
                    isPollingRef.current[service] = false;
                    useAppStore.getState().removeInitialSyncService(service);
                    resolveSyncCallback(service);
                    setSyncVersion(v => v + 1);
                    if (service === currentActiveService) refreshUserProfile(service);
                    if (blocking && service === currentActiveService) {
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
                        eta_seconds: data.eta_seconds,
                        speed: data.speed,
                        speed_unit: data.speed_unit,
                        detail: data.detail,
                        detail_extra: data.detail_extra
                    });
                    setTimeout(check, 1000);
                } else if (data.state === 'error') {
                    // Check cooldown: if the service was recently reconnected,
                    // suppress re-triggering the login modal to avoid a race
                    // where the sync started immediately after login picks up
                    // a stale session state.
                    const reconnectedAt = recentlyReconnectedRef.current[service];
                    const inCooldown = reconnectedAt && (Date.now() - reconnectedAt) < RECONNECT_COOLDOWN_MS;

                    if (data.detail === 'SESSION_EXPIRED') {
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
                    } else if (data.detail === 'REFRESH_FAILED') {
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
                    } else {
                        updateProgress({ state: 'error', detail: data.detail || i18n.t('sync.error') });
                    }
                    isPollingRef.current[service] = false;
                    useAppStore.getState().removeInitialSyncService(service);
                    resolveSyncCallback(service);
                    if (blocking && service === currentActiveService) setShowSyncModal(false);
                } else {
                    updateProgress({ state: 'error', detail: data.detail || i18n.t('sync.unknownError') });
                    isPollingRef.current[service] = false;
                    useAppStore.getState().removeInitialSyncService(service);
                    resolveSyncCallback(service);
                    if (blocking && service === currentActiveService) setShowSyncModal(false);
                }
            } catch {
                const currentServiceProgress = syncProgressByServiceRef.current[service];
                if (currentServiceProgress?.state === 'running') {
                    setTimeout(check, 1000);
                } else {
                    setSyncProgressByService(prev => ({
                        ...prev,
                        [service]: { state: 'error', detail: i18n.t('sync.lostConnection') }
                    }));
                    const currentActiveService = activeServiceRef.current;
                    if (service === currentActiveService) {
                        setSyncProgress({ state: 'error', detail: i18n.t('sync.lostConnection') });
                    }
                    isPollingRef.current[service] = false;
                    useAppStore.getState().removeInitialSyncService(service);
                    resolveSyncCallback(service);
                    if (blocking && service === currentActiveService) setShowSyncModal(false);
                }
            }
        };
        check();
    }, [refreshUserProfile, resolveSyncCallback]);

    // startSync: reads activeService and syncProgressByService from refs
    // to avoid recreating on every progress update.
    const startSync = useCallback(async (blocking: boolean, service?: string) => {
        const targetService = service || activeServiceRef.current;

        if (!targetService) {
            console.error('startSync: No service specified and no active service');
            return;
        }

        // Skip if already polling this service (prevents duplicate poll chains)
        if (isPollingRef.current[targetService]) {
            log(`${targetService}: already polling, skipping startSync`);
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

        try {
            const response = await fetch(`/api/sync/start?service=${encodeURIComponent(targetService)}`, { method: 'POST' });
            if (response.ok) {
                // Sync started successfully
                pollSyncProgress(targetService, blocking);
            } else if (response.status === 400) {
                // Likely "already running" - just poll for existing progress
                log(`${targetService}: sync already running, polling existing progress`);
                pollSyncProgress(targetService, blocking);
            } else {
                // Other error
                const data = await response.json().catch(() => ({ detail: i18n.t('sync.unknownError') }));
                log(`${targetService}: failed to start`, data.detail);
                if (currentProgress?.state !== 'running') {
                    const errorProgress: SyncProgress = { state: 'error', detail: data.detail || i18n.t('sync.failedToStart') };
                    setSyncProgressByService(prev => ({ ...prev, [targetService]: errorProgress }));
                    if (targetService === activeServiceRef.current) {
                        setSyncProgress(errorProgress);
                    }
                }
            }
        } catch {
            if (currentProgress?.state !== 'running') {
                const errorProgress: SyncProgress = { state: 'error', detail: i18n.t('sync.failedToStart') };
                setSyncProgressByService(prev => ({ ...prev, [targetService]: errorProgress }));
                if (targetService === activeServiceRef.current) {
                    setSyncProgress(errorProgress);
                }
            }
        }
    }, [pollSyncProgress]);

    const startSyncAllServices = useCallback(async (blocking: boolean) => {
        if (connectedServices.length === 0) return;

        // Show modal for active service if blocking
        if (blocking) setShowSyncModal(true);

        // Start sync for all connected services concurrently
        await Promise.all(
            connectedServices.map(service => startSync(false, service))
        );
    }, [connectedServices, startSync]);

    const startSequentialSync = useCallback(async (services: string[]) => {
        if (services.length === 0) return;

        // Prevent startup sync effect from also triggering these services
        services.forEach(s => syncedServicesRef.current.add(s));
        hasStartedSyncRef.current = true;

        setShowSyncModal(true);

        for (let i = 0; i < services.length; i++) {
            const service = services[i];
            sequentialSyncServiceRef.current = service;
            setSequentialSyncInfo({ total: services.length, currentIndex: i, currentService: service });

            // Force clear any stale polling state from previous syncs
            isPollingRef.current[service] = false;

            // Reset both legacy and per-service progress before starting
            const initialProgress: SyncProgress = {
                state: 'running',
                phase: 'starting',
                phase_name: i18n.t('sync.starting'),
                detail: i18n.t('sync.initializing')
            };
            setSyncProgressByService(prev => ({ ...prev, [service]: initialProgress }));
            setSyncProgress(initialProgress);

            await new Promise<void>((resolve) => {
                syncCompleteCallbacks.current[service] = resolve;
                startSync(false, service);
            });
        }

        sequentialSyncServiceRef.current = null;
        setSequentialSyncInfo(null);
        setTimeout(() => setShowSyncModal(false), 2000);
    }, [startSync]);

    // Stable ref for startSync so effects can call it without depending on it.
    // This breaks the cascade: effects no longer re-run when startSync is recreated.
    const startSyncRef = useRef(startSync);
    useEffect(() => { startSyncRef.current = startSync; }, [startSync]);

    // Effect 1: Startup sync — one-time per newly connected service
    // Only fires when app is fully configured (output_dir set) to avoid premature sync
    // that triggers SESSION_EXPIRED errors during onboarding.
    useEffect(() => {
        if (!isAuthenticated || !appSettings || connectedServices.length === 0) return;
        // Don't start sync until app is fully configured (prevents re-login dialog during onboarding)
        if (!appSettings.is_configured) return;
        // Don't start sync while sequential sync is running
        if (sequentialSyncServiceRef.current !== null) return;

        const newServices = connectedServices.filter(s => !syncedServicesRef.current.has(s));
        if (newServices.length === 0) return;

        newServices.forEach(s => syncedServicesRef.current.add(s));
        log(`Startup sync for new services: ${newServices.join(', ')}`);

        const isFirstSync = !hasStartedSyncRef.current;
        hasStartedSyncRef.current = true;

        if (isFirstSync) {
            fetch('/api/settings/fresh')
                .then(res => res.json())
                .then(data => {
                    const currentActive = activeServiceRef.current;
                    newServices.forEach(service => {
                        startSyncRef.current(data.is_fresh && service === currentActive, service);
                    });
                })
                .catch((err) => {
                    log('Failed to check fresh status, starting non-blocking sync:', err);
                    newServices.forEach(service => startSyncRef.current(false, service));
                });
        } else {
            newServices.forEach(service => startSyncRef.current(false, service));
        }
    }, [isAuthenticated, appSettings, connectedServices]);

    // Effect 2: Auto-sync interval setup — re-runs when settings or services change.
    // Adaptive mode uses setTimeout chain with dynamic intervals from the backend;
    // fixed mode uses a plain setInterval.
    // Uses startSyncRef to avoid re-running when startSync is recreated.
    useEffect(() => {
        if (!isAuthenticated || !appSettings || connectedServices.length === 0) return;
        if (!appSettings.auto_sync_enabled) return;
        // Don't start auto-sync until app is fully configured
        if (!appSettings.is_configured) return;

        // Cancellation flag: when the effect cleans up, this prevents
        // any in-flight fetch callbacks from setting orphaned timeouts.
        let cancelled = false;

        const clearAllTimers = () => {
            cancelled = true;
            Object.values(syncIntervalRefs.current).forEach(clearInterval);
            Object.values(syncTimeoutRefs.current).forEach(clearTimeout);
            syncIntervalRefs.current = {};
            syncTimeoutRefs.current = {};
        };

        if (appSettings.adaptive_sync_enabled) {
            // Adaptive: setTimeout chain — ask backend for next interval after each tick
            const scheduleNext = (service: string) => {
                fetch(`/api/sync/next_interval?service=${encodeURIComponent(service)}`)
                    .then(res => res.json())
                    .then(data => {
                        if (cancelled) return;
                        const ms = (data.interval_minutes ?? appSettings.sync_interval_minutes) * 60 * 1000;
                        log(`${service}: adaptive next sync in ${(ms / 60000).toFixed(1)}m`);
                        syncTimeoutRefs.current[service] = setTimeout(() => {
                            if (cancelled) return;
                            startSyncRef.current(false, service);
                            scheduleNext(service);
                        }, ms);
                    })
                    .catch((err) => {
                        if (cancelled) return;
                        // Fallback to fixed interval on error
                        log(`${service}: adaptive interval fetch failed, using fixed interval`, err);
                        const ms = appSettings.sync_interval_minutes * 60 * 1000;
                        syncTimeoutRefs.current[service] = setTimeout(() => {
                            if (cancelled) return;
                            startSyncRef.current(false, service);
                            scheduleNext(service);
                        }, ms);
                    });
            };
            connectedServices.forEach(scheduleNext);
        } else {
            // Fixed: plain setInterval
            const intervalMs = appSettings.sync_interval_minutes * 60 * 1000;
            connectedServices.forEach(service => {
                syncIntervalRefs.current[service] = setInterval(() => {
                    startSyncRef.current(false, service);
                }, intervalMs);
            });
        }

        return clearAllTimers;
    }, [isAuthenticated, appSettings?.auto_sync_enabled, appSettings?.adaptive_sync_enabled, appSettings?.sync_interval_minutes, connectedServices]);

    return {
        syncProgress,
        syncProgressByService,
        showSyncModal,
        setShowSyncModal,
        syncVersion,
        startSync,
        startSyncAllServices,
        startSequentialSync,
        sequentialSyncInfo,
        hasStartedSyncRef,
        sessionExpiredService,
        clearSessionExpired,
    };
}
