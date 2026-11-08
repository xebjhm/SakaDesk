import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { DiagnosticsModal, DISK_USAGE_POLL_MS } from './DiagnosticsModal';
import en from '../../i18n/locales/en.json';
import ja from '../../i18n/locales/ja.json';
import zhCN from '../../i18n/locales/zh-CN.json';
import zhTW from '../../i18n/locales/zh-TW.json';
import yue from '../../i18n/locales/yue.json';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';

vi.mock('../../shell/hooks/useAuth', () => ({
    useAuth: () => ({
        connectedServices: [], disconnectedServices: [],
        isServiceConnected: () => false, isServiceDisconnected: () => false,
        getServiceExpiresAt: () => null, getScheduledRefreshServices: () => [],
    }),
}));

const DATA = {
    system: { os: 'Windows', os_release: '11', python_version: '3.12', app_version: '0.3.4', pysaka_version: '0.4.6', app_data_dir: 'A', settings_path: 'S', logs_dir: 'L', is_windows: true },
    auth_status: { has_token: false, groups_configured: [] },
    config_state: { is_configured: true, output_dir_exists: true, auto_sync_enabled: false, adaptive_sync_enabled: false, sync_interval: 15 },
    sync_state: { disk_usage_mb: 0, file_count: 0, services: [] },
    disk_usage: { state: 'ready', size_mb: 0, file_count: 0, detailed: null },
    logs: { recent: ['2026 - INFO - ok'], errors: [], warnings: [] },
};

const READY_USAGE = {
    state: 'ready', size_mb: 2048, file_count: 12345, computed_at: '2026-11-09T00:00:00Z', duration_ms: 160000,
    detailed: { total_bytes: 2 * 1024 * 1024 * 1024, services: [{ name: 'hinatazaka46', total_bytes: 1.5 * 1024 * 1024 * 1024, categories: [] }, { name: 'sakurazaka46', total_bytes: 0.5 * 1024 * 1024 * 1024, categories: [] }] },
};
const PENDING_DATA = { ...DATA, disk_usage: { state: 'pending', size_mb: 0, file_count: 0, detailed: null } };

const ok = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });

/** fetch mock: /api/diagnostics → `summary`; /api/diagnostics/disk-usage → successive `polls`. */
function routeFetch(summary: unknown, polls: Array<unknown | Error>) {
    const queue = [...polls];
    return vi.fn((url: string) => {
        if (url.startsWith('/api/diagnostics/disk-usage')) {
            const next = queue.length > 1 ? queue.shift() : queue[0];
            return next instanceof Error ? Promise.reject(next) : ok(next);
        }
        return ok(summary);
    });
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => DATA }));
});
afterEach(() => vi.unstubAllGlobals());

