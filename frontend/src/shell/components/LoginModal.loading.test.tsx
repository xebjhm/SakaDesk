// Loading UX L6: the login dialog stays cancellable while it connects (F17).
// Every request is a stubbed fetch: no test ever reaches a real login.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import i18n from '../../i18n';
import { clientLog } from '../../utils/clientLog';
import { LoginModal } from './LoginModal';
import { isLoginBusy, resetLoginLock } from './loginLock';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

// The auth context the reconcile re-checks with (null: no provider, as in most dialog tests).
const authMock = vi.hoisted(() => ({ value: null as null | { checkAuth: () => Promise<unknown>; getServiceExpiresAt: (s: string) => number | null } }));
vi.mock('../context/AuthContext', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../context/AuthContext')>()),
    useOptionalAuth: () => authMock.value,
}));

interface Call { url: string; init?: RequestInit; resolve: (r: Response) => void }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Holds `/api/auth/login` and the geo check until the test answers; everything else answers at once. */
function stubFetch(cancelBody: unknown = { cancelled: true }) {
    const calls: Call[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
        const url = String(input);
        calls.push({ url, init, resolve });
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        if (url.startsWith('/api/auth/login/cancel')) resolve(json(cancelBody));
        else if (url.includes('/init')) resolve(json({}));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const find = (prefix: string) => calls.filter((c) => c.url.startsWith(prefix));
    return {
        calls,
        login: () => find('/api/auth/login?')[0],
        cancels: () => find('/api/auth/login/cancel'),
        geo: () => find('/api/auth/geo-availability')[0],
    };
}

const t = (key: string) => i18n.t(key, { lng: 'ja' });
const params = (url: string) => new URL(url, 'http://app').searchParams;
/** The cancel requests as [service, attempt-matches-the-login] pairs. */
const cancelTargets = (net: ReturnType<typeof stubFetch>) => net.cancels().map((c) => [
    params(c.url).get('service'),
    params(c.url).get('attempt') === params(net.login().url).get('attempt'),
]);
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const props = { featureId: 'messages' as const, onSuccess: vi.fn(), isFreshPrompt: false };
const loginButton = () => screen.getByRole('button', { name: new RegExp(`^(${t('common.login')}|${t('login.connecting')})$`) });
const cancelButton = () => screen.getByRole('button', { name: t('common.cancel') });
const closeButton = () => within(screen.getByTestId('login-banner')).getByRole('button', { name: t('common.close') });

beforeAll(async () => { await i18n.changeLanguage('ja'); });
afterAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(clientLog).mockClear();
    resetLoginLock();
    authMock.value = null;
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetLoginLock();
});

