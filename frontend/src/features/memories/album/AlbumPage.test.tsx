import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
        putAlbumCover: vi.fn(),
        deleteAlbumCover: vi.fn(),
    };
});
import { clientLog } from '../../../utils/clientLog';
import { openChat } from '../../../shell/openChat';
import {
    deleteAlbumCover, fetchAlbumColors, fetchAlbumMembers, fetchAlbumMonth, fetchAlbumMonths, MemoriesFetchError, MemoriesTimeoutError, putAlbumCover,
} from '../api';
import { NicknameProvider } from '../shared/useNickname';
import type { MemoriesRoute } from '../MemoriesFeature';
import { AlbumPage } from './AlbumPage';
import { ALBUM_GRID_COLS } from './MonthSection';
import { MEMBER_PANE_WIDTH } from '../shared/MemberPane';
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
    vi.mocked(putAlbumCover).mockReset().mockResolvedValue(undefined);
    vi.mocked(deleteAlbumCover).mockReset().mockResolvedValue(undefined);
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

/**
 * A controllable IntersectionObserver: `fire(month)` reports that band near the viewport to every
 * observer (the load and the live margin alike), `leave(month)` reports it gone.
 */
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
    const report = (month: string, hit: boolean) => act(() => {
        for (const o of observers) {
            const el = [...o.els].find((e) => e.getAttribute('data-month') === month);
            if (el) o.cb([{ target: el, isIntersecting: hit } as unknown as IntersectionObserverEntry], o as unknown as IntersectionObserver);
        }
    });
    const fire = (month: string) => report(month, true);
    const leave = (month: string) => report(month, false);
    return Object.assign(fire, { leave });
}

/** Records which band each `scrollIntoView` call targets (restored after the test). */
function spyScroll() {
    const calls: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
        calls.push(this.getAttribute('data-month') ?? '');
    });
    restoreScroll = () => { Element.prototype.scrollIntoView = original; };
    return calls;
}
let restoreScroll: (() => void) | null = null;
afterEach(() => { restoreScroll?.(); restoreScroll = null; });

