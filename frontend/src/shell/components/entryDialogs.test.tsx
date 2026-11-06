import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { clientLog } from '../../utils/clientLog';
import { groupRoles } from '../../design/tokens';
import { TosDialog } from './TosDialog';
import { SetupWizard } from './SetupWizard';
import { LoginModal } from './LoginModal';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    server.use(http.post('/api/settings/service/:id/init', () => HttpResponse.json({})));
});

describe('ToS (D2d)', () => {
    it('is a standard dialog whose body scrolls while Accept stays in the footer', () => {
        render(<TosDialog onAccept={vi.fn()} />);
        const heading = screen.getByRole('heading', { level: 2, name: 'Terms of Service' });
        expect(screen.getByRole('dialog', { name: 'Terms of Service' })).toContainElement(heading);
        expect(document.getElementById('tos-title')).toBeNull();
        const accept = screen.getByRole('button', { name: 'Accept and Continue' });
        expect(accept).toHaveClass('bg-accent-gradient');
        expect(accept.closest('.overflow-y-auto')).toBeNull();
        expect(screen.getByRole('checkbox')).toHaveClass('accent-group');
    });

    it('links the official terms with the neutral link role', () => {
        render(<TosDialog onAccept={vi.fn()} />);
        expect(screen.getByRole('link', { name: 'Yodel ToS' })).toHaveClass('text-group-strong', 'decoration-group');
    });
});

describe('setup (D2d)', () => {
    it('ties the folder field to its label and names the dialog by its h2', () => {
        render(
            <SetupWizard outputDirInput="" setOutputDirInput={vi.fn()} setupBlogFullBackup={false}
                setSetupBlogFullBackup={vi.fn()} onSelectFolder={vi.fn()} onComplete={vi.fn()} isValid={false} />,
        );
        expect(screen.getByLabelText('Output Folder Path')).toHaveAttribute('placeholder', i18n.t('setup.outputFolderPlaceholder'));
        expect(screen.getByRole('heading', { level: 2, name: 'Welcome to SakaDesk' })).toBeInTheDocument();
        expect(document.getElementById('setup-title')).toBeNull();
        expect(screen.getByRole('button', { name: 'Start Using SakaDesk' })).toHaveClass('bg-accent-gradient');
    });
});

describe('login (D2d)', () => {
    it.each([
        ['hinatazaka46', 'hinatazaka', 'bg-group-title'],
        ['sakurazaka46', 'sakurazaka', 'bg-sheet'],
    ] as const)('%s: official banner, scoped colours, named close, primary sign-in', async (serviceId, group, bannerClass) => {
        const onClose = vi.fn();
        render(<LoginModal serviceId={serviceId} featureId="messages" onClose={onClose} onSuccess={vi.fn()} isFreshPrompt />);
        const banner = screen.getByTestId('login-banner');
        expect(banner).toHaveClass(bannerClass);
        const scope = banner.parentElement as HTMLElement;
        expect(scope.style.getPropertyValue('--ds-group-accent')).toBe(groupRoles(group).action);
        expect(document.getElementById('login-title')).toBeNull();
        expect(screen.getByRole('button', { name: 'Connect Account' })).toHaveClass('bg-accent-gradient');
        const close = within(banner).getByRole('button', { name: 'Close' });
        expect(close).toHaveAttribute('data-shape', 'rounded'); // dialog close stays an inline 12px radius, never a circle
        await userEvent.click(close);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('shows a failed login as an alert and logs it as an error', async () => {
        server.use(
            http.post('/api/auth/login', () => new HttpResponse(null, { status: 500 })),
        );
        render(<LoginModal serviceId="hinatazaka46" featureId="messages" onClose={vi.fn()} onSuccess={vi.fn()} isFreshPrompt />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Login failed or cancelled');
        expect(alert).toHaveClass('text-status-danger');
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'error', reason: 'failed' });
    });

    it('logs the Yodel geo decision and a cancelled warning', async () => {
        server.use(http.get('/api/auth/geo-availability', () => HttpResponse.json({ blocked: true })));
        render(<LoginModal serviceId="yodel" featureId="messages" onClose={vi.fn()} onSuccess={vi.fn()} isFreshPrompt />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        const warning = await screen.findByRole('dialog', { name: 'Yodel is available in Japan only' });
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login_geo', outcome: 'skipped', reason: 'blocked' });
        await userEvent.click(within(warning).getByRole('button', { name: 'Close' }));
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'cancelled' }));
    });
});