describe('login while connecting (L6)', () => {
    it('keeps Cancel and Close enabled and marks Login busy', async () => {
        const net = stubFetch();
        render(<LoginModal serviceId="hinatazaka46" {...props} onClose={vi.fn()} />);
        act(() => { fireEvent.click(loginButton()); });
        await flush();
        expect(net.login()).toBeDefined();
        expect(loginButton()).toHaveAttribute('aria-busy', 'true');
        for (const button of [cancelButton(), closeButton()]) {
            expect(button).not.toBeDisabled();
            expect(button).not.toHaveAttribute('aria-disabled');
        }
    });

    it('stages the copy: opening the window at 3 s, finish in the browser at 10 s', async () => {
        stubFetch();
        render(<LoginModal serviceId="hinatazaka46" {...props} onClose={vi.fn()} />);
        act(() => { fireEvent.click(loginButton()); });
        await flush();
        advance(2999);
        expect(screen.queryByText('ログイン画面を開いています…')).toBeNull();
        advance(1);
        const line = screen.getByText('ログイン画面を開いています…');
        expect(line).toHaveAttribute('role', 'status');
        expect(line).toHaveAttribute('aria-live', 'polite');
        expect(line).toHaveClass('text-small', 'text-secondary');
        advance(6999);
        expect(screen.queryByText(t('login.waitingVerySlow'))).toBeNull();
        advance(1);
        expect(screen.getByText('開いたブラウザのウィンドウでログインを完了してください。いつでもキャンセルできます。')).toBeInTheDocument();
        expect(cancelButton()).not.toHaveAttribute('aria-disabled');
        expect(clientLog).toHaveBeenCalledWith('ui_wait', expect.objectContaining({ surface: 'login', phase: 'very_slow' }));
    });

    it.each([
        ['Cancel', () => fireEvent.click(cancelButton())],
        ['Close', () => fireEvent.click(closeButton())],
        ['Escape', () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })],
    ])('%s aborts the request, asks the backend to cancel, unlocks and closes', async (_name, act0) => {
        const net = stubFetch();
        const onClose = vi.fn();
        render(<LoginModal serviceId="hinatazaka46" {...props} onClose={onClose} />);
        act(() => { fireEvent.click(loginButton()); });
        await flush();
        advance(4000);
        act(() => { act0(); });
        await flush();
        expect(net.login().init?.signal?.aborted).toBe(true);
        expect(net.cancels().map((c) => c.init?.method)).toEqual(['POST']);
        expect(cancelTargets(net)).toEqual([['hinatazaka46', true]]);
        expect(params(net.login().url).get('attempt')).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
        expect(isLoginBusy()).toBe(false);
        expect(onClose).toHaveBeenCalledOnce();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'cancelled' });
        expect(clientLog).toHaveBeenCalledWith('ui_wait', { surface: 'login', phase: 'cancelled', wait_ms: 4000 });
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login_cancel', outcome: 'ok' });
        expect(clientLog).not.toHaveBeenCalledWith('dialog_load', expect.objectContaining({ surface: 'login', outcome: 'error' }));
    });

    it('treats a 409 login_cancelled answer as a cancel, not a failure', async () => {
        const net = stubFetch();
        const onClose = vi.fn();
        render(<LoginModal serviceId="hinatazaka46" {...props} onClose={onClose} />);
        act(() => { fireEvent.click(loginButton()); });
        await flush();
        net.login().resolve(json({ detail: 'login_cancelled' }, 409));
        await flush();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(isLoginBusy()).toBe(false);
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'cancelled' });
        expect(clientLog).toHaveBeenCalledWith('ui_wait', expect.objectContaining({ surface: 'login', phase: 'cancelled' }));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('once the login answered OK, Cancel and Close are blocked with "almost done" and never cancel', async () => {
        const net = stubFetch();
        const onClose = vi.fn();
        const onSuccess = vi.fn();
        render(<LoginModal serviceId="hinatazaka46" {...props} onClose={onClose} onSuccess={onSuccess} />);
        act(() => { fireEvent.click(loginButton()); });
        await flush();
        net.login().resolve(json({ status: 'ok' }));
        await flush();
        expect(cancelButton()).toHaveAttribute('aria-disabled', 'true');
        expect(cancelButton()).toHaveAccessibleDescription('まもなく完了します…');
        expect(closeButton()).toHaveAttribute('aria-disabled', 'true');
        act(() => { fireEvent.click(cancelButton()); });
        act(() => { fireEvent.click(closeButton()); });
        act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
        await flush();
        expect(net.cancels()).toEqual([]);
        expect(onClose).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login_cancel', outcome: 'skipped' });
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(onSuccess).toHaveBeenCalledOnce();
        expect(isLoginBusy()).toBe(false);
    });

    it('a failed login still shows the error text', async () => {
        const net = stubFetch();
        render(<LoginModal serviceId="hinatazaka46" {...props} onClose={vi.fn()} />);
        act(() => { fireEvent.click(loginButton()); });
        await flush();
        net.login().resolve(new Response(null, { status: 500 }));
        await flush();
        expect(screen.getByRole('alert')).toHaveTextContent(t('login.loginFailed'));
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'error', reason: 'failed' });
    });

    it('a second dialog mounted while the first login is in flight can cancel it', async () => {
        const net = stubFetch();
        const first = render(<LoginModal serviceId="hinatazaka46" {...props} onClose={vi.fn()} />);
        act(() => { fireEvent.click(loginButton()); });
        await flush();
        first.unmount();
        const onClose = vi.fn();
        render(<LoginModal serviceId="sakurazaka46" {...props} onClose={onClose} />);
        expect(loginButton()).toHaveAttribute('aria-busy', 'true');
        act(() => { fireEvent.click(cancelButton()); });
        await flush();
        expect(net.login().init?.signal?.aborted).toBe(true);
        expect(cancelTargets(net)).toEqual([['hinatazaka46', true]]);
        expect(isLoginBusy()).toBe(false);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('the Yodel geo check shows loading at once and can be cancelled before any login', async () => {
        const net = stubFetch();
        const onClose = vi.fn();
        render(<LoginModal serviceId="yodel" {...props} onClose={onClose} />);
        act(() => { fireEvent.click(loginButton()); });
        expect(loginButton()).toHaveAttribute('aria-busy', 'true');
        expect(cancelButton()).not.toHaveAttribute('aria-disabled');
        act(() => { fireEvent.click(cancelButton()); });
        await flush();
        expect(isLoginBusy()).toBe(false);
        expect(onClose).toHaveBeenCalledOnce();
        net.geo().resolve(json({ blocked: false }));
        await flush();
        expect(net.login()).toBeUndefined();
    });

    // Fix round 1 (I1): a cancel the backend did not confirm re-checks the auth status.
    it('cancelled: false and now authenticated: runs the success path, not a cancel', async () => {
        const net = stubFetch({ cancelled: false });
        const checkAuth = vi.fn(async () => ({ hinatazaka46: { authenticated: true, expires_at: 2_000_000_000 } }));
        authMock.value = { checkAuth, getServiceExpiresAt: () => 1_000_000_000_000 };
        const onClose = vi.fn();
        const onSuccess = vi.fn();
        render(<LoginModal serviceId="hinatazaka46" {...props} onClose={onClose} onSuccess={onSuccess} />);
        act(() => { fireEvent.click(loginButton()); });
        await flush();
        act(() => { fireEvent.click(cancelButton()); });
        expect(cancelButton()).toHaveAttribute('aria-busy', 'true'); // winding down
        await flush();
        expect(checkAuth).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
        expect(isLoginBusy()).toBe(true); // held for the success path
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(net.calls.some((c) => c.url === '/api/settings/service/hinatazaka46/init')).toBe(true);
        expect(onSuccess).toHaveBeenCalledOnce();
        expect(isLoginBusy()).toBe(false);
        expect(onClose).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login_cancel', outcome: 'skipped', reason: 'completed' });
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'ok' });
        expect(clientLog).not.toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'cancelled' });
        expect(clientLog).not.toHaveBeenCalledWith('ui_wait', expect.objectContaining({ phase: 'cancelled' }));
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('cancelled: false and not authenticated: a cancel', async () => {
        const net = stubFetch({ cancelled: false });
        const checkAuth = vi.fn(async () => ({ hinatazaka46: { authenticated: false } }));
        authMock.value = { checkAuth, getServiceExpiresAt: () => null };
        const onClose = vi.fn();
        const onSuccess = vi.fn();
        render(<LoginModal serviceId="hinatazaka46" {...props} onClose={onClose} onSuccess={onSuccess} />);
        act(() => { fireEvent.click(loginButton()); });
        await flush();
        act(() => { fireEvent.click(cancelButton()); });
        await flush();
        expect(checkAuth).toHaveBeenCalledOnce();
        expect(net.calls.some((c) => c.url.includes('/init'))).toBe(false);
        expect(onSuccess).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledOnce();
        expect(isLoginBusy()).toBe(false);
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login_cancel', outcome: 'ok', reason: 'not_cancelled' });
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'cancelled' });
    });

    it('an old, still-valid token of an expired session does not count as a completed login', async () => {
        stubFetch({ cancelled: false });
        const checkAuth = vi.fn(async () => ({ hinatazaka46: { authenticated: true, expires_at: 1_900_000_000 } }));
        authMock.value = { checkAuth, getServiceExpiresAt: () => 1_900_000_000_000 };
        const onClose = vi.fn();
        const onSuccess = vi.fn();
        render(<LoginModal serviceId="hinatazaka46" {...props} onClose={onClose} onSuccess={onSuccess} />);
        act(() => { fireEvent.click(loginButton()); });
        await flush();
        act(() => { fireEvent.click(cancelButton()); });
        await flush();
        expect(onClose).toHaveBeenCalledOnce();
        expect(onSuccess).not.toHaveBeenCalled();
        expect(isLoginBusy()).toBe(false);
    });

    it.each([
        ['failed', () => new Response(null, { status: 500 }), 'failed'],
        ['unreachable', () => { throw new TypeError('network'); }, 'unreachable'],
    ] as const)('a %s cancel request still unlocks and closes', async (_name, answer, reason) => {
        const net = stubFetch();
        const base = vi.mocked(fetch).getMockImplementation()!;
        vi.mocked(fetch).mockImplementation((input, init) => (String(input).startsWith('/api/auth/login/cancel')
            ? new Promise<Response>((resolve, reject) => { try { resolve(answer()); } catch (e) { reject(e); } })
            : base(input, init)));
        const onClose = vi.fn();
        render(<LoginModal serviceId="hinatazaka46" {...props} onClose={onClose} />);
        act(() => { fireEvent.click(loginButton()); });
        await flush();
        act(() => { fireEvent.click(cancelButton()); });
        await flush();
        expect(net.login().init?.signal?.aborted).toBe(true);
        expect(isLoginBusy()).toBe(false);
        expect(onClose).toHaveBeenCalledOnce();
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login_cancel', outcome: 'error', reason });
    });

    it('a cancel request that never answers times out, unlocks and closes', async () => {
        stubFetch();
        const base = vi.mocked(fetch).getMockImplementation()!;
        vi.mocked(fetch).mockImplementation((input, init) => (String(input).startsWith('/api/auth/login/cancel')
            ? new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); })
            : base(input, init)));
        const onClose = vi.fn();
        render(<LoginModal serviceId="hinatazaka46" {...props} onClose={onClose} />);
        act(() => { fireEvent.click(loginButton()); });
        await flush();
        act(() => { fireEvent.click(cancelButton()); });
        await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
        expect(isLoginBusy()).toBe(true);
        expect(screen.queryByText(t('login.waitingVerySlow'))).toBeNull(); // winding down, no "finish in the browser"
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(isLoginBusy()).toBe(false);
        expect(onClose).toHaveBeenCalledOnce();
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login_cancel', outcome: 'error', reason: 'timeout' });
    });
});
