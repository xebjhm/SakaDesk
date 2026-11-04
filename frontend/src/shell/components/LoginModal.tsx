import React, { useId, useRef, useState } from 'react';
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

interface LoginModalProps {
    serviceId: string;
    featureId: FeatureId;
    onClose: () => void;
    onSuccess: () => void;
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
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showGeoWarning, setShowGeoWarning] = useState(false);

    // The service this dialog currently shows; a login that finishes for another one is stale.
    const currentServiceRef = useRef(serviceId);
    currentServiceRef.current = serviceId;

    // The dialog is reused across services (login carousel): a new service starts clean, so a
    // failed login's error never shows on the next service's dialog. `isLoading` is kept: a login
    // still in flight must block a second one (single-session token).
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

    const doLogin = async () => {
        const loginService = serviceId;
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/auth/login?service=${encodeURIComponent(serviceId)}`,
                { method: 'POST' }
            );
            if (!res.ok) throw new Error(t('login.loginFailed'));

            // Initialize service settings entry
            await fetch(
                `/api/settings/service/${encodeURIComponent(serviceId)}/init`,
                { method: 'POST' }
            );

            // Brief delay before advancing to prevent concurrent browser launches
            await new Promise(resolve => setTimeout(resolve, 1500));
            logDialogLoad('login', 'ok');
            if (currentServiceRef.current === loginService) onSuccess();
            else logDialogLoad('login', 'skipped');
        } catch (err: unknown) {
            logDialogLoad('login', 'error', undefined, 'failed');
            if (currentServiceRef.current === loginService) {
                setError(err instanceof Error ? err.message : t('login.loginFailed'));
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogin = async () => {
        // Yodel's web service is Japan-only. Warn before a login attempt from
        // another region, since the login/data servers reject non-JP connections.
        if (serviceId === 'yodel') {
            try {
                const res = await fetch('/api/auth/geo-availability?service=yodel', { cache: 'no-store' });
                if (!res.ok) {
                    logDialogLoad('login_geo', 'error', undefined, 'failed');
                } else if ((await res.json()).blocked) {
                    logDialogLoad('login_geo', 'skipped', undefined, 'blocked');
                    setShowGeoWarning(true);
                    return;
                } else {
                    logDialogLoad('login_geo', 'ok');
                }
            } catch {
                // Check failed (offline, etc.) — don't block the user; let login proceed.
                logDialogLoad('login_geo', 'error', undefined, 'unreachable');
            }
        }
        await doLogin();
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
                            <p className="truncate text-small">{service?.displayName ?? serviceId}</p>
                        </div>
                        <IconButton
                            size="sm"
                            variant={isLight ? 'ghost' : 'overlay'}
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
                onConfirm={() => { setShowGeoWarning(false); doLogin(); }}
                onCancel={() => { logDialogLoad('login', 'cancelled'); setShowGeoWarning(false); }}
            />
        </>
    );
};
