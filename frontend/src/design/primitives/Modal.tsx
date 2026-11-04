import React, { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../utils/classnames';
import { useDialog } from '../dialog/useDialog';
import type { DialogLogId } from '../dialog/dialogLog';
import { IconButton } from './Button';

export interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Visible title (h2, standard layout); also names the dialog. */
    title?: React.ReactNode;
    /** Name when there is no visible title (search, viewer). */
    'aria-label'?: string;
    /** Id of an element inside a bare dialog that names it. */
    labelledBy?: string;
    /** Translated label of the header close button; no close button without it. */
    closeLabel?: string;
    /** Header content between the title and the close button. */
    headerExtra?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    /** 'sheet': light level-1 dialog. 'viewer': dark full-screen photo/video viewer. */
    tone?: 'sheet' | 'viewer';
    /** 'standard': header, body, footer. 'bare': children directly in the frame. */
    layout?: 'standard' | 'bare';
    placement?: 'center' | 'top';
    /** false: Escape and the backdrop do not close and there is no close button (ToS, setup, sync). */
    dismissible?: boolean;
    initialFocusRef?: React.RefObject<HTMLElement>;
    /** Frame classes (width, height). */
    className?: string;
    /** Standard body classes (padding). */
    bodyClassName?: string;
    /** Breadcrumb surface: logs `dialog` open / close. */
    logId?: DialogLogId;
    /** Keys for the dialog's own content (the viewer's ← / → / ↑ / ↓); Escape is the layer's. */
    onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}

/** Level 1 dialog on the dialog layer (docs/design/DESIGN_SYSTEM.md, "Dialogs"). */
export const Modal: React.FC<ModalProps> = (props) => (props.isOpen ? <OpenModal {...props} /> : null);

const OpenModal: React.FC<ModalProps> = ({
    onClose, title, 'aria-label': ariaLabel, labelledBy, closeLabel, headerExtra, children, footer,
    tone = 'sheet', layout = 'standard', placement = 'center', dismissible = true,
    initialFocusRef, className, bodyClassName, logId, onKeyDown,
}) => {
    const frameRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const { zIndex, requestClose } = useDialog({ isOpen: true, onClose, dismissible, frameRef, initialFocusRef, logId });
    const named = title !== undefined && layout === 'standard' ? titleId : labelledBy;

    return createPortal(
        <div
            data-testid="modal-backdrop"
            className={cn(
                'fixed inset-0 flex justify-center p-4',
                placement === 'top' ? 'items-start' : 'items-center',
                tone === 'viewer' ? 'bg-viewer-scrim p-0' : 'bg-scrim',
            )}
            // 15vh from the top for the command-palette placement (an inline value: arbitrary padding classes are guarded).
            style={placement === 'top' ? { zIndex, paddingTop: '15vh' } : { zIndex }}
            onClick={(e) => {
                if (dismissible && e.target === e.currentTarget) requestClose('backdrop');
            }}
        >
            <div
                ref={frameRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={named}
                aria-label={named ? undefined : ariaLabel}
                tabIndex={-1}
                onKeyDown={onKeyDown}
                className={cn(
                    'outline-none',
                    tone === 'viewer'
                        ? 'relative flex h-full w-full items-center justify-center'
                        : 'flex max-h-full w-full max-w-lg flex-col overflow-hidden bg-sheet rounded-sheet shadow-sheet animate-reveal motion-reduce:animate-none',
                    className,
                )}
                onClick={tone === 'viewer' ? (e) => { if (dismissible && e.target === e.currentTarget) requestClose('backdrop'); } : undefined}
            >
                {layout === 'bare' ? children : (
                    <>
                        <div className="flex shrink-0 items-center gap-3 px-6 pb-2 pt-5">
                            {title !== undefined && (
                                <h2 id={titleId} className="min-w-0 flex-1 truncate text-title font-semibold text-primary">{title}</h2>
                            )}
                            {headerExtra}
                            {dismissible && closeLabel && (
                                <IconButton size="sm" aria-label={closeLabel} icon={<X />} onClick={() => requestClose('button')} />
                            )}
                        </div>
                        <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 pb-6 text-body text-primary', bodyClassName)}>{children}</div>
                        {footer && <div className="flex shrink-0 items-center justify-end gap-2 px-6 pb-6">{footer}</div>}
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
};
