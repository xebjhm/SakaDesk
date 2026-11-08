import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DiagnosticsModal } from './DiagnosticsModal';

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
    logs: { recent: ['2026 - INFO - ok'], errors: [], warnings: [] },
};

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
});
