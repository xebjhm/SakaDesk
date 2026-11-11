import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import i18n from '../../i18n';
import { server } from '../../__tests__/mocks/server';
import { resetUpgradeStoreForTests } from '../../core/upgrade/upgradeStore';
import { useAppStore } from '../../store/appStore';
import { clientLog } from '../../utils/clientLog';
import { SettingsModal } from './SettingsModal';
import type { AppSettings } from '../../features/messages/MessagesFeature';

// The Sync tab's thumbnail cache row (media pipeline M4): the size from
// /api/media/status, a progress line while the worker prepares thumbnails,
// and Clear (DELETE /api/media/cache, then a toast).

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

const base: AppSettings = {
    output_dir: '/out', auto_sync_enabled: true, adaptive_sync_enabled: false, sync_interval_minutes: 10, is_configured: true,
};

type Status = {
    state: string;
    paused_reason: string | null;
    thumbs_full: boolean;
    services: Record<string, { done: number; total: number }>;
    cache: { thumbs_bytes: number; posters_bytes: number; thumbs_cap: number; posters_cap: number };
};

function status(over: Partial<Status> = {}): Status {
    return {
        state: 'idle',
        paused_reason: null,
        thumbs_full: false,
        services: {},
        cache: { thumbs_bytes: 0, posters_bytes: 0, thumbs_cap: 1073741824, posters_cap: 268435456 },
        ...over,
    };
}

function serveStatus(...answers: Status[]) {
    let i = 0;
    const seen: number[] = [];
    server.use(http.get('/api/media/status', () => {
        seen.push(i);
        const body = answers[Math.min(i, answers.length - 1)];
        i += 1;
        return HttpResponse.json(body);
    }));
    return seen;
}

function renderModal() {
    render(
        <SettingsModal appSettings={base} outputDirInput="/out" setOutputDirInput={() => {}}
            onSaveSettings={vi.fn().mockResolvedValue(true)} onClose={() => {}} activeService="hinatazaka46"
            onVerifyAndFix={() => {}} onDeepResync={() => {}} />,
    );
}

const openSync = () => fireEvent.click(screen.getByRole('button', { name: 'Sync', exact: true } as never));

beforeEach(() => {
    resetUpgradeStoreForTests();
    vi.mocked(clientLog).mockClear();
    useAppStore.setState({ selectedServices: [] });
});

