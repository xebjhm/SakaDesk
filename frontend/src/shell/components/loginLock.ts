/**
 * One login at a time for the whole app (single-session token). App can unmount one
 * `LoginModal` and mount another while a login is in flight, so the lock cannot live in a
 * component instance: every login dialog takes and releases this one.
 *
 * The lock also carries the login's phase, so any dialog (even one mounted later) can show it
 * and cancel it:
 * - `connecting`: from the click (the Yodel geo check included) until `POST /api/auth/login`
 *   answers. Cancel works (`cancelLogin`); while a cancel runs, `isLoginCancelling()` is true.
 * - `finishing`: the login answered OK and the credentials are saved; the follow-up steps run.
 *   Cancel is refused, because undoing it would cost the single-session token.
 *
 * Pure module state with no logging imports: the test setup imports it before any test mocks
 * `clientLog`, so callers log the outcome codes.
 */

export type LoginPhase = 'idle' | 'connecting' | 'finishing';

/** How long the client waits for `POST /api/auth/login/cancel` (the backend bounds its own wait at 10 s). */
export const LOGIN_CANCEL_TIMEOUT_MS = 15000;

/** Checks whether the login of `service` completed after all (the backend saved its credentials). */
export type LoginVerifier = (service: string, baselineExpiresAt: number | null) => Promise<boolean>;

/**
 * The backend's answer to the cancel, as a code: `cancelled` it stopped the login (or the login
 * will refuse to start); `not_cancelled` nothing to stop (the login may have finished);
 * `failed` / `unreachable` / `timeout` the cancel request did not answer; `skipped` the login is
 * `finishing`; `none` nothing to cancel (idle, or a cancel already running).
 */
export type CancelBackendOutcome = 'cancelled' | 'not_cancelled' | 'failed' | 'unreachable' | 'timeout' | 'skipped' | 'none';

export interface CancelLoginResult {
    backend: CancelBackendOutcome;
    /**
     * The login had already succeeded (the verifier saw the service authenticated with a new
     * token). The lock is then still held: the login's owner (`awaitLoginCancel`) runs the
     * normal success path and releases it.
     */
    completed: boolean;
    /** The service of the login that was cancelled (an id). */
    service: string;
}

let phase: LoginPhase = 'idle';
/** `Date.now()` when the lock was taken; stable for the whole login (stage clocks start there). */
let startedAt: number | null = null;
/** Bumped on every lock, so a stale step of a cancelled login never acts on a newer one. */
let generation = 0;
let abort: AbortController | null = null;
/** The service whose `POST /api/auth/login` is in flight (an id). */
let activeService: string | null = null;
/** The id sent with that request (`attempt`), so a cancel that overtakes it is not lost. */
let activeAttempt: string | null = null;
/** The service's token expiry before this login, to tell a new login from an old token. */
let activeBaseline: number | null = null;
let cancelling = false;
let pendingCancel: Promise<CancelLoginResult> | null = null;
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
    activeAttempt = null;
    activeBaseline = null;
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

/** True while `cancelLogin` waits for the backend (the login is winding down). */
export function isLoginCancelling(): boolean {
    return cancelling;
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

/** A new id for one login request (letters, digits and `-`, as the backend accepts). */
export function newLoginAttempt(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Registers (or clears, with null) the in-flight login request so `cancelLogin` can abort it:
 * its service, its `attempt` id and the service's token expiry before the login.
 */
export function setLoginAbort(
    controller: AbortController | null,
    login?: { service: string; attempt: string; baselineExpiresAt: number | null },
): void {
    abort = controller;
    activeService = controller && login ? login.service : null;
    activeAttempt = controller && login ? login.attempt : null;
    activeBaseline = controller && login ? login.baselineExpiresAt : null;
}

/** The cancel now running, for the aborted login's owner to learn how it ended; null if none. */
export function awaitLoginCancel(): Promise<CancelLoginResult> | null {
    return pendingCancel;
}

async function postCancel(service: string, attempt: string | null): Promise<CancelBackendOutcome> {
    const params = new URLSearchParams({ service });
    if (attempt) params.set('attempt', attempt);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), LOGIN_CANCEL_TIMEOUT_MS);
    try {
        const res = await fetch(`/api/auth/login/cancel?${params.toString()}`, { method: 'POST', signal: timeout.signal });
        if (!res.ok) return 'failed';
        const body: unknown = await res.json().catch(() => null);
        return (body as { cancelled?: unknown } | null)?.cancelled === true ? 'cancelled' : 'not_cancelled';
    } catch {
        return timeout.signal.aborted ? 'timeout' : 'unreachable';
    } finally {
        clearTimeout(timer);
    }
}

async function settleCancel(
    service: string,
    attempt: string | null,
    hadRequest: boolean,
    baseline: number | null,
    verify: LoginVerifier | undefined,
): Promise<CancelLoginResult> {
    const backend = await postCancel(service, attempt);
    let completed = false;
    // Not cancelled, or unknown: the login may have finished on the backend, so check.
    if (hadRequest && backend !== 'cancelled' && verify) {
        try {
            completed = await verify(service, baseline);
        } catch {
            completed = false;
        }
    }
    cancelling = false;
    pendingCancel = null;
    if (completed) emit();
    else unlockLogin();
    return { backend, completed, service };
}

/**
 * Cancels the login in flight, from any dialog: aborts the request, asks the backend to stop the
 * browser login (`POST /api/auth/login/cancel`, for the in-flight login's service and attempt,
 * else `service`), bounded by `LOGIN_CANCEL_TIMEOUT_MS`. When the backend did not cancel it (or
 * did not answer) and a login request was sent, `verify` re-checks the auth status: a login that
 * completed after all is reported `completed` and keeps the lock for its owner's success path.
 * Otherwise the lock is released once the backend answered, so a new login can never be hit by
 * this cancel. Never throws. Does nothing in `finishing` or when idle.
 */
export function cancelLogin(service: string, verify?: LoginVerifier): Promise<CancelLoginResult> {
    if (phase !== 'connecting' || cancelling) {
        return Promise.resolve({ backend: phase === 'finishing' ? 'skipped' : 'none', completed: false, service });
    }
    cancelling = true;
    const target = activeService ?? service;
    const controller = abort;
    const run = settleCancel(target, activeAttempt, controller !== null, activeBaseline, verify);
    pendingCancel = run;
    abort = null;
    emit();
    // Aborted after `pendingCancel` is set, so the aborted login's owner always finds it.
    controller?.abort();
    return run;
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
    activeAttempt = null;
    activeBaseline = null;
    cancelling = false;
    pendingCancel = null;
    emit();
}
