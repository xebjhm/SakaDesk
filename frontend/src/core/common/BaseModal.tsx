import React, { useEffect, useRef, useId, useCallback } from 'react';
import { X } from 'lucide-react';
import { Portal } from './Portal';
import { cn } from '../../utils/classnames';
import type { BaseModalComponentProps } from '../../types/modal';
import { Z_CLASS } from '../../constants/zIndex';
import { useAppStore } from '../../store/appStore';
import { getServiceTheme } from '../../config/serviceThemes';

// ─── Module-level modal stack ───────────────────────────────────────────────
// Every open BaseModal / DetailModal registers a unique id here (in insertion
// order). Only the top-of-stack modal responds to Escape, so pressing Escape
// over stacked modals closes exactly one — the topmost — instead of closing all
// (bubble-phase BaseModals) or the wrong one (capture-phase DetailModals).
const modalStack: string[] = [];

const registerModal = (id: string) => {
    modalStack.push(id);
};

const unregisterModal = (id: string) => {
    const idx = modalStack.lastIndexOf(id);
    if (idx !== -1) modalStack.splice(idx, 1);
};

const isTopModal = (id: string): boolean => modalStack[modalStack.length - 1] === id;

// ─── Module-level body-scroll lock reference count ──────────────────────────
// Body scroll is disabled while any modal is open. Reference-count opens so that
// closing a nested modal does NOT re-enable scrolling while a parent modal is
// still open — only restore the original overflow once the count returns to 0.
let scrollLockCount = 0;
let previousBodyOverflow = '';

const acquireScrollLock = () => {
    if (scrollLockCount === 0) {
        previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
    scrollLockCount++;
};

const releaseScrollLock = () => {
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0) {
        document.body.style.overflow = previousBodyOverflow;
    }
};

/**
 * BaseModal component that handles common modal patterns:
 * - Portal rendering to document.body
 * - Backdrop with click-to-close
 * - Header with gradient styling, icon, title, and close button
 * - Accessibility: focus trapping, ESC key, ARIA attributes
 * - Consistent styling across all modals
 *
 * @example
 * ```tsx
 * <BaseModal
 *     isOpen={isOpen}
 *     onClose={onClose}
 *     title="My Modal"
 *     icon={Settings}
 *     maxWidth="max-w-md"
 * >
 *     <div className="p-6">Modal content here</div>
 * </BaseModal>
 * ```
 */
