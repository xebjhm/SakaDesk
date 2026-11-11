import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { AlertCircle, LogIn, X } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { Button, IconButton, Modal } from '../../design/primitives';
import { groupTokens } from '../../design/tokens';
import { groupScopeStyle } from '../../design/groupScope';
import { ScopeContext } from '../../design/scopeContext';
import { logDialogLoad } from '../../design/dialog/dialogLog';
import { logWait, useLoadingStages } from '../../design/loading';
import { serviceIdToGroupId } from '../../config/colors';
import { getServiceById } from '../../data/services';
import { FEATURE_DEFINITIONS } from '../../config/features';
import type { FeatureId } from '../../store/appStore';
import { cn } from '../../utils/classnames';
import { ConfirmDialog } from './ConfirmDialog';
import { useOptionalAuth } from '../context/AuthContext';
import {
    type CancelLoginResult,
    type LoginVerifier,
    awaitLoginCancel,
    cancelLogin,
    getLoginPhase,
    getLoginStartedAt,
    isLoginCancelling,
    loginGeneration,
    newLoginAttempt,
    ownsLogin,
    setLoginAbort,
    setLoginFinishing,
    subscribeLoginLock,
    tryLockLogin,
    unlockLogin,
} from './loginLock';

/** The `detail` code of an error answer, or null (never shown or logged as text). */
async function readDetail(res: Response): Promise<string | null> {
    try {
        const body: unknown = await res.json();
        const detail = (body as { detail?: unknown } | null)?.detail;
        return typeof detail === 'string' ? detail : null;
    } catch {
        return null;
    }
}

/** A login stopped by Cancel: the dialog breadcrumb plus `ui_wait` with how long it had waited since `started`. */
function logCancelled(started: number | null): void {
    logDialogLoad('login', 'cancelled');
    logWait('login', 'cancelled', started === null ? 0 : Date.now() - started);
}

/**
 * The `login_cancel` breadcrumb (codes only): `ok` cancelled; `ok`/`not_cancelled` nothing left to
 * cancel and the service is not logged in; `skipped`/`completed` the login had succeeded after
 * all (its success path runs); `error`/`failed|unreachable|timeout` the cancel request failed;
 * `skipped` nothing to cancel.
 */
function logCancelOutcome({ backend, completed }: CancelLoginResult): void {
    if (completed) logDialogLoad('login_cancel', 'skipped', undefined, 'completed');
    else if (backend === 'cancelled') logDialogLoad('login_cancel', 'ok');
    else if (backend === 'not_cancelled') logDialogLoad('login_cancel', 'ok', undefined, 'not_cancelled');
    else if (backend === 'failed' || backend === 'unreachable' || backend === 'timeout') logDialogLoad('login_cancel', 'error', undefined, backend);
    else logDialogLoad('login_cancel', 'skipped');
}

interface LoginModalProps {
    serviceId: string;
    featureId: FeatureId;
    onClose: () => void;
    /** Awaited: the login stays locked until a returned promise settles. */
    onSuccess: () => void | Promise<void>;
    isDisconnected?: boolean;  // true if session expired (vs never connected)
    isFreshPrompt?: boolean;   // true for gentle "connect your account?" prompt after adding service
}

/**
 * Login for one service (spec D2d decisions 5–7, 22): the service's official banner, like its
 * chat header, in that service's colours (group scope), and one primary sign-in button.
 *
 * While it connects (loading UX L6), Close, Cancel, Escape and the backdrop stay usable: they
 * cancel the login (`cancelLogin`: abort, backend cancel, unlock) and close. A cancel is not a
 * failure (no error text). Staged copy appears at 3 s and 10 s. Once the login answered OK
 * (`finishing`), Cancel and Close are blocked with a reason: the single-session login is kept.
 */
