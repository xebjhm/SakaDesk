import React, { useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { Modal, Button } from '../../design/primitives';
import { cn } from '../../utils/classnames';
import type { DialogLogId } from '../../design/dialog/dialogLog';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    variant?: 'warning' | 'danger' | 'default';
    onConfirm: () => void;
    onCancel: () => void;
    /** Breadcrumb surface; `confirm` unless the confirm has its own (reveal all). */
    logId?: DialogLogId;
}

/** The meaning stays semantic on any header (spec 3.4 icon rule: icon-step fill, border-step outline, text-step glyph). */
const ICON_TILE: Record<NonNullable<ConfirmDialogProps['variant']>, string> = {
    warning: 'bg-semantic-warning-icon border-semantic-warning text-semantic-warning',
    danger: 'bg-semantic-danger-icon border-semantic-danger text-semantic-danger',
    default: 'bg-semantic-info-icon border-semantic-info text-semantic-info',
};

const CONFIRM_BUTTON = { warning: 'warning', danger: 'danger', default: 'primary' } as const;

/** In-app confirmation dialog. Escape cancels; at most one emphasised button. The header follows the opener's context. */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    open, title, message, confirmLabel, cancelLabel, variant = 'default', onConfirm, onCancel, logId = 'confirm',
}) => {
    const { t } = useTranslation();
    const cancelRef = useRef<HTMLButtonElement>(null);
    return (
        <Modal
            isOpen={open}
            onClose={onCancel}
            title={title}
            icon={
                <span className={cn('flex h-8 w-8 items-center justify-center rounded-full border', ICON_TILE[variant])}>
                    <AlertTriangle className="h-4 w-4" />
                </span>
            }
            logId={logId}
            initialFocusRef={cancelRef}
            className="max-w-md"
            footer={
                <>
                    <Button ref={cancelRef} variant="secondary" onClick={onCancel}>{cancelLabel ?? t('common.cancel')}</Button>
                    <Button variant={CONFIRM_BUTTON[variant]} onClick={onConfirm}>{confirmLabel}</Button>
                </>
            }
        >
            <p className="whitespace-pre-line break-words text-body text-secondary">{message}</p>
        </Modal>
    );
};
