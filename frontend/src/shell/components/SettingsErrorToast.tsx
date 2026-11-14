import { useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Button, IconButton } from '../../design/primitives';
import { useTranslation } from '../../i18n';
import { Z_INDEX } from '../../constants/zIndex';
import { useAnyDialogOpen } from '../../design/dialog/useAnyDialogOpen';
import { clientLog } from '../../utils/clientLog';

interface SettingsErrorToastProps {
    errorKey: string | null;
    onDebug: () => void;
    onClose: () => void;
}

/**
 * A status card on the toast layer for a failed settings save. It lives in #root, which is inert
 * while a dialog is open, so it waits for the dialogs to close (Settings and Setup show the failure
 * inline). It owns the dialog-stack subscription so only it re-renders when a dialog opens or closes.
 */
export function SettingsErrorToast({ errorKey, onDebug, onClose }: SettingsErrorToastProps) {
    const { t } = useTranslation();
    const dialogOpen = useAnyDialogOpen();
    const deferred = errorKey !== null && dialogOpen;
    // One breadcrumb per deferral, not per render.
    useEffect(() => {
        if (deferred) clientLog('dialog', { target: 'settings_error_toast', outcome: 'suppressed' });
    }, [deferred]);
    if (!errorKey || dialogOpen) return null;
    return (
        <div
            data-testid="settings-error-toast"
            role="alert"
            style={{ zIndex: Z_INDEX.TOAST }}
            className="fixed bottom-4 right-4 flex max-w-sm items-center gap-3 rounded-card bg-card p-4 shadow-card animate-reveal motion-reduce:animate-none"
        >
            <AlertCircle aria-hidden="true" className="h-5 w-5 shrink-0 text-status-danger" />
            <div className="min-w-0 flex-1">
                <p className="text-small font-semibold text-primary">{t('common.error')}</p>
                <p className="text-caption text-secondary">{t(errorKey)}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={onDebug}>
                {t('common.debug')}
            </Button>
            <IconButton
                size="sm"
                variant="ghost"
                aria-label={t('common.close')}
                icon={<X />}
                onClick={onClose}
            />
        </div>
    );
}
