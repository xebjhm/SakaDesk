import { Z_INDEX } from '../../constants/zIndex';

/** One open dialog. `node` returns its frame (for the focus trap). */
export interface DialogEntry {
    readonly id: number;
    /** Opening order: decides the position in the stack (see `nextDialogOrder`). */
    readonly order: number;
    readonly node: () => HTMLElement | null;
    readonly dismissible: boolean;
    /** Where focus returns on close; handed on between dialogs that open in the same render. */
    restoreTo: HTMLElement | null;
}

export interface DialogEntryInit {
    node: () => HTMLElement | null;
    dismissible: boolean;
    /** From `nextDialogOrder()` at render time; omitted: above every open dialog. */
    order?: number;
    restoreTo?: HTMLElement | null;
}

let nextId = 1;
let nextOrder = 1;
let stack: DialogEntry[] = [];
let savedOverflow: string | null = null;
const listeners = new Set<() => void>();

function notify(): void {
    for (const listener of Array.from(listeners)) listener();
}

/**
 * A new opening order. Dialogs take it while rendering, where a parent renders before the
 * dialogs nested in it; React runs their layout effects child first, so pushing in effect
 * order alone would put a child that opens in the same render below its parent.
 * Taking it in render is safe: a render that runs twice (StrictMode) or is thrown away only
 * skips numbers, and the order stays monotonic.
 */
export function nextDialogOrder(): number {
    return nextOrder++;
}

/** Opens a dialog at its order's place (on top unless a later-ordered one is open); the first one locks body scroll. */
export function pushDialog(init: DialogEntryInit): DialogEntry {
    const full: DialogEntry = {
        id: nextId++,
        order: init.order ?? nextDialogOrder(),
        node: init.node,
        dismissible: init.dismissible,
        restoreTo: init.restoreTo ?? null,
    };
    if (stack.length === 0) {
        savedOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
    let at = stack.length;
    while (at > 0 && stack[at - 1].order > full.order) at -= 1;
    stack = [...stack.slice(0, at), full, ...stack.slice(at)];
    notify();
    return full;
}

/** Closes a dialog wherever it is in the stack; the last one restores body scroll. */
export function popDialog(entry: DialogEntry): void {
    if (!stack.some((e) => e.id === entry.id)) return;
    stack = stack.filter((e) => e.id !== entry.id);
    if (stack.length === 0) {
        document.body.style.overflow = savedOverflow ?? '';
        savedOverflow = null;
    }
    notify();
}

/** The top-most open dialog, or null. */
export function topDialog(): DialogEntry | null {
    return stack.length > 0 ? stack[stack.length - 1] : null;
}

/** True when `el` is the frame of a dialog on the layer (as opposed to a legacy modal or the call overlay). */
export function isLayerFrame(el: Element): boolean {
    return stack.some((e) => e.node() === el);
}

export function isTopDialog(entry: DialogEntry): boolean {
    return stack.length > 0 && stack[stack.length - 1].id === entry.id;
}

/** The dialog directly above this one, or null when it is top-most (or not open). */
export function dialogAbove(entry: DialogEntry): DialogEntry | null {
    const at = stack.findIndex((e) => e.id === entry.id);
    return at >= 0 && at < stack.length - 1 ? stack[at + 1] : null;
}

/** z-index of a dialog: Z_INDEX.DIALOG for the first, one DIALOG_STEP higher per dialog below it. */
export function dialogZIndex(entry: DialogEntry): number {
    const depth = Math.max(0, stack.findIndex((e) => e.id === entry.id));
    return Z_INDEX.DIALOG + depth * Z_INDEX.DIALOG_STEP;
}

/**
 * z-index of a layer that sits between dialogs by opening order (the lifted incoming call,
 * spec D2d decision 20): half a DIALOG_STEP above the open dialogs opened before `order`, so
 * dialogs opened later stay above it. Recompute on every stack change.
 */
export function interleavedZIndex(order: number): number {
    const below = stack.filter((e) => e.order < order).length;
    return Z_INDEX.DIALOG + below * Z_INDEX.DIALOG_STEP - Z_INDEX.DIALOG_STEP / 2;
}

export function openDialogCount(): number {
    return stack.length;
}

/** Calls `listener` after every push, pop and reset (depths may have changed); returns the unsubscribe. */
export function subscribeDialogStack(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Test helper: forget every dialog and unlock scroll. */
export function resetDialogStack(): void {
    if (stack.length > 0) document.body.style.overflow = savedOverflow ?? '';
    stack = [];
    savedOverflow = null;
    notify();
}
