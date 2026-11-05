import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { AlertCircle, Loader2, LogIn, X } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { Button, IconButton, Modal } from '../../design/primitives';
import { groupTokens } from '../../design/tokens';
import { groupScopeStyle } from '../../design/groupScope';
import { logDialogLoad } from '../../design/dialog/dialogLog';
import { serviceIdToGroupId } from '../../config/colors';
import { getServiceById } from '../../data/services';
import { FEATURE_DEFINITIONS } from '../../config/features';
import type { FeatureId } from '../../store/appStore';
import { cn } from '../../utils/classnames';
import { ConfirmDialog } from './ConfirmDialog';
import { isLoginBusy, subscribeLoginLock, tryLockLogin, unlockLogin } from './loginLock';

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
    const isLoading = useSyncExternalStore(subscribeLoginLock, isLoginBusy);
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

    /** Logs in for `loginService`; the caller holds the lock, which this releases when done. */
    const doLogin = async (loginService: string) => {
        setError(null);
        try {
            const res = await fetch(
                `/api/auth/login?service=${encodeURIComponent(loginService)}`,
                { method: 'POST' }
            );
            if (!res.ok) throw new Error(t('login.loginFailed'));

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
            unlockLogin();
        }
    };

    const handleLogin = async () => {
        if (!tryLockLogin()) return;
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
        await doLogin(loginService);
    };

    const confirmGeoWarning = () => {
        setShowGeoWarning(false);
        if (!tryLockLogin()) return;
        void doLogin(serviceId);
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

    return (
        <>
            <Modal isOpen onClose={onClose} dismissible={!isLoading} layout="bare" labelledBy={titleId} logId="login" className="max-w-md">
                <div className="flex min-h-0 flex-col" style={groupScopeStyle(groupId)}>
                    {/* The service's official banner, drawn like its chat header. */}
                    <div
                        data-testid="login-banner"
                        className={cn('flex shrink-0 items-center gap-3 px-6 py-4', isLight ? 'bg-sheet text-group-title' : 'bg-group-title text-inverse')}
                    >
                        <span
                            aria-hidden="true"
                            className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-pill', isLight ? 'bg-group-subtle' : 'bg-viewer-control')}
                        >
                            <LogIn className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <h2 id={titleId} className="truncate text-title font-semibold">{title}</h2>
                            <p className={cn('truncate text-small', isLight && 'text-secondary')}>{service?.displayName ?? serviceId}</p>
                        </div>
                        <IconButton
                            size="sm"
                            variant={isLight ? 'ghost' : 'overlay'}
                            shape="rounded"
                            aria-label={t('common.close')}
                            disabled={isLoading}
                            icon={<X />}
                            onClick={onClose}
                        />
                    </div>
                    {isLight && <div className="h-1 shrink-0 bg-group-title-bar" />}

                    <div className="flex flex-col gap-4 overflow-y-auto p-6">
                        <p className="text-body text-secondary">{description}</p>

                        {error && (
                            <p role="alert" className="flex items-center gap-2 text-small text-status-danger">
                                <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
                                {error}
                            </p>
                        )}

                        <div className="flex gap-3">
                            <Button variant="secondary" className="flex-1" onClick={onClose} disabled={isLoading}>
                                {isFreshPrompt ? t('login.maybeLater') : t('common.cancel')}
                            </Button>
                            <Button variant="primary" className="flex-1" onClick={handleLogin} disabled={isLoading}>
                                {isLoading ? (
                                    <>
                                        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                                        {t('login.connecting')}
                                    </>
                                ) : (
                                    isFreshPrompt ? t('login.connectAccount') : t('common.login')
                                )}
                            </Button>
                        </div>

                        <p className="text-center text-caption text-muted">{t('login.credentialsSaved')}</p>
                    </div>
                </div>
            </Modal>
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
        </>
    );
};
