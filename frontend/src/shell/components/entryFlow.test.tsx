// frontend/src/shell/components/entryFlow.test.tsx
import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { persisted } from '../../core/persistence/persisted';
import { TosDialog } from './TosDialog';
import { SetupWizard } from './SetupWizard';
import { LoginModal } from './LoginModal';
import { SyncModal } from './SyncModal';
import { InlineSyncView } from '../../core/layout/InlineSyncView';
import { LandingPage } from '../../pages/LandingPage';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

// Locks the entry flow before D2d restyles it (docs/superpowers/specs/2026-11-05-d2d-entry-design.md).
vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
afterEach(() => vi.restoreAllMocks());

const RUNNING: SyncProgress = {
    state: 'running', phase: 'scanning', phase_name: 'Scanning', phase_number: 1, completed: 5, total: 20,
    elapsed_seconds: 30, eta_seconds: 90, speed: 2.5, speed_unit: 'groups', detail: 'Fixture detail',
};

const VERIFIED: SyncProgress = {
    state: 'complete', phase: 'complete', phase_number: 3, completed: 40, total: 40,
    elapsed_seconds: 12, eta_seconds: 0, speed: 3, speed_unit: 'files',
    result: {
        members: 2, checked: 40, missing: 3, repaired: 1, failed: 0, still_missing: 2, unresolved: 2,
        unresolved_items: [
            { member: '金村 美玖', timestamp: '2026-11-01T10:00:00Z', media_type: 'voice' },
            { member: '小坂 菜緒', timestamp: null, media_type: 'picture' },
        ],
    },
};

