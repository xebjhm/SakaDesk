/**
 * One login at a time for the whole app (single-session token). App can unmount one
 * `LoginModal` and mount another while a login is in flight, so the lock cannot live in a
 * component instance: every login dialog takes and releases this one.
 */
let busy = false;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) listener();
}

/** Takes the lock; false when a login (or its Yodel geo check) is already in flight. */
export function tryLockLogin(): boolean {
    if (busy) return false;
    busy = true;
    emit();
    return true;
}

export function unlockLogin(): void {
    if (!busy) return;
    busy = false;
    emit();
}

export function isLoginBusy(): boolean {
    return busy;
}

/** For `useSyncExternalStore`: every dialog shows the app-wide in-flight state. */
export function subscribeLoginLock(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Test-only: a test that ends with a login still pending must not lock the next one. */
export function resetLoginLock(): void {
    busy = false;
    emit();
}
