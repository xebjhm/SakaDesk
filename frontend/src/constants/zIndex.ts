/**
 * Centralized z-index management for the application.
 * All z-index values should be defined here to prevent stacking context conflicts.
 */
export const Z_INDEX = {
    // Navigation & overlays
    DROPDOWN_OVERLAY: 40,
    DROPDOWN: 50,

    // Modal system
    MODAL_BACKDROP: 100,
    MODAL: 100,
    MODAL_DETAIL: 110,  // For nested views within modals (e.g., full image view)

    // Tooltips & popovers
    TOOLTIP: 120,
} as const;

// Tailwind class helpers for common z-index values
export const Z_CLASS = {
    DROPDOWN_OVERLAY: 'z-40',
    DROPDOWN: 'z-50',
    MODAL: 'z-[100]',
    MODAL_DETAIL: 'z-[110]',
    TOOLTIP: 'z-[120]',
} as const;
