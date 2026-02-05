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

    const syncIntervalRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});
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

    const pollSyncProgress = useCallback(async (service: string, blocking: boolean) => {
        if (isPollingRef.current[service]) return;
        isPollingRef.current[service] = true;

        const check = async () => {
            try {
                const res = await fetch(`/api/sync/progress?service=${encodeURIComponent(service)}`);
                const data = await res.json();

                const updateProgress = (progress: SyncProgress) => {
                    setSyncProgressByService(prev => ({ ...prev, [service]: progress }));
                    // Also update legacy if this is the active service
                    if (service === activeService) {
                        setSyncProgress(progress);
                    }
                };

                if (data.state === 'idle') {
                    updateProgress({ state: 'idle' });
                    isPollingRef.current[service] = false;
                    if (blocking && service === activeService) setShowSyncModal(false);
                    setSyncVersion(v => v + 1);
                    if (service === activeService) refreshUserProfile(service);
                } else if (data.state === 'complete') {
                    updateProgress({
                        state: 'idle',
                        phase: 'complete',
                        phase_name: 'Complete',
                        phase_number: 4,
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
                        updateProgress({ state: 'error', detail: 'Session expired' });
                        hasStartedSyncRef.current = false;
                    } else {
                        updateProgress({ state: 'error', detail: data.detail || 'Sync error' });
                    }
                    isPollingRef.current[service] = false;
                    if (blocking && service === activeService) setShowSyncModal(false);
                } else {
                    updateProgress({ state: 'error', detail: data.detail || 'Unknown error' });
                    isPollingRef.current[service] = false;
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

    // Startup sync: sync ALL connected services, including newly connected ones
    useEffect(() => {
        if (!isAuthenticated || !appSettings || connectedServices.length === 0) return;

        // Find services that haven't been synced yet
        const newServices = connectedServices.filter(s => !syncedServicesRef.current.has(s));
        if (newServices.length === 0) return;

        // Mark these services as synced (before async to prevent duplicates)
        newServices.forEach(s => syncedServicesRef.current.add(s));
        log(`Startup sync for new services: ${newServices.join(', ')}`);

        const isFirstSync = !hasStartedSyncRef.current;
        hasStartedSyncRef.current = true;

        // Only check fresh install status on first sync
        if (isFirstSync) {
            fetch('/api/settings/fresh')
                .then(res => res.json())
                .then(data => {
                    const isFresh = data.is_fresh;

                    // Sync new services
                    newServices.forEach(service => {
                        // Fresh install: show modal for active service only
                        const showModal = isFresh && service === activeService;
                        startSync(showModal, service);
                    });
                })
                .catch(() => {
                    // On error, still sync new services without blocking modal
                    newServices.forEach(service => {
                        startSync(false, service);
                    });
                });
        } else {
            // Not first sync - just sync new services without modal
            newServices.forEach(service => {
                startSync(false, service);
            });
        }

        // Setup auto-sync for each connected service if enabled
        if (appSettings.auto_sync_enabled) {
            const intervalMs = appSettings.sync_interval_minutes * 60 * 1000;

            newServices.forEach(service => {
                // Clear existing interval for this service if any
                if (syncIntervalRefs.current[service]) {
                    clearInterval(syncIntervalRefs.current[service]);
                }

                syncIntervalRefs.current[service] = setInterval(() => {
                    startSync(false, service);
                }, intervalMs);
            });
        }

        return () => {
            // Cleanup all intervals
            Object.values(syncIntervalRefs.current).forEach(interval => {
                clearInterval(interval);
            });
            syncIntervalRefs.current = {};
        };
    }, [isAuthenticated, appSettings, connectedServices, activeService, startSync]);

    return {
        syncProgress,
        syncProgressByService,
        showSyncModal,
        setShowSyncModal,
        syncVersion,
        startSync,
        startSyncAllServices,
        hasStartedSyncRef,
        sessionExpiredService,
        clearSessionExpired,
    };
}
