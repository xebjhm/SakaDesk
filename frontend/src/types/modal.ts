import type { LucideIcon } from 'lucide-react';

/**
 * Base props that all modal components should extend.
 * Provides consistent API for modal open/close behavior.
 */
export interface BaseModalProps {
    /** Whether the modal is currently visible */
    isOpen: boolean;
    /** Callback fired when the modal should close */
    onClose: () => void;
}

/**
 * Props for the BaseModal component that handles common modal patterns.
 */
export interface BaseModalComponentProps extends BaseModalProps {
    /** Modal title displayed in the header */
    title: string;
    /** Optional icon displayed next to the title */
    icon?: LucideIcon;
    /** Modal content */
    children: React.ReactNode;
    /** Maximum width class (e.g., 'max-w-md', 'max-w-2xl'). Defaults to 'max-w-2xl' */
    maxWidth?: string;
    /** Optional footer content rendered at the bottom of the modal */
    footer?: React.ReactNode;
    /** Whether this is a detail/nested view (uses higher z-index and darker backdrop). Defaults to false */
    isDetailView?: boolean;
    /** Additional class names for the modal container */
    className?: string;
}

/**
 * Props for modals with loading and error states.
 */
export interface AsyncModalState {
    loading: boolean;
    error: string | null;
}
