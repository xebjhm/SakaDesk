import { useState, useEffect, useRef, useCallback } from 'react'
import { Layout } from '../core/layout'
import { LandingPage } from '../pages/LandingPage'
import { Loader2 } from 'lucide-react'
import { DiagnosticsModal, ReportIssueModal, AboutModal, UpdateBanner } from '../core/modals'
import { ErrorBoundary } from '../core/common'
import { MessagesFeature } from '../features/messages'
import { useAppStore } from '../store/appStore'
import { applyThemeToDocument, serviceIdToGroupId } from '../config/colors'
import { SearchModal, useGlobalSearchShortcut } from '../features/search'
import type { SearchModalHandle } from '../features/search'

import { getServiceIdFromDisplayName } from '../data/services'
import { useAuth } from './hooks/useAuth'
import { useSync } from './hooks/useSync'
import { useSettings } from './hooks/useSettings'
import { SyncModal, SetupWizard, SettingsModal, LoginModal, TosDialog } from './components'

function App() {
    const {
        activeService,
        setActiveService,
        selectedServices,
        setSelectedServices,
    } = useAppStore();

    // Auth hook
    const {
        isAuthenticated,
        authCheckComplete,
        setAuthError,
        connectedServices,
        markServiceDisconnected,
        checkAuth,
    } = useAuth();

    // Migration: Auto-populate selectedServices from connectedServices for existing users
    useEffect(() => {
        if (authCheckComplete && connectedServices.length > 0 && selectedServices.length === 0) {
            setSelectedServices(connectedServices);
            // Also set activeService if not set
            if (!activeService) {
                setActiveService(connectedServices[0]);
            }
        }
    }, [authCheckComplete, connectedServices, selectedServices, setSelectedServices, activeService, setActiveService]);

    // Apply theme CSS variables when activeService changes
    useEffect(() => {
        if (activeService) {
            const groupId = serviceIdToGroupId(activeService);
            applyThemeToDocument(groupId);
        }
    }, [activeService]);

    // Settings hook
    const {
        appSettings,
        setAppSettings,
        allServiceSettings,
        connectedServices: settingsConnectedServices,
        outputDirInput,
        setOutputDirInput,
        settingsError,
        showSettingsModal,
        setShowSettingsModal,
        showSetupWizard,
        setShowSetupWizard,
        setupBlogFullBackup,
        setSetupBlogFullBackup,
        saveSettings,
        saveServiceSettings,
        handleSelectFolder,
        openSettingsModal,
    } = useSettings(isAuthenticated);

    // Sync hook - now syncs ALL connected services independently
    const {
        syncProgress,
        showSyncModal,
        syncVersion,
        startSync,
        hasStartedSyncRef,
        sessionExpiredService,
        clearSessionExpired,
    } = useSync({
        isAuthenticated,
        appSettings,
        connectedServices,
        setAuthError,
        setIsAuthenticated: (auth: boolean) => {
            if (!auth) {
                hasStartedSyncRef.current = false;
            }
        },
        onSyncComplete: () => {
            // Refresh profile on sync complete
            if (activeService) {
                fetch(`/api/profile?service=${encodeURIComponent(activeService)}`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.nickname) {
                            setAppSettings(prev => {
                                if (!prev) return prev;
                                const newNicknames = { ...(prev.user_nicknames || {}), [activeService]: data.nickname };
                                return {
                                    ...prev,
                                    user_nickname: data.nickname,  // Legacy: keep for compatibility
                                    user_nicknames: newNicknames,
                                };
                            });
                        }
                    })
                    .catch(console.error);
            }
        },
        markServiceDisconnected,
    });

    // UI state
    const [showDiagnostics, setShowDiagnostics] = useState(false);
    const [showReportModal, setShowReportModal] = useState(false);
    const [crashError, setCrashError] = useState<string | undefined>();
    const [showAboutModal, setShowAboutModal] = useState(false);

    // Search modal
    const searchModalRef = useRef<SearchModalHandle>(null);
    const openSearch = useCallback(() => searchModalRef.current?.open(), []);
    useGlobalSearchShortcut(openSearch);

    // ToS acceptance state - check localStorage on mount
    const [tosAccepted, setTosAccepted] = useState(() => {
        return localStorage.getItem('tos_accepted_at') !== null;
    });

    // One-time migration: sync localStorage read states to backend
    useEffect(() => {
        const migrateReadStates = async () => {
            try {
                const entries: Array<{
                    service: string;
                    group_id: number;
                    member_id: number;
                    last_read_id: number;
                    read_count: number;
                    revealed_ids: number[];
                }> = [];

                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (!key?.startsWith('read_state_')) continue;
                    const path = key.slice('read_state_'.length);
                    // Try individual path first, then group chat path
                    let serviceId: string | undefined;
                    let groupId: number;
                    let memberId: number;
                    const individualMatch = path.match(/^(.+?)\/messages\/(\d+)\s.*?\/(\d+)\s/);
                    if (individualMatch) {
                        serviceId = getServiceIdFromDisplayName(individualMatch[1]);
                        groupId = parseInt(individualMatch[2], 10);
                        memberId = parseInt(individualMatch[3], 10);
                    } else {
                        const groupMatch = path.match(/^(.+?)\/messages\/(\d+)\s/);
                        if (!groupMatch) continue;
                        serviceId = getServiceIdFromDisplayName(groupMatch[1]);
                        groupId = parseInt(groupMatch[2], 10);
                        memberId = 0;
                    }
                    if (!serviceId) continue;
                    try {
                        const state = JSON.parse(localStorage.getItem(key) || '{}');
                        entries.push({
                            service: serviceId,
                            group_id: groupId,
                            member_id: memberId,
                            last_read_id: state.lastReadId || 0,
                            read_count: state.readCount || 0,
                            revealed_ids: state.revealedIds || [],
                        });
                    } catch { /* skip malformed entries */ }
                }

                if (entries.length > 0) {
                    await fetch('/api/read-states/batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(entries),
                    });
                }
            } catch {
                // Non-fatal — migration will retry on next app start
            }
        };
        migrateReadStates();
    }, []);

    // === RENDER ===

    // Show ToS dialog on first launch (blocks all other content until accepted)
    if (!tosAccepted) {
        return <TosDialog onAccept={() => setTosAccepted(true)} />;
    }

    // Show loading while auth check is in progress
    if (!authCheckComplete) {
        return <div className="h-screen flex items-center justify-center bg-gray-50"><Loader2 className="animate-spin text-blue-500" /></div>;
    }

    // Show LandingPage if no services selected (new user or all services removed)
    if (selectedServices.length === 0) {
        return (
            <LandingPage
                onComplete={(services) => {
                    setSelectedServices(services);
                    setActiveService(services[0]);
                }}
            />
        );
    }

    const handleSetupComplete = async () => {
        if (outputDirInput.trim()) {
            const success = await saveSettings({ output_dir: outputDirInput.trim() });
            if (success) {
                // Save blog backup preference for active service
                if (activeService) {
                    await fetch(`/api/settings/service/${encodeURIComponent(activeService)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            sync_enabled: true,
                            adaptive_sync_enabled: true,
                            last_sync: null,
                            blogs_full_backup: setupBlogFullBackup
                        })
                    });
                }
                setShowSetupWizard(false);
                startSync(true);
            }
        }
    };

    return (
        <div className="flex flex-col h-screen bg-[#F0F2F5] font-sans overflow-hidden">
            {/* Update Banner */}
            <UpdateBanner />

            <div className="flex flex-1 overflow-hidden">
                {/* Sync Modal */}
                {showSyncModal && <SyncModal syncProgress={syncProgress} />}

                {/* Setup Wizard (First Time) */}
                {showSetupWizard && (
                    <SetupWizard
                        outputDirInput={outputDirInput}
                        setOutputDirInput={setOutputDirInput}
                        setupBlogFullBackup={setupBlogFullBackup}
                        setSetupBlogFullBackup={setSetupBlogFullBackup}
                        onSelectFolder={handleSelectFolder}
                        onComplete={handleSetupComplete}
                        isValid={!!outputDirInput.trim()}
                    />
                )}

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
                {settingsError && (
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
                )}

                {/* Settings Modal */}
                {showSettingsModal && appSettings && (
                    <SettingsModal
                        appSettings={appSettings}
                        allServiceSettings={allServiceSettings}
                        connectedServices={settingsConnectedServices}
                        outputDirInput={outputDirInput}
                        setOutputDirInput={setOutputDirInput}
                        onSaveSettings={saveSettings}
                        onSaveServiceSettings={saveServiceSettings}
                        onClose={() => setShowSettingsModal(false)}
                    />
                )}

                {/* Session Expired Login Modal - triggered by sync detecting SESSION_EXPIRED */}
                {sessionExpiredService && (
                    <LoginModal
                        serviceId={sessionExpiredService}
                        featureId="messages"
                        onClose={clearSessionExpired}
                        onSuccess={async () => {
                            await checkAuth();
                            clearSessionExpired();
                            // Restart sync for this service
                            startSync(false, sessionExpiredService);
                        }}
                        isDisconnected={true}
                    />
                )}

                {/* Search Modal */}
                <SearchModal
                    ref={searchModalRef}
                    userNicknames={appSettings?.user_nicknames}
                    userNickname={appSettings?.user_nickname}
                />

                {/* Main 3-zone layout */}
                <Layout
                    onAddService={() => {/* AddServiceModal will be triggered from ServiceRail */}}
                    onOpenSettings={openSettingsModal}
                    onReportIssue={() => setShowReportModal(true)}
                    onOpenAbout={() => setShowAboutModal(true)}
                    onOpenSearch={openSearch}
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