export const BaseModal: React.FC<BaseModalComponentProps> = ({
    isOpen,
    onClose,
    title,
    icon: Icon,
    children,
    maxWidth = 'max-w-2xl',
    footer,
    isDetailView = false,
    className,
}) => {
    // Get per-service theme colors for modal header
    const activeService = useAppStore((state) => state.activeService);
    const theme = getServiceTheme(activeService);

    const modalRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const titleId = useId();
    const modalId = useId();

    // Handle ESC key to close modal (skip when exiting fullscreen — browser handles that).
    // Only respond if this modal is the top of the stack, so a single Escape closes
    // exactly the topmost modal rather than every stacked BaseModal.
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape' && isOpen && !document.fullscreenElement && isTopModal(modalId)) {
            onClose();
        }
    }, [isOpen, onClose, modalId]);

    // Focus management
    useEffect(() => {
        if (isOpen) {
            // Store the currently focused element
            previousFocusRef.current = document.activeElement as HTMLElement;

            // Register in the modal stack (topmost handles Escape)
            registerModal(modalId);

            // Focus the modal container
            setTimeout(() => {
                modalRef.current?.focus();
            }, 0);

            // Add keyboard listener
            document.addEventListener('keydown', handleKeyDown);

            // Prevent body scroll while any modal is open (reference-counted)
            acquireScrollLock();

            return () => {
                document.removeEventListener('keydown', handleKeyDown);
                releaseScrollLock();
                unregisterModal(modalId);

                // Return focus to previous element
                previousFocusRef.current?.focus();
            };
        }
    }, [isOpen, handleKeyDown, modalId]);

    // Handle backdrop click
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    if (!isOpen) return null;

    const zIndexClass = isDetailView ? Z_CLASS.MODAL_DETAIL : Z_CLASS.MODAL;
    const backdropOpacity = isDetailView ? 'bg-black/90' : 'bg-black/60';

    return (
        <Portal>
            <div
                className={cn(
                    "fixed inset-0 flex items-center justify-center p-4",
                    backdropOpacity,
                    zIndexClass
                )}
                onClick={handleBackdropClick}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
            >
                <div
                    ref={modalRef}
                    tabIndex={-1}
                    className={cn(
                        "bg-white rounded-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh] outline-none",
                        maxWidth,
                        className
                    )}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="shrink-0">
                        <div
                            className="px-6 py-4 flex items-center justify-between"
                            style={{
                                background: theme.messages.headerStyle === 'light'
                                    ? '#FFFFFF'
                                    : `linear-gradient(to right, ${theme.messages.headerGradient.from}, ${theme.messages.headerGradient.via}, ${theme.messages.headerGradient.to})`,
                            }}
                        >
                            <div className="flex items-center gap-3">
                                {Icon && (
                                    <Icon
                                        className="w-5 h-5"
                                        style={{ color: theme.messages.headerStyle === 'light' ? theme.messages.headerTextColor : 'white' }}
                                    />
                                )}
                                <h3
                                    id={titleId}
                                    className="text-lg font-bold"
                                    style={{ color: theme.messages.headerStyle === 'light' ? theme.messages.headerTextColor : 'white' }}
                                >
                                    {title}
                                </h3>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-1 rounded-lg transition-colors"
                                style={{
                                    color: theme.messages.headerStyle === 'light' ? theme.messages.headerTextColor : 'rgba(255,255,255,0.8)',
                                }}
                                aria-label="Close modal"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        {/* Gradient bar below header for light style */}
                        {theme.messages.headerStyle === 'light' && (
                            <div
                                className="h-1"
                                style={{ background: theme.messages.headerBarGradient }}
                            />
                        )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto">
                        {children}
                    </div>

                    {/* Footer (optional) */}
                    {footer && (
                        <div className="shrink-0">
                            {footer}
                        </div>
                    )}
                </div>
            </div>
        </Portal>
    );
};

/**
 * DetailModal is a variant for showing detail views (e.g., viewing a single item from a list).
 * Uses a darker backdrop and higher z-index to layer on top of parent modal.
 *
 * Two modes:
 * 1. With header (title, subtitle, backButton) - for nested content views
 * 2. Without header (fullscreen mode) - for media viewing
 */
interface DetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    /** Title shown in header (enables header mode) */
    title?: string;
    /** Subtitle shown below title */
    subtitle?: string;
    /** Back button element (left side of header) */
    backButton?: React.ReactNode;
    /** Callback to close all modals (parent + detail) */
    onCloseAll?: () => void;
    /** Footer content (e.g., metadata) */
    footer?: React.ReactNode;
    /** Max width class for the modal */
    maxWidth?: string;
}

