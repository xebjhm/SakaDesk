import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
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
        expect(accept).toHaveClass('bg-group-accent');
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
        expect(screen.getByRole('button', { name: 'Start Using SakaDesk' })).toHaveClass('bg-group-accent');
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
        expect(screen.getByRole('button', { name: 'Connect Account' })).toHaveClass('bg-group-accent');
        await userEvent.click(within(banner).getByRole('button', { name: 'Close' }));
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
    });

    it('logs a successful login', async () => {
        server.use(http.post('/api/auth/login', () => HttpResponse.json({})));
        const onSuccess = vi.fn();
        render(<LoginModal serviceId="hinatazaka46" {...props} onSuccess={onSuccess} />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce(), { timeout: 4000 });
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'login', outcome: 'ok' });
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
