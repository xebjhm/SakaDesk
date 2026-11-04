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