export const LoginModal: React.FC<LoginModalProps> = ({
    serviceId,
    featureId,
    onClose,
    onSuccess,
    isDisconnected = false,
    isFreshPrompt = false,
}) => {
    const { t } = useTranslation();
    const titleId = useId();
    // App-wide (loginLock): a dialog mounted while another one's login is in flight shows it as busy.
    const phase = useSyncExternalStore(subscribeLoginLock, getLoginPhase);
    const startedAt = useSyncExternalStore(subscribeLoginLock, getLoginStartedAt);
    const cancelling = useSyncExternalStore(subscribeLoginLock, isLoginCancelling);
    const isLoading = phase !== 'idle';
    const finishing = phase === 'finishing';
    // A login being cancelled is winding down: no "finish in the browser" copy for it.
    const { stage } = useLoadingStages(phase === 'connecting' && !cancelling, { surface: 'login', startedAt: startedAt ?? undefined });
    // Null outside an AuthProvider (dialog tests): a cancel then cannot re-check and stays a cancel.
    const auth = useOptionalAuth();
    const authRef = useRef(auth);
    authRef.current = auth;
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const [error, setError] = useState<string | null>(null);
    const [showGeoWarning, setShowGeoWarning] = useState(false);

    // The service this dialog currently shows; a login that finishes for another one is stale.
    const currentServiceRef = useRef(serviceId);
    currentServiceRef.current = serviceId;

    // The dialog is reused across services (login carousel): a new service starts clean, so a
    // failed login's error never shows on the next service's dialog. The login lock is app-wide
    // (loginLock), so a login still in flight keeps blocking a second one (single-session token).
    const [shownService, setShownService] = useState(serviceId);
    if (shownService !== serviceId) {
        setShownService(serviceId);
        setError(null);
        setShowGeoWarning(false);
    }

    const service = getServiceById(serviceId);
    const feature = FEATURE_DEFINITIONS[featureId];
    const groupId = serviceIdToGroupId(serviceId);
    const isLight = groupTokens[groupId].official.headerStyle === 'light';

    // A Yodel geo check that resolves after this dialog unmounted must not log in.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    // One login at a time for the whole app (single-session token): the lock is taken
    // synchronously on the first click, before the Yodel geo check, so a second click (in this
    // dialog or in one mounted later) cannot start a second login.

    /**
     * After a cancel the backend did not confirm: did the login of `service` complete after all?
     * True when the re-checked status shows it authenticated with a new token (a still-valid old
     * token of an expired session does not count).
     */
    const verifyLogin: LoginVerifier = async (service, baselineExpiresAt) => {
        const current = authRef.current;
        if (!current) return false;
        const snapshot = await current.checkAuth();
        const status = snapshot?.[service];
        if (!status?.authenticated) return false;
        const expiresAt = status.expires_at ? status.expires_at * 1000 : null;
        return baselineExpiresAt === null || expiresAt !== baselineExpiresAt;
    };

    /** Logs in for `loginService`; the caller holds the lock (taken at `gen`), which this releases when done. */
    const doLogin = async (loginService: string, gen: number) => {
        setError(null);
        const controller = new AbortController();
        const attempt = newLoginAttempt();
        const started = getLoginStartedAt();
        setLoginAbort(controller, {
            service: loginService,
            attempt,
            baselineExpiresAt: authRef.current?.getServiceExpiresAt(loginService) ?? null,
        });
        try {
            let res: Response | null = null;
            try {
                res = await fetch(
                    `/api/auth/login?service=${encodeURIComponent(loginService)}&attempt=${encodeURIComponent(attempt)}`,
                    { method: 'POST', signal: controller.signal }
                );
            } catch (err: unknown) {
                if (!controller.signal.aborted) throw err;
                // Cancel (this dialog or another): it decides whether the login completed after all.
                const result = await awaitLoginCancel();
                if (!result?.completed) {
                    logCancelled(started);
                    return;
                }
            }
            if (res && res.status === 409 && (await readDetail(res)) === 'login_cancelled') {
                // The backend stopped this login (POST /login/cancel): a cancel, not a failure.
                logCancelled(started);
                return;
            }
            if (res && !res.ok) throw new Error(t('login.loginFailed'));
            // Answered OK, or a cancel found it completed: the normal success path.
            setLoginFinishing();

            // Initialize service settings entry
            await fetch(
                `/api/settings/service/${encodeURIComponent(loginService)}/init`,
                { method: 'POST' }
            );

            // Brief delay before advancing to prevent concurrent browser launches
            await new Promise(resolve => setTimeout(resolve, 1500));
            if (currentServiceRef.current === loginService) {
                logDialogLoad('login', 'ok');
                // Hold the lock until the caller has moved on (e.g. App's auth check has advanced).
                // The login itself worked: a failure here is not a failed login, so the user is
                // never asked to sign in again on a single-session token.
                try {
                    await onSuccess();
                } catch {
                    logDialogLoad('login', 'error', undefined, 'after_login');
                }
            } else {
                logDialogLoad('login', 'skipped');
            }
        } catch (err: unknown) {
            logDialogLoad('login', 'error', undefined, 'failed');
            if (currentServiceRef.current === loginService) {
                setError(err instanceof Error ? err.message : t('login.loginFailed'));
            }
        } finally {
            // A cancelled (or replaced) login is not ours to release.
            if (ownsLogin(gen)) unlockLogin();
        }
    };

    const handleLogin = async () => {
        if (!tryLockLogin()) return;
        const gen = loginGeneration();
        const loginService = serviceId;
        // Yodel's web service is Japan-only. Warn before a login attempt from
        // another region, since the login/data servers reject non-JP connections.
        if (loginService === 'yodel') {
            let blocked = false;
            try {
                const res = await fetch('/api/auth/geo-availability?service=yodel', { cache: 'no-store' });
                if (!res.ok) {
                    logDialogLoad('login_geo', 'error', undefined, 'failed');
                } else if ((await res.json()).blocked) {
                    blocked = true;
                } else {
                    logDialogLoad('login_geo', 'ok');
                }
            } catch {
                // Check failed (offline, etc.) — don't block the user; let login proceed.
                logDialogLoad('login_geo', 'error', undefined, 'unreachable');
            }
            // Cancelled during the check: cancelLogin already released the lock.
            if (!ownsLogin(gen)) {
                logDialogLoad('login', 'skipped');
                return;
            }
            // The dialog closed, or moved to another service, while the check was pending: never
            // log in (or warn) for the old one.
            if (!mountedRef.current || currentServiceRef.current !== loginService) {
                logDialogLoad('login', 'skipped');
                unlockLogin();
                return;
            }
            if (blocked) {
                logDialogLoad('login_geo', 'skipped', undefined, 'blocked');
                setShowGeoWarning(true);
                unlockLogin();
                return;
            }
        }
        await doLogin(loginService, gen);
    };

    const confirmGeoWarning = () => {
        setShowGeoWarning(false);
        if (!tryLockLogin()) return;
        void doLogin(serviceId, loginGeneration());
    };

    /**
     * Close, Cancel, Escape and the backdrop. While connecting they cancel the login, then close
     * once the backend answered (if the login turns out to have succeeded, its success path runs
     * instead). Once the login answered OK (`finishing`) they are refused, so a working login is
     * never undone.
     */
    const handleDismiss = () => {
        if (getLoginPhase() === 'finishing') {
            logDialogLoad('login_cancel', 'skipped');
            return;
        }
        if (getLoginPhase() === 'connecting') {
            if (isLoginCancelling()) return; // already winding down
            void cancelLogin(serviceId, verifyLogin).then((result) => {
                logCancelOutcome(result);
                // This dialog's login completed after all: its success path moves on (onSuccess).
                if (result.completed && result.service === currentServiceRef.current) return;
                onCloseRef.current();
            });
            return;
        }
        onClose();
    };

    const title = isFreshPrompt
        ? t('login.connectPromptTitle')
        : isDisconnected
            ? t('login.sessionExpired')
            : t('login.loginRequired');
    const description = isFreshPrompt
        ? t('login.connectPromptDesc', { service: service?.displayName ?? serviceId })
        : isDisconnected
            ? t('login.sessionExpiredDesc', {
                service: service?.displayName ?? serviceId,
                feature: feature ? t(feature.labelKey) : featureId,
            })
            : t('login.premiumFeatureDesc', {
                feature: feature ? t(feature.labelKey) : featureId,
                service: service?.name ?? serviceId,
            });

    const scopeStyle = groupScopeStyle(groupId);

    return (
        <>
            <Modal isOpen onClose={handleDismiss} layout="bare" labelledBy={titleId} logId="login" className="max-w-md">
                <div className="flex min-h-0 flex-col" style={scopeStyle}>
                    {/* The service's official banner, drawn like its chat header. */}
                    <div
                        data-testid="login-banner"
                        className={cn('flex shrink-0 items-center gap-3 px-6 py-4', isLight ? 'bg-sheet text-group-title' : 'bg-group-title text-inverse')}
                    >
                        <span
                            aria-hidden="true"
                            className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-pill', isLight ? 'bg-accent-subtle' : 'bg-viewer-control')}
                        >
                            <LogIn className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <h2 id={titleId} className="truncate text-title font-bold">{title}</h2>
                            <p className={cn('truncate text-small', isLight && 'text-secondary')}>{service?.displayName ?? serviceId}</p>
                        </div>
                        <IconButton
                            size="sm"
                            variant={isLight ? 'ghost' : 'overlay'}
                            shape="rounded"
                            aria-label={t('common.close')}
                            aria-disabled={finishing || undefined}
                            title={finishing ? t('login.finishing') : undefined}
                            icon={<X />}
                            onClick={handleDismiss}
                        />
                    </div>
                    {isLight && <div className="h-1 shrink-0 bg-group-title-bar" />}

                    <div className="flex flex-col gap-4 overflow-y-auto p-6">
                        <p className="text-body text-secondary">{description}</p>

                        {(stage === 'slow' || stage === 'verySlow') && (
                            <p role="status" aria-live="polite" className="text-small text-secondary">
                                {stage === 'verySlow' ? t('login.waitingVerySlow') : t('login.waitingSlow')}
                            </p>
                        )}

                        {error && (
                            <p role="alert" className="flex items-center gap-2 text-small text-status-danger">
                                <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
                                {error}
                            </p>
                        )}

                        <div className="flex gap-3">
                            <Button
                                variant="secondary"
                                className="flex-1"
                                onClick={handleDismiss}
                                loading={cancelling}
                                disabledReason={finishing ? t('login.finishing') : undefined}
                            >
                                {isFreshPrompt ? t('login.maybeLater') : t('common.cancel')}
                            </Button>
                            <Button variant="primary" className="flex-1" onClick={handleLogin} loading={isLoading}>
                                {isLoading
                                    ? t('login.connecting')
                                    : isFreshPrompt ? t('login.connectAccount') : t('common.login')}
                            </Button>
                        </div>

                        <p className="text-center text-caption text-muted">{t('login.credentialsSaved')}</p>
                    </div>
                </div>
            </Modal>
            {/* The warning is its own portal: hand it this login's group so it does not inherit the screen behind (spec §4). */}
            <ScopeContext.Provider value={{ scope: 'group', style: scopeStyle }}>
                <ConfirmDialog
                    open={showGeoWarning}
                    title={t('login.yodelJpOnlyTitle')}
                    message={t('login.yodelJpOnlyMessage')}
                    confirmLabel={t('login.loginAnyway')}
                    cancelLabel={t('common.close')}
                    variant="warning"
                    onConfirm={confirmGeoWarning}
                    onCancel={() => { logDialogLoad('login', 'cancelled'); setShowGeoWarning(false); }}
                />
            </ScopeContext.Provider>
        </>
    );
};
