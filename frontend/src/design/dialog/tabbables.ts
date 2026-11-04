/** Elements that may take focus by Tab (before the visibility, disabled, tabindex and radio filters). */
const CANDIDATES = [
    'a[href]', 'area[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'iframe',
    'details > summary:first-of-type', 'video[controls]', 'audio[controls]',
    '[contenteditable]:not([contenteditable="false"])', '[tabindex]',
].join(', ');

function tabIndexOf(el: HTMLElement): number {
    const attr = el.getAttribute('tabindex');
    if (attr === null) return 0;
    const n = Number.parseInt(attr, 10);
    return Number.isNaN(n) ? 0 : n;
}

/**
 * Hidden from Tab: `inert`, the `hidden` attribute, `display: none` on it or an ancestor (up to
 * `root`), or `visibility: hidden`. A real browser answers with `checkVisibility()` (it also covers
 * closed `<details>` and other boxes with no client rects); jsdom lacks it and lays nothing out,
 * so there the walk over computed styles stands in.
 */
function isHidden(el: HTMLElement, root: HTMLElement): boolean {
    if (el.closest('[inert]')) return true;
    if (typeof el.checkVisibility === 'function') {
        return !el.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions);
    }
    if (getComputedStyle(el).visibility === 'hidden') return true;
    for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        if (node.hidden || getComputedStyle(node).display === 'none') return true;
        if (node === root) break;
    }
    return false;
}

function byDocumentOrder(a: Node, b: Node): number {
    if (a === b) return 0;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

/**
 * The elements Tab visits inside `root`, in the browser's order: positive `tabindex` first (by
 * value), then the rest in DOM order. Leaves out `tabindex="-1"` on any element, disabled
 * controls (also inside a disabled `fieldset`), hidden or inert elements, and all radios of a
 * named group but the checked one (the first when none is checked).
 */
export function tabbables(root: HTMLElement): HTMLElement[] {
    const seenGroups = new Set<string>();
    // Sorted by document position: jsdom does not return a selector list in document order.
    const found = Array.from(root.querySelectorAll<HTMLElement>(CANDIDATES)).sort(byDocumentOrder).filter((el) => {
        if (tabIndexOf(el) < 0) return false;
        if (el.matches(':disabled')) return false;
        if (isHidden(el, root)) return false;
        if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
            const key = `${el.form ? 'form' : 'doc'}:${el.name}`;
            const group = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
                .filter((r) => r.name === el.name && r.form === el.form);
            const checked = group.find((r) => r.checked);
            if (checked) return checked === el;
            if (seenGroups.has(key)) return false;
            seenGroups.add(key);
        }
        return true;
    });
    const positive = found.filter((el) => tabIndexOf(el) > 0).sort((a, b) => tabIndexOf(a) - tabIndexOf(b));
    return [...positive, ...found.filter((el) => tabIndexOf(el) === 0)];
}
