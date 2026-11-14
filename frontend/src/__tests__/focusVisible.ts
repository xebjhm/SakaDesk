import { vi } from 'vitest';

/**
 * Pins `el.matches(':focus-visible')` for the focused element: `true` as after a keyboard focus,
 * `false` as after a mouse click (Chromium focuses a clicked button, but not focus-visibly). The
 * players only ever ask `matches(':focus-visible')`; jsdom infers it from its own event
 * bookkeeping, so tests state the modality they mean. Undo with `vi.restoreAllMocks()`.
 */
export function mockFocusVisible(keyboard: boolean) {
    const original = Element.prototype.matches;
    return vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
        if (selector === ':focus-visible') return keyboard && this === document.activeElement;
        return original.call(this, selector);
    });
}
