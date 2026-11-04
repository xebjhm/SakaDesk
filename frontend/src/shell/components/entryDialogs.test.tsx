import { describe, it, expect, vi, beforeAll } from 'vitest';
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

    it('logs the login outcome', async () => {
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