describe('login banner text (D2d)', () => {
    it('on the light banner only the title is in the official colour; the service line is secondary', () => {
        const { unmount } = render(<LoginModal serviceId="sakurazaka46" featureId="messages" onClose={vi.fn()} onSuccess={vi.fn()} isFreshPrompt />);
        expect(within(screen.getByTestId('login-banner')).getByText('櫻坂46')).toHaveClass('text-secondary');
        unmount();
        render(<LoginModal serviceId="hinatazaka46" featureId="messages" onClose={vi.fn()} onSuccess={vi.fn()} isFreshPrompt />);
        expect(within(screen.getByTestId('login-banner')).getByText('日向坂46')).not.toHaveClass('text-secondary');
    });

    it('draws the banner title bold and the light-header icon disc in the accent tint (R-c)', () => {
        render(<LoginModal serviceId="sakurazaka46" featureId="messages" onClose={vi.fn()} onSuccess={vi.fn()} isFreshPrompt />);
        const banner = screen.getByTestId('login-banner');
        expect(within(banner).getByRole('heading', { level: 2 })).toHaveClass('font-bold');
        expect(banner.querySelector('span[aria-hidden="true"]')).toHaveClass('bg-accent-subtle');
    });
});

describe('login stale state (D2d)', () => {
    it('does not carry a failed login error onto the next service dialog', async () => {
        server.use(http.post('/api/auth/login', () => new HttpResponse(null, { status: 500 })));
        const props = { featureId: 'messages' as const, onClose: vi.fn(), onSuccess: vi.fn(), isFreshPrompt: true };
        const { rerender } = render(<LoginModal serviceId="hinatazaka46" {...props} />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Login failed or cancelled');
        rerender(<LoginModal serviceId="sakurazaka46" {...props} />);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('button', { name: 'Connect Account' })).toBeEnabled();
    });
});