const MANY = ['2026-10', '2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03'];

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

    it('stays usable at the smallest window: width-derived columns, a wrapping band, no sideways scroll (D4b)', async () => {
        renderAlbum();
        const recent = await screen.findByTestId('album-month-2026-10');
        const grid = await within(recent).findByTestId('album-grid');
        // Columns come from the grid's own width at a 6rem minimum tile, never from the window.
        expect(grid).toHaveClass(ALBUM_GRID_COLS);
        expect(grid.className).not.toMatch(/(^|\s)(\w+:)?grid-cols-\d/);
        // The band wraps the grid below the polaroid instead of squeezing it to nothing.
        expect(within(recent).getByTestId('album-band-row')).toHaveClass('flex-wrap');
        expect(within(recent).getByTestId('album-band-body')).toHaveClass('min-w-[12.5rem]');
        expect(screen.getByTestId('album-scroller')).toHaveClass('overflow-x-hidden');
        // The member pane yields width at a small window (no fixed w-60).
        const pane = screen.getByRole('navigation');
        expect(pane).toHaveClass(MEMBER_PANE_WIDTH);
        expect(pane).not.toHaveClass('w-60');
        // The burst badge is held inside its tile.
        expect(within(grid).getByTestId('burst-badge')).toHaveClass('max-w-[calc(100%-0.5rem)]', 'overflow-hidden');
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
        const calls = spyScroll();
        renderAlbum();
        await screen.findByTestId('album-month-2026-10');
        const ribbon = await screen.findByTestId('album-ribbon');
        await userEvent.click(within(ribbon).getByRole('button', { name: 'Go to May 2022' }));
        expect(calls[calls.length - 1]).toBe('2022-05');
        const seg = within(ribbon).getByRole('button', { name: 'Go to May 2022' });
        seg.focus();
        await userEvent.keyboard('{ArrowUp}');
        expect(calls[calls.length - 1]).toBe('2026-10');
        // jumps are instant, never an animated scroll through every band
        expect(vi.mocked(Element.prototype.scrollIntoView).mock.calls.every((c) => (c[0] as ScrollIntoViewOptions).behavior === 'auto')).toBe(true);
        // the ribbon colours: null falls back
        expect(within(ribbon).getByRole('button', { name: 'Go to October 2026' }).style.backgroundColor).toBe('coral');
        expect(seg.style.backgroundColor).toBe('');
    });

    it('a scrub across the ribbon loads only the months where it settles', async () => {
        spyScroll();
        const fire = stubObserver();
        vi.mocked(fetchAlbumMonths).mockResolvedValue(monthsPayload(MANY.map((m) => monthSummary(m))));
        renderAlbum();
        const ribbon = await screen.findByTestId('album-ribbon');
        const scroller = screen.getByTestId('album-scroller');
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        ribbon.getBoundingClientRect = () => ({ top: 0, height: 800, bottom: 800, left: 0, right: 12, width: 12, x: 0, y: 0, toJSON: () => ({}) });
        ribbon.setPointerCapture = vi.fn();
        fireEvent.pointerDown(ribbon, { clientY: 10, pointerId: 1 });
        // the scrub passes bands 0..6: each comes near, then goes as the grid scrolls on
        for (let i = 0; i < 7; i += 1) {
            fireEvent.pointerMove(ribbon, { clientY: i * 100 + 50, pointerId: 1 });
            fire(MANY[i]);
            fireEvent.scroll(scroller);
            if (i > 0) fire.leave(MANY[i - 1]);
            act(() => { vi.advanceTimersByTime(50); });
        }
        fireEvent.pointerUp(ribbon, { pointerId: 1 });
        expect(fetchAlbumMonth).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(200); });
        vi.useFakeTimers({ toFake: ['Date'] });
        await waitFor(() => expect(fetchAlbumMonth).toHaveBeenCalled());
        expect(vi.mocked(fetchAlbumMonth).mock.calls.map((c) => c[1])).toEqual(['2026-04']);
    });

    it('re-aligns a jump target after its grid loads, and not again once loaded', async () => {
        const calls = spyScroll();
        const fire = stubObserver();
        vi.mocked(fetchAlbumMonths).mockResolvedValue(monthsPayload(MANY.map((m) => monthSummary(m))));
        renderAlbum();
        const ribbon = await screen.findByTestId('album-ribbon');
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        fireEvent.click(within(ribbon).getByRole('button', { name: 'Go to May 2026' }), { detail: 0 });
        fire('2026-05');
        act(() => { vi.advanceTimersByTime(200); });
        vi.useFakeTimers({ toFake: ['Date'] });
        await within(section('2026-05')).findByTestId('album-grid');
        await waitFor(() => expect(calls.filter((m) => m === '2026-05')).toHaveLength(2));
        // a later jump to the loaded month scrolls once; a retry elsewhere never pulls it back
        fireEvent.click(within(ribbon).getByRole('button', { name: 'Go to May 2026' }), { detail: 0 });
        expect(calls.filter((m) => m === '2026-05')).toHaveLength(3);
    });

    it('keeps the number of live month grids bounded and remounts from cache', async () => {
        const fire = stubObserver();
        vi.mocked(fetchAlbumMonths).mockResolvedValue(monthsPayload(MANY.map((m) => monthSummary(m))));
        renderAlbum();
        await screen.findByTestId('album-month-2026-10');
        let peak = 0;
        for (let i = 0; i < MANY.length; i += 1) {
            fire(MANY[i]);
            if (i >= 2) fire.leave(MANY[i - 2]);
            await within(section(MANY[i])).findByTestId('album-grid');
            peak = Math.max(peak, screen.queryAllByTestId('album-grid').length);
        }
        expect(peak).toBeLessThanOrEqual(2);
        expect(within(section(MANY[0])).queryByTestId('album-grid')).toBeNull();
        expect(within(section(MANY[0])).getByTestId('album-month-placeholder')).toBeInTheDocument();
        // scrolling back remounts from the kept payload: no second request
        fire(MANY[0]);
        await within(section(MANY[0])).findByTestId('album-grid');
        expect(vi.mocked(fetchAlbumMonth).mock.calls.filter((c) => c[1] === MANY[0])).toHaveLength(1);
    });

    it('aborts an in-flight month request when the member changes', async () => {
        const signals: AbortSignal[] = [];
        vi.mocked(fetchAlbumMonth).mockImplementation((_s, _m, _q, signal) => {
            signals.push(signal);
            return new Promise(() => {});
        });
        const { rerender } = renderAlbum();
        await waitFor(() => expect(signals).toHaveLength(1));
        rerender({ page: 'album', memberPath: NAO_PATH });
        expect(signals[0].aborted).toBe(true);
    });

    it('shows the oshi heart on her row', async () => {
        vi.mocked(fetchAlbumMembers).mockResolvedValue(membersPayload({
            members: membersPayload().members.map((m, i) => ({ ...m, oshi: i === 1 })),
        }));
        renderAlbum();
        const nao = await screen.findByRole('button', { name: /小坂 菜緒/ });
        expect(within(nao).getByTestId('member-pane-oshi')).toBeInTheDocument();
        expect(within(screen.getByRole('button', { name: /金村 美玖/ })).queryByTestId('member-pane-oshi')).toBeNull();
    });

    it('does not pin every tile larger under the favourites filter', async () => {
        renderAlbum();
        await screen.findByTestId('album-month-2026-10');
        await userEvent.click(screen.getByRole('button', { name: 'Favorites' }));
        const grid = await within(await screen.findByTestId('album-month-2026-10')).findByTestId('album-grid');
        const fav = within(grid).getByTestId('album-tile-2');
        expect(fav).not.toHaveClass('col-span-2');
        expect(within(fav).queryByTestId('album-washi')).toBeNull();
        expect(within(fav).getByTestId('album-star')).toHaveClass('text-semantic-star');
    });

    it('shows the month label once when the cover has no words', async () => {
        vi.mocked(fetchAlbumMonths).mockResolvedValue(monthsPayload([
            monthSummary('2026-10', { cover: { ...monthSummary('2026-10').cover, caption: null, text: null } }),
            monthSummary('2026-09'),
        ]));
        renderAlbum();
        const bare = await screen.findByTestId('album-month-2026-10');
        expect(within(bare).getAllByText('October 2026')).toHaveLength(1);
        expect(within(bare).getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
        expect(within(section('2026-09')).getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
    });
});

