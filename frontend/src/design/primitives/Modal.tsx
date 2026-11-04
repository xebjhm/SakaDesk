import React, { useId } from 'react';
import { Portal } from '../../core/common/Portal';
import { useModalClose } from '../../core/common/useModalClose';
import { cn } from '../../utils/classnames';

export interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    className?: string;
}

/** Level 1 dialog. Escape / backdrop close and the portal reuse core/common. */
export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer, className }) => {
    const handleBackdropClick = useModalClose(isOpen, onClose);
    const titleId = useId();
    if (!isOpen) return null;
    return (
        <Portal>
            <div
                data-testid="modal-backdrop"
                className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
                onClick={handleBackdropClick}
            >
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={titleId}
                    className={cn(
                        'flex max-h-full w-full max-w-lg flex-col overflow-hidden bg-sheet rounded-sheet shadow-sheet',
                        className,
                    )}
                >
                    <h2 id={titleId} className="px-6 pb-2 pt-6 text-title font-semibold text-primary">{title}</h2>
                    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 text-body text-primary">{children}</div>
                    {footer && <div className="flex justify-end gap-2 px-6 pb-6">{footer}</div>}
                </div>
            </div>
        </Portal>
    );
};
