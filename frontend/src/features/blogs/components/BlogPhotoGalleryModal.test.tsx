import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';

vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
import { virtuosoCapture, resetVirtuosoCapture } from '../../../__tests__/virtuosoMock';
vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

// The calendar is its own dialog (tested elsewhere): capture what it is given.
const calendar: { onSelectDate?: (d: Date) => void; dates?: { date: string; count: number }[] } = {};
vi.mock('../../../core/modals/CalendarModal', () => ({
    CalendarModal: ({ onSelectDate, dates }: { onSelectDate: (d: Date) => void; dates?: { date: string; count: number }[] }) => {
        calendar.onSelectDate = onSelectDate;
        calendar.dates = dates;
        return null;
    },
}));

import i18n from '../../../i18n';
import { formatDateTime } from '../../../utils/classnames';
import { BlogPhotoGalleryModal } from './BlogPhotoGalleryModal';
import { resetMediaMetaForTests } from '../../../core/media/grid/mediaMeta';
import { resetLoadSchedulerForTests } from '../../../core/media/grid/loadScheduler';
import { resetPosterCaptureForTests } from '../../../core/media/grid/posterCapture';
import type { BlogGalleryImage, BlogMeta } from '../../../types';

/** An `Image` stand-in without `decode`: the scheduler settles on `load` / `error`, which a test fires. */
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

