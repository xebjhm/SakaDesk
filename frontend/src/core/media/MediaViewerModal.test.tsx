import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { MediaViewerModal, type MediaViewerItem } from './PhotoDetailModal';
import { useAppStore } from '../../store/appStore';
import { resetDialogStack } from '../../design/dialog/dialogStack';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => resetDialogStack());

const items: MediaViewerItem[] = [
    { src: '/a.jpg', type: 'picture', timestamp: '2026-11-01T00:00:00Z', sourceLabel: '春の日記 🌸', onSourceJump: vi.fn() },
    { src: '/b.jpg', type: 'picture', timestamp: '2026-11-02T00:00:00Z' },
];

describe('MediaViewerModal', () => {
    it('is a dark named dialog with overlay controls', () => {
        render(<MediaViewerModal mediaItems={items} currentIndex={0} onClose={vi.fn()} onNavigate={vi.fn()} />);
        expect(screen.getByRole('dialog', { name: 'Media viewer' })).toBeInTheDocument();
        expect(screen.getByTestId('modal-backdrop')).toHaveClass('bg-viewer-scrim');
        expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('bg-viewer-control');
        expect(screen.getByText('1 / 2')).toHaveClass('text-viewer-muted');
        expect(screen.getByRole('button', { name: '春の日記 🌸' })).toHaveClass('decoration-viewer');
    });

    it('← / → navigate, Escape closes through the dialog layer', async () => {
        const onNavigate = vi.fn();
        const onClose = vi.fn();
        render(<MediaViewerModal mediaItems={items} currentIndex={0} onClose={onClose} onNavigate={onNavigate} />);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
        expect(onNavigate).toHaveBeenCalledWith(1);
        await userEvent.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('the source link jumps', async () => {
        render(<MediaViewerModal mediaItems={items} currentIndex={0} onClose={vi.fn()} onNavigate={vi.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: '春の日記 🌸' }));
        expect(items[0].onSourceJump).toHaveBeenCalled();
    });

    it('keeps ← / → working after navigating away from the focused Download button', async () => {
        useAppStore.setState({ goldenFingerActive: true });
        try {
            const pics: MediaViewerItem[] = [
                { src: '/a.jpg', type: 'picture', timestamp: '2026-11-01T00:00:00Z' },
                { src: '/b.mp3', type: 'voice', timestamp: '2026-11-02T00:00:00Z' },
                { src: '/c.jpg', type: 'picture', timestamp: '2026-11-03T00:00:00Z' },
            ];
            const onNavigate = vi.fn();
            const { rerender } = render(<MediaViewerModal mediaItems={pics} currentIndex={0} onClose={vi.fn()} onNavigate={onNavigate} />);
            screen.getByRole('button', { name: 'Download' }).focus();
            await userEvent.keyboard('{ArrowRight}');
            expect(onNavigate).toHaveBeenLastCalledWith(1);
            rerender(<MediaViewerModal mediaItems={pics} currentIndex={1} onClose={vi.fn()} onNavigate={onNavigate} />);
            expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
            await userEvent.keyboard('{ArrowRight}');
            expect(onNavigate).toHaveBeenLastCalledWith(2);
        } finally {
            useAppStore.setState({ goldenFingerActive: false });
        }
    });

    it.each([
        ['video', '/v.mp4'],
        ['voice', '/v.m4a'],
    ] as const)('↑ / ↓ change the %s volume (the frame leaves them to the player)', (type, src) => {
        window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
        window.HTMLMediaElement.prototype.pause = vi.fn();
        window.HTMLMediaElement.prototype.load = vi.fn();
        const media: MediaViewerItem[] = [{ src, type, timestamp: '2026-11-01T00:00:00Z' }];
        const { container } = render(<MediaViewerModal mediaItems={media} currentIndex={0} onClose={vi.fn()} onNavigate={vi.fn()} />);
        const slider = () => container.ownerDocument.querySelector<HTMLInputElement>('input[type="range"][step="0.01"]')!;
        const before = Number(slider().value);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowUp' });
        expect(Number(slider().value)).toBeCloseTo(before + 0.05);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' });
        expect(Number(slider().value)).toBeCloseTo(before);
    });

    describe('time-aware navigation (← older, → newer)', () => {
        const three: MediaViewerItem[] = [
            { src: '/1.jpg', type: 'picture', timestamp: '2026-11-01T00:00:00Z' },
            { src: '/2.jpg', type: 'picture', timestamp: '2026-11-02T00:00:00Z' },
            { src: '/3.jpg', type: 'picture', timestamp: '2026-11-03T00:00:00Z' },
        ];

        it('oldest-first (default): ← goes to index-1 and → to index+1', () => {
            const onNavigate = vi.fn();
            render(<MediaViewerModal mediaItems={three} currentIndex={1} onClose={vi.fn()} onNavigate={onNavigate} />);
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
            expect(onNavigate).toHaveBeenLastCalledWith(0);
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
            expect(onNavigate).toHaveBeenLastCalledWith(2);
            expect(screen.getByText('2 / 3')).toBeInTheDocument();
        });

        it('newest-first: ← goes to the older item (index+1), → to the newer (index-1), oldest = 1', () => {
            const newestFirst = [...three].reverse();
            const onNavigate = vi.fn();
            render(<MediaViewerModal mediaItems={newestFirst} currentIndex={1} order="newest_first" onClose={vi.fn()} onNavigate={onNavigate} />);
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
            expect(onNavigate).toHaveBeenLastCalledWith(2);
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
            expect(onNavigate).toHaveBeenLastCalledWith(0);
            expect(screen.getByText('2 / 3')).toBeInTheDocument();
        });

        it('newest-first: nothing happens past either end', () => {
            const onNavigate = vi.fn();
            const { rerender } = render(<MediaViewerModal mediaItems={three} currentIndex={0} order="newest_first" onClose={vi.fn()} onNavigate={onNavigate} />);
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
            expect(onNavigate).not.toHaveBeenCalled();
            expect(screen.getByText('3 / 3')).toBeInTheDocument();
            rerender(<MediaViewerModal mediaItems={three} currentIndex={2} order="newest_first" onClose={vi.fn()} onNavigate={onNavigate} />);
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
            expect(onNavigate).not.toHaveBeenCalled();
        });
    });

    describe('zoom and pan (pictures)', () => {
        const pics: MediaViewerItem[] = [
            { src: '/1.jpg', type: 'picture', timestamp: '2026-11-01T00:00:00Z' },
            { src: '/2.jpg', type: 'picture', timestamp: '2026-11-02T00:00:00Z' },
        ];
        // jsdom has no layout: give the stage a 400×300 box at the origin (centre 200, 150).
        const layOut = () => {
            const stage = screen.getByTestId('viewer-stage');
            vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
                left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}),
            } as DOMRect);
            return stage;
        };
        const img = () => screen.getByRole('img', { name: 'Media viewer' });
        const transform = () => img().style.transform;
        const view = () => {
            const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(transform());
            if (!m) throw new Error(`unexpected transform ${transform()}`);
            return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
        };
        const renderViewer = (index = 0) => {
            const utils = render(<MediaViewerModal mediaItems={pics} currentIndex={index} onClose={vi.fn()} onNavigate={vi.fn()} />);
            const stage = layOut();
            return { ...utils, stage };
        };

        it('starts at fit', () => {
            renderViewer();
            expect(view()).toEqual({ x: 0, y: 0, scale: 1 });
        });

        it('the wheel zooms around the cursor and does not scroll the page behind', () => {
            renderViewer();
            // 100 px right of the centre.
            const notPrevented = fireEvent.wheel(screen.getByRole('dialog'), { deltaY: -100, clientX: 300, clientY: 150 });
            expect(notPrevented).toBe(false);
            const zoomed = view();
            expect(zoomed.scale).toBeGreaterThan(1);
            // The point under the cursor stays put: the image shifts left.
            expect(zoomed.x).toBeLessThan(0);
            expect(zoomed.y).toBeCloseTo(0);
            fireEvent.wheel(screen.getByRole('dialog'), { deltaY: 100, clientX: 300, clientY: 150 });
            expect(view().scale).toBeCloseTo(1);
        });

        it('the wheel stays at the 4× limit', () => {
            renderViewer();
            for (let i = 0; i < 40; i++) fireEvent.wheel(screen.getByRole('dialog'), { deltaY: -100, clientX: 200, clientY: 150 });
            expect(view().scale).toBe(4);
        });

        it('− / + / fit buttons zoom out, in and back to fit', async () => {
            renderViewer();
            const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
            const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
            const fit = screen.getByRole('button', { name: 'Fit to screen' });
            // Floating viewer controls are full circles.
            for (const b of [zoomIn, zoomOut, fit]) {
                expect(b).toHaveClass('bg-viewer-control');
                expect(b).toHaveAttribute('data-shape', 'circle');
            }
            expect(zoomOut).toHaveAttribute('aria-disabled', 'true');
            expect(fit).toHaveAttribute('aria-disabled', 'true');
            await userEvent.click(zoomIn);
            await userEvent.click(zoomIn);
            expect(view().scale).toBe(1.5);
            expect(zoomOut).not.toHaveAttribute('aria-disabled');
            await userEvent.click(zoomOut);
            expect(view().scale).toBe(1.25);
            await userEvent.click(fit);
            expect(view()).toEqual({ x: 0, y: 0, scale: 1 });
        });

        it('↑ / ↓ still zoom a photo', () => {
            renderViewer();
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowUp' });
            expect(view().scale).toBe(1.25);
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' });
            expect(view().scale).toBe(1);
        });

        it('← / → navigate and do not pan when zoomed', () => {
            const onNavigate = vi.fn();
            render(<MediaViewerModal mediaItems={pics} currentIndex={0} onClose={vi.fn()} onNavigate={onNavigate} />);
            layOut();
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowUp' });
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
            expect(onNavigate).toHaveBeenCalledWith(1);
            expect(view()).toEqual({ x: 0, y: 0, scale: 1.25 });
        });

        it('dragging pans only when zoomed, with pointer capture and a grab cursor', () => {
            const { stage } = renderViewer();
            const capture = vi.fn();
            const release = vi.fn();
            stage.setPointerCapture = capture;
            stage.releasePointerCapture = release;
            stage.hasPointerCapture = () => true;

            // At fit a drag does nothing.
            expect(stage).not.toHaveClass('cursor-grab');
            fireEvent.pointerDown(img(), { pointerId: 1, button: 0, clientX: 200, clientY: 150 });
            fireEvent.pointerMove(img(), { pointerId: 1, clientX: 260, clientY: 190 });
            fireEvent.pointerUp(img(), { pointerId: 1, clientX: 260, clientY: 190 });
            expect(view()).toEqual({ x: 0, y: 0, scale: 1 });
            expect(capture).not.toHaveBeenCalled();

            // Zoomed to 2×: the drag moves the image with the pointer.
            fireEvent.doubleClick(img(), { clientX: 200, clientY: 150 });
            expect(view().scale).toBe(2);
            expect(stage).toHaveClass('cursor-grab');
            fireEvent.pointerDown(img(), { pointerId: 7, button: 0, clientX: 200, clientY: 150 });
            expect(capture).toHaveBeenCalledWith(7);
            expect(stage).toHaveClass('cursor-grabbing');
            fireEvent.pointerMove(img(), { pointerId: 7, clientX: 260, clientY: 110 });
            expect(view()).toEqual({ x: 60, y: -40, scale: 2 });
            // No transition while dragging: the image follows the pointer.
            expect(img()).toHaveClass('transition-none');
            // Clamped: the image cannot be dragged off-screen (at 2× it overhangs 200 / 150 px).
            fireEvent.pointerMove(img(), { pointerId: 7, clientX: 2000, clientY: -2000 });
            expect(view()).toEqual({ x: 200, y: -150, scale: 2 });
            fireEvent.pointerUp(img(), { pointerId: 7, clientX: 2000, clientY: -2000 });
            expect(release).toHaveBeenCalledWith(7);
            expect(stage).not.toHaveClass('cursor-grabbing');
            // After release, moving does not pan.
            fireEvent.pointerMove(img(), { pointerId: 7, clientX: 0, clientY: 0 });
            expect(view()).toEqual({ x: 200, y: -150, scale: 2 });
        });

        it('double-click toggles fit ↔ 2× at the click point', () => {
            renderViewer();
            fireEvent.doubleClick(img(), { clientX: 300, clientY: 100 });
            // The clicked point (100 right, 50 up of the centre) stays under the cursor.
            expect(view()).toEqual({ x: -100, y: 50, scale: 2 });
            fireEvent.doubleClick(img(), { clientX: 300, clientY: 100 });
            expect(view()).toEqual({ x: 0, y: 0, scale: 1 });
        });

        it('resets zoom and pan when the item changes', () => {
            const { rerender } = renderViewer(0);
            fireEvent.doubleClick(img(), { clientX: 300, clientY: 100 });
            expect(view().scale).toBe(2);
            rerender(<MediaViewerModal mediaItems={pics} currentIndex={1} onClose={vi.fn()} onNavigate={vi.fn()} />);
            expect(view()).toEqual({ x: 0, y: 0, scale: 1 });
        });

        it('video and voice get no zoom controls and leave the wheel alone', () => {
            window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
            window.HTMLMediaElement.prototype.pause = vi.fn();
            window.HTMLMediaElement.prototype.load = vi.fn();
            render(<MediaViewerModal mediaItems={[{ src: '/v.mp4', type: 'video', timestamp: '2026-11-01T00:00:00Z' }]} currentIndex={0} onClose={vi.fn()} onNavigate={vi.fn()} />);
            expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
            expect(fireEvent.wheel(screen.getByRole('dialog'), { deltaY: -100 })).toBe(true);
        });

        it('keeps the golden-finger Download beside the zoom controls', () => {
            useAppStore.setState({ goldenFingerActive: true });
            try {
                renderViewer();
                expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
                expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
            } finally {
                useAppStore.setState({ goldenFingerActive: false });
            }
        });
    });
});
