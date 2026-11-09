/**
 * Layering, one source (docs/superpowers/specs/2026-11-05-d2c-dialogs-design.md, decision 31).
 * DROPDOWN: menus anchored inside the app frame. DIALOG + depth × DIALOG_STEP: each open
 * dialog (design/dialog/dialogStack.ts). POPOVER: portaled menus, above any dialog.
 * A call that starts ringing while a dialog is open sits between dialogs by opening order:
 * dialogStack.interleavedZIndex (half a DIALOG_STEP above the dialogs opened before it).
 * TOAST: above everything.
 */
export const Z_INDEX = {
    DROPDOWN: 50,
    DIALOG: 100,
    DIALOG_STEP: 10,
    POPOVER: 1000,
    TOAST: 1100,
} as const;
