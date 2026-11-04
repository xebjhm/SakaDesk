import { isLayerFrame, topDialog, type DialogEntry } from './dialogStack';

/** A dialog that closed in the current commit, with the frame it had (refs are cleared on unmount). */
interface Closed {
    entry: DialogEntry;
    frame: HTMLElement | null;
}

let pending: Closed[] = [];
let scheduled = false;

/**
 * Follows `restoreTo` through dialogs that closed in this commit: a target inside a closing
 * frame (the inner opener of a nested dialog that closes with its parent) is about to be
 * removed, so focus goes where that frame's own dialog would have sent it.
 */
function resolve(target: HTMLElement | null, closed: Closed[]): HTMLElement | null {
    let current = target;
    for (let hops = 0; current && hops <= closed.length; hops += 1) {
        const owner = closed.find((c) => c.frame !== null && c.frame.contains(current));
        if (!owner) return current;
        current = owner.entry.restoreTo;
    }
    return current;
}

/** True when `el` sits inside the frame of a dialog on the layer. */
function inLayerFrame(el: Element): boolean {
    for (let node: Element | null = el; node; node = node.parentElement) {
        if (isLayerFrame(node)) return true;
    }
    return false;
}

/** True when focus was lost (its element was removed with a dialog) rather than moved by the app. */
function focusIsLost(): boolean {
    const active = document.activeElement;
    return active === null || active === document.body || !active.isConnected;
}

function flush(): void {
    scheduled = false;
    const closed = pending.sort((a, b) => a.entry.order - b.entry.order);
    pending = [];
    if (closed.length === 0) return;
    const top = topDialog();
    if (top) {
        // Dialogs remain: focus stays inside the top-most one.
        const frame = top.node();
        if (!frame) return;
        const active = document.activeElement;
        if (active && frame.contains(active)) return;
        // A portaled menu (the player menus) belongs to the top-most dialog: the only one in use.
        if (active?.closest('[role="menu"]') && !inLayerFrame(active)) return;
        for (const c of closed) {
            const target = resolve(c.entry.restoreTo, closed);
            if (target?.isConnected && frame.contains(target)) {
                target.focus({ preventScroll: true });
                return;
            }
        }
        frame.focus({ preventScroll: true });
        return;
    }
    if (!focusIsLost()) return; // the app moved focus itself while closing
    for (const c of closed) {
        const target = resolve(c.entry.restoreTo, closed);
        if (target?.isConnected) {
            target.focus({ preventScroll: true });
            return;
        }
    }
}

/**
 * Restores focus for a dialog that closed, after the commit. React runs a parent's layout
 * cleanup before its children's on deletion and removes the DOM afterwards, so restoring
 * synchronously would let a nested dialog focus a button that is about to disappear. All
 * dialogs closed in one commit are settled together in a microtask: the outermost one's
 * opener wins (or the remaining top-most dialog keeps the focus).
 */
export function restoreFocusAfterClose(entry: DialogEntry, frame: HTMLElement | null): void {
    pending.push({ entry, frame });
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
}

/**
 * Where a dialog opening now returns focus when it closes: the focused element, unless it lies
 * in (or focus was lost with) a dialog that closed in this commit, then that dialog's own target.
 * Covers StrictMode's simulated remount and one dialog replacing another.
 */
export function restoreTargetForOpening(): HTMLElement | null {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (pending.length === 0) return active;
    if (focusIsLost()) {
        const outermost = [...pending].sort((a, b) => a.entry.order - b.entry.order)[0];
        return resolve(outermost.entry.restoreTo, pending);
    }
    return resolve(active, pending);
}
