import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buildMediaUrl } from '../../messages/mediaUrl';
import { installMediaTileHarness, readyMeta, type MediaTileHarness } from '../../../__tests__/mediaTileHarness';
import type { MediaMeta } from '../../../core/media/grid/mediaMeta';
import { MemoryThumb } from './MemoryThumb';

const PIC = '/api/content/media/hinatazaka46/messages/r/picture/1.jpg';
const THUMB = '/api/content/thumb/hinatazaka46/messages/r/picture/1.jpg';
const VID = '/api/content/media/hinatazaka46/messages/r/video/2.mp4';
const VID_THUMB = '/api/content/thumb/hinatazaka46/messages/r/video/2.mp4';

let meta: (url: string) => MediaMeta | null;
let h: MediaTileHarness;
const originalDpr = window.devicePixelRatio;

beforeEach(() => {
    meta = () => null;
    h = installMediaTileHarness((u) => meta(u));
});
afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'devicePixelRatio', { value: originalDpr, configurable: true });
});

const setDpr = (dpr: number) => Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });

describe('MemoryThumb on the shared media tile', () => {
    it('with px, a picture asks for the thumbnail at the drawn size, versioned once meta is known', async () => {
        meta = () => readyMeta();
        render(<MemoryThumb message={{ type: 'picture', media_url: PIC }} px={120} />);
        await waitFor(() => expect(h.requested()).toEqual([`${THUMB}?w=160&v=a1b2c3d4e5f6`]));
        await h.load();
        const img = screen.getByTestId('memory-thumb').querySelector('img[data-media-tile-image]')!;
        expect(img).toHaveAttribute('src', `${THUMB}?w=160&v=a1b2c3d4e5f6`);
    });

    it('without meta it asks for the plain thumbnail', async () => {
        render(<MemoryThumb message={{ type: 'picture', media_url: PIC }} px={120} />);
        await waitFor(() => expect(h.requested()).toEqual([`${THUMB}?w=160`]));
    });

    it('paints the placeholder colour before the image', async () => {
        meta = () => readyMeta({ color: 'teal' });
        render(<MemoryThumb message={{ type: 'picture', media_url: PIC }} px={120} className="h-full w-full sepia-memories-1" />);
        const tile = screen.getByTestId('memory-thumb');
        expect(tile).toHaveAttribute('data-state', 'loading');
        expect(tile).toHaveClass('sepia-memories-1');
        await waitFor(() => expect((tile.querySelector('[data-skeleton]') as HTMLElement | null)?.style.backgroundColor).toBe('teal'));
        expect(tile.querySelector('img[data-media-tile-image]')).toBeNull();
    });

    it('calls onFail only after the full file failed too, with a retry handle', async () => {
        meta = () => readyMeta();
        const onFail = vi.fn();
        render(<MemoryThumb message={{ type: 'picture', media_url: PIC }} px={120} onFail={onFail} />);
        await waitFor(() => expect(h.requested()).toHaveLength(1));
        await h.fail(); // ?v
        await waitFor(() => expect(h.requested()).toHaveLength(2));
        expect(h.requested()[1]).toBe(`${THUMB}?w=160`);
        await h.fail(); // plain
        await waitFor(() => expect(h.requested()).toHaveLength(3));
        expect(h.requested()[2]).toBe(PIC);
        expect(onFail).not.toHaveBeenCalled();
        await h.fail(); // the full file
        await waitFor(() => expect(onFail).toHaveBeenCalledTimes(1));
        expect(screen.getByTestId('memory-thumb')).toHaveAttribute('data-state', 'failed');
        // the handle starts the chain again
        onFail.mock.calls[0][0]();
        await waitFor(() => expect(h.requested()).toHaveLength(4));
    });

    it('reports its state to onStateChange', async () => {
        const onStateChange = vi.fn();
        render(<MemoryThumb message={{ type: 'picture', media_url: PIC }} px={120} onStateChange={onStateChange} />);
        expect(onStateChange).toHaveBeenLastCalledWith('loading');
        await waitFor(() => expect(h.requested()).toHaveLength(1));
        await h.load();
        await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith('ready'));
    });

    it('loading="eager" renders a synchronous <img> (the recap poster export)', () => {
        const { container } = render(<MemoryThumb message={{ type: 'picture', media_url: PIC }} px={200} loading="eager" />);
        const img = container.querySelector('img')!;
        expect(img).toHaveAttribute('src', `${THUMB}?w=320`);
        expect(img).toHaveAttribute('loading', 'eager');
        expect(h.requested()).toEqual([]);
    });

    it('without px it loads the original file directly, never a thumbnail first', async () => {
        const onFail = vi.fn();
        const { container } = render(<MemoryThumb message={{ type: 'picture', media_url: PIC }} onFail={onFail} className="h-10" />);
        const img = container.querySelector('img')!;
        expect(img).toHaveAttribute('src', PIC);
        expect(img).toHaveAttribute('loading', 'lazy');
        expect(img).toHaveAttribute('decoding', 'async');
        expect(img).toHaveClass('h-10');
        fireEvent.error(img);
        expect(onFail).toHaveBeenCalledTimes(1);
        expect(h.requested()).toEqual([]);
        expect(h.metaBatches).toEqual([]);
        // eager stays the original too
        const eager = render(<MemoryThumb message={{ type: 'picture', media_url: PIC }} loading="eager" />);
        expect(eager.container.querySelector('img')).toHaveAttribute('src', PIC);
        expect(eager.container.querySelector('img')).toHaveAttribute('loading', 'eager');
    });

    it('caps a big tile at the pre-generated 480 unless it is large (★ / cover)', async () => {
        render(<MemoryThumb message={{ type: 'picture', media_url: PIC }} px={600} />);
        render(<MemoryThumb message={{ type: 'picture', media_url: PIC.replace('1.jpg', '9.jpg') }} px={600} large />);
        await waitFor(() => expect(h.requested()).toHaveLength(2));
        expect(h.requested()).toContain(`${THUMB}?w=480`);
        expect(h.requested()).toContain(`${THUMB.replace('1.jpg', '9.jpg')}?w=640`);
    });

    it('large only lifts the cap: a small still still asks for a small thumbnail', async () => {
        setDpr(1);
        render(<MemoryThumb message={{ type: 'picture', media_url: PIC }} px={144} large />);
        await waitFor(() => expect(h.requested()).toEqual([`${THUMB}?w=160`]));
    });

    it('a video never mounts a <video>: its poster thumbnail when meta has one', async () => {
        meta = () => readyMeta({ kind: 'video', poster: true, v: '0f1e2d3c4b5a' });
        const { container } = render(<MemoryThumb message={{ type: 'video', media_url: VID }} px={120} />);
        await waitFor(() => expect(h.requested()).toEqual([`${VID_THUMB}?w=160&v=0f1e2d3c4b5a`]));
        await h.load();
        expect(container.querySelector('video')).toBeNull();
        expect(container.querySelector('img[data-media-tile-image]')).toHaveAttribute('src', `${VID_THUMB}?w=160&v=0f1e2d3c4b5a`);
    });

    it('a video without a poster shows the film tile and never loads the file as an image', async () => {
        meta = () => readyMeta({ kind: 'video', poster: false });
        const { container } = render(<MemoryThumb message={{ type: 'video', media_url: VID }} px={120} />);
        await waitFor(() => expect(screen.getByTestId('media-tile-film')).toBeInTheDocument());
        expect(container.querySelector('video')).toBeNull();
        expect(h.requested().some((s) => s === VID)).toBe(false);
    });

    it('shows the neutral film tile for a video without a file and nothing for text', () => {
        render(<MemoryThumb message={{ type: 'video', media_url: null }} className="h-10" />);
        expect(screen.getByTestId('memory-thumb-video-tile')).toHaveClass('h-10');
        const { container } = render(<MemoryThumb message={{ type: 'text', media_url: null }} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('encodes CJK and emoji paths', async () => {
        const url = buildMediaUrl('hinatazaka46', 'messages/62 石森 璃花/🌸 写真.jpg');
        render(<MemoryThumb message={{ type: 'picture', media_url: url }} px={100} />);
        const e = encodeURIComponent;
        await waitFor(() => expect(h.requested()).toEqual([
            `/api/content/thumb/hinatazaka46/messages/62%20${e('石森')}%20${e('璃花')}/${e('🌸')}%20${e('写真')}.jpg?w=160`,
        ]));
    });
});
