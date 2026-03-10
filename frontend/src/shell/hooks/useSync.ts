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
    clearSessionExpired: () => void;
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

    const clearSessionExpired = useCallback(() => {
        setSessionExpiredService(null);
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

    // Update legacy syncProgress when activeService changes
    useEffect(() => {
        if (activeService && syncProgressByService[activeService]) {
            setSyncProgress(syncProgressByService[activeService]);
        }
    }, [activeService, syncProgressByService]);

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

    const pollSyncProgress = useCallback(async (service: string, blocking: boolean) => {
        if (isPollingRef.current[service]) return;
        isPollingRef.current[service] = true;

        const check = async () => {
            try {
                const res = await fetch(`/api/sync/progress?service=${encodeURIComponent(service)}`);
                const data = await res.json();

                const updateProgress = (progress: SyncProgress) => {
                    setSyncProgressByService(prev => ({ ...prev, [service]: progress }));
                    // Also update legacy if this is the active service or the current sequential sync service
                    if (service === activeService || service === sequentialSyncServiceRef.current) {
                        setSyncProgress(progress);
                    }
                };

                if (data.state === 'idle') {
                    updateProgress({ state: 'idle' });
                    isPollingRef.current[service] = false;
                    resolveSyncCallback(service);
                    if (blocking && service === activeService) setShowSyncModal(false);
                    setSyncVersion(v => v + 1);
                    if (service === activeService) refreshUserProfile(service);
                } else if (data.state === 'complete') {
                    updateProgress({
                        state: 'idle',
                        phase: 'complete',
                        phase_name: 'Complete',
                        phase_number: 5,
                        completed: data.total || data.completed,
                        total: data.total,
                        elapsed_seconds: data.elapsed_seconds,
                        eta_seconds: 0,
                        speed: data.speed,
                        speed_unit: data.speed_unit,
                        detail: 'Sync complete!',
                        detail_extra: ''
                    });
                    isPollingRef.current[service] = false;
                    resolveSyncCallback(service);
                    setSyncVersion(v => v + 1);
                    if (service === activeService) refreshUserProfile(service);
                    if (blocking && service === activeService) {
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
                    if (data.detail === 'SESSION_EXPIRED') {
                        log(`${service}: session expired detected`);
                        // Mark this specific service as disconnected
                        markServiceDisconnected?.(service, 'Session expired');
                        // Trigger LoginModal for this service (if it's active)
                        if (service === activeService) {
                            setSessionExpiredService(service);
                        }
                        updateProgress({ state: 'error', detail: 'Authentication session has expired. Please log in again to continue using the service.' });
                        hasStartedSyncRef.current = false;
                    } else if (data.detail === 'REFRESH_FAILED') {
                        log(`${service}: refresh failed detected - possible bug`);
                        // Mark this specific service as disconnected
                        markServiceDisconnected?.(service, 'Refresh failed');
                        // Trigger LoginModal for this service (if it's active)
                        if (service === activeService) {
                            setSessionExpiredService(service);
                        }
                        updateProgress({ state: 'error', detail: 'Authentication failed unexpectedly. Please log in again to continue using the service. If this persists, please report this issue.' });
                        hasStartedSyncRef.current = false;
                    } else {
                        updateProgress({ state: 'error', detail: data.detail || 'Sync error' });
                    }
                    isPollingRef.current[service] = false;
                    resolveSyncCallback(service);
                    if (blocking && service === activeService) setShowSyncModal(false);
                } else {
                    updateProgress({ state: 'error', detail: data.detail || 'Unknown error' });
                    isPollingRef.current[service] = false;
                    resolveSyncCallback(service);
                    if (blocking && service === activeService) setShowSyncModal(false);
                }
            } catch {
                const currentServiceProgress = syncProgressByService[service];
                if (currentServiceProgress?.state === 'running') {
                    setTimeout(check, 1000);
                } else {
                    setSyncProgressByService(prev => ({
                        ...prev,
                        [service]: { state: 'error', detail: 'Lost connection' }
                    }));
                    if (service === activeService) {
                        setSyncProgress({ state: 'error', detail: 'Lost connection' });
                    }
                    isPollingRef.current[service] = false;
                    resolveSyncCallback(service);
                    if (blocking && service === activeService) setShowSyncModal(false);
                }
            }
        };
        check();
    }, [activeService, refreshUserProfile, markServiceDisconnected, syncProgressByService]);

    const startSync = useCallback(async (blocking: boolean, service?: string) => {
        const targetService = service || activeService;

        if (!targetService) {
            console.error('startSync: No service specified and no active service');
            return;
        }

        // Skip if already polling this service (prevents duplicate poll chains)
        if (isPollingRef.current[targetService]) {
            log(`${targetService}: already polling, skipping startSync`);
            return;
        }

        if (blocking && targetService === activeService) setShowSyncModal(true);

        const currentProgress = syncProgressByService[targetService];
        if (currentProgress?.state !== 'running') {
            const initialProgress: SyncProgress = {
                state: 'running',
                phase: 'starting',
                phase_name: 'Starting',
                detail: 'Initializing...'
            };
            setSyncProgressByService(prev => ({ ...prev, [targetService]: initialProgress }));
            if (targetService === activeService) {
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
                const data = await response.json().catch(() => ({ detail: 'Unknown error' }));
                log(`${targetService}: failed to start`, data.detail);
                if (currentProgress?.state !== 'running') {
                    const errorProgress: SyncProgress = { state: 'error', detail: data.detail || 'Failed to start sync' };
                    setSyncProgressByService(prev => ({ ...prev, [targetService]: errorProgress }));
                    if (targetService === activeService) {
                        setSyncProgress(errorProgress);
                    }
                }
            }
        } catch {
            if (currentProgress?.state !== 'running') {
                const errorProgress: SyncProgress = { state: 'error', detail: 'Failed to start sync' };
                setSyncProgressByService(prev => ({ ...prev, [targetService]: errorProgress }));
                if (targetService === activeService) {
                    setSyncProgress(errorProgress);
                }
            }
        }
    }, [activeService, pollSyncProgress, syncProgressByService]);

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

            // Update legacy progress to show this service's progress in SyncModal
            setSyncProgress({ state: 'running', phase: 'starting', phase_name: 'Starting', detail: 'Initializing...' });

            await new Promise<void>((resolve) => {
                syncCompleteCallbacks.current[service] = resolve;
                startSync(false, service);
            });
        }

        sequentialSyncServiceRef.current = null;
        setSequentialSyncInfo(null);
        setTimeout(() => setShowSyncModal(false), 2000);
    }, [startSync]);

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
                    newServices.forEach(service => {
                        startSync(data.is_fresh && service === activeService, service);
                    });
                })
                .catch(() => {
                    newServices.forEach(service => startSync(false, service));
                });
        } else {
            newServices.forEach(service => startSync(false, service));
        }
    }, [isAuthenticated, appSettings, connectedServices, activeService, startSync]);

    // Effect 2: Auto-sync interval setup — re-runs when settings or services change.
    // Adaptive mode uses setTimeout chain with dynamic intervals from the backend;
    // fixed mode uses a plain setInterval.
    useEffect(() => {
        if (!isAuthenticated || !appSettings || connectedServices.length === 0) return;
        if (!appSettings.auto_sync_enabled) return;
        // Don't start auto-sync until app is fully configured
        if (!appSettings.is_configured) return;

        const clearAllTimers = () => {
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
                        const ms = (data.interval_minutes ?? appSettings.sync_interval_minutes) * 60 * 1000;
                        log(`${service}: adaptive next sync in ${(ms / 60000).toFixed(1)}m`);
                        syncTimeoutRefs.current[service] = setTimeout(() => {
                            startSync(false, service);
                            scheduleNext(service);
                        }, ms);
                    })
                    .catch(() => {
                        // Fallback to fixed interval on error
                        const ms = appSettings.sync_interval_minutes * 60 * 1000;
                        syncTimeoutRefs.current[service] = setTimeout(() => {
                            startSync(false, service);
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
                    startSync(false, service);
                }, intervalMs);
            });
        }

        return clearAllTimers;
    }, [isAuthenticated, appSettings?.auto_sync_enabled, appSettings?.adaptive_sync_enabled, appSettings?.sync_interval_minutes, connectedServices, startSync]);

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
