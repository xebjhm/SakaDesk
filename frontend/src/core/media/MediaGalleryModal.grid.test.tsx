import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';

vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);
import { virtuosoCapture, resetVirtuosoCapture } from '../../__tests__/virtuosoMock';
vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';

// The calendar is its own dialog (tested elsewhere): capture the date callback it is given.
const calendar: { onSelectDate?: (d: Date) => void } = {};
vi.mock('../modals/CalendarModal', () => ({
    CalendarModal: ({ onSelectDate }: { onSelectDate: (d: Date) => void }) => {
        calendar.onSelectDate = onSelectDate;
        return null;
    },
}));

import i18n from '../../i18n';
import { formatDateTime } from '../../utils/classnames';
import { MediaGalleryModal } from './MediaGalleryModal';
import { resetMediaMetaForTests } from './grid/mediaMeta';
import { resetLoadSchedulerForTests } from './grid/loadScheduler';
import { resetPosterCaptureForTests } from './grid/posterCapture';
import { PREGEN_POLL_MS } from './grid/galleryStatus';
import type { Message } from '../../types';

/** An `Image` stand-in without `decode`: the scheduler settles on `load` / `error`, which the test fires. */
class FakeImage {
    static all: FakeImage[] = [];
    decoding = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private value = '';
    constructor() { FakeImage.all.push(this); }
    set src(v: string) { this.value = v; }
    get src() { return this.value; }
}
const requested = () => FakeImage.all.map((i) => i.src).filter(Boolean);

