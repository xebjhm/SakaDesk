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
 * Props for modals with loading and error states.
 */
export interface AsyncModalState {
    loading: boolean;
    error: string | null;
}
