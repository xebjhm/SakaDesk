/**
 * Layering, one source (docs/superpowers/specs/2026-11-05-d2c-dialogs-design.md, decision 31).
 * DROPDOWN: menus anchored inside the app frame. DIALOG + depth × DIALOG_STEP: each open
 * dialog (design/dialog/dialogStack.ts). POPOVER: portaled menus, above any dialog.
 * TOAST: above everything.
 */
export const Z_INDEX = {
    DROPDOWN: 50,
    DIALOG: 100,
    DIALOG_STEP: 10,
    POPOVER: 1000,
    TOAST: 1100,
} as const;

/** @deprecated Pre-D2c classes; D2c Task 13 removes them once nothing uses them. */
export const Z_CLASS = {
    DROPDOWN_OVERLAY: 'z-40',
    DROPDOWN: 'z-50',
    MODAL: 'z-[100]',
    MODAL_DETAIL: 'z-[110]',
    TOOLTIP: 'z-[120]',
} as const;
