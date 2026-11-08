import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { MediaGalleryModal } from './MediaGalleryModal';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import type { Message } from '../../types';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    resetDialogStack();
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
});
afterEach(() => vi.unstubAllGlobals());

const older = { id: 3, content: null, timestamp: '2026-10-01T04:00:00Z', type: 'voice', is_favorite: false, media_file: 'messages/a/voice/3.m4a', media_duration: 34 } as unknown as Message;
const voice = { id: 7, content: null, timestamp: '2026-11-03T04:00:00Z', type: 'voice', is_favorite: false, media_file: 'messages/a/voice/7.m4a', media_duration: 12 } as unknown as Message;

describe('MediaGalleryModal (R-c)', () => {
    it('has the image icon and an accent tab selection (e4e4118: accent text, accent-border bar)', () => {
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[voice]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        expect(screen.getByTestId('modal-header-icon')).toBeInTheDocument();
        const photos = screen.getByRole('tab', { name: 'Photos' });
        expect(photos).toHaveClass('text-accent-strong', 'focus-visible:ring-accent');
        expect(photos.querySelector('span[aria-hidden="true"]')).toHaveClass('bg-accent-border');
        const videos = screen.getByRole('tab', { name: 'Videos' });
        expect(videos).toHaveClass('text-muted', 'hover:text-secondary');
        expect(videos).not.toHaveClass('text-accent-strong');
        expect(videos.querySelector('span[aria-hidden="true"]')).toBeNull();
    });

    it('starts at the top after switching tabs (N3)', async () => {
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[voice, older]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        const body = screen.getByTestId('modal-body');
        body.scrollTop = 500;
        await userEvent.click(screen.getByRole('tab', { name: 'Voice messages' }));
        expect(body.scrollTop).toBe(0);
        body.scrollTop = 300;
        await userEvent.click(screen.getByRole('tab', { name: 'Videos' }));
        expect(body.scrollTop).toBe(0);
    });

    it('keeps the scroll offset when the active tab is clicked again', async () => {
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[voice, older]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        const body = screen.getByTestId('modal-body');
        body.scrollTop = 400;
        await userEvent.click(screen.getByRole('tab', { name: 'Photos' }));
        expect(body.scrollTop).toBe(400);
    });

    it('flips voice row selection to the accent roles and marks the name ja', async () => {
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[voice, older]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        await userEvent.click(screen.getByRole('tab', { name: 'Voice messages' }));
        const rowFor = (duration: string) => screen.getAllByRole('button', { name: /春野 ひなた/ }).find((b) => b.textContent?.includes(duration))!;
        const newer = rowFor('00:12');
        const old = rowFor('00:34');
        // The newest voice is selected by default; the older one is not.
        expect(newer).toHaveAttribute('aria-pressed', 'true');
        expect(old).toHaveAttribute('aria-pressed', 'false');
        expect(old).toHaveClass('hover:bg-sunken');
        expect(old).not.toHaveClass('bg-accent-subtle');
        expect(within(old).getByText('春野 ひなた')).toHaveClass('text-primary');
        expect(within(old).getByText('00:34')).toHaveClass('text-muted');

        await userEvent.click(old);
        expect(old).toHaveAttribute('aria-pressed', 'true');
        expect(old).toHaveClass('bg-accent-subtle', 'focus-visible:ring-accent');
        expect(old).not.toHaveClass('hover:bg-sunken');
        const name = within(old).getByText('春野 ひなた');
        expect(name).toHaveAttribute('lang', 'ja');
        expect(name).toHaveClass('text-accent-strong');
        expect(within(old).getByText('00:34')).toHaveClass('text-accent-strong');

        expect(newer).toHaveAttribute('aria-pressed', 'false');
        expect(newer).toHaveClass('hover:bg-sunken');
        expect(newer).not.toHaveClass('bg-accent-subtle');
        expect(within(newer).getByText('春野 ひなた')).toHaveClass('text-primary');
    });

    it('keeps the tab bar out of the scrolling body; month headers stick to its top edge', () => {
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[voice]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        const tablist = screen.getByRole('tablist');
        expect(screen.getByTestId('modal-body')).not.toContainElement(tablist);
        expect(screen.getByTestId('modal-toolbar')).toContainElement(tablist);
        expect(screen.getByTestId('modal-body')).toHaveClass('pt-0');
    });

    it('month headers are sticky top-0 in the voice list', async () => {
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[voice]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        await userEvent.click(screen.getByRole('tab', { name: 'Voice messages' }));
        const header = screen.getByTestId('modal-body').querySelector('.sticky.z-10')!;
        expect(header).toHaveClass('top-0');
        expect(header).not.toHaveClass('top-12');
    });
});