export const DetailModal: React.FC<DetailModalProps> = ({
    isOpen,
    onClose,
    children,
    title,
    subtitle,
    backButton,
    onCloseAll,
    footer,
    maxWidth = 'max-w-2xl',
}) => {
    // Get per-service theme colors for modal header
    const activeService = useAppStore((state) => state.activeService);
    const theme = getServiceTheme(activeService);

    const modalRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const titleId = useId();
    const modalId = useId();

    // Handle ESC key — only the top-of-stack modal responds, so stacked
    // DetailModals close the topmost (not the bottom) one. Capture phase +
    // stopImmediatePropagation ensures that when this modal IS the top, no
    // parent BaseModal's bubble-phase handler also fires.
    // Skip when exiting fullscreen — browser handles that, we don't want to close the modal.
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape' && isOpen && !document.fullscreenElement && isTopModal(modalId)) {
            e.stopImmediatePropagation();
            onClose();
        }
    }, [isOpen, onClose, modalId]);

    // Focus management
    useEffect(() => {
        if (isOpen) {
            previousFocusRef.current = document.activeElement as HTMLElement;
            registerModal(modalId);
            setTimeout(() => modalRef.current?.focus(), 0);
            document.addEventListener('keydown', handleKeyDown, true);
            acquireScrollLock();

            return () => {
                document.removeEventListener('keydown', handleKeyDown, true);
                releaseScrollLock();
                unregisterModal(modalId);
                previousFocusRef.current?.focus();
            };
        }
    }, [isOpen, handleKeyDown, modalId]);

    if (!isOpen) return null;

    // Header mode (has title)
    const hasHeader = !!title;

    if (hasHeader) {
        return (
            <Portal>
                <div
                    className={cn(
                        "fixed inset-0 bg-black/70 flex items-center justify-center p-4",
                        Z_CLASS.MODAL_DETAIL
                    )}
                    onClick={onClose}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={titleId}
                >
                    <div
                        ref={modalRef}
                        tabIndex={-1}
                        className={cn(
                            "bg-white rounded-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh] outline-none",
                            maxWidth
                        )}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="shrink-0">
                            <div
                                className="px-6 py-4 flex items-center justify-between"
                                style={{
                                    background: theme.messages.headerStyle === 'light'
                                        ? '#FFFFFF'
                                        : `linear-gradient(to right, ${theme.messages.headerGradient.from}, ${theme.messages.headerGradient.via}, ${theme.messages.headerGradient.to})`,
                                }}
                            >
                                <div className="flex items-center gap-3">
                                    {backButton && React.cloneElement(backButton as React.ReactElement, {
                                        style: { color: theme.messages.headerStyle === 'light' ? theme.messages.headerTextColor : 'rgba(255,255,255,0.8)' }
                                    })}
                                    <div>
                                        <h3
                                            id={titleId}
                                            className="text-lg font-bold"
                                            style={{ color: theme.messages.headerStyle === 'light' ? theme.messages.headerTextColor : 'white' }}
                                        >
                                            {title}
                                        </h3>
                                        {subtitle && (
                                            <p
                                                className="text-sm"
                                                style={{ color: theme.messages.headerStyle === 'light' ? `${theme.messages.headerTextColor}cc` : 'rgba(255,255,255,0.8)' }}
                                            >
                                                {subtitle}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <button
                                    onClick={onCloseAll || onClose}
                                    className="p-1 rounded-lg transition-colors"
                                    style={{
                                        color: theme.messages.headerStyle === 'light' ? theme.messages.headerTextColor : 'rgba(255,255,255,0.8)',
                                    }}
                                    aria-label="Close modal"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>
                            {/* Gradient bar below header for light style */}
                            {theme.messages.headerStyle === 'light' && (
                                <div
                                    className="h-1"
                                    style={{ background: theme.messages.headerBarGradient }}
                                />
                            )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-6">
                            {children}
                        </div>

                        {/* Footer (optional) */}
                        {footer && (
                            <div className="shrink-0">
                                {footer}
                            </div>
                        )}
                    </div>
                </div>
            </Portal>
        );
    }

    // Fullscreen mode (no header, for media)
    return (
        <Portal>
            <div
                ref={modalRef}
                tabIndex={-1}
                className={cn(
                    "fixed inset-0 bg-black/90 flex items-center justify-center p-4 outline-none",
                    Z_CLASS.MODAL_DETAIL
                )}
                role="dialog"
                aria-modal="true"
                onClick={onClose}
            >
                <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col">
                    {/* Close button */}
                    <button
                        onClick={onClose}
                        className="absolute -top-12 right-0 text-white/80 hover:text-white transition-colors z-10"
                        aria-label="Close"
                    >
                        <X className="w-8 h-8" />
                    </button>

                    {/* Content */}
                    <div
                        className="bg-black rounded-xl overflow-hidden flex items-center justify-center flex-1"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {children}
                    </div>

                    {/* Footer (metadata) */}
                    {footer && (
                        <div className="text-white/80 text-sm text-center mt-4">
                            {footer}
                        </div>
                    )}
                </div>
            </div>
        </Portal>
    );
};
