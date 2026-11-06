import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../utils/classnames';
import { useDialog } from '../dialog/useDialog';
import type { DialogLogId } from '../dialog/dialogLog';
import { IconButton } from './Button';
import { brandScopeStyle } from '../brandScope';
import { ScopeContext, useScope } from '../scopeContext';

export interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Visible title (h2, standard layout); also names the dialog. */
    title?: React.ReactNode;
    /** Decorative icon before the title (standard layout). It takes the header text colour; pass an unsized lucide icon (plain dialog icons are drawn at 20 px; ConfirmDialog passes its own 32 px semantic tile, drawn as given). Ignored without a title or in the bare layout. */
    icon?: React.ReactNode;
    /** Name when there is no visible title (search, viewer). */
    'aria-label'?: string;
    /** Id of an element inside a bare dialog that names it. */
    labelledBy?: string;
    /** Translated label of the header close button; no close button without it. */
    closeLabel?: string;
    /** Header content between the title and the close button. It sits on the expressive header, so it should inherit the header text colour (no text-muted). */
    headerExtra?: React.ReactNode;
    /**
     * 'brand': the dialog is a brand-context surface (settings, search, about...) and its children inherit brand.
     * 'inherit' (default): the scope provided by ScopeContext (brand from a BrandScope or a brand Modal, or a group scope a
     * parent hands over, as the login does for its geo warning), else the active group.
     */
    scope?: 'inherit' | 'brand';
    /** 'expressive' (default): context gradient header (L1). 'plain': quiet header for small confirms. */
    header?: 'expressive' | 'plain';
    children: React.ReactNode;
    footer?: React.ReactNode;
    /** A hairline and 16 px above the footer, for a long body that scrolls under it (Diagnostics). */
    footerDivider?: boolean;
    /** 'sheet': light level-1 dialog. 'viewer': dark full-screen photo/video viewer. */
    tone?: 'sheet' | 'viewer';
    /** 'standard': header, body, footer. 'bare': children directly in the frame. */
    layout?: 'standard' | 'bare';
    placement?: 'center' | 'top';
    /**
     * false: Escape and the backdrop do not close and there is no close button (ToS, setup, sync).
     * Such a dialog does not claim Escape either, so a handler further out still sees the key.
     */
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

const warned = new Set<string>();

/** Development only: one console warning per message for a dialog that cannot be named as asked. */
function warnOnce(message: string): void {
    if (!import.meta.env.DEV || warned.has(message)) return;
    warned.add(message);
    console.warn(message);
}

/** Level 1 dialog on the dialog layer (docs/design/DESIGN_SYSTEM.md, "Dialogs"). */
export const Modal: React.FC<ModalProps> = (props) => (props.isOpen ? <OpenModal {...props} /> : null);

const OpenModal: React.FC<ModalProps> = ({
    onClose, title, icon, 'aria-label': ariaLabel, labelledBy, closeLabel, headerExtra, children, footer, footerDivider = false,
    tone = 'sheet', layout = 'standard', placement = 'center', dismissible = true,
    initialFocusRef, className, bodyClassName, logId, onKeyDown, scope = 'inherit', header = 'expressive',
}) => {
    const inherited = useScope();
    const scopeValue = scope === 'brand' ? { scope: 'brand' as const, style: brandScopeStyle() } : inherited;
    const frameRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const { zIndex, requestClose } = useDialog({ isOpen: true, onClose, dismissible, frameRef, initialFocusRef, logId });
    const named = title !== undefined && layout === 'standard' ? titleId : labelledBy;
    // A click closes only when the press also started on the backdrop (or the viewer stage):
    // a drag that starts inside the dialog and ends outside it is not a dismissal.
    const pressedOn = useRef<EventTarget | null>(null);
    const startPress = (e: React.MouseEvent) => {
        pressedOn.current = e.target;
    };
    const clickOutside = (e: React.MouseEvent) => {
        const started = pressedOn.current === e.currentTarget;
        pressedOn.current = null;
        if (dismissible && started && e.target === e.currentTarget) requestClose('backdrop');
    };

    useEffect(() => {
        if (title !== undefined && layout === 'bare') {
            warnOnce('[Modal] title is ignored in layout="bare": name the dialog with aria-label or labelledBy');
        }
        if (!named && !ariaLabel) {
            warnOnce('[Modal] dialog has no accessible name: pass title, aria-label or labelledBy');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- checked once per open
    }, []);

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
            onMouseDown={startPress}
            onClick={clickOutside}
        >
            <div
                ref={frameRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={named}
                aria-label={named ? undefined : ariaLabel}
                tabIndex={-1}
                data-scope={scopeValue?.scope}
                style={scopeValue?.style}
                onKeyDown={onKeyDown}
                className={cn(
                    'outline-none',
                    tone === 'viewer'
                        ? 'relative flex h-full w-full items-center justify-center'
                        : 'flex max-h-full w-full max-w-lg flex-col overflow-hidden bg-sheet rounded-xl shadow-sheet animate-reveal motion-reduce:animate-none',
                    className,
                )}
                onMouseDown={tone === 'viewer' ? startPress : undefined}
                onClick={tone === 'viewer' ? clickOutside : undefined}
            >
                <ScopeContext.Provider value={scopeValue}>
                {layout === 'bare' ? children : (
                    <>
                        <div
                            data-testid="modal-header"
                            className={cn(
                                'flex shrink-0 items-center gap-3 px-6',
                                header === 'expressive' ? 'bg-expressive-header py-4 text-expressive-header' : 'pb-2 pt-5 text-primary',
                            )}
                        >
                            {title !== undefined && icon && (
                                <span data-testid="modal-header-icon" aria-hidden="true" className="flex shrink-0 items-center [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
                            )}
                            {title !== undefined && (
                                <h2 id={titleId} className="min-w-0 flex-1 truncate text-title font-bold">{title}</h2>
                            )}
                            {headerExtra}
                            {dismissible && closeLabel && (
                                <IconButton
                                    size="sm"
                                    aria-label={closeLabel}
                                    icon={<X />}
                                    className={header === 'expressive' ? 'text-expressive-header hover:bg-accent-subtle hover:text-accent-strong' : undefined}
                                    onClick={() => requestClose('button')}
                                />
                            )}
                        </div>
                        {header === 'expressive' && <div data-testid="modal-header-bar" aria-hidden="true" className="h-[3px] shrink-0 bg-expressive-header-bar" />}
                        <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 text-body text-primary', bodyClassName)}>{children}</div>
                        {footer && (
                            <div data-testid="modal-footer" className={cn('flex shrink-0 items-center justify-end gap-2 px-6 pb-6', footerDivider && 'border-t border-subtle pt-4')}>
                                {footer}
                            </div>
                        )}
                    </>
                )}
                </ScopeContext.Provider>
            </div>
        </div>,
        document.body,
    );
};
