import React, { useEffect, useRef, useId, useCallback } from 'react';
import { X } from 'lucide-react';
import { Portal } from './Portal';
import { cn } from '../../utils/classnames';
import type { BaseModalComponentProps } from '../../types/modal';
import { Z_CLASS } from '../../constants/zIndex';
import { useAppStore } from '../../store/appStore';
import { getServiceTheme } from '../../config/serviceThemes';

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

    // Handle ESC key to close modal (skip when exiting fullscreen — browser handles that)
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape' && isOpen && !document.fullscreenElement) {
            onClose();
        }
    }, [isOpen, onClose]);

    // Focus management
    useEffect(() => {
        if (isOpen) {
            // Store the currently focused element
            previousFocusRef.current = document.activeElement as HTMLElement;

            // Focus the modal container
            setTimeout(() => {
                modalRef.current?.focus();
            }, 0);

            // Add keyboard listener
            document.addEventListener('keydown', handleKeyDown);

            // Prevent body scroll when modal is open
            document.body.style.overflow = 'hidden';

            return () => {
                document.removeEventListener('keydown', handleKeyDown);
                document.body.style.overflow = '';

                // Return focus to previous element
                previousFocusRef.current?.focus();
            };
        }
    }, [isOpen, handleKeyDown]);

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

    // Handle ESC key — stopImmediatePropagation prevents parent modals from also closing.
    // Capture phase so this fires BEFORE parent BaseModal's bubble-phase handler.
    // Skip when exiting fullscreen — browser handles that, we don't want to close the modal.
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape' && isOpen && !document.fullscreenElement) {
            e.stopImmediatePropagation();
            onClose();
        }
    }, [isOpen, onClose]);

    // Focus management
    useEffect(() => {
        if (isOpen) {
            previousFocusRef.current = document.activeElement as HTMLElement;
            setTimeout(() => modalRef.current?.focus(), 0);
            document.addEventListener('keydown', handleKeyDown, true);
            document.body.style.overflow = 'hidden';

            return () => {
                document.removeEventListener('keydown', handleKeyDown, true);
                document.body.style.overflow = '';
                previousFocusRef.current?.focus();
            };
        }
    }, [isOpen, handleKeyDown]);

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