describe('login in flight and breadcrumbs (D2d)', () => {
    const props = { featureId: 'messages' as const, onClose: vi.fn(), onSuccess: vi.fn(), isFreshPrompt: true };

    /** A login request that stays pending until `settle` is called. */
    function pendingLogin(status: number) {
        let settle!: () => void;
        const gate = new Promise<void>((resolve) => { settle = resolve; });
        server.use(http.post('/api/auth/login', async () => { await gate; return new HttpResponse(null, { status }); }));
        return settle;
    }

    it('disables the close paths while a login is in flight', async () => {
        const settle = pendingLogin(500);
        const onClose = vi.fn();
        render(<LoginModal serviceId="hinatazaka46" {...props} onClose={onClose} />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        expect(await screen.findByRole('button', { name: 'Connecting...' })).toBeDisabled();
        expect(within(screen.getByTestId('login-banner')).getByRole('button', { name: 'Close' })).toBeDisabled();
        await userEvent.keyboard('{Escape}');
        expect(onClose).not.toHaveBeenCalled();
        settle();
        await screen.findByRole('alert');
    });

    it('keeps Connect disabled on the next service until the first login settles, with no stale error', async () => {
        const settle = pendingLogin(500);
        const { rerender } = render(<LoginModal serviceId="hinatazaka46" {...props} />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        await screen.findByRole('button', { name: 'Connecting...' });
        rerender(<LoginModal serviceId="sakurazaka46" {...props} />);
        expect(screen.getByRole('button', { name: 'Connecting...' })).toBeDisabled();
        expect(screen.queryByRole('alert')).toBeNull();
        settle();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Account' })).toBeEnabled());
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('does not advance the next service when the earlier login succeeds late', async () => {
        const settle = pendingLogin(200);
        const onSuccess = vi.fn();
        const { rerender } = render(<LoginModal serviceId="hinatazaka46" {...props} onSuccess={onSuccess} />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        await screen.findByRole('button', { name: 'Connecting...' });
        rerender(<LoginModal serviceId="sakurazaka46" {...props} onSuccess={onSuccess} />);
        settle();
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'skipped' }), { timeout: 4000 });
        expect(onSuccess).not.toHaveBeenCalled();
        // A stale success is only a skip, never also an ok.
        expect(clientLog).not.toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'ok' });
    });

    it('logs a successful login', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            server.use(http.post('/api/auth/login', () => HttpResponse.json({})));
            const onSuccess = vi.fn();
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            render(<LoginModal serviceId="hinatazaka46" {...props} onSuccess={onSuccess} />);
            await user.click(screen.getByRole('button', { name: 'Connect Account' }));
            await screen.findByRole('button', { name: 'Connecting...' });
            await vi.advanceTimersByTimeAsync(1500);
            await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
            expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'ok' });
        } finally {
            vi.useRealTimers();
        }
    });

    it('logs the Yodel geo check as ok, failed and unreachable', async () => {
        const cases: Array<[string, () => void, object]> = [
            ['ok', () => server.use(http.get('/api/auth/geo-availability', () => HttpResponse.json({ blocked: false }))), { surface: 'login_geo', outcome: 'ok' }],
            ['failed', () => server.use(http.get('/api/auth/geo-availability', () => new HttpResponse(null, { status: 500 }))), { surface: 'login_geo', outcome: 'error', reason: 'failed' }],
            ['unreachable', () => server.use(http.get('/api/auth/geo-availability', () => HttpResponse.error())), { surface: 'login_geo', outcome: 'error', reason: 'unreachable' }],
        ];
        for (const [, arrange, expected] of cases) {
            arrange();
            server.use(http.post('/api/auth/login', () => new HttpResponse(null, { status: 500 })));
            vi.mocked(clientLog).mockClear();
            const { unmount } = render(<LoginModal serviceId="yodel" {...props} />);
            await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
            await screen.findByRole('alert');
            expect(clientLog).toHaveBeenCalledWith('dialog_load', expected);
            unmount();
        }
    });

    it('logs in after the Yodel warning is confirmed', async () => {
        server.use(http.get('/api/auth/geo-availability', () => HttpResponse.json({ blocked: true })));
        let logins = 0;
        server.use(http.post('/api/auth/login', () => { logins += 1; return new HttpResponse(null, { status: 500 }); }));
        render(<LoginModal serviceId="yodel" {...props} />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        const warning = await screen.findByRole('dialog', { name: 'Yodel is available in Japan only' });
        await userEvent.click(within(warning).getByRole('button', { name: 'Log in anyway' }));
        await waitFor(() => expect(logins).toBe(1));
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'error', reason: 'failed' });
    });
});

