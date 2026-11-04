// frontend/src/features/blogs/components/arrowKeys.ts
// When ← / → belong to something else than switching the blog post.

/** Where ← / → belong to something else: typing, a dialog, or a control that already handled them. */
export const NOT_POST_KEYS =
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], dialog, [aria-modal="true"]';

/** Any dialog that is open anywhere on the page (also one that does not hold the focus). */
const OPEN_DIALOG = '[aria-modal="true"], dialog[open]';

/**
 * True when an arrow key must not change the post: the event was already handled (the photo
 * viewer calls preventDefault on its arrows), it comes from a text field, a content-editable
 * element or anything inside a dialog, or a dialog is open somewhere on the page.
 */
export function ignoresPostKeys(e: KeyboardEvent): boolean {
    if (e.defaultPrevented) return true;
    if (e.target instanceof Element && e.target.closest(NOT_POST_KEYS) !== null) return true;
    return document.querySelector(OPEN_DIALOG) !== null;
}
