/**
 * One login at a time for the whole app (single-session token). App can unmount one
 * `LoginModal` and mount another while a login is in flight, so the lock cannot live in a
 * component instance: every login dialog takes and releases this one.
 *
 * The lock also carries the login's phase, so any dialog (even one mounted later) can show it
 * and cancel it:
 * - `connecting`: from the click (the Yodel geo check included) until `POST /api/auth/login`
 *   answers. Cancel works (`cancelLogin`).
 * - `finishing`: the login answered OK and the credentials are saved; the follow-up steps run.
 *   Cancel is refused, because undoing it would cost the single-session token.
 *
 * Pure module state with no logging imports: the test setup imports it before any test mocks
 * `clientLog`, so the caller logs `cancelLogin`'s outcome code.
 */

export type LoginPhase = 'idle' | 'connecting' | 'finishing';

let phase: LoginPhase = 'idle';
/** `Date.now()` when the lock was taken; stable for the whole login (stage clocks start there). */
let startedAt: number | null = null;
/** Bumped on every lock, so a stale step of a cancelled login never acts on a newer one. */
let generation = 0;
let abort: AbortController | null = null;
/** The service whose `POST /api/auth/login` is in flight (an id). */
let activeService: string | null = null;
let cancelling = false;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) listener();
}

/** Takes the lock (phase `connecting`); false when a login (or its Yodel geo check) is already in flight. */
export function tryLockLogin(): boolean {
    if (phase !== 'idle') return false;
    phase = 'connecting';
    startedAt = Date.now();
    generation += 1;
    emit();
    return true;
}

export function unlockLogin(): void {
    if (phase === 'idle') return;
    phase = 'idle';
    startedAt = null;
    abort = null;
    activeService = null;
    emit();
}

export function isLoginBusy(): boolean {
    return phase !== 'idle';
}

export function getLoginPhase(): LoginPhase {
    return phase;
}

export function getLoginStartedAt(): number | null {
    return startedAt;
}

/** The current lock's generation: read it right after `tryLockLogin` and pass it to `ownsLogin`. */
export function loginGeneration(): number {
    return generation;
}

/** True while the lock taken at `gen` is still held (not cancelled, released or replaced). */
export function ownsLogin(gen: number): boolean {
    return phase !== 'idle' && generation === gen && !cancelling;
}

/** The login request answered OK: from here Cancel is refused. */
export function setLoginFinishing(): void {
    if (phase !== 'connecting') return;
    phase = 'finishing';
    emit();
}

/** Registers (or clears, with null) the in-flight login request so `cancelLogin` can abort it. */
export function setLoginAbort(controller: AbortController | null, service?: string): void {
    abort = controller;
    activeService = controller ? service ?? null : null;
}

/**
 * How `cancelLogin` ended (a code for the caller's breadcrumb): `ok` the backend answered,
 * `failed` it refused, `unreachable` the request failed, `skipped` the login is `finishing` (never
 * cancelled), `none` nothing to cancel (idle, or a cancel already running).
 */
export type CancelLoginOutcome = 'ok' | 'failed' | 'unreachable' | 'skipped' | 'none';

/**
 * Cancels the login in flight, from any dialog: aborts the request, asks the backend to stop the
 * browser login (`POST /api/auth/login/cancel`, for the in-flight login's service, else
 * `service`) and then releases the lock. The lock is held until the backend answered, so a new
 * login can never be hit by this cancel. A network failure never throws and still unlocks.
 * Does nothing in `finishing` or when idle. Resolves with the outcome code.
 */
export async function cancelLogin(service: string): Promise<CancelLoginOutcome> {
    if (phase !== 'connecting' || cancelling) return phase === 'finishing' ? 'skipped' : 'none';
    cancelling = true;
    const target = activeService ?? service;
    const controller = abort;
    abort = null;
    controller?.abort();
    try {
        const res = await fetch(`/api/auth/login/cancel?service=${encodeURIComponent(target)}`, { method: 'POST' });
        return res.ok ? 'ok' : 'failed';
    } catch {
        return 'unreachable';
    } finally {
        cancelling = false;
        unlockLogin();
    }
}

/** For `useSyncExternalStore`: every dialog shows the app-wide in-flight state. */
export function subscribeLoginLock(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Test-only: a test that ends with a login still pending must not lock the next one. */
export function resetLoginLock(): void {
    phase = 'idle';
    startedAt = null;
    abort = null;
    activeService = null;
    cancelling = false;
    emit();
}
