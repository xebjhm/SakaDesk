import { useState, useEffect, useRef, useCallback } from 'react'
import { MultiGroupAuthStatus } from './types'
import { Layout } from './components/Layout'
import { AddServicePage } from './pages/AddServicePage'
import { Loader2, Download, FolderOpen } from 'lucide-react'
import { DiagnosticsModal } from './components/DiagnosticsModal'
import { ReportIssueModal } from './components/ReportIssueModal'
import { AboutModal } from './components/AboutModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { UpdateBanner } from './components/UpdateBanner'
import { MessagesFeature, SyncProgress, AppSettings } from './components/features/MessagesFeature'
import { useAppStore } from './stores/appStore'

const formatTime = (seconds: number | undefined): string => {
    if (!seconds || seconds <= 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m >= 60) {
        const h = Math.floor(m / 60);
        return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const formatSpeed = (speed: number | null | undefined, unit: string): string => {
    if (!speed || speed <= 0) return '';
    return `${speed.toFixed(2)} ${unit}/s`;
};

function App() {
    // Get active service from store
    const { activeService, setActiveService } = useAppStore();

    // Auth state
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
    const [, setAuthError] = useState<string | null>(null); // Error message for display (used for session expiry)
    const [authStatus, setAuthStatus] = useState<MultiGroupAuthStatus | null>(null);

    // Sync state
    const [syncProgress, setSyncProgress] = useState<SyncProgress>({ state: 'idle' });
    const [showSyncModal, setShowSyncModal] = useState(false);
    const [syncVersion, setSyncVersion] = useState(0); // Increments when sync completes - triggers MessagesFeature refresh
    const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isPollingRef = useRef(false);

    // Sync Progress Ref for fresh access in closures (Fixes Jumping Bug)
    const syncProgressRef = useRef(syncProgress);
    useEffect(() => { syncProgressRef.current = syncProgress; }, [syncProgress]);

    // Settings state
    const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [showSetupWizard, setShowSetupWizard] = useState(false);
    const [outputDirInput, setOutputDirInput] = useState('');
    const [showDiagnostics, setShowDiagnostics] = useState(false);

    // Bug report state
    const [showReportModal, setShowReportModal] = useState(false);
    const [crashError, setCrashError] = useState<string | undefined>();

    // About modal state
    const [showAboutModal, setShowAboutModal] = useState(false);

    // Add service page state
    const [showAddServicePage, setShowAddServicePage] = useState(false);

    // Error state for settings save
    const [settingsError, setSettingsError] = useState<string | null>(null);

    // === AUTH ===
    // Token refresh timer ref - reset after login or successful refresh
    const tokenRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        checkAuth();
    }, []);

    const checkAuth = async () => {
        try {
            const res = await fetch('/api/auth/status');
            const data: { services: Record<string, { authenticated: boolean; token_expired?: boolean }> } = await res.json();

            const authenticatedServices = Object.entries(data.services)
                .filter(([_, s]) => s.authenticated === true)
                .map(([name]) => name);

            const anyAuthenticated = authenticatedServices.length > 0;
            setIsAuthenticated(anyAuthenticated);
            setAuthStatus(data.services);

            // Auto-select first authenticated service if none selected
            if (anyAuthenticated && !activeService) {
                setActiveService(authenticatedServices[0]);
            }

            // Check for any expired tokens
            const anyExpired = Object.values(data.services).some(s => s.token_expired === true);
            if (anyExpired) {
                setAuthError("Session expired. Please login again.");
            }
        } catch {
            setIsAuthenticated(false);
        }
    };

    // Auth status is already fetched in checkAuth and stored in authStatus
    // No separate fetch needed for multi-group status

    // Proactive token refresh polling (50-55 min with jitter)
    // Timer resets after login or successful refresh to align with token lifetime
    const getJitteredRefreshInterval = () => {
        // 50 minutes base + 0-5 minutes random jitter = 50-55 minutes
        const baseMs = 50 * 60 * 1000; // 50 minutes
        const jitterMs = Math.random() * 5 * 60 * 1000; // 0-5 minutes
        return baseMs + jitterMs;
    };

    const scheduleTokenRefresh = useCallback(() => {
        // Clear any existing timer
        if (tokenRefreshTimeoutRef.current) {
            clearTimeout(tokenRefreshTimeoutRef.current);
        }

        const intervalMs = getJitteredRefreshInterval();
        console.log(`[Auth] Scheduling token refresh in ${Math.round(intervalMs / 60000)} minutes`);

        tokenRefreshTimeoutRef.current = setTimeout(async () => {
            try {
                console.log('[Auth] Proactive token refresh triggered');
                // Refresh all authenticated services
                const services = authStatus
                    ? Object.entries(authStatus)
                        .filter(([_, s]) => s.authenticated === true)
                        .map(([name]) => name)
                    : [];

                let allValid = true;
                for (const service of services) {
                    const res = await fetch(`/api/auth/refresh-if-needed?service=${encodeURIComponent(service)}`, { method: 'POST' });
                    const data = await res.json();
                    console.log(`[Auth] Refresh result for ${service}: ${data.status}, remaining: ${Math.round(data.remaining_seconds / 60)} min`);

                    if (data.status === 'refresh_failed' || data.status === 'no_token') {
                        allValid = false;
                    }
                }

                if (allValid || services.length === 0) {
                    // All tokens are good - schedule next refresh
                    scheduleTokenRefresh();
                } else {
                    // At least one token refresh failed - user needs to re-login
                    console.warn('[Auth] Token refresh failed for at least one service');
                    setIsAuthenticated(false);
                    setAuthError("Session expired. Please login again.");
                }
            } catch (e) {
                console.error('[Auth] Token refresh error:', e);
                // Network error - schedule retry
                scheduleTokenRefresh();
            }
        }, intervalMs);
    }, [authStatus]);

    // Start/stop token refresh polling based on auth state
    // Only trigger on isAuthenticated change, not on scheduleTokenRefresh identity change
    useEffect(() => {
        if (isAuthenticated) {
            // Start the refresh timer when authenticated
            scheduleTokenRefresh();
        }

        return () => {
            // Cleanup timer on unmount or auth state change
            if (tokenRefreshTimeoutRef.current) {
                clearTimeout(tokenRefreshTimeoutRef.current);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated]);

    // === STARTUP SYNC ===
    const hasStartedSyncRef = useRef(false);

    useEffect(() => {
        if (isAuthenticated && appSettings && !hasStartedSyncRef.current) {
            hasStartedSyncRef.current = true; // Only start once per session

            // Check if this is a fresh install (show modal only for fresh)
            fetch('/api/settings/fresh')
                .then(res => res.json())
                .then(data => {
                    if (data.is_fresh) {
                        // Fresh install: show modal
                        startSync(true);
                    } else {
                        // Incremental: background sync
                        startSync(false);
                    }
                })
                .catch(() => startSync(false));

            // Periodic sync based on settings
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
    }, [isAuthenticated, appSettings]);

    // Load settings on auth
    useEffect(() => {
        if (isAuthenticated) {
            fetch('/api/settings')
                .then(res => res.json())
                .then(data => {
                    setAppSettings(data);
                    setOutputDirInput(data.output_dir);
                    if (!data.is_configured) {
                        setShowSetupWizard(true);
                    }
                    // If no cached nickname, fetch from profile API
                    if (!data.user_nickname && activeService) {
                        fetch(`/api/profile?service=${encodeURIComponent(activeService)}`)
                            .then(res => res.json())
                            .then(profileData => {
                                if (profileData.nickname) {
                                    // Update local state with the fetched nickname
                                    setAppSettings(prev => prev ? { ...prev, user_nickname: profileData.nickname } : prev);
                                }
                            })
                            .catch(console.error);
                    }
                })
                .catch(console.error);
        }
    }, [isAuthenticated]);

    // Refresh user profile (nickname) from server - called after sync completes
    const refreshUserProfile = async () => {
        const targetService = activeService || 'hinatazaka46';
        try {
            const res = await fetch(`/api/profile/refresh?service=${encodeURIComponent(targetService)}`, { method: 'POST' });
            const data = await res.json();
            if (data.nickname) {
                setAppSettings(prev => prev ? { ...prev, user_nickname: data.nickname } : prev);
            }
        } catch (e) {
            console.error('Failed to refresh profile:', e);
        }
    };

    const startSync = async (blocking: boolean, service?: string) => {
        // Use provided service or fall back to activeService or default
        const targetService = service || activeService || 'hinatazaka46';

        if (blocking) setShowSyncModal(true);

        // Fix Jumping Bug: Don't reset state if already running
        // Use Ref for fresh state
        if (syncProgressRef.current.state !== 'running') {
            setSyncProgress({ state: 'running', phase: 'starting', phase_name: 'Starting', detail: 'Initializing...' });
        }

        try {
            await fetch(`/api/sync/start?service=${encodeURIComponent(targetService)}`, { method: 'POST' });
            // If 400, it's already running.
            pollSyncProgress(blocking);
        } catch {
            // Only set error if we weren't already running
            if (syncProgressRef.current.state !== 'running') {
                setSyncProgress({ state: 'error', detail: 'Failed to start sync' });
            }
        }
    };

    const pollSyncProgress = async (blocking: boolean) => {
        // Fix duplicate loops
        if (isPollingRef.current) return;
        isPollingRef.current = true;

        const check = async () => {
            try {
                const res = await fetch('/api/sync/progress');
                const data = await res.json();

                if (data.state === 'idle') {
                    setSyncProgress({ state: 'idle' });
                    isPollingRef.current = false; // Stop polling
                    if (blocking) setShowSyncModal(false);
                    // Increment syncVersion to trigger MessagesFeature refresh
                    setSyncVersion(v => v + 1);
                    // Refresh user profile (nickname may have changed)
                    refreshUserProfile();
                } else if (data.state === 'complete') {
                    // Show completion state, keep modal open briefly
                    setSyncProgress({
                        state: 'idle',  // Use idle for UI but handle specially
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
                    isPollingRef.current = false; // Stop polling
                    // Increment syncVersion to trigger MessagesFeature refresh
                    setSyncVersion(v => v + 1);
                    // Refresh user profile (nickname may have changed)
                    refreshUserProfile();
                    // Auto-close after 2 seconds
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
                    // Check for session expired error - redirect to login
                    if (data.detail === 'SESSION_EXPIRED') {
                        setIsAuthenticated(false);
                        setAuthError("Session expired. Please login again.");
                        hasStartedSyncRef.current = false;  // Allow sync after re-login
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
                    // Retry on connection error if we thought we were running
                    setTimeout(check, 1000);
                } else {
                    setSyncProgress({ state: 'error', detail: 'Lost connection' });
                    isPollingRef.current = false;
                    if (blocking) setShowSyncModal(false);
                }
            }
        };
        check();
    };

    const saveSettings = async (updates: Partial<AppSettings>): Promise<boolean> => {
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (!res.ok) throw new Error("Failed to save");
            const data = await res.json();
            setAppSettings(data);
            setOutputDirInput(data.output_dir);
            return true;
        } catch (e) {
            console.error('Failed to save settings:', e);
            setSettingsError("Failed to save settings");
            return false;
        }
    };

    const handleSelectFolder = async () => {
        try {
            const res = await fetch('/api/settings/select-folder', { method: 'POST' });
            const data = await res.json();
            if (data.path) {
                setOutputDirInput(data.path);
            } else if (data.error) {
                console.warn("Folder picker unavailable:", data.error);
            }
        } catch (e) {
            console.error(e);
        }
    };

    // === RENDER ===
    if (isAuthenticated === null) {
        return <div className="h-screen flex items-center justify-center bg-gray-50"><Loader2 className="animate-spin text-blue-500" /></div>;
    }

    // Get list of connected services
    const connectedServices = authStatus
        ? Object.entries(authStatus)
            .filter(([_, s]) => s.authenticated === true)
            .map(([name]) => name)
        : [];

    // Show AddServicePage if:
    // 1. No services connected (first install / fresh state)
    // 2. User explicitly wants to add a service (clicked + button)
    if (isAuthenticated === false || connectedServices.length === 0 || showAddServicePage) {
        return (
            <AddServicePage
                onLoginSuccess={() => {
                    setShowAddServicePage(false);
                    checkAuth();
                }}
                onBack={connectedServices.length > 0 ? () => setShowAddServicePage(false) : undefined}
                connectedServices={connectedServices}
            />
        );
    }

    // Dynamic Unit Label
    const getUnitLabel = () => {
        if (syncProgress.phase_number === 2) return 'members';
        if (syncProgress.phase_number === 3) return 'files';
        return 'items';
    };

    return (
        <div className="flex flex-col h-screen bg-[#F0F2F5] font-sans overflow-hidden">
            {/* Update Banner */}
            <UpdateBanner />

            <div className="flex flex-1 overflow-hidden">
            {/* Sync Modal - CLI Style */}
            {showSyncModal && (
                <div className="fixed inset-0 bg-gradient-to-br from-slate-900/90 to-slate-800/90 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
                        {/* Header - Chat Room Style */}
                        <div className="bg-gradient-to-r from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] px-6 py-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                                    <Download className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">
                                        Phase {syncProgress.phase_number || 1}: {syncProgress.phase_name || 'Starting'}
                                    </h3>
                                    <p className="text-sm text-white/80">
                                        {syncProgress.total ? `${syncProgress.total.toLocaleString()} ${getUnitLabel()}` : 'Please wait...'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-5">
                            {/* Progress Bar */}
                            <div>
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-gray-600 font-medium">
                                        {syncProgress.completed?.toLocaleString() || 0} / {syncProgress.total?.toLocaleString() || 0}
                                    </span>
                                    <span className="text-gray-900 font-semibold">
                                        {syncProgress.total && syncProgress.total > 0
                                            ? `${Math.round(((syncProgress.completed || 0) / syncProgress.total) * 100)}%`
                                            : '0%'
                                        }
                                    </span>
                                </div>
                                <div className="h-4 bg-gray-100 rounded-full overflow-hidden shadow-inner">
                                    <div
                                        className="h-full bg-gradient-to-r from-blue-400 via-blue-500 to-indigo-500 transition-all duration-300 ease-out rounded-full relative"
                                        style={{
                                            width: syncProgress.total && syncProgress.total > 0
                                                ? `${((syncProgress.completed || 0) / syncProgress.total) * 100}%`
                                                : '0%'
                                        }}
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/20" />
                                    </div>
                                </div>
                            </div>

                            {/* Stats Grid */}
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-gray-50 rounded-xl p-3 text-center">
                                    <div className="text-xs text-gray-500 mb-1">Elapsed</div>
                                    <div className="text-lg font-mono font-semibold text-gray-900">
                                        {formatTime(syncProgress.elapsed_seconds)}
                                    </div>
                                </div>
                                <div className="bg-gray-50 rounded-xl p-3 text-center">
                                    <div className="text-xs text-gray-500 mb-1">ETA</div>
                                    <div className="text-lg font-mono font-semibold text-gray-900">
                                        {syncProgress.eta_seconds ? formatTime(syncProgress.eta_seconds) : '--:--'}
                                    </div>
                                </div>
                                <div className="bg-gray-50 rounded-xl p-3 text-center">
                                    <div className="text-xs text-gray-500 mb-1">Speed</div>
                                    <div className="text-lg font-mono font-semibold text-gray-900">
                                        {formatSpeed(syncProgress.speed, syncProgress.speed_unit || 'it')}
                                    </div>
                                </div>
                            </div>

                            {/* Current Item Detail or Warning */}
                            <div className={`rounded-xl px-4 py-3 flex items-center ${syncProgress.phase_number === 3 ? 'bg-amber-50 border border-amber-100 justify-center' : 'bg-blue-50'
                                }`}>
                                {syncProgress.phase_number === 3 ? (
                                    <div className="flex items-center gap-2 text-amber-700">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span className="text-sm font-medium">
                                            Downloading media... Please do not close the app.
                                        </span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                                        <span className="text-sm text-gray-700 font-medium truncate">
                                            {/* Old Style Alignment: Combined Detail */}
                                            {syncProgress.detail || "Processing..."}
                                            {syncProgress.detail_extra && ` ${syncProgress.detail_extra}`}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Phase Dots */}
                            <div className="flex justify-center gap-3 pt-2">
                                {[
                                    { phase: 'scanning', label: 'Scan' },
                                    { phase: 'syncing', label: 'Sync' },
                                    { phase: 'downloading', label: 'Download' }
                                ].map((p) => {
                                    const currentPhaseIndex = ['scanning', 'discovering', 'syncing', 'downloading'].indexOf(syncProgress.phase || '');
                                    const thisPhaseIndex = ['scanning', 'discovering', 'syncing', 'downloading'].indexOf(p.phase);
                                    const isActive = syncProgress.phase === p.phase || (p.phase === 'scanning' && syncProgress.phase === 'discovering');
                                    const isComplete = currentPhaseIndex > thisPhaseIndex;

                                    return (
                                        <div key={p.phase} className="flex flex-col items-center gap-1">
                                            <div
                                                className={`w-3 h-3 rounded-full transition-all ${isActive ? 'bg-blue-500 ring-4 ring-blue-100' :
                                                    isComplete ? 'bg-green-500' :
                                                        'bg-gray-200'
                                                    }`}
                                            />
                                            <span className={`text-xs ${isActive ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                                                {p.label}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Setup Wizard (First Time) */}
            {showSetupWizard && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
                        {/* Changed Header to match Sync Modal (Blue/Purple Gradient) - requested by user */}
                        <div className="bg-gradient-to-r from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] px-6 py-5">
                            <div className="flex items-center gap-3">
                                <FolderOpen className="w-8 h-8 text-white" />
                                <div>
                                    <h3 className="text-xl font-bold text-white">Welcome to HakoDesk</h3>
                                    <p className="text-sm text-white/80">Let's set up your data folder</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Output Folder Path
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={outputDirInput}
                                        onChange={(e) => setOutputDirInput(e.target.value)}
                                        placeholder="C:\Users\YourName\HakoDesk-data"
                                        className="flex-1 px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                    <button
                                        onClick={handleSelectFolder}
                                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors border border-gray-200"
                                    >
                                        Browse
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 mt-2">
                                    Enter the full path where messages will be stored. You can copy this from Windows Explorer.
                                </p>
                            </div>
                            <button
                                onClick={async () => {
                                    if (outputDirInput.trim()) {
                                        const success = await saveSettings({ output_dir: outputDirInput.trim() });
                                        if (success) {
                                            setShowSetupWizard(false);
                                            // Start initial sync immediately
                                            startSync(true);
                                        }
                                    }
                                }}
                                disabled={!outputDirInput.trim()}
                                className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Start Using HakoDesk
                            </button>
                        </div>
                    </div>
                </div>
            )
            }

            <DiagnosticsModal
                isOpen={showDiagnostics}
                onClose={() => setShowDiagnostics(false)}
            />

            <AboutModal
                isOpen={showAboutModal}
                onClose={() => setShowAboutModal(false)}
                onOpenDiagnostics={() => setShowDiagnostics(true)}
            />

            <ReportIssueModal
                isOpen={showReportModal}
                onClose={() => {
                    setShowReportModal(false);
                    setCrashError(undefined);
                }}
                currentScreen={'Home'}
                crashError={crashError}
            />

            {/* ERROR TOAST */}
            {
                settingsError && (
                    <div className="fixed bottom-4 right-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 z-50">
                        <div className="bg-red-100 p-2 rounded-full">
                            <Loader2 className="w-4 h-4 text-red-600" />
                        </div>
                        <div>
                            <p className="font-semibold text-sm">Error</p>
                            <p className="text-xs opacity-90">{settingsError}</p>
                        </div>
                        <button
                            onClick={() => setShowDiagnostics(true)}
                            className="ml-2 bg-white/50 hover:bg-white text-red-700 p-1.5 rounded-lg transition-colors text-xs font-medium"
                        >
                            Debug
                        </button>
                    </div>
                )
            }

            {/* Settings Modal */}
            {
                showSettingsModal && appSettings && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl max-w-md w-full shadow-xl overflow-hidden">
                            <div className="bg-gray-100 px-6 py-4 flex items-center justify-between border-b">
                                <h3 className="text-lg font-bold text-gray-800">Settings</h3>
                                <button
                                    onClick={() => setShowSettingsModal(false)}
                                    className="text-gray-500 hover:text-gray-700"
                                >
                                    X
                                </button>
                            </div>
                            <div className="p-6 space-y-6">
                                {/* Output Folder */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Output Folder
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={outputDirInput}
                                            onChange={(e) => setOutputDirInput(e.target.value)}
                                            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <button
                                            onClick={() => saveSettings({ output_dir: outputDirInput })}
                                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                                        >
                                            Save
                                        </button>
                                    </div>
                                </div>

                                {/* Auto-Sync */}
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <label className="text-sm font-medium text-gray-700">Auto-Sync</label>
                                        <button
                                            onClick={() => saveSettings({ auto_sync_enabled: !appSettings.auto_sync_enabled })}
                                            className={`relative w-12 h-6 rounded-full transition-colors ${appSettings.auto_sync_enabled ? 'bg-blue-500' : 'bg-gray-300'
                                                }`}
                                        >
                                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${appSettings.auto_sync_enabled ? 'translate-x-7' : 'translate-x-1'
                                                }`} />
                                        </button>
                                    </div>
                                    {appSettings.auto_sync_enabled && (
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm text-gray-600">Sync every</span>
                                            <select
                                                value={appSettings.sync_interval_minutes}
                                                onChange={(e) => saveSettings({ sync_interval_minutes: parseInt(e.target.value) })}
                                                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            >
                                                <option value={1}>1 minute</option>
                                                <option value={5}>5 minutes</option>
                                                <option value={10}>10 minutes</option>
                                                <option value={30}>30 minutes</option>
                                                <option value={60}>1 hour</option>
                                            </select>
                                        </div>
                                    )}
                                </div>

                                {/* Adaptive Sync */}
                                {appSettings.auto_sync_enabled && (
                                    <div>
                                        <div className="flex items-center justify-between">
                                            <label className="text-sm font-medium text-gray-700">Smart Timing</label>
                                            <button
                                                onClick={() => saveSettings({ adaptive_sync_enabled: !appSettings.adaptive_sync_enabled })}
                                                className={`relative w-12 h-6 rounded-full transition-colors ${appSettings.adaptive_sync_enabled ? 'bg-blue-500' : 'bg-gray-300'
                                                    }`}
                                            >
                                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${appSettings.adaptive_sync_enabled ? 'translate-x-7' : 'translate-x-1'
                                                    }`} />
                                            </button>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Randomize intervals based on posting patterns</p>
                                    </div>
                                )}

                                {/* Desktop Notifications */}
                                <div>
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium text-gray-700">Desktop Notifications</label>
                                        <button
                                            onClick={() => saveSettings({ notifications_enabled: !appSettings.notifications_enabled })}
                                            className={`relative w-12 h-6 rounded-full transition-colors ${appSettings.notifications_enabled ? 'bg-blue-500' : 'bg-gray-300'
                                                }`}
                                        >
                                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${appSettings.notifications_enabled ? 'translate-x-7' : 'translate-x-1'
                                                }`} />
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">Show notification when new messages arrive</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Main 3-zone layout */}
            <Layout
                authStatus={authStatus}
                onAddService={() => setShowAddServicePage(true)}
                onOpenSettings={() => setShowSettingsModal(true)}
                onReportIssue={() => setShowReportModal(true)}
                onOpenAbout={() => setShowAboutModal(true)}
                messagesContent={
                    <MessagesFeature
                        appSettings={appSettings}
                        syncProgress={syncProgress}
                        syncVersion={syncVersion}
                    />
                }
            />
            </div>
        </div>
    )
}

function AppWithErrorBoundary() {
    const [crashError, setCrashError] = useState<string | undefined>();
    const [showReportAfterCrash, setShowReportAfterCrash] = useState(false);

    const handleReportIssue = (error: string) => {
        setCrashError(error);
        setShowReportAfterCrash(true);
    };

    return (
        <>
            <ErrorBoundary onReportIssue={handleReportIssue}>
                <App />
            </ErrorBoundary>
            {showReportAfterCrash && (
                <ReportIssueModal
                    isOpen={showReportAfterCrash}
                    onClose={() => {
                        setShowReportAfterCrash(false);
                        setCrashError(undefined);
                    }}
                    crashError={crashError}
                />
            )}
        </>
    );
}

export default AppWithErrorBoundary
