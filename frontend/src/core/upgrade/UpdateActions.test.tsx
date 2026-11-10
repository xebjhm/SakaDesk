import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18n from '../../i18n';
import { UpdateActions } from './UpdateActions';
import { useUpgradeStore, resetUpgradeStoreForTests, type VersionInfo } from './upgradeStore';

const INFO: VersionInfo = {
    current_version: '0.4.1', latest_version: '0.4.2', update_available: true,
    release_url: 'https://github.com/xebjhm/SakaDesk/releases/tag/v0.4.2', release_notes: null, error: null,
    upgrade_supported: true,
};

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('UpdateActions (Settings → Updates)', () => {
    let calls: string[];
    beforeEach(() => {
        calls = [];
        resetUpgradeStoreForTests();
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            calls.push(`${init?.method ?? 'GET'} ${url}`);
            const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
            if (url === '/api/version/upgrade/start') return json({ success: true, version: '0.4.2' });
            if (url === '/api/version/upgrade/status') return json({ state: 'downloading', progress: 30, error: null, version: '0.4.2' });
            if (url === '/api/version/upgrade/cancel') return json({ success: true });
            if (url === '/api/version/upgrade/install') return json({ success: true });
            return json({});
        }));
    });
    afterEach(() => { vi.unstubAllGlobals(); resetUpgradeStoreForTests(); });

    it('renders nothing when up to date', () => {
        useUpgradeStore.setState({ versionInfo: { ...INFO, update_available: false } });
        const { container } = render(<UpdateActions />);
        expect(container).toBeEmptyDOMElement();
    });

    it('offers Download even for a version skipped on the rail, then shows progress and Cancel', async () => {
        useUpgradeStore.setState({ versionInfo: INFO, dismissed: true });
        render(<UpdateActions />);
        expect(screen.getByText('Update available! v0.4.2')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Download update' }));
        await waitFor(() => expect(calls).toContain('POST /api/version/upgrade/start'));
        expect(await screen.findByRole('progressbar')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));
        await waitFor(() => expect(calls).toContain('POST /api/version/upgrade/cancel'));
        // Back to "available"; the cancel also stops auto-download for this session.
        expect(await screen.findByRole('button', { name: 'Download update' })).toBeInTheDocument();
        expect(useUpgradeStore.getState().autoDownloadTriggered).toBe(true);
    });

    it('shows Install now with the restart hint when ready', async () => {
        useUpgradeStore.setState({ versionInfo: INFO, status: { state: 'ready', progress: 100, error: null, version: '0.4.2' } });
        render(<UpdateActions />);
        expect(screen.getByText(/closes and reopens/)).toBeInTheDocument();
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        const close = vi.spyOn(window, 'close').mockImplementation(() => {});
        fireEvent.click(screen.getByRole('button', { name: 'Install Now' }));
        await vi.waitFor(() => expect(calls).toContain('POST /api/version/upgrade/install'));
        vi.useRealTimers();
        close.mockRestore();
    });

    it('shows the error and retries (cancel, then start)', async () => {
        useUpgradeStore.setState({ versionInfo: INFO, status: { state: 'error', progress: 0, error: 'boom', version: '0.4.2' } });
        render(<UpdateActions />);
        expect(screen.getByText('Upgrade failed: boom')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(calls.slice(-2)).toEqual(['POST /api/version/upgrade/cancel', 'POST /api/version/upgrade/start']));
    });

    it('offers the download page where in-place upgrade is unsupported', () => {
        useUpgradeStore.setState({ versionInfo: { ...INFO, upgrade_supported: false } });
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        render(<UpdateActions />);
        fireEvent.click(screen.getByRole('button', { name: 'Open download page' }));
        expect(open).toHaveBeenCalledWith(INFO.release_url, '_blank');
        open.mockRestore();
    });
});