describe('MediaGalleryModal detail view direction', () => {
    const pic = (id: number, ts: string) => ({ id, content: null, timestamp: ts, type: 'picture', is_favorite: false, media_file: `messages/a/picture/${id}.jpg` }) as unknown as Message;

    it('the grid is newest first, but ArrowLeft opens the older photo and ArrowRight the newer', async () => {
        const messages = [pic(1, '2026-10-01T04:00:00Z'), pic(2, '2026-10-02T04:00:00Z'), pic(3, '2026-10-03T04:00:00Z')];
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={messages} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        const thumbs = Array.from(document.querySelectorAll('img')).map((i) => i.closest('button')!);
        await userEvent.click(thumbs[1]); // the middle photo (id 2)
        const viewer = await screen.findByRole('dialog', { name: 'Media viewer' });
        const shown = () => viewer.querySelector('img')?.getAttribute('src') ?? '';
        expect(shown()).toMatch(/\/2\.jpg/);
        await userEvent.keyboard('{ArrowLeft}');
        expect(shown()).toMatch(/\/1\.jpg/);
        await userEvent.keyboard('{ArrowLeft}'); // already the oldest
        expect(shown()).toMatch(/\/1\.jpg/);
        await userEvent.keyboard('{ArrowRight}{ArrowRight}');
        expect(shown()).toMatch(/\/3\.jpg/);
    });
});

describe('MediaGalleryModal detail view zoom', () => {
    const pic = (id: number, ts: string) => ({ id, content: null, timestamp: ts, type: 'picture', is_favorite: false, media_file: `messages/a/picture/${id}.jpg` }) as unknown as Message;
    const messages = [pic(1, '2026-10-01T04:00:00Z'), pic(2, '2026-10-02T04:00:00Z')];

    const openDetail = async (msgs: Message[] = messages, thumb = 0) => {
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={msgs} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        const thumbs = Array.from(document.querySelectorAll('img')).map((i) => i.closest('button')!);
        await userEvent.click(thumbs[thumb]);
        const viewer = await screen.findByRole('dialog', { name: 'Media viewer' });
        const stage = screen.getByTestId('viewer-stage');
        vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
            left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}),
        } as DOMRect);
        return { viewer, stage };
    };
    const img = () => screen.getByRole('img', { name: 'Media viewer' });
    const scale = () => Number(/scale\(([\d.]+)\)/.exec(img().style.transform)![1]);

    it('shows the zoom controls and zooms with the wheel, buttons, arrows and double-click', async () => {
        const { viewer } = await openDetail();
        const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
        const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
        const fit = screen.getByRole('button', { name: 'Fit to screen' });
        expect(scale()).toBe(1);
        expect(zoomOut).toHaveAttribute('aria-disabled', 'true');
        expect(fireEvent.wheel(viewer, { deltaY: -100, clientX: 300, clientY: 150 })).toBe(false);
        expect(scale()).toBeGreaterThan(1);
        await userEvent.click(fit);
        expect(scale()).toBe(1);
        await userEvent.click(zoomIn);
        expect(scale()).toBe(1.25);
        await userEvent.click(zoomOut);
        expect(scale()).toBe(1);
        await userEvent.keyboard('{ArrowUp}');
        expect(scale()).toBe(1.25);
        await userEvent.keyboard('{ArrowDown}');
        expect(scale()).toBe(1);
        fireEvent.doubleClick(img(), { clientX: 200, clientY: 150 });
        expect(scale()).toBe(2);
    });

    it('drags to pan only when zoomed', async () => {
        const { stage } = await openDetail();
        fireEvent.pointerDown(img(), { pointerId: 1, button: 0, clientX: 200, clientY: 150 });
        fireEvent.pointerMove(img(), { pointerId: 1, clientX: 250, clientY: 150 });
        expect(img().style.transform).toContain('translate(0px, 0px)');
        fireEvent.doubleClick(img(), { clientX: 200, clientY: 150 });
        expect(stage).toHaveClass('cursor-grab');
        fireEvent.pointerDown(img(), { pointerId: 2, button: 0, clientX: 200, clientY: 150 });
        fireEvent.pointerMove(img(), { pointerId: 2, clientX: 250, clientY: 150 });
        expect(img().style.transform).toContain('translate(50px, 0px)');
        fireEvent.lostPointerCapture(img(), { pointerId: 2 });
        expect(stage).not.toHaveClass('cursor-grabbing');
    });

    it('keeps ← / → stepping older / newer while zoomed, and resets zoom on the new photo', async () => {
        await openDetail(messages, 0); // newest first: thumb 0 is id 2
        fireEvent.doubleClick(img(), { clientX: 200, clientY: 150 });
        expect(scale()).toBe(2);
        await userEvent.keyboard('{ArrowLeft}');
        expect(img().getAttribute('src')).toMatch(/\/1\.jpg/);
        expect(scale()).toBe(1);
    });

    it('gives videos no zoom controls and leaves the wheel alone', async () => {
        window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
        window.HTMLMediaElement.prototype.pause = vi.fn();
        window.HTMLMediaElement.prototype.load = vi.fn();
        const video = { id: 9, content: null, timestamp: '2026-10-05T04:00:00Z', type: 'video', is_favorite: false, media_file: 'messages/a/video/9.mp4' } as unknown as Message;
        vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[video]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        await userEvent.click(screen.getByRole('tab', { name: 'Videos' }));
        await userEvent.click(screen.getByTestId('modal-body').querySelector('button') as HTMLElement);
        const viewer = await screen.findByRole('dialog', { name: 'Media viewer' });
        expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
        expect(fireEvent.wheel(viewer, { deltaY: -100 })).toBe(true);
    });
});