describe('AlbumPage cover choice', () => {
    const tile = async (month: string, id: number) => within(await screen.findByTestId(`album-month-${month}`)).findByTestId(`album-tile-${id}`);

    it('right-click on a photo offers 「この月の表紙にする」, sets the cover and refetches the months', async () => {
        renderAlbum({ page: 'album', memberPath: NAO_PATH });
        const target = await tile('2026-10', 1);
        expect(fetchAlbumMonths).toHaveBeenCalledTimes(1);
        fireEvent.contextMenu(target, { clientX: 40, clientY: 50 });
        const menu = screen.getByRole('menu');
        await userEvent.click(within(menu).getByRole('menuitem', { name: 'Make this the month cover' }));
        expect(putAlbumCover).toHaveBeenCalledWith(
            'hinatazaka46',
            { member: NAO_PATH, month: '2026-10', room: 'messages/34 金村 美玖/58 金村 美玖', id: 1 },
            expect.any(AbortSignal),
        );
        await waitFor(() => expect(fetchAlbumMonths).toHaveBeenCalledTimes(2));
        expect(screen.queryByRole('menu')).toBeNull();
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'album_cover', outcome: 'on' });
        // The bands stay while the months refetch (no flash back to the loading line).
        expect(screen.getByTestId('album-month-2026-10')).toBeInTheDocument();
    });

    it('sends a null member for the 全員 album', async () => {
        renderAlbum();
        fireEvent.contextMenu(await tile('2026-10', 2));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Make this the month cover' }));
        expect(putAlbumCover).toHaveBeenCalledWith('hinatazaka46', expect.objectContaining({ member: null, id: 2 }), expect.any(AbortSignal));
    });

    it('opens the menu from the keyboard (Shift+F10 and the context-menu key)', async () => {
        renderAlbum();
        const target = await tile('2026-10', 1);
        target.focus();
        await userEvent.keyboard('{Shift>}{F10}{/Shift}');
        expect(screen.getByRole('menu')).toBeInTheDocument();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('menu')).toBeNull();
        target.focus();
        fireEvent.keyDown(target, { key: 'ContextMenu' });
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('makes an override cover a menu button (not an ARIA figure) that opens the reset menu on click', async () => {
        vi.mocked(fetchAlbumMonths).mockResolvedValue(monthsPayload([monthSummary('2026-10', { cover_rule: 'override' })]));
        renderAlbum();
        const band = await screen.findByTestId('album-month-2026-10');
        const figure = within(band).getByTestId('album-polaroid');
        expect(figure).not.toHaveAttribute('aria-haspopup');
        expect(figure).not.toHaveAttribute('tabindex');
        const trigger = within(band).getByRole('button', { name: 'October 2026' });
        expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
        expect(trigger).toContainElement(figure);
        await userEvent.click(trigger);
        expect(screen.getByRole('menuitem', { name: 'Choose the cover automatically' })).toBeInTheDocument();
    });

    it('lets a burst frame be chosen as the cover', async () => {
        renderAlbum();
        const grid = await within(await screen.findByTestId('album-month-2026-10')).findByTestId('album-grid');
        await userEvent.click(within(grid).getByRole('button', { name: /3 photos/ }));
        const dialog = await screen.findByRole('dialog');
        const frames = within(dialog).getAllByTestId('burst-frame');
        fireEvent.contextMenu(within(frames[1]).getAllByRole('button')[0]);
        await userEvent.click(screen.getByRole('menuitem', { name: 'Make this the month cover' }));
        expect(putAlbumCover).toHaveBeenCalledWith('hinatazaka46', expect.objectContaining({ month: '2026-10', id: 4 }), expect.any(AbortSignal));
    });

    it('offers 「表紙を自動にもどす」 on an override cover only, and clears it', async () => {
        vi.mocked(fetchAlbumMonths).mockResolvedValue(monthsPayload([
            monthSummary('2026-10', { cover_rule: 'override' }),
            monthSummary('2022-05', { cover_color: null }),
        ]));
        renderAlbum();
        const auto = within(await screen.findByTestId('album-month-2022-05')).getByTestId('album-polaroid');
        fireEvent.contextMenu(auto);
        expect(screen.queryByRole('menu')).toBeNull();

        const chosen = within(screen.getByTestId('album-month-2026-10')).getByTestId('album-polaroid');
        fireEvent.contextMenu(chosen);
        await userEvent.click(screen.getByRole('menuitem', { name: 'Choose the cover automatically' }));
        expect(deleteAlbumCover).toHaveBeenCalledWith('hinatazaka46', { month: '2026-10', member: undefined }, expect.any(AbortSignal));
        await waitFor(() => expect(fetchAlbumMonths).toHaveBeenCalledTimes(2));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'album_cover', outcome: 'off' });
    });

    it.each([
        ['a refused cover', () => new MemoriesFetchError(400, 'not_in_month'), { reason: 'not_in_month', error_code: 400 }],
        ['a failed request', () => new MemoriesFetchError(503, null), { reason: 'request_failed', error_code: 503 }],
        ['a network failure', () => new TypeError('Failed to fetch'), { reason: 'request_failed' }],
        ['a timed-out write (which may have landed: refetch, never retry)', () => new MemoriesTimeoutError(), { reason: 'timeout' }],
    ])('%s shows the inline toast, logs album_cover off with its reason and refetches', async (_name, error, why) => {
        vi.mocked(putAlbumCover).mockRejectedValue(error());
        renderAlbum();
        fireEvent.contextMenu(await tile('2026-10', 1));
        vi.mocked(clientLog).mockClear();
        await userEvent.click(screen.getByRole('menuitem', { name: 'Make this the month cover' }));
        expect(await screen.findByText("Couldn't change the cover")).toHaveAttribute('role', 'status');
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'album_cover', outcome: 'off', ...why });
        // Never the bare `off` of a successful reset, never `on`.
        expect(vi.mocked(clientLog)).not.toHaveBeenCalledWith('memories_toggle', { target: 'album_cover', outcome: 'off' });
        expect(vi.mocked(clientLog)).not.toHaveBeenCalledWith('memories_toggle', { target: 'album_cover', outcome: 'on' });
        await waitFor(() => expect(fetchAlbumMonths).toHaveBeenCalledTimes(2));
        expect(putAlbumCover).toHaveBeenCalledTimes(1);
    });
});
