/** A field that owns its own keys (text input, range slider, select, editable text). */
export const isEditable = (el: EventTarget | null): boolean =>
    el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
