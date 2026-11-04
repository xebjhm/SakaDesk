import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiagnosticsModal } from './DiagnosticsModal';

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
    it('loads the diagnostics and shows the system block and logs', async () => {
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        expect(await screen.findByText('Developer Diagnostics')).toBeInTheDocument();
        expect(await screen.findByText(/2026 - INFO - ok/)).toBeInTheDocument();
        expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/diagnostics');
    });
});
