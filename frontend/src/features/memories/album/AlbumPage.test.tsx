import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import i18n from '../../../i18n';
import { server } from '../../../__tests__/mocks/server';

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
import { openChat } from '../../../shell/openChat';
import { fetchAlbumColors, fetchAlbumMembers, fetchAlbumMonth, fetchAlbumMonths } from '../api';
import { NicknameProvider } from '../shared/useNickname';
import type { MemoriesRoute } from '../MemoriesFeature';
import { AlbumPage } from './AlbumPage';
import {
    colorsPayload, MEMBER_PATH, membersPayload, monthPayload, monthsPayload, monthSummary, NAO_PATH,
} from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    // The media viewer asks for transcripts of what it shows.
    server.use(http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T03:00:00Z'));
    vi.mocked(clientLog).mockClear();
    vi.mocked(openChat).mockClear();
    vi.mocked(fetchAlbumMembers).mockReset().mockResolvedValue(membersPayload());
    vi.mocked(fetchAlbumMonths).mockReset().mockResolvedValue(monthsPayload());
    vi.mocked(fetchAlbumMonth).mockReset().mockImplementation(async (_s, month) => monthPayload(month));
    vi.mocked(fetchAlbumColors).mockReset().mockResolvedValue(colorsPayload());
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

type AlbumRoute = Extract<MemoriesRoute, { page: 'album' }>;

function renderAlbum(route: AlbumRoute = { page: 'album' }) {
    const go = vi.fn();
    const utils = render(
        <NicknameProvider nickname="みーぱん">
            <AlbumPage service="hinatazaka46" route={route} go={go} />
        </NicknameProvider>,
    );
    const rerender = (next: AlbumRoute) => utils.rerender(
        <NicknameProvider nickname="みーぱん">
            <AlbumPage service="hinatazaka46" route={next} go={go} />
        </NicknameProvider>,
    );
    return { go, rerender };
}

const section = (month: string) => screen.getByTestId(`album-month-${month}`);

/** A controllable IntersectionObserver: `fire(month)` reports that section near the viewport. */
function stubObserver() {
    const observers: { cb: IntersectionObserverCallback; els: Set<Element> }[] = [];
    class FakeObserver {
        els = new Set<Element>();
        constructor(public cb: IntersectionObserverCallback) { observers.push(this); }
        observe(el: Element) { this.els.add(el); }
        unobserve(el: Element) { this.els.delete(el); }
        disconnect() { this.els.clear(); }
        takeRecords() { return []; }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    return (month: string) => act(() => {
        for (const o of observers) {
            const el = [...o.els].find((e) => e.getAttribute('data-month') === month);
            if (el) o.cb([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], o as unknown as IntersectionObserver);
        }
    });
}

describe('AlbumPage', () => {
    it('lists everyone with counts and refetches the months for a picked member', async () => {
        const { go, rerender } = renderAlbum();
        const all = await screen.findByRole('button', { name: /Everyone/ });
        expect(all).toHaveTextContent('12');
        expect(screen.getByRole('button', { name: /小坂 菜緒/ })).toHaveTextContent('3');
        await waitFor(() => expect(fetchAlbumMonths).toHaveBeenCalledWith('hinatazaka46', { member: undefined, kind: 'all' }, expect.anything()));

        await userEvent.click(screen.getByRole('button', { name: /小坂 菜緒/ }));
        expect(go).toHaveBeenCalledWith({ page: 'album', memberPath: NAO_PATH });
        rerender({ page: 'album', memberPath: NAO_PATH });
        await waitFor(() => expect(fetchAlbumMonths).toHaveBeenLastCalledWith('hinatazaka46', { member: NAO_PATH, kind: 'all' }, expect.anything()));
        expect(fetchAlbumColors).toHaveBeenLastCalledWith('hinatazaka46', NAO_PATH, expect.anything());
        expect(screen.getByRole('button', { name: /小坂 菜緒/ })).toHaveAttribute('aria-current', 'true');
    });

    it('never shows a 0 and shows the empty state when there is nothing', async () => {
        vi.mocked(fetchAlbumMembers).mockResolvedValue(membersPayload({ total: 0, members: [] }));
        vi.mocked(fetchAlbumMonths).mockResolvedValue(monthsPayload([]));
        renderAlbum();
        expect(await screen.findByText('There are no photos to lay out here yet.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Everyone/ })).not.toHaveTextContent('0');
    });

    it('passes the filter kind and gives the favourites pill the star tone', async () => {
        renderAlbum();
        await screen.findByTestId('album-month-2026-10');
        await userEvent.click(screen.getByRole('button', { name: 'Videos' }));
        await waitFor(() => expect(fetchAlbumMonths).toHaveBeenLastCalledWith('hinatazaka46', { member: undefined, kind: 'video' }, expect.anything()));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'album_filter', outcome: 'on', kind: 'video' });

        const fav = screen.getByRole('button', { name: 'Favorites' });
        await userEvent.click(fav);
        await waitFor(() => expect(fetchAlbumMonths).toHaveBeenLastCalledWith('hinatazaka46', { member: undefined, kind: 'favorite' }, expect.anything()));
        expect(fav).toHaveAttribute('aria-pressed', 'true');
        expect(fav).not.toHaveClass('bg-accent-subtle', 'text-accent-strong', 'ring-accent-border');
        expect(fav).toHaveClass('ring-strong');
        expect(fav.querySelector('svg')).toHaveClass('text-semantic-star');
        await userEvent.click(screen.getByRole('button', { name: 'Photos' }));
        await waitFor(() => expect(fetchAlbumMonths).toHaveBeenLastCalledWith('hinatazaka46', { member: undefined, kind: 'picture' }, expect.anything()));
        await userEvent.click(screen.getByRole('button', { name: 'All' }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'album_filter', outcome: 'off', kind: 'all' });
    });

    it('loads month sections lazily as they near the viewport', async () => {
        const fire = stubObserver();
        renderAlbum();
        await screen.findByTestId('album-month-2026-10');
        expect(fetchAlbumMonth).not.toHaveBeenCalled();
        fire('2022-05');
        await waitFor(() => expect(fetchAlbumMonth).toHaveBeenCalledTimes(1));
        expect(fetchAlbumMonth).toHaveBeenCalledWith('hinatazaka46', '2022-05', { member: undefined, kind: 'all' }, expect.anything());
        fire('2022-05');
        fire('2026-10');
        await waitFor(() => expect(fetchAlbumMonth).toHaveBeenCalledTimes(2));
    });

    it('loads the sections in order without an IntersectionObserver', async () => {
        renderAlbum();
        await waitFor(() => expect(fetchAlbumMonth).toHaveBeenCalledTimes(2));
        expect(vi.mocked(fetchAlbumMonth).mock.calls.map((c) => c[1])).toEqual(['2026-10', '2022-05']);
    });

    it('draws the polaroid cover with her words through MemoryText, the tint and sepia', async () => {
        renderAlbum();
        const recent = await screen.findByTestId('album-month-2026-10');
        const cover = within(recent).getByTestId('album-polaroid');
        expect(cover).toHaveClass('bg-memories-paper', 'shadow-memories-polaroid');
        expect(within(cover).getByTestId('memory-text')).toHaveTextContent('あの日の空、みーぱんにも見せたかった');
        expect(within(cover).getByTestId('memory-text')).toHaveAttribute('lang', 'ja');
        expect(recent.style.backgroundColor).toContain('color-mix');
        expect(recent.style.backgroundColor).toContain('coral');
        expect(cover.querySelector('img')!.className).not.toContain('sepia-memories');

        const old = section('2022-05');
        // a null colour falls back to the neutral band
        expect(old.style.backgroundColor).toBe('');
        expect(old).toHaveClass('bg-sunken');
        expect(within(old).getByTestId('album-polaroid').querySelector('img')).toHaveClass('sepia-memories-3');
    });

    it('labels a cover without words with the month only', async () => {
        vi.mocked(fetchAlbumMonths).mockResolvedValue(monthsPayload([
            monthSummary('2026-10', { cover: monthSummary('2026-10').cover && { ...monthSummary('2026-10').cover, caption: null, text: null } }),
        ]));
        renderAlbum();
        const cover = within(await screen.findByTestId('album-month-2026-10')).getByTestId('album-polaroid');
        expect(within(cover).queryByTestId('memory-text')).toBeNull();
        expect(cover).toHaveTextContent('October 2026');
    });

    it('pins favourites larger with tape, stacks bursts and shows hover captions', async () => {
        renderAlbum();
        const recent = await screen.findByTestId('album-month-2026-10');
        const grid = await within(recent).findByTestId('album-grid');
        const fav = within(grid).getByTestId('album-tile-2');
        expect(fav).toHaveClass('col-span-2', 'row-span-2');
        expect(within(fav).getByTestId('album-washi')).toHaveClass('bg-memories-washi');
        expect(within(grid).getByTestId('album-tile-1')).not.toHaveClass('col-span-2');
        expect(within(grid).queryByTestId('album-washi-1')).toBeNull();
        // the burst 3-4-5 collapses to one stack
        expect(within(grid).queryByTestId('album-tile-4')).toBeNull();
        expect(within(grid).getByRole('button', { name: /3 photos/ })).toBeInTheDocument();
        // tiles are lazy images; a video is never an image
        const img = within(grid).getByTestId('album-tile-1').querySelector('img')!;
        expect(img).toHaveAttribute('loading', 'lazy');
        expect(img).toHaveAttribute('decoding', 'async');
        expect(within(grid).getByTestId('album-tile-6').querySelector('img')).toBeNull();
        expect(within(grid).getByTestId('album-tile-6').querySelector('video')).toHaveAttribute('preload', 'metadata');
        // her words within 3 minutes, as a frosted caption
        const caption = within(within(grid).getByTestId('album-tile-1')).getByTestId('album-hover-caption');
        expect(caption).toHaveClass('backdrop-blur-frost');
        expect(within(caption).getByTestId('memory-text')).toHaveTextContent('おはよう');
        expect(within(within(grid).getByTestId('album-tile-6')).queryByTestId('album-hover-caption')).toBeNull();
    });

    it('opens a burst sequence', async () => {
        renderAlbum();
        const grid = await within(await screen.findByTestId('album-month-2026-10')).findByTestId('album-grid');
        await userEvent.click(within(grid).getByRole('button', { name: /3 photos/ }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getAllByTestId('burst-frame')).toHaveLength(3);
    });

    it('opens the media viewer at the clicked tile and jumps to her chat', async () => {
        renderAlbum();
        const grid = await within(await screen.findByTestId('album-month-2026-10')).findByTestId('album-grid');
        await userEvent.click(within(grid).getByTestId('album-tile-6'));
        const viewer = await screen.findByRole('dialog');
        // six viewable items, the video is the sixth (oldest first)
        expect(within(viewer).getByText('6 / 6')).toBeInTheDocument();
        await userEvent.click(within(viewer).getByText('View in chat'));
        expect(vi.mocked(openChat)).toHaveBeenCalledWith(expect.objectContaining({
            service: 'hinatazaka46', path: MEMBER_PATH, name: '金村 美玖', message_id: 6, is_group_chat: false,
        }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_jump', { target: 'album', has_target: true });
    });

    it('scrolls the grid to a month from the ribbon by click and keyboard', async () => {
        const calls: string[] = [];
        const scrollIntoView = vi.fn(function (this: Element) { calls.push(this.getAttribute('data-month') ?? ''); });
        Element.prototype.scrollIntoView = scrollIntoView;
        renderAlbum();
        await screen.findByTestId('album-month-2026-10');
        const ribbon = await screen.findByTestId('album-ribbon');
        await userEvent.click(within(ribbon).getByRole('button', { name: 'Go to May 2022' }));
        expect(calls[calls.length - 1]).toBe('2022-05');
        const seg = within(ribbon).getByRole('button', { name: 'Go to May 2022' });
        seg.focus();
        await userEvent.keyboard('{ArrowUp}');
        expect(calls[calls.length - 1]).toBe('2026-10');
        // the ribbon colours: null falls back
        expect(within(ribbon).getByRole('button', { name: 'Go to October 2026' }).style.backgroundColor).toBe('coral');
        expect(seg.style.backgroundColor).toBe('');
    });
});