/** A stand-in that reports the grid 800 px wide (5 columns of `tileGrid.ts` tiles). */
class StubResizeObserver {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
        this.cb([{ target, contentRect: { width: 800 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
}

const SERVICE = 'hinatazaka46';
// Noon UTC, so the local date is the same day in every test runner's time zone.
const pic = (id: number, day: string, extra: Partial<Message> = {}) =>
    ({ id, content: null, timestamp: `${day}T12:00:00Z`, type: 'picture', is_favorite: false, media_file: `messages/a/picture/${id}.jpg`, ...extra }) as unknown as Message;
const vid = (id: number, day: string, extra: Partial<Message> = {}) =>
    ({ id, content: null, timestamp: `${day}T12:00:00Z`, type: 'video', is_favorite: false, media_file: `messages/a/video/${id}.mp4`, media_duration: 75, ...extra }) as unknown as Message;
const voice = (id: number, day: string) =>
    ({ id, content: null, timestamp: `${day}T12:00:00Z`, type: 'voice', is_favorite: false, media_file: `messages/a/voice/${id}.m4a`, media_duration: 12 }) as unknown as Message;

const renderGallery = (messages: Message[], props: Partial<React.ComponentProps<typeof MediaGalleryModal>> = {}) =>
    render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={messages} memberName="春野 ひなた" serviceId={SERVICE} {...props} />);
const tiles = () => screen.getAllByRole('button', { name: /^Open (photo|video) from / });

let statusBody: unknown;
let statusCalls = 0;

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    FakeImage.all = [];
    resetVirtuosoCapture();
    resetMediaMetaForTests();
    resetLoadSchedulerForTests();
    resetPosterCaptureForTests();
    calendar.onSelectDate = undefined;
    vi.mocked(clientLog).mockClear();
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    Element.prototype.scrollIntoView = vi.fn();
    statusCalls = 0;
    statusBody = { state: 'idle', paused_reason: null, thumbs_full: false, services: {}, posters: {}, cache: {} };
    server.use(
        http.get('/api/media/status', () => {
            statusCalls += 1;
            return HttpResponse.json(statusBody as Record<string, unknown>);
        }),
        // Voice rows read their cached transcript (none here).
        http.get('/api/transcription/*', () => new HttpResponse(null, { status: 404 })),
    );
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('MediaGalleryModal on the shared virtual grid (M6)', () => {
    it('renders photo tiles that request thumbnails, never a full-size image', async () => {
        renderGallery([pic(1, '2026-10-01'), pic(2, '2026-10-02'), pic(3, '2026-11-03')]);
        expect(tiles()).toHaveLength(3);
        expect(screen.getByTestId('modal-body').querySelectorAll('[data-media-grid-row]').length).toBeGreaterThan(0);
        tiles().forEach((t) => expect(t.querySelector('[data-state]')).not.toBeNull());
        await waitFor(() => expect(requested()).toHaveLength(3));
        requested().forEach((src) => expect(src).toMatch(/^\/api\/content\/thumb\/hinatazaka46\/messages\/a\/picture\/\d\.jpg\?w=\d+$/));
        // No full-size picture in the grid.
        screen.getByTestId('modal-body').querySelectorAll('img').forEach((img) => {
            expect(img.getAttribute('src') ?? '').not.toMatch(/^\/api\/content\/media\//);
        });
        // Month groups, newest first, with today's labels.
        const body = screen.getByTestId('modal-body');
        expect(body.textContent!.indexOf('2026 / 11')).toBeLessThan(body.textContent!.indexOf('2026 / 10'));
    });

    it('labels each tile with the localised open action and date', async () => {
        const p = pic(5, '2026-10-05');
        const v = vid(6, '2026-10-06');
        const { unmount } = renderGallery([p, v]);
        expect(screen.getByRole('button', { name: `Open photo from ${formatDateTime(p.timestamp)}` })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('tab', { name: 'Videos' }));
        expect(screen.getByRole('button', { name: `Open video from ${formatDateTime(v.timestamp)}` })).toBeInTheDocument();
        unmount();
        await act(async () => { await i18n.changeLanguage('ja'); });
        try {
            renderGallery([p]);
            expect(screen.getByRole('button', { name: `${formatDateTime(p.timestamp)} の写真を開く` })).toBeInTheDocument();
        } finally {
            await act(async () => { await i18n.changeLanguage('en'); });
        }
    });

    it('renders video tiles with no <video>, keeping the mute and duration overlays', async () => {
        renderGallery([vid(6, '2026-10-06', { is_muted: true } as Partial<Message>), vid(7, '2026-10-07')]);
        await userEvent.click(screen.getByRole('tab', { name: 'Videos' }));
        const body = screen.getByTestId('modal-body');
        expect(body.querySelector('video')).toBeNull();
        expect(tiles()).toHaveLength(2);
        expect(within(body).getAllByText('01:15')).toHaveLength(2);
        // The mute badge (bottom left, an icon on the toast pill) only on the muted video.
        expect(body.querySelectorAll('button .bottom-1.left-1.bg-toast svg')).toHaveLength(1);
        tiles().forEach((t) => expect(t.querySelector('[data-state]')).not.toBeNull());
    });

    it('opens the same detail item as before when a tile is clicked', async () => {
        renderGallery([pic(1, '2026-10-01'), pic(2, '2026-10-02'), pic(3, '2026-10-03')]);
        await userEvent.click(tiles()[1]); // newest first: id 2
        const viewer = await screen.findByRole('dialog', { name: 'Media viewer' });
        expect(viewer.querySelector('img')?.getAttribute('src')).toBe('/api/content/media/hinatazaka46/messages/a/picture/2.jpg');
    });

    it('retries a failed tile on click instead of opening the viewer', async () => {
        renderGallery([pic(1, '2026-10-01')]);
        const tile = tiles()[0];
        // Fail every candidate: the thumbnail, then the full file.
        for (let i = 0; i < 5 && tile.querySelector('[data-state="failed"]') === null; i += 1) {
            await waitFor(() => expect(FakeImage.all.some((img) => img.onerror)).toBe(true));
            act(() => FakeImage.all.filter((img) => img.onerror).forEach((img) => { const fail = img.onerror!; img.onerror = null; img.onload = null; fail(); }));
        }
        expect(tile.querySelector('[data-state="failed"]')).not.toBeNull();
        // Its accessible name says what a click does now: retry, not open.
        const date = formatDateTime(pic(1, '2026-10-01').timestamp);
        expect(tile).toHaveAccessibleName(`Retry loading photo from ${date}`);
        const before = FakeImage.all.length;
        await userEvent.click(tile);
        expect(screen.queryByRole('dialog', { name: 'Media viewer' })).toBeNull();
        await waitFor(() => expect(FakeImage.all.length).toBeGreaterThan(before));
        expect(tile.querySelector('[data-state="failed"]')).toBeNull();
        expect(tile).toHaveAccessibleName(`Open photo from ${date}`);
        // A tile that is not failed opens the viewer as usual.
        await userEvent.click(tile);
        expect(await screen.findByRole('dialog', { name: 'Media viewer' })).toBeInTheDocument();
    });

    it('asks favourited (★) photos for the large thumbnail, others stop at 480', async () => {
        vi.stubGlobal('devicePixelRatio', 4);
        renderGallery([pic(1, '2026-10-01', { is_favorite: true }), pic(2, '2026-10-02')]);
        await waitFor(() => expect(requested()).toHaveLength(2));
        expect(requested().find((s) => s.includes('/1.jpg'))).toMatch(/w=640$/);
        expect(requested().find((s) => s.includes('/2.jpg'))).toMatch(/w=480$/);
    });

    it('jumps to the first item of a calendar date through scrollToItem', async () => {
        // Newest first at 5 columns: Nov group row 0 = [12]; Oct group rows 1 = [11..7], 2 = [6..2] (flat 6..10).
        const october = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((id) => pic(id, `2026-10-${String(id).padStart(2, '0')}`));
        renderGallery([...october, pic(12, '2026-11-20')]);
        expect(calendar.onSelectDate).toBeDefined();
        act(() => calendar.onSelectDate!(new Date(2026, 9, 4))); // id 4 is flat index 8 → row 2
        act(() => calendar.onSelectDate!(new Date(2026, 10, 20))); // id 12, flat 0 → row 0
        act(() => calendar.onSelectDate!(new Date(2026, 9, 25))); // no item that day → its month
        expect(virtuosoCapture.scrollToIndex).toEqual([
            { index: 2, align: 'start' },
            { index: 0, align: 'start' },
            { groupIndex: 1, align: 'start' },
        ]);
        expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('resets the scroll when the tab changes', async () => {
        renderGallery([pic(1, '2026-10-01'), vid(2, '2026-10-02'), voice(3, '2026-10-03')]);
        const body = screen.getByTestId('modal-body');
        body.scrollTop = 500;
        await userEvent.click(screen.getByRole('tab', { name: 'Videos' }));
        expect(body.scrollTop).toBe(0);
        body.scrollTop = 200;
        await userEvent.click(screen.getByRole('tab', { name: 'Photos' }));
        expect(body.scrollTop).toBe(0);
    });

    it('leaves the voice tab a list, with no grid', async () => {
        renderGallery([voice(3, '2026-10-03'), voice(4, '2026-10-04')]);
        await userEvent.click(screen.getByRole('tab', { name: 'Voice messages' }));
        const body = screen.getByTestId('modal-body');
        expect(body.querySelector('[data-media-grid-row]')).toBeNull();
        expect(within(body).getAllByRole('button', { name: /春野 ひなた/ })).toHaveLength(2);
        expect(body.querySelector('.sticky.top-0.z-10')).not.toBeNull();
    });

    it('keeps the empty state for an empty tab', () => {
        renderGallery([voice(3, '2026-10-03')]);
        expect(screen.getByText('No photos yet')).toBeInTheDocument();
    });
});

describe('MediaGalleryModal grid-level loading states', () => {
    it('shows the first-load StatusBlock after 200 ms and holds it at least 400 ms', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: false });
        const { rerender } = renderGallery([], { listStatus: 'loading' });
        const body = screen.getByTestId('modal-body');
        const status = within(body).getByRole('status');
        expect(status).toHaveAttribute('data-stage', 'hidden');
        expect(screen.queryByText('No photos yet')).toBeNull();
        await act(async () => { await vi.advanceTimersByTimeAsync(210); });
        expect(within(body).getByRole('status')).toHaveAttribute('data-stage', 'shown');
        rerender(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[pic(1, '2026-10-01')]} memberName="春野 ひなた" serviceId={SERVICE} listStatus="ready" />);
        // Held: shown for only ~10 ms so far.
        expect(within(body).queryByRole('status')).toHaveAttribute('data-stage', 'shown');
        expect(screen.queryAllByRole('button', { name: /^Open photo from / })).toHaveLength(0);
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        expect(screen.getAllByRole('button', { name: /^Open photo from / })).toHaveLength(1);
    });

    it('says it is still working at 3 s and explains at 10 s', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: false });
        renderGallery([], { listStatus: 'loading' });
        await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
        expect(screen.getByText('Still loading…')).toBeInTheDocument();
        await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
        expect(screen.getByRole('status')).toHaveAttribute('data-stage', 'verySlow');
        expect(clientLog).toHaveBeenCalledWith('ui_wait', expect.objectContaining({ surface: 'media_gallery', phase: 'very_slow' }));
    });