describe('thumbnail cache row', () => {
    it('shows the cache size (thumbnails + posters)', async () => {
        serveStatus(status({ cache: { thumbs_bytes: 300 * 1024 * 1024, posters_bytes: 12 * 1024 * 1024, thumbs_cap: 1, posters_cap: 1 } }));
        renderModal();
        openSync();
        expect(screen.getByText('Thumbnail cache')).toBeInTheDocument();
        expect(await screen.findByText('312 MB used')).toBeInTheDocument();
        expect(screen.queryByText(/Preparing thumbnails/)).toBeNull();
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_media_cache', outcome: 'ok' }));
    });

    it('does not ask before the Sync tab opens', async () => {
        const seen = serveStatus(status());
        renderModal();
        await act(async () => { await Promise.resolve(); });
        expect(seen).toEqual([]);
    });

    it('shows a loading line while the size loads', async () => {
        let release: () => void = () => {};
        server.use(http.get('/api/media/status', async () => {
            await new Promise<void>(r => { release = r; });
            return HttpResponse.json(status());
        }));
        renderModal();
        openSync();
        expect(await screen.findByTestId('media-cache-loading')).toBeInTheDocument();
        await act(async () => { release(); });
        await waitFor(() => expect(screen.queryByTestId('media-cache-loading')).toBeNull());
    });

    it('shows the preparing line while the worker runs, a quiet paused line while it pauses, and polls until idle', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            serveStatus(
                status({ state: 'running', services: { hinatazaka46: { done: 100, total: 400 }, sakurazaka46: { done: 20, total: 100 } } }),
                status({ state: 'paused', paused_reason: 'sync', services: { hinatazaka46: { done: 300, total: 400 }, sakurazaka46: { done: 20, total: 100 } } }),
                status({ state: 'idle', services: { hinatazaka46: { done: 400, total: 400 }, sakurazaka46: { done: 100, total: 100 } } }),
            );
            renderModal();
            openSync();
            const running = await screen.findByText('Preparing thumbnails… 120 / 500');
            expect(running.querySelector('[data-spinner]')).not.toBeNull();
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            // Paused (here for a sync): says so, with no spinner, so it never looks frozen.
            const paused = await screen.findByText('Thumbnail preparation paused · 320 / 500');
            expect(paused.querySelector('[data-spinner]')).toBeNull();
            expect(screen.queryByText(/Preparing thumbnails/)).toBeNull();
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            await waitFor(() => expect(screen.queryByText(/Preparing thumbnails|preparation paused/)).toBeNull());
        } finally {
            vi.useRealTimers();
        }
    });

    it('a running worker with nothing counted yet shows no progress line', async () => {
        serveStatus(status({ state: 'running', services: {} }));
        renderModal();
        openSync();
        expect(await screen.findByText('0 B used')).toBeInTheDocument();
        expect(screen.queryByText(/Preparing thumbnails/)).toBeNull();
    });

    it('Clear calls DELETE, shows the toast and reloads the size', async () => {
        const seen = serveStatus(
            status({ cache: { thumbs_bytes: 2048, posters_bytes: 0, thumbs_cap: 1, posters_cap: 1 } }),
            status(),
        );
        const deletes: string[] = [];
        server.use(http.delete('/api/media/cache', ({ request }) => {
            deletes.push(request.method);
            return HttpResponse.json({ freed_bytes: 2048 });
        }));
        renderModal();
        openSync();
        expect(await screen.findByText('2 KB used')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(await screen.findByRole('status')).toHaveTextContent('Thumbnail cache cleared');
        expect(deletes).toEqual(['DELETE']);
        expect(await screen.findByText('0 B used')).toBeInTheDocument();
        expect(seen.length).toBe(2);
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_media_clean', outcome: 'ok' }));
    });

    it('a failed status read shows no size and logs the error', async () => {
        server.use(http.get('/api/media/status', () => new HttpResponse(null, { status: 500 })));
        renderModal();
        openSync();
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_media_cache', outcome: 'error' }));
        expect(screen.queryByText(/used$/)).toBeNull();
        expect(screen.getByText("Couldn't read the cache size")).toBeInTheDocument();
    });

    it('a failed clear shows no toast and logs the error', async () => {
        serveStatus(status());
        server.use(http.delete('/api/media/cache', () => new HttpResponse(null, { status: 500 })));
        renderModal();
        openSync();
        await screen.findByText('0 B used');
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_media_clean', outcome: 'error' }));
        expect(screen.queryByText('Thumbnail cache cleared')).toBeNull();
        expect(screen.getByText("Couldn't clear the thumbnail cache")).toBeInTheDocument();
        // a later successful clear removes the message
        server.use(http.delete('/api/media/cache', () => HttpResponse.json({ freed_bytes: 0 })));
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        await waitFor(() => expect(screen.queryByText("Couldn't clear the thumbnail cache")).toBeNull());
    });

    it('a full cache shows the at-capacity line instead of progress, and stops polling when idle', async () => {
        const seen = serveStatus(status({
            state: 'idle', thumbs_full: true,
            services: { hinatazaka46: { done: 100, total: 400 } },
            cache: { thumbs_bytes: 900 * 1024 * 1024, posters_bytes: 0, thumbs_cap: 1, posters_cap: 1 },
        }));
        renderModal();
        openSync();
        expect(await screen.findByTestId('media-cache-full')).toHaveTextContent('Full. Older thumbnails are replaced as you browse');
        expect(screen.queryByText(/Preparing thumbnails/)).toBeNull();
        expect(seen.length).toBe(1);
    });

    it('a full cache never shows progress, even while placeholders are still being made', async () => {
        serveStatus(status({ state: 'running', thumbs_full: true, services: { hinatazaka46: { done: 1, total: 9 } } }));
        renderModal();
        openSync();
        expect(await screen.findByTestId('media-cache-full')).toBeInTheDocument();
        expect(screen.queryByText(/Preparing thumbnails/)).toBeNull();
    });

    it('a status without the full flag reads as not full', async () => {
        const body = status({ state: 'running', services: { hinatazaka46: { done: 1, total: 2 } } }) as Partial<Status>;
        delete body.thumbs_full;
        server.use(http.get('/api/media/status', () => HttpResponse.json(body)));
        renderModal();
        openSync();
        expect(await screen.findByText('Preparing thumbnails… 1 / 2')).toBeInTheDocument();
        expect(screen.queryByTestId('media-cache-full')).toBeNull();
    });

    it('uses the Japanese wording', async () => {
        await i18n.changeLanguage('ja');
        try {
            serveStatus(status({ state: 'running', services: { hinatazaka46: { done: 1, total: 2 } } }));
            renderModal();
            fireEvent.click(screen.getByRole('button', { name: '同期', exact: true } as never));
            expect(screen.getByText('サムネイルキャッシュ')).toBeInTheDocument();
            expect(await screen.findByText('サムネイルを準備中… 1 / 2')).toBeInTheDocument();
            expect(screen.getByText('0 B 使用中')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: '削除' })).toBeInTheDocument();
        } finally {
            await i18n.changeLanguage('en');
        }
    });
});
