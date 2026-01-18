import { useState, useRef, useEffect, useCallback } from 'react';
import type { SyncProgress, AppSettings } from '../../features/messages/MessagesFeature';
import { useAppStore } from '../../store/appStore';

export interface UseSyncReturn {
    syncProgress: SyncProgress;
    syncProgressByService: Record<string, SyncProgress>;
    showSyncModal: boolean;
    setShowSyncModal: (show: boolean) => void;
    syncVersion: number;
    startSync: (blocking: boolean, service?: string) => Promise<void>;
    startSyncAllServices: (blocking: boolean) => Promise<void>;
    hasStartedSyncRef: React.MutableRefObject<boolean>;
    // New: service that triggered session expiry (for showing LoginModal)
    sessionExpiredService: string | null;
    clearSessionExpired: () => void;
}

interface UseSyncOptions {
    isAuthenticated: boolean | null;
    appSettings: AppSettings | null;
    connectedServices: string[];
    setAuthError: (error: string | null) => void;
    setIsAuthenticated: (auth: boolean) => void;
    onSyncComplete?: () => void;
    // New: callback to mark service as disconnected in auth context
    markServiceDisconnected?: (serviceId: string, error?: string) => void;
}

export function useSync({
    isAuthenticated,
    appSettings,
    connectedServices,
    setAuthError,
    setIsAuthenticated,
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
    const syncProgressRef = useRef(syncProgress);

    useEffect(() => { syncProgressRef.current = syncProgress; }, [syncProgress]);

    // Update legacy syncProgress when activeService changes
    useEffect(() => {
        if (activeService && syncProgressByService[activeService]) {
            setSyncProgress(syncProgressByService[activeService]);
        }
    }, [activeService, syncProgressByService]);

    const refreshUserProfile = useCallback(async () => {
        const targetService = activeService || 'hinatazaka46';
        try {
            const res = await fetch(`/api/profile/refresh?service=${encodeURIComponent(targetService)}`, { method: 'POST' });
            const data = await res.json();
            if (data.nickname) {
                onSyncComplete?.();
            }
        } catch (e) {
            console.error('Failed to refresh profile:', e);
        }
    }, [activeService, onSyncComplete]);

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
                    if (service === activeService) refreshUserProfile();
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
                    if (service === activeService) refreshUserProfile();
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
                        console.log(`[Sync] ${service}: session expired detected`);
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
    }, [activeService, refreshUserProfile, setAuthError, setIsAuthenticated, syncProgressByService]);

    const startSync = useCallback(async (blocking: boolean, service?: string) => {
        const targetService = service || activeService || 'hinatazaka46';

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
            await fetch(`/api/sync/start?service=${encodeURIComponent(targetService)}`, { method: 'POST' });
            pollSyncProgress(targetService, blocking);
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

    // Startup sync: sync ALL connected services
    useEffect(() => {
        if (isAuthenticated && appSettings && !hasStartedSyncRef.current && connectedServices.length > 0) {
            hasStartedSyncRef.current = true;

            fetch('/api/settings/fresh')
                .then(res => res.json())
                .then(data => {
                    const isFresh = data.is_fresh;

                    // Sync ALL connected services, not just the active one
                    connectedServices.forEach(service => {
                        // Fresh install: show modal for active service only
                        const showModal = isFresh && service === activeService;
                        startSync(showModal, service);
                    });
                })
                .catch(() => {
                    // On error, still sync all services without blocking modal
                    connectedServices.forEach(service => {
                        startSync(false, service);
                    });
                });

            // Setup auto-sync for each connected service if enabled
            if (appSettings.auto_sync_enabled) {
                const intervalMs = appSettings.sync_interval_minutes * 60 * 1000;

                connectedServices.forEach(service => {
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
        }
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