describe('ToS', () => {
    it('Accept is disabled until the box is ticked, then stores the acceptance and continues', async () => {
        const setPref = vi.spyOn(persisted, 'setPref').mockImplementation(() => undefined);
        const onAccept = vi.fn();
        render(<TosDialog onAccept={onAccept} />);
        const accept = screen.getByRole('button', { name: 'Accept and Continue' });
        expect(accept).toHaveAttribute('aria-disabled', 'true');
        await userEvent.click(screen.getByRole('checkbox', { name: /I understand and accept/ }));
        expect(accept).not.toHaveAttribute('aria-disabled');
        await userEvent.click(accept);
        expect(setPref).toHaveBeenCalledWith('tos_accepted_at', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
        expect(onAccept).toHaveBeenCalledOnce();
    });

    it('links the four official terms', () => {
        render(<TosDialog onAccept={vi.fn()} />);
        expect(screen.getByRole('link', { name: 'Nogizaka46 ToS' })).toHaveAttribute('href', 'https://contact.nogizaka46.com/s/n46app/page/app_terms');
        expect(screen.getByRole('link', { name: 'Sakurazaka46 ToS' })).toHaveAttribute('href', 'https://sakurazaka46.com/s/s46app/page/app_terms');
        expect(screen.getByRole('link', { name: 'Hinatazaka46 ToS' })).toHaveAttribute('href', 'https://www.hinatazaka46.com/s/h46app/page/app_terms');
        expect(screen.getByRole('link', { name: 'Yodel ToS' })).toHaveAttribute('href', 'https://yodel-app.com/s/yodel/rule');
    });
});

describe('setup wizard', () => {
    const props = (over: Partial<ComponentProps<typeof SetupWizard>> = {}) => ({
        outputDirInput: '', setOutputDirInput: vi.fn(), setupBlogFullBackup: false, setSetupBlogFullBackup: vi.fn(),
        onSelectFolder: vi.fn(), onComplete: vi.fn(), isValid: false, ...over,
    });

    it('types the folder, browses, opts into blogs; Start waits for a valid folder', async () => {
        const p = props();
        render(<SetupWizard {...p} />);
        await userEvent.type(screen.getByPlaceholderText(i18n.t('setup.outputFolderPlaceholder')), 'D');
        expect(p.setOutputDirInput).toHaveBeenCalledWith('D');
        await userEvent.click(screen.getByRole('button', { name: 'Browse' }));
        expect(p.onSelectFolder).toHaveBeenCalledOnce();
        await userEvent.click(screen.getByRole('checkbox', { name: /Download blogs for search/ }));
        expect(p.setSetupBlogFullBackup).toHaveBeenCalledWith(true);
        expect(screen.getByRole('button', { name: 'Start Using SakaDesk' })).toBeDisabled();
    });

    it('Start completes the setup when the folder is valid', async () => {
        const p = props({ outputDirInput: 'C:\\データ', isValid: true });
        render(<SetupWizard {...p} />);
        await userEvent.click(screen.getByRole('button', { name: 'Start Using SakaDesk' }));
        expect(p.onComplete).toHaveBeenCalledOnce();
    });
});

/** Answers the login calls; never a real network request (msw rejects unhandled ones). */
function pinLogin(opts: { loginStatus?: number; geo?: 'blocked' | 'open' | 'error' } = {}) {
    const calls = { login: [] as string[], init: [] as string[], geo: 0 };
    server.use(
        http.post('/api/auth/login', ({ request }) => {
            calls.login.push(new URL(request.url).searchParams.get('service') ?? '');
            return opts.loginStatus && opts.loginStatus !== 200
                ? new HttpResponse(null, { status: opts.loginStatus })
                : HttpResponse.json({ success: true });
        }),
        http.post('/api/settings/service/:service/init', ({ params }) => {
            calls.init.push(String(params.service));
            return HttpResponse.json({ ok: true });
        }),
        http.get('/api/auth/geo-availability', () => {
            calls.geo += 1;
            if (opts.geo === 'error') return HttpResponse.error();
            return HttpResponse.json({ blocked: opts.geo === 'blocked' });
        }),
    );
    return calls;
}

describe('login dialog', () => {
    it.each([
        [{ isFreshPrompt: true }, 'Connect Your Account?', 'Maybe Later', 'Connect Account'],
        [{ isDisconnected: true }, 'Session Expired', 'Cancel', 'Login'],
        [{}, 'Login Required', 'Cancel', 'Login'],
    ])('%o shows its title and buttons', (flags, title, secondary, primary) => {
        render(<LoginModal serviceId="hinatazaka46" featureId="messages" onClose={vi.fn()} onSuccess={vi.fn()} {...flags} />);
        expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: secondary })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: primary })).toBeInTheDocument();
    });

    it('signs in: logs in, initialises the service settings, then reports success', async () => {
        // Fake timers skip the dialog's 1.5 s settle delay instead of waiting for it.
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            const calls = pinLogin();
            const onSuccess = vi.fn();
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            render(<LoginModal serviceId="hinatazaka46" featureId="messages" onClose={vi.fn()} onSuccess={onSuccess} isFreshPrompt />);
            await user.click(screen.getByRole('button', { name: 'Connect Account' }));
            expect(await screen.findByText('Connecting...')).toBeInTheDocument();
            await waitFor(() => expect(calls.init).toEqual(['hinatazaka46']));
            expect(onSuccess).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1500);
            await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
            expect(calls.login).toEqual(['hinatazaka46']);
            expect(calls.geo).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('a failed login shows the error, never succeeds and re-enables both buttons', async () => {
        pinLogin({ loginStatus: 500 });
        const onSuccess = vi.fn();
        render(<LoginModal serviceId="hinatazaka46" featureId="messages" onClose={vi.fn()} onSuccess={onSuccess} isFreshPrompt />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        expect(await screen.findByText('Login failed or cancelled')).toBeInTheDocument();
        expect(onSuccess).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Connect Account' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Maybe Later' })).toBeEnabled();
    });

    it('Maybe Later closes without logging in', async () => {
        const calls = pinLogin();
        const onClose = vi.fn();
        render(<LoginModal serviceId="hinatazaka46" featureId="messages" onClose={onClose} onSuccess={vi.fn()} isFreshPrompt />);
        await userEvent.click(screen.getByRole('button', { name: 'Maybe Later' }));
        expect(onClose).toHaveBeenCalledOnce();
        expect(calls.login).toEqual([]);
    });

    it('Yodel outside Japan warns first: Close does not log in, Log in anyway does', async () => {
        const calls = pinLogin({ geo: 'blocked' });
        render(<LoginModal serviceId="yodel" featureId="messages" onClose={vi.fn()} onSuccess={vi.fn()} isFreshPrompt />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        const warning = await screen.findByRole('dialog', { name: 'Yodel is available in Japan only' });
        await userEvent.click(within(warning).getByRole('button', { name: 'Close' }));
        expect(screen.queryByRole('dialog', { name: 'Yodel is available in Japan only' })).toBeNull();
        expect(calls.login).toEqual([]);

        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        const again = await screen.findByRole('dialog', { name: 'Yodel is available in Japan only' });
        await userEvent.click(within(again).getByRole('button', { name: 'Log in anyway' }));
        await waitFor(() => expect(calls.login).toEqual(['yodel']));
    });

    it('a failing geo check lets the Yodel login proceed', async () => {
        const calls = pinLogin({ geo: 'error' });
        render(<LoginModal serviceId="yodel" featureId="messages" onClose={vi.fn()} onSuccess={vi.fn()} isFreshPrompt />);
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        await waitFor(() => expect(calls.login).toEqual(['yodel']));
        expect(calls.geo).toBe(1);
    });
});