describe('login lock across the Yodel geo check (D2d)', () => {
    const props = { featureId: 'messages' as const, onClose: vi.fn(), onSuccess: vi.fn(), isFreshPrompt: true };

    /** A geo check that stays pending until `settle` is called; counts geo and login calls. */
    function pendingGeo(blocked = false) {
        let settle!: () => void;
        const gate = new Promise<void>((resolve) => { settle = resolve; });
        const calls = { geo: 0, login: [] as string[] };
        server.use(
            http.get('/api/auth/geo-availability', async () => { calls.geo += 1; await gate; return HttpResponse.json({ blocked }); }),
            http.post('/api/auth/login', ({ request }) => {
                calls.login.push(new URL(request.url).searchParams.get('service') ?? '');
                return new HttpResponse(null, { status: 500 });
            }),
        );
        return { settle, calls };
    }

    it('a double click during a pending geo check logs in once', async () => {
        const { settle, calls } = pendingGeo();
        render(<LoginModal serviceId="yodel" {...props} />);
        const connect = screen.getByRole('button', { name: 'Connect Account' });
        // Same tick: the button is not disabled yet, so only the lock can stop the second click.
        act(() => {
            fireEvent.click(connect);
            fireEvent.click(connect);
        });
        expect(screen.getByRole('button', { name: 'Connecting...' })).toBeDisabled();
        settle();
        await screen.findByRole('alert');
        expect(calls.geo).toBe(1);
        expect(calls.login).toEqual(['yodel']);
    });

    it('does not log in when the service changed during the geo check', async () => {
        const { settle, calls } = pendingGeo();
        const { rerender } = render(<LoginModal serviceId="yodel" {...props} />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        rerender(<LoginModal serviceId="hinatazaka46" {...props} />);
        settle();
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'skipped' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Account' })).toBeEnabled());
        expect(calls.login).toEqual([]);
    });

    it('releases the lock when the geo warning shows', async () => {
        const { settle } = pendingGeo(true);
        render(<LoginModal serviceId="yodel" {...props} />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        settle();
        const warning = await screen.findByRole('dialog', { name: 'Yodel is available in Japan only' });
        await userEvent.click(within(warning).getByRole('button', { name: 'Close' }));
        expect(screen.getByRole('button', { name: 'Connect Account' })).toBeEnabled();
    });
});

describe('login holds its lock until onSuccess settles (D2d)', () => {
    beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
    afterEach(() => { vi.useRealTimers(); });

    it('keeps Connect locked while onSuccess is pending', async () => {
        server.use(http.post('/api/auth/login', () => HttpResponse.json({})));
        let finish!: () => void;
        const onSuccess = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(<LoginModal serviceId="hinatazaka46" featureId="messages" onClose={vi.fn()} onSuccess={onSuccess} isFreshPrompt />);
        await user.click(screen.getByRole('button', { name: 'Connect Account' }));
        await screen.findByRole('button', { name: 'Connecting...' });
        await vi.advanceTimersByTimeAsync(1500);
        await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
        expect(screen.getByRole('button', { name: 'Connecting...' })).toBeDisabled();
        finish();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Account' })).toBeEnabled());
    });
});

describe('one login per app (D2d review)', () => {
    const props = { featureId: 'messages' as const, onClose: vi.fn(), onSuccess: vi.fn(), isFreshPrompt: true };
    const primary = () => screen.getByRole('button', { name: /^(Connect Account|Connecting\.\.\.)$/ });

    it('a dialog unmounted during its geo check never logs in', async () => {
        let settle!: () => void;
        const gate = new Promise<void>((resolve) => { settle = resolve; });
        const logins: string[] = [];
        server.use(
            http.get('/api/auth/geo-availability', async () => { await gate; return HttpResponse.json({ blocked: false }); }),
            http.post('/api/auth/login', ({ request }) => {
                logins.push(new URL(request.url).searchParams.get('service') ?? '');
                return new HttpResponse(null, { status: 500 });
            }),
        );
        const { unmount } = render(<LoginModal serviceId="yodel" {...props} />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        unmount();
        settle();
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'skipped' }));
        expect(logins).toEqual([]);
    });

    it('a second dialog mounted while the first login is in flight cannot log in', async () => {
        let settle!: () => void;
        const gate = new Promise<void>((resolve) => { settle = resolve; });
        const logins: string[] = [];
        server.use(http.post('/api/auth/login', async ({ request }) => {
            logins.push(new URL(request.url).searchParams.get('service') ?? '');
            await gate;
            return new HttpResponse(null, { status: 500 });
        }));
        const first = render(<LoginModal serviceId="hinatazaka46" {...props} />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        await waitFor(() => expect(logins).toEqual(['hinatazaka46']));
        first.unmount();

        render(<LoginModal serviceId="sakurazaka46" {...props} isFreshPrompt={false} isDisconnected />);
        expect(primary()).toBeDisabled();
        act(() => { fireEvent.click(primary()); });
        expect(logins).toEqual(['hinatazaka46']);

        settle();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Login' })).toBeEnabled());
        expect(logins).toEqual(['hinatazaka46']);
    });

    it('a failing onSuccess is not reported as a failed login', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            server.use(http.post('/api/auth/login', () => HttpResponse.json({})));
            const onSuccess = vi.fn(() => Promise.reject(new Error('auth refresh failed')));
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            render(<LoginModal serviceId="hinatazaka46" {...props} onSuccess={onSuccess} />);
            await user.click(screen.getByRole('button', { name: 'Connect Account' }));
            await screen.findByRole('button', { name: 'Connecting...' });
            await vi.advanceTimersByTimeAsync(1500);
            await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'error', reason: 'after_login' }));
            expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'ok' });
            expect(clientLog).not.toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'error', reason: 'failed' });
            expect(screen.queryByRole('alert')).toBeNull();
            await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Account' })).toBeEnabled());
        } finally {
            vi.useRealTimers();
        }
    });
});
