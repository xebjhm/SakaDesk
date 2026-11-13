import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../__tests__/mocks/server';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { useAppStore } from '../store/appStore';
import { persisted } from '../core/persistence/persisted';

vi.mock('../core/layout', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../core/layout')>()),
    Layout: () => <div data-testid="layout-stub" />,
}));

function pinPrefs(tosAccepted: boolean) {
    vi.spyOn(persisted, 'getPref').mockImplementation(<T,>(key: string, fallback: T): T => {
        if (key === 'tos_accepted_at') return (tosAccepted ? '2024-01-01T00:00:00Z' : fallback) as unknown as T;
        if (key === 'language') return 'en' as unknown as T;
        return fallback;
    });
}

describe('first launch on the brand atmosphere (R-d)', () => {
    beforeEach(() => {
        server.use(
            http.get('*/api/app-state/prefs', () => HttpResponse.json({})),
            http.patch('*/api/app-state/prefs', () => HttpResponse.json({ ok: true })),
            http.get('*/api/app-state/migrate', () => HttpResponse.json({ migrated: true })),
            http.get('*/api/app-state/conversation-all', () => HttpResponse.json({})),
        );
    });

    it('the boot screen is brand with an ink spinner (pending decision D7)', () => {
        pinPrefs(false);
        useAppStore.setState({ selectedServices: [], activeService: null });
        const { unmount } = render(<AuthProvider><App /></AuthProvider>);
        const boot = screen.getByTestId('boot-screen');
        expect(boot.closest('[data-scope="brand"]')).not.toBeNull();
        expect(boot.querySelector('svg')).toHaveClass('animate-spin', 'text-accent', 'motion-reduce:animate-none');
        // L6: the Spinner primitive is the status; its label shows under reduced motion.
        const status = within(boot).getByRole('status', { name: 'Loading...' });
        expect(within(status).getByText('Loading...')).toHaveClass('sr-only', 'motion-reduce:not-sr-only');
        unmount();
    });

    it('ToS sits on the brand orbs', async () => {
        pinPrefs(false);
        useAppStore.setState({ selectedServices: [], activeService: null });
        const { unmount } = render(<AuthProvider><App /></AuthProvider>);
        expect(await screen.findByRole('dialog', { name: 'Terms of Service' })).toHaveAttribute('data-scope', 'brand');
        const backdrop = screen.getByTestId('entry-backdrop');
        expect(backdrop.querySelector('[data-scope="brand"]')).not.toBeNull();
        expect(backdrop.querySelectorAll('[data-testid="atmosphere-orb"]')).toHaveLength(3);
        unmount();
    });
});

describe('cancelling the first-launch sync (R-d)', () => {
    it('leaves the sync dialog, starts no later group, shows no toast and keeps the blog backup choice', async () => {
        pinPrefs(true);
        useAppStore.setState({ selectedServices: ['sakurazaka46', 'hinatazaka46'], activeService: 'sakurazaka46' });
        const starts: string[] = [];
        const startAll: unknown[] = [];
        const cancels: string[] = [];
        const saves: unknown[] = [];
        // S1 (spec 2026-11-10): the backend runs the sequence; the app follows its queue.
        const seq = {
            id: 'seq1', services: ['sakurazaka46', 'hinatazaka46'], current_index: 0, blocking: true,
            state: 'running', completed: [] as string[], failed: [] as string[],
        };
        server.use(
            http.get('*/api/app-state/prefs', () => HttpResponse.json({})),
            http.patch('*/api/app-state/prefs', () => HttpResponse.json({ ok: true })),
            http.get('*/api/app-state/migrate', () => HttpResponse.json({ migrated: true })),
            http.get('*/api/app-state/conversation-all', () => HttpResponse.json({})),
            http.get('*/api/auth/status', () => HttpResponse.json({
                services: {
                    sakurazaka46: { authenticated: true, app_id: 'a', storage_type: 'test' },
                    hinatazaka46: { authenticated: true, app_id: 'b', storage_type: 'test' },
                },
            })),
            http.get('*/api/settings', () => HttpResponse.json({
                output_dir: '', auto_sync_enabled: false, sync_interval_minutes: 30,
                adaptive_sync_enabled: false, blogs_full_backup: false, is_configured: false,
            })),
            http.post('*/api/settings', async ({ request }) => {
                const body = await request.json() as Record<string, unknown>;
                saves.push(body);
                return HttpResponse.json({
                    output_dir: 'C:\\SakaDesk-データ', auto_sync_enabled: false, sync_interval_minutes: 30,
                    adaptive_sync_enabled: false, blogs_full_backup: !!body.blogs_full_backup, is_configured: true,
                });
            }),
            http.post('*/api/settings/select-folder', () => HttpResponse.json({ path: 'C:\\SakaDesk-データ' })),
            http.post('*/api/sync/start-all', async ({ request }) => {
                startAll.push(await request.json());
                return HttpResponse.json({ sequence_id: seq.id, results: {} });
            }),
            http.post('*/api/sync/start', ({ request }) => {
                starts.push(new URL(request.url).searchParams.get('service') ?? '');
                return HttpResponse.json({ status: 'started' });
            }),
            http.get('*/api/sync/queue', () => HttpResponse.json({ running: null, queued: [], sequence: seq })),
            http.get('*/api/sync/progress', () => HttpResponse.json({ state: 'running', phase: 'messages', phase_name: 'Messages', completed: 5, total: 20 })),
            http.post('*/api/sync/cancel', ({ request }) => {
                cancels.push(new URL(request.url).search);
                seq.state = 'cancelled';
                return HttpResponse.json({ status: 'cancelled' });
            }),
            http.post('*/api/blogs/backup/start', () => HttpResponse.json({ ok: true })),
        );
        const user = userEvent.setup();
        const { unmount } = render(<AuthProvider><App /></AuthProvider>);

        await user.click(await screen.findByRole('button', { name: 'Browse' }));
        await waitFor(() => expect(screen.getByLabelText('Output Folder Path')).toHaveValue('C:\\SakaDesk-データ'));
        await user.click(screen.getByRole('checkbox'));
        await user.click(screen.getByRole('button', { name: 'Start Using SakaDesk' }));
        await user.click(await screen.findByRole('button', { name: 'Cancel' }, { timeout: 5000 }));

        // The blog backup the user opted into is still saved once the cancelled sync ends.
        await waitFor(() => expect(saves).toContainEqual({ blogs_full_backup: true }));
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
        expect(screen.queryByText('Your archive is ready')).toBeNull();
        // One sequence for both groups; Cancel ends it in the backend, so no later group starts.
        expect(startAll).toEqual([{ services: ['sakurazaka46', 'hinatazaka46'], blocking: true }]);
        expect(cancels).toEqual(['?sequence=seq1']);
        expect(starts).toEqual([]);
        unmount();
    });
});