describe('sync dialog', () => {
    it('a sequential sync names the service and its place, with the progress', () => {
        render(<SyncModal syncProgress={RUNNING} sequentialSyncInfo={{ total: 3, currentIndex: 1, currentService: 'hinatazaka46' }} />);
        expect(screen.getByRole('dialog', { name: 'Phase 1: Scanning Groups' })).toBeInTheDocument();
        expect(screen.getByText('日向坂46 (2/3)')).toBeInTheDocument();
        expect(screen.getByText('5 / 20')).toBeInTheDocument();
        expect(screen.getByText('25%')).toBeInTheDocument();
        expect(screen.getByText('Fixture detail')).toBeInTheDocument();
    });

    it('the media phase warns not to close, offers Cancel and no Done', async () => {
        const onCancel = vi.fn();
        const onClose = vi.fn();
        render(<SyncModal syncProgress={{ ...RUNNING, phase: 'downloading', phase_number: 3, completed: 100, total: 500 }} onClose={onClose} onCancel={onCancel} />);
        expect(screen.getByText('Downloading media... Please do not close the app.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a finished verify shows its summary and the unresolved items; Done closes', async () => {
        const onClose = vi.fn();
        render(<SyncModal syncProgress={VERIFIED} onClose={onClose} />);
        expect(screen.getByRole('dialog', { name: 'Complete' })).toBeInTheDocument();
        expect(screen.getByText('Checked 40 files · repaired 1 · 2 still unavailable')).toBeInTheDocument();
        expect(screen.getByText("2 media item(s) have no available source and couldn't be verified.")).toBeInTheDocument();
        expect(screen.getByText('金村 美玖')).toBeInTheDocument();
        expect(screen.getByText('小坂 菜緒')).toBeInTheDocument();
        expect(screen.queryByText('Fixture detail')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(onClose).toHaveBeenCalledOnce();
    });
});

describe('inline sync view', () => {
    it.each(['hinatazaka46', 'sakurazaka46'])('%s shows the phase, count, percent and detail', (service) => {
        render(<InlineSyncView service={service} syncProgress={RUNNING} />);
        expect(screen.getByRole('heading', { name: 'Phase 1: Scanning Groups' })).toBeInTheDocument();
        expect(screen.getByText('5 / 20')).toBeInTheDocument();
        expect(screen.getByText('25%')).toBeInTheDocument();
        expect(screen.getByText('Fixture detail')).toBeInTheDocument();
    });
});

describe('landing page', () => {
    it('picks groups, counts them and starts with them in click order', async () => {
        const onComplete = vi.fn();
        render(<LandingPage onComplete={onComplete} />);
        expect(screen.getByRole('button', { name: 'Select at least one group' })).toHaveAttribute('aria-disabled', 'true');

        await userEvent.click(screen.getByRole('button', { name: /日向坂46/ }));
        expect(screen.getByRole('button', { name: 'Get Started' })).toBeEnabled();
        await userEvent.click(screen.getByRole('button', { name: /櫻坂46/ }));
        expect(screen.getByRole('button', { name: 'Get Started with 2 groups' })).toBeEnabled();

        await userEvent.click(screen.getByRole('button', { name: /日向坂46/ })); // deselect
        expect(screen.getByRole('button', { name: 'Get Started' })).toBeEnabled();
        await userEvent.click(screen.getByRole('button', { name: /日向坂46/ })); // select again: now second
        await userEvent.click(screen.getByRole('button', { name: 'Get Started with 2 groups' }));
        expect(onComplete).toHaveBeenCalledWith(['sakurazaka46', 'hinatazaka46']);
    });
});