/** Reports the grid 800 px wide (5 columns of `tileGrid.ts` tiles). */
class StubResizeObserver {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
        this.cb([{ target, contentRect: { width: 800 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
}

const SERVICE = 'hinatazaka46';
const MEMBER = '58';
// Noon UTC: the local date is the same day in every test runner's time zone.
const image = (blogId: string, day: string, index: number, title = 'ブログ 🌸'): BlogGalleryImage => ({
    blog_id: blogId,
    published_at: `${day}T12:00:00Z`,
    title,
    image_index: index,
    media_url: `/api/content/media/${SERVICE}/blogs/%E9%87%91%E6%9D%91/${day.replace(/-/g, '')}_${blogId}/images/img_${index}.jpg`,
    src: `/api/blogs/image?service=${SERVICE}&blog_id=${blogId}&filename=img_${index}.jpg`,
});
// Newest first, as the backend sends them.
const IMAGES = [image('b2', '2026-11-03', 0), image('b2', '2026-11-03', 1), image('b1', '2026-10-01', 0, '秋の日記')];
const BLOG_B1: BlogMeta = { id: 'b1', title: '秋の日記', published_at: '2026-10-01T12:00:00Z', url: 'u', thumbnail: null, cached: true };

let galleryReply: () => Promise<Response> | Response;
let galleryCalls: URL[] = [];
let contentCalls = 0;
let statusBody: unknown;

const renderGallery = (props: Partial<React.ComponentProps<typeof BlogPhotoGalleryModal>> = {}) =>
    render(
        <BlogPhotoGalleryModal isOpen onClose={vi.fn()} blogs={[BLOG_B1]} serviceId={SERVICE} memberId={MEMBER} backupEnabled onJumpToBlog={vi.fn()} {...props} />,
    );
const tiles = () => screen.queryAllByRole('button', { name: /^Open photo from / });
const dialogLoads = () => vi.mocked(clientLog).mock.calls.filter(([e, f]) => e === 'dialog_load' && (f as { surface?: string }).surface === 'blog_gallery').map(([, f]) => f);

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    FakeImage.all = [];
    resetVirtuosoCapture();
    resetMediaMetaForTests();
    resetLoadSchedulerForTests();
    resetPosterCaptureForTests();
    calendar.onSelectDate = undefined;
    calendar.dates = undefined;
    vi.mocked(clientLog).mockClear();
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    Element.prototype.scrollIntoView = vi.fn();
    galleryCalls = [];
    contentCalls = 0;
    galleryReply = () => HttpResponse.json({ images: IMAGES });
    statusBody = { state: 'idle', paused_reason: null, thumbs_full: false, services: {}, posters: {}, cache: {} };
    server.use(
        http.get('/api/blogs/gallery', ({ request }) => {
            galleryCalls.push(new URL(request.url));
            return galleryReply();
        }),
        http.get('/api/blogs/content', () => {
            contentCalls += 1;
            return HttpResponse.json({});
        }),
        http.get('/api/media/status', () => HttpResponse.json(statusBody as Record<string, unknown>)),
    );
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('BlogPhotoGalleryModal: one call, then the shared grid (M7)', () => {
    it('makes exactly one gallery request on open (no per-blog content requests)', async () => {
        renderGallery();
        await waitFor(() => expect(tiles()).toHaveLength(3));
        expect(galleryCalls).toHaveLength(1);
        expect(galleryCalls[0].searchParams.get('service')).toBe(SERVICE);
        expect(galleryCalls[0].searchParams.get('member_id')).toBe(MEMBER);
        expect(contentCalls).toBe(0);
        expect(screen.getByText(i18n.t('blogGallery.count', { count: 3 }))).toBeInTheDocument();
    });

    it('renders tiles that request thumbnails of the media URL, never the full image', async () => {
        renderGallery();
        await waitFor(() => expect(requested()).toHaveLength(3));
        requested().forEach((src) => expect(src).toMatch(/^\/api\/content\/thumb\/hinatazaka46\/blogs\/%E9%87%91%E6%9D%91\/\d{8}_b\d\/images\/img_\d\.jpg\?w=\d+$/));
        const body = screen.getByTestId('modal-body');
        expect(body.querySelectorAll('[data-media-grid-row]').length).toBeGreaterThan(0);
        body.querySelectorAll('img').forEach((img) => expect(img.getAttribute('src') ?? '').not.toMatch(/^\/api\/blogs\/image/));
        // Month groups, newest first.
        expect(body.textContent!.indexOf('2026 / 11')).toBeLessThan(body.textContent!.indexOf('2026 / 10'));
    });

    it('stops plain tiles at the 480 thumbnail (blogs have no ★)', async () => {
        vi.stubGlobal('devicePixelRatio', 4);
        renderGallery();
        await waitFor(() => expect(requested()).toHaveLength(3));
        requested().forEach((src) => expect(src).toMatch(/w=480$/));
    });

    it('labels each tile with the localised open action and date', async () => {
        renderGallery();
        await waitFor(() => expect(tiles()).toHaveLength(3));
        expect(tiles()[2]).toHaveAccessibleName(`Open photo from ${formatDateTime(IMAGES[2].published_at)}`);
    });

    it('opens the viewer at the clicked index with the /api/blogs/image src', async () => {
        renderGallery();
        await waitFor(() => expect(tiles()).toHaveLength(3));
        await userEvent.click(tiles()[1]);
        const viewer = await screen.findByRole('dialog', { name: i18n.t('common.mediaViewer') });
        expect(viewer.querySelector('img')?.getAttribute('src')).toBe(IMAGES[1].src);
        expect(screen.getByText('2 / 3')).toBeInTheDocument();
    });

    it('left is older and right is newer in the viewer, although the grid is newest first', async () => {
        renderGallery();
        await waitFor(() => expect(tiles()).toHaveLength(3));
        await userEvent.click(tiles()[0]);
        const viewer = await screen.findByRole('dialog', { name: i18n.t('common.mediaViewer') });
        const shown = () => viewer.querySelector('img')?.getAttribute('src');
        expect(shown()).toBe(IMAGES[0].src);
        expect(screen.getByText('3 / 3')).toBeInTheDocument();
        fireEvent.keyDown(viewer, { key: 'ArrowLeft' });
        expect(shown()).toBe(IMAGES[1].src);
        fireEvent.keyDown(viewer, { key: 'ArrowRight' });
        expect(shown()).toBe(IMAGES[0].src);
    });

    it('draws the viewer controls as circles on the dark chrome', async () => {
        renderGallery();
        await waitFor(() => expect(tiles()).toHaveLength(3));
        await userEvent.click(tiles()[0]);
        const viewer = await screen.findByRole('dialog', { name: i18n.t('common.mediaViewer') });
        const close = Array.from(viewer.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === i18n.t('common.close'))!;
        expect(close).toHaveAttribute('data-shape', 'circle');
    });

    it('jumps from the viewer to the blog: the listed blog, or one built from the image', async () => {
        const onJumpToBlog = vi.fn();
        const onClose = vi.fn();
        renderGallery({ onJumpToBlog, onClose });
        await waitFor(() => expect(tiles()).toHaveLength(3));
        await userEvent.click(tiles()[2]);
        await userEvent.click(await screen.findByRole('button', { name: new RegExp('秋の日記') }));
        expect(onClose).toHaveBeenCalled();
        expect(onJumpToBlog).toHaveBeenLastCalledWith(BLOG_B1);
        // b2 is not in the (still loading) timeline list: the jump uses the image's own blog fields.
        await userEvent.click(tiles()[0]);
        await userEvent.click(await screen.findByRole('button', { name: /ブログ 🌸/ }));
        expect(onJumpToBlog).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b2', title: 'ブログ 🌸', published_at: IMAGES[0].published_at }));
    });

    it('jumps to a calendar date through scrollToItem, and to its month when no photo is on that day', async () => {
        renderGallery();
        await waitFor(() => expect(tiles()).toHaveLength(3));
        expect(calendar.dates).toEqual([{ date: '2026-11-03', count: 2 }, { date: '2026-10-01', count: 1 }]);
        act(() => calendar.onSelectDate!(new Date(2026, 9, 1))); // b1, flat index 2 → Oct group row 1
        act(() => calendar.onSelectDate!(new Date(2026, 9, 20))); // nothing that day → its month
        expect(virtuosoCapture.scrollToIndex).toEqual([{ index: 1, align: 'start' }, { groupIndex: 1, align: 'start' }]);
        expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('retries a failed tile on click instead of opening the viewer, and names it so', async () => {
        galleryReply = () => HttpResponse.json({ images: [IMAGES[2]] });
        renderGallery();
        await waitFor(() => expect(tiles()).toHaveLength(1));
        const tile = tiles()[0];
        for (let i = 0; i < 5 && tile.querySelector('[data-state="failed"]') === null; i += 1) {
            await waitFor(() => expect(FakeImage.all.some((img) => img.onerror)).toBe(true));
            act(() => FakeImage.all.filter((img) => img.onerror).forEach((img) => { const fail = img.onerror!; img.onerror = null; img.onload = null; fail(); }));
        }
        expect(tile.querySelector('[data-state="failed"]')).not.toBeNull();
        expect(tile).toHaveAccessibleName(`Retry loading photo from ${formatDateTime(IMAGES[2].published_at)}`);
        const before = FakeImage.all.length;
        await userEvent.click(tile);
        expect(screen.queryByRole('dialog', { name: i18n.t('common.mediaViewer') })).toBeNull();
        await waitFor(() => expect(FakeImage.all.length).toBeGreaterThan(before));
        expect(tile.querySelector('[data-state="failed"]')).toBeNull();
    });

    it('has no top padding on the scroller, so photos never show above the sticky month header', async () => {
        renderGallery();
        await waitFor(() => expect(tiles()).toHaveLength(3));
        expect(screen.getByTestId('modal-body')).toHaveClass('pt-0');
    });
});

describe('BlogPhotoGalleryModal grid-level states', () => {
    it('shows the first-load StatusBlock after 200 ms, holds it 400 ms, and hides the count meanwhile', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: false });
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        galleryReply = async () => { await gate; return HttpResponse.json({ images: IMAGES }); };
        renderGallery();
        const body = screen.getByTestId('modal-body');
        expect(within(body).getByRole('status')).toHaveAttribute('data-stage', 'hidden');
        await act(async () => { await vi.advanceTimersByTimeAsync(210); });
        expect(within(body).getByRole('status')).toHaveAttribute('data-stage', 'shown');
        expect(body).toHaveTextContent(i18n.t('blogGallery.loading'));
        expect(screen.queryByText(/photos$/)).toBeNull();
        await act(async () => { release(); await vi.advanceTimersByTimeAsync(10); });
        // Held: shown for only ~20 ms so far.
        expect(within(body).getByRole('status')).toHaveAttribute('data-stage', 'shown');
        expect(tiles()).toHaveLength(0);
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        expect(tiles()).toHaveLength(3);
        expect(dialogLoads()).toEqual([{ surface: 'blog_gallery', outcome: 'ok', count: 3 }]);
    });

    it('says it is still working at 3 s and explains at 10 s', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: false });
        galleryReply = () => new Promise<Response>(() => {});
        renderGallery();
        await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
        expect(screen.getByText('Still loading…')).toBeInTheDocument();
        await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
        expect(within(screen.getByTestId('modal-body')).getByRole('status')).toHaveAttribute('data-stage', 'verySlow');
        expect(clientLog).toHaveBeenCalledWith('ui_wait', expect.objectContaining({ surface: 'blog_gallery', phase: 'very_slow' }));
    });

    it('shows the error with a Retry that runs the one request again', async () => {
        galleryReply = () => new HttpResponse(null, { status: 500 });
        renderGallery();
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load");
        expect(dialogLoads()).toEqual([{ surface: 'blog_gallery', outcome: 'error' }]);
        galleryReply = () => HttpResponse.json({ images: IMAGES });
        await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(tiles()).toHaveLength(3));
        expect(galleryCalls).toHaveLength(2);
        expect(dialogLoads()[dialogLoads().length - 1]).toEqual({ surface: 'blog_gallery', outcome: 'ok', count: 3 });
    });

