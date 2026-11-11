import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import i18n from '../../../i18n';
import { server } from '../../../__tests__/mocks/server';
import { installMediaTileHarness, type MediaTileHarness } from '../../../__tests__/mediaTileHarness';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return {
        ...real,
        fetchAlbumMembers: vi.fn(),
        fetchAlbumMonths: vi.fn(),
        fetchAlbumMonth: vi.fn(),
        fetchAlbumColors: vi.fn(),
    };
});
import { clientLog } from '../../../utils/clientLog';
import { fetchAlbumColors, fetchAlbumMembers, fetchAlbumMonth, fetchAlbumMonths } from '../api';
import { NicknameProvider } from '../shared/useNickname';
import type { AlbumMonthPayload } from '../types';
import { AlbumPage } from './AlbumPage';
import { colorsPayload, membersPayload, monthPayload, monthsPayload, monthSummary, photo } from './__fixtures__';

/**
 * The album on the shared media tile (media pipeline M8): one meta batch per loaded month, the
 * `media_grid` breadcrumb, the pre-generation progress line, ★ / cover thumbnail sizes and a
 * failed tile whose click retries.
 */

/** Distinct ids per month (the fixture's media URLs do not carry the month). */
const ID_BASE: Record<string, number> = { '2026-10': 10, '2022-05': 20 };
function distinctMonth(month: string): AlbumMonthPayload {
    const base = ID_BASE[month] ?? 30;
    const items = monthPayload(month).items.map((item) => {
        const id = base + item.id;
        const url = item.media_url?.replace(/\/(\d+)\.(jpg|mp4)$/, `/${id}.$2`) ?? null;
        return { ...item, id, media_url: url };
    });
    return monthPayload(month, { items, bursts: [{ burst_id: base, room: items[0].room, ids: [base + 3, base + 4, base + 5] }] });
}
const urlsOf = (month: string) => distinctMonth(month).items.map((i) => i.media_url!);

const originalDpr = window.devicePixelRatio;
let h: MediaTileHarness;

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    server.use(http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })));
    h = installMediaTileHarness();
    vi.mocked(clientLog).mockClear();
    vi.mocked(fetchAlbumMembers).mockReset().mockResolvedValue(membersPayload());
    vi.mocked(fetchAlbumMonths).mockReset().mockResolvedValue(monthsPayload([
        monthSummary('2026-10', { cover: photo(91, '2026-10', { caption: 'あの日' }) }),
        monthSummary('2022-05', { cover: photo(92, '2022-05'), cover_color: null }),
    ]));
    vi.mocked(fetchAlbumMonth).mockReset().mockImplementation(async (_s, month) => distinctMonth(month));
    vi.mocked(fetchAlbumColors).mockReset().mockResolvedValue(colorsPayload());
});
afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'devicePixelRatio', { value: originalDpr, configurable: true });
});

const renderAlbum = () => render(
    <NicknameProvider nickname="みーぱん">
        <AlbumPage service="hinatazaka46" route={{ page: 'album' }} go={vi.fn()} />
    </NicknameProvider>,
);

/** Settle every load the scheduler starts (at most four run at once) until none is left. */
async function loadAll() {
    for (let round = 0; round < 12; round += 1) {
        await h.load();
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    }
}