    it('shows the error StatusBlock with a Retry', async () => {
        const onRetryList = vi.fn();
        renderGallery([], { listStatus: 'error', onRetryList });
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load");
        await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
        expect(onRetryList).toHaveBeenCalledTimes(1);
    });

    it('shows the error without a Retry when the host gives no retry, never "No photos yet"', () => {
        renderGallery([], { listStatus: 'error' });
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load");
        expect(within(alert).queryByRole('button')).toBeNull();
        expect(screen.queryByText('No photos yet')).toBeNull();
    });

    it('shows a quiet "Preparing thumbnails" bar while pre-generation runs, and polls gently', async () => {
        statusBody = { state: 'running', paused_reason: null, thumbs_full: false, services: { hinatazaka46: { done: 3, total: 10 } }, posters: {}, cache: {} };
        vi.useFakeTimers({ shouldAdvanceTime: true });
        renderGallery([pic(1, '2026-10-01')]);
        const bar = await screen.findByRole('progressbar', { name: 'Preparing thumbnails… 3 / 10' });
        expect(bar).toHaveAttribute('aria-valuenow', '30');
        expect(statusCalls).toBe(1);
        statusBody = { state: 'idle', paused_reason: null, thumbs_full: false, services: { hinatazaka46: { done: 10, total: 10 } }, posters: {}, cache: {} };
        await act(async () => { await vi.advanceTimersByTimeAsync(PREGEN_POLL_MS); });
        await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
        expect(statusCalls).toBe(2);
        await act(async () => { await vi.advanceTimersByTimeAsync(PREGEN_POLL_MS * 2); });
        expect(statusCalls).toBe(2);
    });

