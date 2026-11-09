import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { UpgradeIcon } from './UpgradeIcon';

// 0.4.1: the 0.3.4 → 0.4.0 upgrade broke because a click on the ring while
// downloading cancelled, and auto-download then started a second download
// into the same installer file.
type Call = { url: string; method: string };

function mockBackend(calls: Call[]) {
    return vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? 'GET' });
        const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
        if (url === '/api/settings') return json({ auto_download_updates: true });
        if (url === '/api/version') {
            return json({
                current_version: '0.4.0', latest_version: '0.4.1', update_available: true,
                release_url: null, release_notes: null, error: null, upgrade_supported: true,
            });
        }
        if (url === '/api/version/upgrade/start') return json({ success: true, version: '0.4.1' });
        if (url === '/api/version/upgrade/status') return json({ state: 'downloading', progress: 40, error: null, version: '0.4.1' });
        if (url === '/api/version/upgrade/cancel') return json({ success: true });
        return json({});
    });
}

describe('UpgradeIcon while downloading', () => {
    let calls: Call[];
    beforeEach(() => {
        calls = [];
        vi.stubGlobal('fetch', mockBackend(calls));
    });
    afterEach(() => vi.unstubAllGlobals());

    const starts = () => calls.filter((c) => c.url === '/api/version/upgrade/start').length;
    const cancels = () => calls.filter((c) => c.url === '/api/version/upgrade/cancel').length;

    it('ignores a click on the ring (no cancel, no second download)', async () => {
        render(<UpgradeIcon />);
        await waitFor(() => expect(starts()).toBe(1));
        const ring = await screen.findByTitle(/0\.4\.1/);
        fireEvent.click(ring);
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(cancels()).toBe(0);
        expect(starts()).toBe(1);
    });

    it('cancels from the hover × and does not auto-start again', async () => {
        render(<UpgradeIcon />);
        await waitFor(() => expect(starts()).toBe(1));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel download' }));
        await waitFor(() => expect(cancels()).toBe(1));
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(starts()).toBe(1);
    });
});