    it('keeps the empty state when the member has no cached photos', async () => {
        galleryReply = () => HttpResponse.json({ images: [] });
        renderGallery();
        expect(await screen.findByText(i18n.t('blogGallery.emptyNoPhotos'))).toBeInTheDocument();
        expect(screen.getByText(i18n.t('blogGallery.count', { count: 0 }))).toBeInTheDocument();
        expect(dialogLoads()).toEqual([{ surface: 'blog_gallery', outcome: 'ok', count: 0 }]);
    });

    it('keeps the no-backup state and makes no request', async () => {
        renderGallery({ backupEnabled: false });
        expect(screen.getByText(i18n.t('blogGallery.emptyNoBackup'))).toBeInTheDocument();
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(galleryCalls).toHaveLength(0);
    });

    it('logs cancelled when it closes before the request settles, and reads nothing while closed', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        galleryReply = async () => { await gate; return HttpResponse.json({ images: IMAGES }); };
        const { rerender } = renderGallery();
        await waitFor(() => expect(galleryCalls).toHaveLength(1));
        rerender(<BlogPhotoGalleryModal isOpen={false} onClose={vi.fn()} blogs={[]} serviceId={SERVICE} memberId={MEMBER} backupEnabled onJumpToBlog={vi.fn()} />);
        await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
        expect(dialogLoads()).toEqual([{ surface: 'blog_gallery', outcome: 'cancelled' }]);
        expect(galleryCalls).toHaveLength(1);
    });

    it('shows the quiet "Preparing thumbnails" bar for this service, and its paused form', async () => {
        statusBody = { state: 'running', paused_reason: null, thumbs_full: false, services: { [SERVICE]: { done: 3, total: 10 } }, posters: {}, cache: {} };
        const { unmount } = renderGallery();
        expect(await screen.findByRole('progressbar', { name: 'Preparing thumbnails… 3 / 10' })).toHaveAttribute('aria-valuenow', '30');
        unmount();
        statusBody = { state: 'paused', paused_reason: 'foreground', thumbs_full: false, services: { [SERVICE]: { done: 4, total: 10 } }, posters: {}, cache: {} };
        renderGallery();
        expect(await screen.findByRole('progressbar', { name: 'Thumbnail preparation paused · 4 / 10' })).toBeInTheDocument();
    });
});