    it('says the bar is paused while the worker yields (here to the gallery itself), so it never looks frozen', async () => {
        statusBody = { state: 'paused', paused_reason: 'foreground', thumbs_full: false, services: { hinatazaka46: { done: 3, total: 10 } }, posters: {}, cache: {} };
        renderGallery([pic(1, '2026-10-01')]);
        const bar = await screen.findByRole('progressbar', { name: 'Thumbnail preparation paused · 3 / 10' });
        expect(bar).toHaveAttribute('aria-valuenow', '30');
        expect(screen.queryByText(/Preparing thumbnails/)).toBeNull();
    });

    it('shows no pre-generation bar when the thumbnail cache is full, and none on the voice tab', async () => {
        statusBody = { state: 'running', paused_reason: null, thumbs_full: true, services: { hinatazaka46: { done: 3, total: 10 } }, posters: {}, cache: {} };
        renderGallery([pic(1, '2026-10-01'), voice(3, '2026-10-03')]);
        await waitFor(() => expect(statusCalls).toBe(1));
        expect(screen.queryByRole('progressbar')).toBeNull();
        // The voice tab has no thumbnails: no bar, and no status read there.
        statusBody = { state: 'running', paused_reason: null, thumbs_full: false, services: { hinatazaka46: { done: 3, total: 10 } }, posters: {}, cache: {} };
        await userEvent.click(screen.getByRole('tab', { name: 'Voice messages' }));
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(statusCalls).toBe(1);
        expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('does not read the status while closed', async () => {
        render(<MediaGalleryModal isOpen={false} onClose={vi.fn()} messages={[pic(1, '2026-10-01')]} memberName="春野 ひなた" serviceId={SERVICE} />);
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(statusCalls).toBe(0);
    });
});
