/**
 * The page-global the desktop host drives (`window.__sakadeskCallPopup`).
 *
 * It is installed synchronously (module load / before the first render), because the host
 * evaluates `start` right after pywebview's `loaded` event, which can be before React has
 * mounted `CallPopupApp`. A `start` that arrives while no handler is attached is queued
 * (the newest wins) and replayed when the handler attaches; a `cancel` for the queued id
 * drops it.
 */
export interface CallPopupHandler {
    start(callId: number): void;
    cancel(callId: number): void;
}

declare global {
    interface Window {
        /** Called by the desktop host: ring the reserved call / cancel it. */
        __sakadeskCallPopup?: { start(callId: number): void; cancel(callId: number): void };
    }
}

let handler: CallPopupHandler | null = null;
let pending: number | null = null;

function start(callId: number): void {
    if (handler) handler.start(callId);
    else pending = callId;
}

function cancel(callId: number): void {
    if (handler) handler.cancel(callId);
    else if (pending === callId) pending = null;
}

/** Idempotent: publishes the global (a no-op outside a browser). */
export function installCallPopupBridge(): void {
    if (typeof window === 'undefined') return;
    window.__sakadeskCallPopup = { start, cancel };
}

/** Attach the live handler and replay a queued start; returns the detach function. */
export function attachCallPopupHandler(h: CallPopupHandler): () => void {
    handler = h;
    if (pending !== null) {
        const callId = pending;
        pending = null;
        h.start(callId);
    }
    return () => { if (handler === h) handler = null; };
}

/** Put a start back in the queue (used when the handler detaches before the call loaded). */
export function requeueCallPopupStart(callId: number): void {
    if (!handler) pending = callId;
}

/** Test seam: forget the handler and any queued start. */
export function resetCallPopupBridge(): void {
    handler = null;
    pending = null;
}
