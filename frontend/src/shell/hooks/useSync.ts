import { useState, useRef, useEffect, useCallback } from 'react';
import type { SyncProgress, AppSettings } from '../../features/messages/MessagesFeature';
import { useAppStore } from '../../store/appStore';

export interface UseSyncReturn {
    syncProgress: SyncProgress;
    showSyncModal: boolean;
    setShowSyncModal: (show: boolean) => void;
    syncVersion: number;
    startSync: (blocking: boolean, service?: string) => Promise<void>;
    hasStartedSyncRef: React.MutableRefObject<boolean>;
}

interface UseSyncOptions {
    isAuthenticated: boolean | null;
    appSettings: AppSettings | null;
    setAuthError: (error: string | null) => void;
    setIsAuthenticated: (auth: boolean) => void;
    onSyncComplete?: () => void;
}

export function useSync({
    isAuthenticated,
    appSettings,
    setAuthError,
    setIsAuthenticated,
    onSyncComplete,
}: UseSyncOptions): UseSyncReturn {
    const { activeService } = useAppStore();

    const [syncProgress, setSyncProgress] = useState<SyncProgress>({ state: 'idle' });
    const [showSyncModal, setShowSyncModal] = useState(false);
    const [syncVersion, setSyncVersion] = useState(0);

    const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isPollingRef = useRef(false);
    const hasStartedSyncRef = useRef(false);
    const syncProgressRef = useRef(syncProgress);

    useEffect(() => { syncProgressRef.current = syncProgress; }, [syncProgress]);

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

    const pollSyncProgress = useCallback(async (blocking: boolean) => {
        if (isPollingRef.current) return;
        isPollingRef.current = true;

        const check = async () => {
            try {
                const res = await fetch('/api/sync/progress');
                const data = await res.json();

                if (data.state === 'idle') {
                    setSyncProgress({ state: 'idle' });
                    isPollingRef.current = false;
                    if (blocking) setShowSyncModal(false);
                    setSyncVersion(v => v + 1);
                    refreshUserProfile();
                } else if (data.state === 'complete') {
                    setSyncProgress({
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
                    isPollingRef.current = false;
                    setSyncVersion(v => v + 1);
                    refreshUserProfile();
                    if (blocking) {
                        setTimeout(() => setShowSyncModal(false), 2000);
                    }
                } else if (data.state === 'running') {
                    setSyncProgress({
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
                        setIsAuthenticated(false);
                        setAuthError("Session expired. Please login again.");
                        hasStartedSyncRef.current = false;
                    } else {
                        setSyncProgress({ state: 'error', detail: data.detail || 'Sync error' });
                    }
                    isPollingRef.current = false;
                    if (blocking) setShowSyncModal(false);
                } else {
                    setSyncProgress({ state: 'error', detail: data.detail || 'Unknown error' });
                    isPollingRef.current = false;
                    if (blocking) setShowSyncModal(false);
                }
            } catch {
                if (syncProgressRef.current.state === 'running') {
                    setTimeout(check, 1000);
                } else {
                    setSyncProgress({ state: 'error', detail: 'Lost connection' });
                    isPollingRef.current = false;
                    if (blocking) setShowSyncModal(false);
                }
            }
        };
        check();
    }, [refreshUserProfile, setAuthError, setIsAuthenticated]);

    const startSync = useCallback(async (blocking: boolean, service?: string) => {
        const targetService = service || activeService || 'hinatazaka46';

        if (blocking) setShowSyncModal(true);

        if (syncProgressRef.current.state !== 'running') {
            setSyncProgress({ state: 'running', phase: 'starting', phase_name: 'Starting', detail: 'Initializing...' });
        }

        try {
            await fetch(`/api/sync/start?service=${encodeURIComponent(targetService)}`, { method: 'POST' });
            pollSyncProgress(blocking);
        } catch {
            if (syncProgressRef.current.state !== 'running') {
                setSyncProgress({ state: 'error', detail: 'Failed to start sync' });
            }
        }
    }, [activeService, pollSyncProgress]);

    // Startup sync
    useEffect(() => {
        if (isAuthenticated && appSettings && !hasStartedSyncRef.current) {
            hasStartedSyncRef.current = true;

            fetch('/api/settings/fresh')
                .then(res => res.json())
                .then(data => {
                    if (data.is_fresh) {
                        startSync(true);
                    } else {
                        startSync(false);
                    }
                })
                .catch(() => startSync(false));

            if (appSettings.auto_sync_enabled) {
                const intervalMs = appSettings.sync_interval_minutes * 60 * 1000;
                syncIntervalRef.current = setInterval(() => {
                    startSync(false);
                }, intervalMs);
            }

            return () => {
                if (syncIntervalRef.current) {
                    clearInterval(syncIntervalRef.current);
                }
            };
        }
    }, [isAuthenticated, appSettings, startSync]);

    return {
        syncProgress,
        showSyncModal,
        setShowSyncModal,
        syncVersion,
        startSync,
        hasStartedSyncRef,
    };
}
