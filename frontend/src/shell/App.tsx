import { useState, useEffect, useRef, useCallback } from 'react'
import { Layout } from '../core/layout'
import { LandingPage } from '../pages/LandingPage'
import { Loader2 } from 'lucide-react'
import { DiagnosticsModal, ReportIssueModal, AboutModal, UpdateBanner } from '../core/modals'
import { ErrorBoundary } from '../core/common'
import { MessagesFeature } from '../features/messages'
import { useAppStore } from '../store/appStore'
import type { FeatureId } from '../store/appStore'
import { applyThemeToDocument, serviceIdToGroupId } from '../config/colors'
import { isFeaturePaid, SERVICE_FEATURES } from '../config/features'
import { SearchModal, useGlobalSearchShortcut } from '../features/search'
import type { SearchModalHandle } from '../features/search'

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
        setActiveFeature,
    } = useAppStore();

    // Auth hook
    const {
        isAuthenticated,
        authCheckComplete,
        setAuthError,
        connectedServices,
        markServiceDisconnected,
        isServiceDisconnected,
        checkAuth,
    } = useAuth();

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
                                return {
                                    ...prev,
                                    user_nicknames: { ...(prev.user_nicknames || {}), [activeService]: data.nickname },
                                };
                            });
                        }
                    })
                    .catch(console.error);
            }
        },
        markServiceDisconnected,
    });

    // Track active feature per service for disconnected-service detection
    const activeFeatures = useAppStore(s => s.activeFeatures);
    const currentFeature = activeService ? activeFeatures[activeService] ?? 'messages' : null;

    // Disconnected service login popup — shown when user switches to a paid feature on a disconnected service
    const [disconnectedLoginService, setDisconnectedLoginService] = useState<string | null>(null);

    useEffect(() => {
        if (!activeService) return;
        if (!isServiceDisconnected(activeService)) return;
        if (!currentFeature || !isFeaturePaid(currentFeature as FeatureId)) return;
        if (sessionExpiredService) return;
        if (disconnectedLoginService) return; // Already showing
        setDisconnectedLoginService(activeService);
    }, [activeService, currentFeature]);

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

    // === RENDER ===

    // Show ToS dialog on first launch (blocks all other content until accepted)
    if (!tosAccepted) {
        return <TosDialog onAccept={() => setTosAccepted(true)} />;
    }

    // Show loading while auth check is in progress
    if (!authCheckComplete) {
        return <div className="h-screen flex items-center justify-center bg-[#F0F2F5]"><Loader2 className="animate-spin text-blue-500" /></div>;
    }

    // Show LandingPage if no services selected (new user or all services removed)
    if (selectedServices.length === 0) {
        return (
            <LandingPage
                onComplete={(services) => {
                    setSelectedServices(services);
                    setActiveService(services[0]);
                    // Default to blogs (free) for services that support it
                    for (const svc of services) {
                        if (SERVICE_FEATURES[svc]?.includes('blogs')) {
                            setActiveFeature(svc, 'blogs');
                        }
                    }
                }}
            />
        );
    }

    const handleSetupComplete = async () => {
        if (outputDirInput.trim()) {
            const success = await saveSettings({
                output_dir: outputDirInput.trim(),
                blogs_full_backup: setupBlogFullBackup,
            });
            if (success) {
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
                        outputDirInput={outputDirInput}
                        setOutputDirInput={setOutputDirInput}
                        onSaveSettings={saveSettings}
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

                {/* Disconnected Service Login Modal - triggered by switching to disconnected service */}
                {disconnectedLoginService && !sessionExpiredService && (
                    <LoginModal
                        serviceId={disconnectedLoginService}
                        featureId="messages"
                        onClose={() => setDisconnectedLoginService(null)}
                        onSuccess={async () => {
                            await checkAuth();
                            setDisconnectedLoginService(null);
                            startSync(false, disconnectedLoginService);
                        }}
                        isDisconnected={true}
                    />
                )}

                {/* Search Modal */}
                <SearchModal
                    ref={searchModalRef}
                    userNicknames={appSettings?.user_nicknames}
                    blogBackupEnabled={appSettings?.blogs_full_backup}
                    onOpenSettings={openSettingsModal}
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
                            onSyncNow={() => startSync(false)}
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
