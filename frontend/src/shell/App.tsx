import { useState, useEffect, useRef, useCallback } from 'react'
import { Layout } from '../core/layout'
import { LandingPage } from '../pages/LandingPage'
import { Loader2 } from 'lucide-react'
import { DiagnosticsModal, ReportIssueModal, AboutModal } from '../core/modals'
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
        setFreshlyAddedService,
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
        syncProgressByService,
        showSyncModal,
        syncVersion,
        startSync,
        startSequentialSync,
        sequentialSyncInfo,
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

    // Fresh service login prompt — shown after adding a new service (outside onboarding)
    const freshlyAddedService = useAppStore(s => s.freshlyAddedService);

    // Initial sync tracking — services currently undergoing their first sync
    const initialSyncServices = useAppStore(s => s.initialSyncServices);

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

    // ── First-Launch Login Carousel ──────────────────────────────────
    // On first launch, after LandingPage completes, we step through each
    // selected service that supports messages and show a login prompt.
    // Zero network activity until the carousel + setup wizard are done.
    const [loginCarousel, setLoginCarousel] = useState<string[] | null>(null);
    const [loginCarouselIndex, setLoginCarouselIndex] = useState(0);

    const advanceLoginCarousel = useCallback(() => {
        if (!loginCarousel) return;
        const nextIndex = loginCarouselIndex + 1;
        if (nextIndex >= loginCarousel.length) {
            // Carousel done — if setup wizard needs to show, it's already pending
            setLoginCarousel(null);
            setLoginCarouselIndex(0);
        } else {
            setLoginCarouselIndex(nextIndex);
        }
    }, [loginCarousel, loginCarouselIndex]);

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
                    // Start login carousel for services that support messages
                    const messageServices = services.filter(svc => SERVICE_FEATURES[svc]?.includes('messages'));
                    if (messageServices.length > 0) {
                        setLoginCarousel(messageServices);
                        setLoginCarouselIndex(0);
                    }
                }}
            />
        );
    }

    const handleSetupComplete = async () => {
        if (outputDirInput.trim()) {
            // Save output_dir only — blogs_full_backup is deferred until after
            // sync completes so blog downloads don't compete for bandwidth.
            const success = await saveSettings({
                output_dir: outputDirInput.trim(),
            });
            if (success) {
                setShowSetupWizard(false);
                // Sequential sync: one service at a time with blocking modal
                const servicesToSync = connectedServices.length > 0
                    ? connectedServices
                    : [];
                if (servicesToSync.length > 0) {
                    await startSequentialSync(servicesToSync);
                }
                // Now save blogs_full_backup — the useSettings hook will
                // auto-start blog backup via /api/blogs/backup/start.
                if (setupBlogFullBackup) {
                    await saveSettings({ blogs_full_backup: true });
                }
            }
        }
    };

    // Login carousel is active — show LoginModal for current service
    const loginCarouselService = loginCarousel?.[loginCarouselIndex] ?? null;
    const isOnboarding = loginCarousel !== null || showSetupWizard;

    return (
        <div className="flex flex-col h-screen bg-[#F0F2F5] font-sans overflow-hidden">

            <div className="flex flex-1 overflow-hidden">
                {/* Sync Modal — pass sequentialSyncInfo for multi-service progress */}
                {showSyncModal && <SyncModal syncProgress={syncProgress} sequentialSyncInfo={sequentialSyncInfo} />}

                {/* Login Carousel (first-launch only) — shown BEFORE SetupWizard */}
                {loginCarouselService && (
                    <LoginModal
                        serviceId={loginCarouselService}
                        featureId="messages"
                        onClose={advanceLoginCarousel}
                        onSuccess={async () => {
                            await checkAuth();
                            advanceLoginCarousel();
                        }}
                        isFreshPrompt={true}
                    />
                )}

                {/* Setup Wizard (First Time) — shown after login carousel completes */}
                {showSetupWizard && !loginCarousel && (
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
                {sessionExpiredService && !isOnboarding && (
                    <LoginModal
                        serviceId={sessionExpiredService}
                        featureId="messages"
                        onClose={clearSessionExpired}
                        onSuccess={async () => {
                            await checkAuth();
                            // Pass reconnected service to activate cooldown —
                            // prevents SESSION_EXPIRED from re-triggering the
                            // modal if the sync started below races with auth.
                            clearSessionExpired(sessionExpiredService);
                            // Restart sync for this service
                            startSync(false, sessionExpiredService);
                        }}
                        isDisconnected={true}
                    />
                )}

                {/* Disconnected Service Login Modal - triggered by switching to disconnected service */}
                {disconnectedLoginService && !sessionExpiredService && !isOnboarding && (
                    <LoginModal
                        serviceId={disconnectedLoginService}
                        featureId="messages"
                        onClose={() => setDisconnectedLoginService(null)}
                        onSuccess={async () => {
                            await checkAuth();
                            setDisconnectedLoginService(null);
                            // Pass reconnected service to activate cooldown
                            clearSessionExpired(disconnectedLoginService);
                            startSync(false, disconnectedLoginService);
                        }}
                        isDisconnected={true}
                    />
                )}

                {/* Fresh Service Login Prompt — gentle prompt after adding a new service (outside onboarding) */}
                {freshlyAddedService && !sessionExpiredService && !disconnectedLoginService && !isOnboarding && (
                    <LoginModal
                        serviceId={freshlyAddedService}
                        featureId="messages"
                        onClose={() => setFreshlyAddedService(null)}
                        onSuccess={async () => {
                            await checkAuth();
                            const svc = freshlyAddedService;
                            setFreshlyAddedService(null);
                            useAppStore.getState().addInitialSyncService(svc);
                            startSync(false, svc);
                        }}
                        isFreshPrompt={true}
                    />
                )}

                {/* Search Modal */}
                <SearchModal
                    ref={searchModalRef}
                    userNicknames={appSettings?.user_nicknames}
                    blogBackupEnabled={appSettings?.blogs_full_backup}
                    onOpenSettings={openSettingsModal}
                />

                {/* Main 3-zone layout — hidden during onboarding and sync to show clean background */}
                {!isOnboarding && !showSyncModal && (
                    <Layout
                        onAddService={() => {/* AddServiceModal will be triggered from ServiceRail */}}
                        onOpenSettings={openSettingsModal}
                        onReportIssue={() => setShowReportModal(true)}
                        onOpenAbout={() => setShowAboutModal(true)}
                        onOpenSearch={openSearch}
                        syncProgressByService={syncProgressByService}
                        initialSyncServices={initialSyncServices}
                        blogBackupEnabled={appSettings?.blogs_full_backup}
                        messagesContent={
                            <MessagesFeature
                                appSettings={appSettings}
                                syncProgress={syncProgress}
                                syncVersion={syncVersion}
                                onSyncNow={() => startSync(false)}
                            />
                        }
                    />
                )}
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