describe('DiagnosticsModal', () => {
    it('keeps the last scrolled row clear of the footer (R-d)', async () => {
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        await screen.findByRole('dialog', { name: 'Developer Diagnostics' });
        expect(screen.getByTestId('modal-footer')).toHaveClass('border-t', 'pt-4');
    });

    it('is a brand-scoped dialog with a dark console header and no expressive bar', async () => {
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        const dialog = await screen.findByRole('dialog', { name: 'Developer Diagnostics' });
        expect(dialog).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByTestId('modal-header')).toHaveClass('bg-console', 'text-console');
        expect(screen.queryByTestId('modal-header-bar')).toBeNull();
    });

    it('shows the hidden-panel badge as monospace uppercase amber on dark', async () => {
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        await screen.findByRole('dialog', { name: 'Developer Diagnostics' });
        expect(screen.getByText('Hidden Panel')).toHaveClass('font-mono', 'uppercase', 'tracking-wide', 'bg-console-badge', 'text-console-badge');
    });

    it('draws Copy JSON as a solid ink button, never the accent gradient', async () => {
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        await screen.findByText(/2026 - INFO - ok/);
        const copy = screen.getByRole('button', { name: /Copy JSON/ });
        expect(copy).toHaveClass('bg-console', 'text-console', 'hover:bg-console');
        expect(copy.className).not.toMatch(/bg-accent/);
        expect(copy.className).not.toContain('hover:bg-sunken');
    });

    it('uses no brand gradient or expressive surface anywhere in the panel', async () => {
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        const dialog = await screen.findByRole('dialog', { name: 'Developer Diagnostics' });
        await screen.findByText(/2026 - INFO - ok/);
        expect(dialog.innerHTML).not.toMatch(/accent-gradient|expressive|shadow-accent/);
    });

    it('draws the log block in the console look', async () => {
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        const line = await screen.findByText(/2026 - INFO - ok/);
        expect(line.parentElement).toHaveClass('bg-console', 'text-console-muted', 'font-mono');
    });

    it('draws the terminal icon in the header', async () => {
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        await screen.findByRole('dialog', { name: 'Developer Diagnostics' });
        expect(screen.getByTestId('modal-header-icon').querySelector('svg')).toHaveClass('text-console-prompt');
    });

    it('loads the diagnostics and shows the system block and logs', async () => {
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        expect(await screen.findByText('Developer Diagnostics')).toBeInTheDocument();
        expect(await screen.findByText(/2026 - INFO - ok/)).toBeInTheDocument();
        expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/diagnostics');
    });

    it('logs the load as ok', async () => {
        vi.mocked(clientLog).mockClear();
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        await screen.findByText(/2026 - INFO - ok/);
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'diagnostics', outcome: 'ok' });
    });

    it('logs a failed load as an error, without the error text', async () => {
        vi.mocked(clientLog).mockClear();
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('C:\\Users\\secret')));
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'diagnostics', outcome: 'error' }));
        expect(JSON.stringify(vi.mocked(clientLog).mock.calls)).not.toContain('secret');
    });

    describe('disk usage computed in the background (L6)', () => {
        afterEach(() => vi.useRealTimers());

        it('shows everything else at once and a calculating state in the Disk usage card', async () => {
            vi.stubGlobal('fetch', routeFetch(PENDING_DATA, [{ state: 'pending' }]));
            render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
            expect(await screen.findByText(/2026 - INFO - ok/)).toBeInTheDocument();
            const pending = screen.getByTestId('disk-usage-pending');
            expect(pending).toHaveTextContent('Calculating…');
            expect(pending).toHaveAttribute('role', 'status');
            expect(screen.queryByText('Files')).toBeNull();
            // Copy JSON is usable as soon as the summary arrives.
            expect(screen.getByRole('button', { name: /Copy JSON/ })).toBeEnabled();
            expect(clientLog).toHaveBeenCalledWith('diagnostics_disk_usage', { outcome: 'pending', phase: 'load' });
        });

        it('polls until ready, then fills the card and logs the transition', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            vi.mocked(clientLog).mockClear();
            const fetchMock = routeFetch(PENDING_DATA, [{ state: 'pending' }, READY_USAGE]);
            vi.stubGlobal('fetch', fetchMock);
            render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
            await screen.findByTestId('disk-usage-pending');

            await act(async () => { await vi.advanceTimersByTimeAsync(DISK_USAGE_POLL_MS); });
            expect(screen.getByTestId('disk-usage-pending')).toBeInTheDocument();
            await act(async () => { await vi.advanceTimersByTimeAsync(DISK_USAGE_POLL_MS); });

            expect(await screen.findByText('2.0 GB')).toBeInTheDocument();
            expect(screen.getByText('12,345')).toBeInTheDocument();
            expect(screen.getByText('1.5 GB')).toBeInTheDocument();
            expect(screen.queryByTestId('disk-usage-pending')).toBeNull();
            expect(fetchMock).toHaveBeenCalledWith('/api/diagnostics/disk-usage');
            expect(clientLog).toHaveBeenCalledWith('diagnostics_disk_usage', { outcome: 'ready', phase: 'poll', count: 2 });

            // No more polling once ready.
            const polls = fetchMock.mock.calls.filter(([u]) => u.startsWith('/api/diagnostics/disk-usage')).length;
            await act(async () => { await vi.advanceTimersByTimeAsync(DISK_USAGE_POLL_MS * 3); });
            expect(fetchMock.mock.calls.filter(([u]) => u.startsWith('/api/diagnostics/disk-usage')).length).toBe(polls);
        });

        it('copies the ready disk usage in the JSON, mirrored into sync_state', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            const writeText = vi.fn();
            vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
            vi.stubGlobal('fetch', routeFetch(PENDING_DATA, [READY_USAGE]));
            render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
            await screen.findByTestId('disk-usage-pending');
            await act(async () => { await vi.advanceTimersByTimeAsync(DISK_USAGE_POLL_MS); });
            await screen.findByText('2.0 GB');
            fireEvent.click(screen.getByRole('button', { name: /Copy JSON/ }));
            const copied = JSON.parse(writeText.mock.calls[0][0]);
            expect(copied.disk_usage.state).toBe('ready');
            expect(copied.sync_state.file_count).toBe(12345);
            expect(copied.sync_state.disk_usage_detailed.total_bytes).toBe(READY_USAGE.detailed.total_bytes);
        });

        it('shows a could-not-calculate state when the walk failed', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            vi.mocked(clientLog).mockClear();
            vi.stubGlobal('fetch', routeFetch(PENDING_DATA, [{ state: 'failed', size_mb: 0, file_count: 0 }]));
            render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
            await screen.findByTestId('disk-usage-pending');
            await act(async () => { await vi.advanceTimersByTimeAsync(DISK_USAGE_POLL_MS); });
            expect(await screen.findByTestId('disk-usage-failed')).toHaveTextContent("Couldn't calculate");
            expect(clientLog).toHaveBeenCalledWith('diagnostics_disk_usage', { outcome: 'failed', phase: 'poll', count: 1 });
        });

        it('stops polling and shows the failed state when a poll request errors, without the error text', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            vi.mocked(clientLog).mockClear();
            vi.stubGlobal('fetch', routeFetch(PENDING_DATA, [new Error('C:\\Users\\secret')]));
            render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
            await screen.findByTestId('disk-usage-pending');
            await act(async () => { await vi.advanceTimersByTimeAsync(DISK_USAGE_POLL_MS); });
            expect(await screen.findByTestId('disk-usage-failed')).toBeInTheDocument();
            expect(clientLog).toHaveBeenCalledWith('diagnostics_disk_usage', { outcome: 'error', phase: 'poll', count: 1 });
            expect(JSON.stringify(vi.mocked(clientLog).mock.calls)).not.toContain('secret');
        });

        it('logs an abandoned poll when the panel closes while still calculating', async () => {
            vi.mocked(clientLog).mockClear();
            vi.stubGlobal('fetch', routeFetch(PENDING_DATA, [{ state: 'pending' }]));
            const { rerender } = render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
            await screen.findByTestId('disk-usage-pending');
            rerender(<DiagnosticsModal isOpen={false} onClose={vi.fn()} />);
            expect(clientLog).toHaveBeenCalledWith('diagnostics_disk_usage', { outcome: 'abandoned', phase: 'poll', count: 0 });
        });

        it('logs an abandoned poll when the panel unmounts while still calculating', async () => {
            vi.mocked(clientLog).mockClear();
            vi.stubGlobal('fetch', routeFetch(PENDING_DATA, [{ state: 'pending' }]));
            const { unmount } = render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
            await screen.findByTestId('disk-usage-pending');
            unmount();
            expect(clientLog).toHaveBeenCalledWith('diagnostics_disk_usage', { outcome: 'abandoned', phase: 'poll', count: 0 });
        });

        it('does not log abandoned when the Refresh response makes disk usage ready', async () => {
            vi.mocked(clientLog).mockClear();
            let summary: unknown = PENDING_DATA;
            const fetchMock = vi.fn((url: string) =>
                url.startsWith('/api/diagnostics/disk-usage') ? ok({ state: 'pending' }) : ok(summary),
            );
            vi.stubGlobal('fetch', fetchMock);
            render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
            await screen.findByTestId('disk-usage-pending');
            summary = { ...DATA, disk_usage: READY_USAGE };
            fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
            expect(await screen.findByText('2.0 GB')).toBeInTheDocument();
            expect(clientLog).toHaveBeenCalledWith('diagnostics_disk_usage', { outcome: 'ready', phase: 'refresh' });
            expect(clientLog).not.toHaveBeenCalledWith('diagnostics_disk_usage', expect.objectContaining({ outcome: 'abandoned' }));
        });

        it('Refresh asks the backend to recompute disk usage', async () => {
            vi.mocked(clientLog).mockClear();
            const fetchMock = routeFetch(DATA, [READY_USAGE]);
            vi.stubGlobal('fetch', fetchMock);
            render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
            await screen.findByText(/2026 - INFO - ok/);
            expect(fetchMock).toHaveBeenCalledWith('/api/diagnostics');
            fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
            await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/diagnostics?refresh_disk_usage=true'));
            await waitFor(() => expect(clientLog).toHaveBeenCalledWith('diagnostics_disk_usage', { outcome: 'ready', phase: 'refresh' }));
        });

        it.each(Object.entries({ en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue }))('%s has the disk usage strings', (_code, data) => {
            const section = (data as unknown as Record<string, Record<string, unknown>>).diagnostics;
            expect(section?.diskUsageCalculating).toBeTruthy();
            expect(section?.diskUsageFailed).toBeTruthy();
        });
    });
});
