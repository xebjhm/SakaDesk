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

const ICON_TONE: Record<NonNullable<ConfirmDialogProps['variant']>, string> = {
    warning: 'text-status-warning',
    danger: 'text-status-danger',
    default: 'text-secondary',
};

/** In-app confirmation dialog. Escape cancels; at most one emphasised button. */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    open, title, message, confirmLabel, cancelLabel, variant = 'default', onConfirm, onCancel, logId = 'confirm',
}) => {
    const { t } = useTranslation();
    const cancelRef = useRef<HTMLButtonElement>(null);
    return (
        <Modal
            isOpen={open}
            onClose={onCancel}
            title={<span className="flex items-center gap-2"><AlertTriangle aria-hidden="true" className={cn('h-5 w-5 shrink-0', ICON_TONE[variant])} />{title}</span>}
            header="plain"
            logId={logId}
            initialFocusRef={cancelRef}
            className="max-w-md"
            footer={
                <>
                    <Button ref={cancelRef} variant="ghost" onClick={onCancel}>{cancelLabel ?? t('common.cancel')}</Button>
                    <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
                </>
            }
        >
            <p className="whitespace-pre-line text-body text-secondary">{message}</p>
        </Modal>
    );
};
