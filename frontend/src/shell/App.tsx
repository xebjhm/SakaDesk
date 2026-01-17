import { useState } from 'react'
import { Layout } from '../core/layout'
import { AddServicePage } from '../pages/AddServicePage'
import { Loader2 } from 'lucide-react'
import { DiagnosticsModal, ReportIssueModal, AboutModal, UpdateBanner } from '../core/modals'
import { ErrorBoundary } from '../core/common'
import { MessagesFeature } from '../features/messages'
import { useAppStore } from '../store/appStore'

import { useAuth } from './hooks/useAuth'
import { useSync } from './hooks/useSync'
import { useSettings } from './hooks/useSettings'
import { SyncModal, SetupWizard, SettingsModal } from './components'

function App() {
    const { activeService, setActiveService } = useAppStore();

    // Auth hook
    const {
        isAuthenticated,
        authStatus,
        setAuthError,
        checkAuth,
        connectedServices,
    } = useAuth();

    // Settings hook
    const {
        appSettings,
        setAppSettings,
        serviceSettings,
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

    // Sync hook
    const {
        syncProgress,
        showSyncModal,
        syncVersion,
        startSync,
        hasStartedSyncRef,
    } = useSync({
        isAuthenticated,
        appSettings,
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
                            setAppSettings(prev => prev ? { ...prev, user_nickname: data.nickname } : prev);
                        }
                    })
                    .catch(console.error);
            }
        },
    });

    // UI state
    const [showDiagnostics, setShowDiagnostics] = useState(false);
    const [showReportModal, setShowReportModal] = useState(false);
    const [crashError, setCrashError] = useState<string | undefined>();
    const [showAboutModal, setShowAboutModal] = useState(false);
    const [showAddServicePage, setShowAddServicePage] = useState(false);

    // === RENDER ===
    if (isAuthenticated === null) {
        return <div className="h-screen flex items-center justify-center bg-gray-50"><Loader2 className="animate-spin text-blue-500" /></div>;
    }

    // Show AddServicePage if:
    // 1. No services connected (first install / fresh state)
    // 2. User explicitly wants to add a service (clicked + button)
    if (isAuthenticated === false || connectedServices.length === 0 || showAddServicePage) {
        return (
            <AddServicePage
                onLoginSuccess={(serviceId: string) => {
                    setShowAddServicePage(false);
                    setActiveService(serviceId);
                    checkAuth();
                }}
                onBack={connectedServices.length > 0 ? () => setShowAddServicePage(false) : undefined}
                connectedServices={connectedServices}
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
                        serviceSettings={serviceSettings}
                        activeService={activeService}
                        outputDirInput={outputDirInput}
                        setOutputDirInput={setOutputDirInput}
                        onSaveSettings={saveSettings}
                        onSaveServiceSettings={saveServiceSettings}
                        onClose={() => setShowSettingsModal(false)}
                    />
                )}

                {/* Main 3-zone layout */}
                <Layout
                    authStatus={authStatus}
                    onAddService={() => setShowAddServicePage(true)}
                    onOpenSettings={openSettingsModal}
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
