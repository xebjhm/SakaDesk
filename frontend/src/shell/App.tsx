import { useState, useEffect, useRef, useCallback } from 'react'
import { Layout } from '../core/layout'
import { LandingPage } from '../pages/LandingPage'
import { AlertCircle, Loader2, X } from 'lucide-react'
import { Button, IconButton } from '../design/primitives'
import { useTranslation } from '../i18n'
import { DiagnosticsModal, ReportIssueModal, AboutModal } from '../core/modals'
import { ErrorBoundary } from '../core/common'
import { MessagesFeature } from '../features/messages'
import { useAppStore } from '../store/appStore'
import type { FeatureId } from '../store/appStore'
import { serviceIdToGroupId } from '../config/colors'
import { applyGroupTokens } from '../design/applyTokens'
import type { GroupId } from '../design/tokens'
import { Z_INDEX } from '../constants/zIndex'
import { isFeaturePaid, SERVICE_FEATURES } from '../config/features'
import { SearchModal, useGlobalSearchShortcut } from '../features/search'
import type { SearchModalHandle } from '../features/search'
import { persisted } from '../core/persistence/persisted'
import { applyStartupLanguage } from './language'
import { openChatFromToast } from './openChat'
import { clientLog } from '../utils/clientLog'
import { markVoiceHeard } from './markVoiceHeard'

import { useAuth } from './hooks/useAuth'
import { useSync } from './hooks/useSync'
import { useBackendSyncWatcher } from './hooks/useBackendSyncWatcher'
import { useSettings } from './hooks/useSettings'
import { SyncModal, SetupWizard, SettingsModal, LoginModal, TosDialog, EntryBackdrop, FirstSyncToast } from './components'
import { BrandScope } from '../design/brandScope'
import { celebrateFirstSync } from './firstSyncCelebration'

