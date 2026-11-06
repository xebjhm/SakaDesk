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
    it('is a brand dialog whose header note sits on a white pill', async () => {
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        const dialog = await screen.findByRole('dialog', { name: 'Developer Diagnostics' });
        expect(dialog).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByText('Hidden Panel')).toHaveClass('bg-sheet', 'text-secondary');
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