describe('AlbumPage on the shared media tile', () => {
    it('primes the meta store with one batch per loaded month', async () => {
        let releaseOld: (() => void) | null = null;
        vi.mocked(fetchAlbumMonth).mockImplementation((_s, month) => (month === '2022-05'
            ? new Promise((resolve) => { releaseOld = () => resolve(distinctMonth(month)); })
            : Promise.resolve(distinctMonth(month))));
        renderAlbum();
        await screen.findByTestId('album-grid');
        const recent = new Set(urlsOf('2026-10'));
        // The month's media go out together in one batch (its 16 ms flush may also carry the covers:
        // the first grid can now land within the covers' flush).
        await waitFor(() => expect(h.metaBatches.some((b) => [...recent].every((u) => b.includes(u)))).toBe(true));
        // the burst's hidden frames are primed too (only the first is drawn)
        expect(h.metaBatches.flat()).toContain(urlsOf('2026-10')[4]);

        await waitFor(() => expect(releaseOld).not.toBeNull());
        const before = h.metaBatches.length;
        act(() => releaseOld!());
        const old = new Set(urlsOf('2022-05'));
        await waitFor(() => expect(h.metaBatches.length).toBe(before + 1));
        expect(new Set(h.metaBatches[before])).toEqual(old);
        // no URL is ever sent twice
        const all = h.metaBatches.flat();
        expect(new Set(all).size).toBe(all.length);
    });

    it('logs the media_grid first-paint breadcrumb once per page mount', async () => {
        renderAlbum();
        await screen.findByTestId('album-grid');
        await waitFor(() => expect(h.requested().length).toBeGreaterThan(0));
        await loadAll();
        const crumbs = () => vi.mocked(clientLog).mock.calls.filter(([event]) => event === 'media_grid');
        await waitFor(() => expect(crumbs()).toHaveLength(1));
        expect(crumbs()[0][1]).toEqual({ grid: 'album', first_tile_ms: expect.any(Number), visible: expect.any(Number), count: 8 });
        // switching the filter remounts the grid, not the page: no second breadcrumb
        await userEvent.click(screen.getByRole('button', { name: 'Photos' }));
        await loadAll();
        expect(crumbs()).toHaveLength(1);
    });

    it('shows the quiet "Preparing thumbnails" line while pre-generation runs, and its paused form', async () => {
        let state: 'running' | 'paused' = 'running';
        server.use(http.get('/api/media/status', () => HttpResponse.json({
            state, paused_reason: state === 'paused' ? 'foreground' : null, thumbs_full: false,
            services: { hinatazaka46: { done: 3, total: 10 } },
        })));
        const first = renderAlbum();
        expect(await screen.findByText('Preparing thumbnails… 3 / 10')).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
        // logged as the album's own Memories code, never as the gallery dialog's
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_load', { target: 'album_pregen', outcome: 'ok' });
        expect(vi.mocked(clientLog).mock.calls.some(([event]) => event === 'dialog_load')).toBe(false);
        first.unmount();

        state = 'paused';
        renderAlbum();
        expect(await screen.findByText('Thumbnail preparation paused · 3 / 10')).toBeInTheDocument();
    });

    it('shows no progress line when the worker is idle', async () => {
        renderAlbum();
        await screen.findByTestId('album-grid');
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(screen.queryByText(/Preparing thumbnails/)).toBeNull();
        expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('asks for 640 on ★ and cover tiles and at most 480 on the others', async () => {
        // A wide grid (six 260 px columns) on a dense screen: every tile would want more than 480.
        class WideObserver {
            constructor(private cb: ResizeObserverCallback) {}
            observe(target: Element) {
                this.cb([{ target, contentRect: { width: 1600 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
            }
            unobserve() {}
            disconnect() {}
        }
        vi.stubGlobal('ResizeObserver', WideObserver);
        Object.defineProperty(window, 'devicePixelRatio', { value: 4, configurable: true });
        renderAlbum();
        await screen.findByTestId('album-grid');
        await waitFor(() => expect(h.requested().length).toBeGreaterThan(0));
        await loadAll();
        const widthOf = (id: number) => {
            const src = h.requested().find((s) => s.includes(`/picture/${id}.jpg`));
            return src ? Number(/[?&]w=(\d+)/.exec(src)![1]) : undefined;
        };
        expect(widthOf(91)).toBe(640); // the month cover
        expect(widthOf(12)).toBe(640); // the ★ tile (pinned 2×2)
        expect(widthOf(11)).toBe(480); // an ordinary tile
        expect(widthOf(13)).toBe(480); // the burst stack's still
        const ordinary = h.requested().filter((s) => !/\/(91|92|12|22)\.jpg/.test(s));
        expect(ordinary.length).toBeGreaterThan(0);
        expect(ordinary.every((s) => Number(/[?&]w=(\d+)/.exec(s)![1]) <= 480)).toBe(true);
    });

    it('a failed tile retries on click instead of opening the viewer', async () => {
        renderAlbum();
        const grid = await screen.findByTestId('album-grid');
        const tile = within(grid).getByTestId('album-tile-11');
        expect(tile).toHaveAccessibleName('おはよう');
        const tileSrcs = () => h.requested().filter((s) => s.includes('/picture/11.jpg'));
        // thumbnail, then the full file: both fail (the other tiles load, freeing the slots)
        const others = /^(?!.*\/picture\/11\.jpg)/;
        for (let i = 1; i <= 2; i += 1) {
            await waitFor(async () => {
                await h.load(others);
                expect(tileSrcs()).toHaveLength(i);
            });
            await h.fail('/picture/11.jpg');
        }
        await waitFor(() => expect(within(tile).getByTestId('memory-thumb')).toHaveAttribute('data-state', 'failed'));
        expect(tile).toHaveAccessibleName('Retry loading: おはよう');
        await userEvent.click(tile);
        expect(screen.queryByRole('dialog')).toBeNull();
        await waitFor(async () => {
            await h.load(others);
            expect(tileSrcs()).toHaveLength(3);
        });
        expect(tile).toHaveAccessibleName('おはよう');
    });
});
