// loginLock state transitions (fix round 2, R1): a cancel reconciled into a completed login
// goes straight from "cancelling" to "finishing", never back to plain "connecting".
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    cancelLogin, getLoginPhase, isLoginCancelling, resetLoginLock, setLoginAbort, subscribeLoginLock, tryLockLogin,
} from './loginLock';

afterEach(() => { vi.unstubAllGlobals(); resetLoginLock(); });

function stubCancel(body: unknown) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
}

describe('cancelLogin state', () => {
    it('a completed reconcile notifies finishing, never connecting-and-not-cancelling', async () => {
        stubCancel({ cancelled: false });
        expect(tryLockLogin()).toBe(true);
        setLoginAbort(new AbortController(), { service: 'hinatazaka46', attempt: 'a-1', baselineExpiresAt: null });
        const seen: string[] = [];
        const unsubscribe = subscribeLoginLock(() => { seen.push(`${getLoginPhase()}:${isLoginCancelling()}`); });
        const result = await cancelLogin('hinatazaka46', async () => true);
        unsubscribe();
        expect(result).toEqual({ backend: 'not_cancelled', completed: true, service: 'hinatazaka46' });
        expect(seen).toEqual(['connecting:true', 'finishing:false']);
        expect(getLoginPhase()).toBe('finishing');
    });

    it('a confirmed cancel unlocks', async () => {
        stubCancel({ cancelled: true });
        tryLockLogin();
        setLoginAbort(new AbortController(), { service: 'sakurazaka46', attempt: 'b-2', baselineExpiresAt: null });
        const seen: string[] = [];
        const unsubscribe = subscribeLoginLock(() => { seen.push(`${getLoginPhase()}:${isLoginCancelling()}`); });
        const result = await cancelLogin('sakurazaka46', async () => true);
        unsubscribe();
        expect(result.backend).toBe('cancelled');
        expect(result.completed).toBe(false);
        expect(seen).toEqual(['connecting:true', 'idle:false']);
    });
});
