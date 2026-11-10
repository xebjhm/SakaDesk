import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryThumb } from './MemoryThumb';

describe('MemoryThumb', () => {
    it('shows a picture as an image', () => {
        const { container } = render(<MemoryThumb message={{ type: 'picture', media_url: '/p.jpg' }} />);
        expect(container.querySelector('img')).toHaveAttribute('src', '/p.jpg');
        // grids of thousands of stills: load and decode off the critical path
        expect(container.querySelector('img')).toHaveAttribute('loading', 'lazy');
        expect(container.querySelector('img')).toHaveAttribute('decoding', 'async');
    });

    it('never puts a video into an image', () => {
        const { container } = render(<MemoryThumb message={{ type: 'video', media_url: '/v.mp4' }} />);
        expect(container.querySelector('img')).toBeNull();
        const video = screen.getByTestId('memory-thumb-video') as HTMLVideoElement;
        expect(video).toHaveAttribute('src', '/v.mp4');
        expect(video.muted).toBe(true);
        expect(video).toHaveAttribute('preload', 'metadata');
    });

    it('shows a film tile for a video without a file and nothing for text', () => {
        render(<MemoryThumb message={{ type: 'video', media_url: null }} />);
        expect(screen.getByTestId('memory-thumb-video-tile')).toBeInTheDocument();
        const { container } = render(<MemoryThumb message={{ type: 'text', media_url: null }} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('asks for a thumbnail at the drawn size and falls back to the full file on error', () => {
        const url = '/api/content/media/hinatazaka46/messages/r/picture/1.jpg';
        const { container } = render(<MemoryThumb message={{ type: 'picture', media_url: url }} px={120} />);
        const img = container.querySelector('img')!;
        expect(img.getAttribute('src')).toMatch(/^\/api\/content\/thumb\/hinatazaka46\/messages\/r\/picture\/1\.jpg\?w=(160|320|480|640)$/);
        fireEvent.error(img);
        expect(container.querySelector('img')).toHaveAttribute('src', url);
    });

    it('caps a big tile at the pre-generated 480 unless it is large (★ / cover / export)', () => {
        const url = '/api/content/media/hinatazaka46/messages/r/picture/1.jpg';
        const thumb = '/api/content/thumb/hinatazaka46/messages/r/picture/1.jpg';
        const { container, rerender } = render(<MemoryThumb message={{ type: 'picture', media_url: url }} px={600} />);
        expect(container.querySelector('img')).toHaveAttribute('src', `${thumb}?w=480`);
        rerender(<MemoryThumb message={{ type: 'picture', media_url: url }} px={600} large />);
        expect(container.querySelector('img')).toHaveAttribute('src', `${thumb}?w=640`);
    });

    it('never asks for a video thumbnail', () => {
        render(<MemoryThumb message={{ type: 'video', media_url: '/api/content/media/s/v.mp4' }} px={120} />);
        expect(screen.getByTestId('memory-thumb-video')).toHaveAttribute('src', '/api/content/media/s/v.mp4');
    });
});

describe('MemoryThumb video lazy mount', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('mounts the video only while it is in view', () => {
        let report: ((hit: boolean) => void) | null = null;
        class FakeObserver {
            constructor(cb: IntersectionObserverCallback) {
                report = (hit) => cb([{ isIntersecting: hit } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
            }
            observe() {}
            unobserve() {}
            disconnect() {}
            takeRecords() { return []; }
        }
        vi.stubGlobal('IntersectionObserver', FakeObserver);
        render(<MemoryThumb message={{ type: 'video', media_url: '/v.mp4' }} className="h-10" />);
        expect(screen.queryByTestId('memory-thumb-video')).toBeNull();
        expect(screen.getByTestId('memory-thumb-video-tile').parentElement).toHaveClass('h-10');
        act(() => report!(true));
        expect(screen.getByTestId('memory-thumb-video')).toBeInTheDocument();
        act(() => report!(false));
        expect(screen.queryByTestId('memory-thumb-video')).toBeNull();
    });
});