function App() {
    const { t } = useTranslation()
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

    // Settings hook
    const {
        appSettings,
        setAppSettings,
        outputDirInput,
        setOutputDirInput,
        settingsErrorKey,
        clearSettingsError,
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
        setShowSyncModal,
        syncVersion,
        startSync,
        verifyAndFix,
        cancelSync,
        startSequentialSync,
        sequentialSyncInfo,
        hasStartedSyncRef,
        sessionExpiredService,
        clearSessionExpired,
        isPolling,
        followSync,
        lastHandledRunId,
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

    // Follow syncs the backend scheduler / tray started on its own, including ones
    // that finished (or failed) while nobody was watching.
    useBackendSyncWatcher({
        services: isAuthenticated ? connectedServices : [],
        isPolling,
        follow: followSync,
        lastHandledRunId,
    })

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
    const [showFirstSyncToast, setShowFirstSyncToast] = useState(false);
    const hideFirstSyncToast = useCallback(() => setShowFirstSyncToast(false), []);

    // Search modal
    const searchModalRef = useRef<SearchModalHandle>(null);
    const openSearch = useCallback(() => searchModalRef.current?.open(), []);
    useGlobalSearchShortcut(openSearch);

    // ToS acceptance state - check persisted app-state on mount
    const [tosAccepted, setTosAccepted] = useState(() => {
        return persisted.getPref('tos_accepted_at', null) !== null;
    });

    // Group design tokens on the document: the active group's once ToS is accepted and a group is
    // chosen, the `default` group before that. Its accent roles equal the brand; the entry screens
    // set brand scope on themselves (R-d), so no screen reads its group roles.
    const tokenGroup: GroupId = tosAccepted && selectedServices.length > 0 && activeService
        ? serviceIdToGroupId(activeService)
        : 'default';
    useEffect(() => {
        applyGroupTokens(tokenGroup);
    }, [tokenGroup]);

    // Backend-backed prefs hydration — loads the app-state prefs cache before
    // the gated UI renders. Swallows fetch errors internally (see persisted.ts),
    // so this can never break startup even if the endpoint is unavailable; a
    // failing conversation-cache load retries with backoff first, delaying the
    // first render by at most the sum of CONV_HYDRATE_RETRY_DELAYS_MS plus the
    // request times. If every try fails, the first render proceeds with the cache
    // not ready and persisted.ts keeps retrying in the background
    // (CONV_BACKGROUND_RETRY_DELAYS_MS, then every CONV_BACKGROUND_RETRY_MAX_MS),
    // notifying persisted.onConversationsReady listeners once it loads.
    const [prefsHydrated, setPrefsHydrated] = useState(false);
    useEffect(() => {
        persisted.hydratePrefs()
            .then(() => persisted.hydrateConversations().catch(() => {/* defensive: never block startup */}))
            .then(() => persisted.migrateOnce().catch(() => {/* defensive: never block startup */}))
            .then(() => {
                // Re-evaluate ToS acceptance now that the prefs cache is
                // hydrated + migrated. The initial useState read (below) ran
                // against an EMPTY cache at mount — an upgrading user who
                // already accepted has their acceptance in the backend, not in
                // the synchronous mount-time cache, so without this they would
                // be bounced back to the ToS gate on every launch.
                setTosAccepted(persisted.getPref('tos_accepted_at', null) !== null);
            })
            // Apply language now that hydration + migration have run, so the first
            // gated render is in the right language (the single ordered decision lives
            // in language.ts).
            .then(() => applyStartupLanguage())
            .then(() =>
                // Load the app-state bundle (selected services, favorites, etc.)
                // from the backend now that the prefs cache is hydrated. Storage
                // was skipped at import time (skipHydration: true) because the
                // cache is empty until this point. Defensive: a rehydrate failure
                // must not block startup (store just keeps its default state).
                useAppStore.persist.rehydrate()?.catch(() => {/* defensive: never block startup */})
            )
            .finally(() => setPrefsHydrated(true));
    }, []);

    // SD-FE-STATE-03: flush any pending debounced prefs writes when the window
    // is being hidden/closed. pywebview tears down the JS context on close, so a
    // change made within the 300ms debounce (a settings toggle, ToS acceptance,
    // conversation selection) would otherwise never reach app_state.db.
    // `pagehide` fires on close; `visibilitychange`→hidden covers minimize/hide
    // paths where pagehide may not fire. flushNow() uses a keepalive request.
    useEffect(() => {
        const flush = () => persisted.flushNow();
        const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('pagehide', flush);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);

    // Desktop toast click: the pywebview host calls window.__sakadeskOpenChat(target).
    useEffect(() => {
        window.__sakadeskOpenChat = openChatFromToast;
        return () => { delete window.__sakadeskOpenChat; };
    }, []);

    // Desktop "log in again" toast click: show that service and its login dialog.
    useEffect(() => {
        window.__sakadeskOpenLogin = (service: string) => {
            if (!useAppStore.getState().selectedServices.includes(service)) {
                clientLog('notify_open_login', { delivered: false, reason: 'unknown_service' });
                return false;
            }
            useAppStore.getState().setActiveService(service);
            setDisconnectedLoginService(service);
            clientLog('notify_open_login', { delivered: true, service });
            return true;
        };
        return () => { delete window.__sakadeskOpenLogin; };
    }, []);

    // Desktop popup answered a voice: the main window (sole writer) marks it heard.
    useEffect(() => {
        window.__sakadeskMarkVoiceHeard = markVoiceHeard;
        return () => { delete window.__sakadeskMarkVoiceHeard; };
    }, []);

    // === RENDER ===

    // Show loading while auth check is in progress or prefs are hydrating.
    // This MUST precede the ToS gate: `tosAccepted` is only meaningful once the
    // prefs cache is hydrated (a returning/upgrading user's acceptance lives in
    // the backend, not the empty mount-time cache). Gating on ToS before
    // hydration would bounce those users back into the dialog.
    if (!authCheckComplete || !prefsHydrated) {
        return (
            <BrandScope className="flex h-screen items-center justify-center bg-window">
                <span data-testid="boot-screen" role="status" aria-label={t('common.loading')}>
                    <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-accent motion-reduce:animate-none" />
                </span>
            </BrandScope>
        );
    }

    // Show ToS dialog on first launch (blocks all other content until accepted)
    if (!tosAccepted) {
        return (
            <>
                <EntryBackdrop />
                <TosDialog onAccept={() => setTosAccepted(true)} />
            </>
        );
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
                    const outcome = await startSequentialSync(servicesToSync);
                    // Tier-B celebration of the first complete sync (spec §9, decision D11).
                    if (celebrateFirstSync(outcome)) setShowFirstSyncToast(true);
                }
                // Now save blogs_full_backup — the useSettings hook will
                // auto-start blog backup via /api/blogs/backup/start. Saved after a
                // cancelled sync too: Cancel stops the message sync, it does not undo
                // the blog backup the user chose in the wizard.
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
        <div className="flex h-screen flex-col overflow-hidden bg-window font-sans">

            <div className="flex flex-1 overflow-hidden">
                {/* First launch (login carousel, setup, first sync) and blocking syncs: the brand orbs behind the dialogs (spec §9). The layout is hidden meanwhile. */}
                {(isOnboarding || showSyncModal) && <EntryBackdrop />}
                {/* Sync Modal — pass sequentialSyncInfo for multi-service progress */}
                {showSyncModal && <SyncModal syncProgress={syncProgress} sequentialSyncInfo={sequentialSyncInfo} onClose={() => setShowSyncModal(false)} onCancel={() => cancelSync()} />}

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

                {/* ERROR TOAST: a status card on the toast layer, so it shows over an open Settings dialog. */}
                {settingsErrorKey && (
                    <div
                        data-testid="settings-error-toast"
                        role="alert"
                        style={{ zIndex: Z_INDEX.TOAST }}
                        className="fixed bottom-4 right-4 flex max-w-sm items-center gap-3 rounded-card bg-card p-4 shadow-card animate-reveal motion-reduce:animate-none"
                    >
                        <AlertCircle aria-hidden="true" className="h-5 w-5 shrink-0 text-status-danger" />
                        <div className="min-w-0 flex-1">
                            <p className="text-small font-semibold text-primary">{t('common.error')}</p>
                            <p className="text-caption text-secondary">{t(settingsErrorKey)}</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setShowDiagnostics(true)}>
                            {t('common.debug')}
                        </Button>
                        <IconButton
                            size="sm"
                            variant="ghost"
                            aria-label={t('common.close')}
                            icon={<X />}
                            onClick={clearSettingsError}
                        />
                    </div>
                )}
                {showFirstSyncToast && <FirstSyncToast onDone={hideFirstSyncToast} />}

                {/* Settings Modal */}
                {showSettingsModal && appSettings && (
                    <SettingsModal
                        appSettings={appSettings}
                        outputDirInput={outputDirInput}
                        setOutputDirInput={setOutputDirInput}
                        onSaveSettings={saveSettings}
                        onClose={() => setShowSettingsModal(false)}
                        activeService={activeService ?? ''}
                        onVerifyAndFix={verifyAndFix}
                        onDeepResync={(service) => startSync(true, service, true)}
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
