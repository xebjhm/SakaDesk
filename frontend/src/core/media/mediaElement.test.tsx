import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useRef } from 'react';
import { render, act } from '@testing-library/react';
import { releaseMediaElement, useMediaDuration, useMediaSource } from './mediaElement';

const Player: React.FC<{ src?: string }> = ({ src }) => {
    const ref = useRef<HTMLVideoElement>(null);
    useMediaSource(ref, src);
    return <video data-testid="v" ref={ref} />;
};

beforeEach(() => {
    HTMLMediaElement.prototype.pause = vi.fn();
    HTMLMediaElement.prototype.load = vi.fn();
});

describe('releaseMediaElement', () => {
    it('pauses, clears src on the element and its <source> children, then loads', () => {
        const video = document.createElement('video');
        video.setAttribute('src', '/a.mp4');
        const source = document.createElement('source');
        source.setAttribute('src', '/a.webm');
        video.appendChild(source);
        const order: string[] = [];
        video.pause = vi.fn(() => { order.push('pause'); });
        video.load = vi.fn(() => { order.push(`load:${video.getAttribute('src')}:${source.getAttribute('src')}`); });

        releaseMediaElement(video);

        expect(order).toEqual(['pause', 'load:null:null']);
    });

    it('ignores a missing element', () => {
        expect(() => releaseMediaElement(null)).not.toThrow();
    });
});

describe('useMediaSource', () => {
    it('sets src on mount and releases the element on unmount', () => {
        const { getByTestId, unmount } = render(<Player src="/a.mp4" />);
        const video = getByTestId('v') as HTMLVideoElement;
        expect(video.getAttribute('src')).toBe('/a.mp4');
        unmount();
        expect(video.getAttribute('src')).toBeNull();
        expect(video.pause).toHaveBeenCalled();
        expect(video.load).toHaveBeenCalledTimes(1);
    });

    it('releases the old source before binding the new one', () => {
        const { getByTestId, rerender } = render(<Player src="/a.mp4" />);
        const video = getByTestId('v') as HTMLVideoElement;
        const seen: Array<string | null> = [];
        (video.load as ReturnType<typeof vi.fn>).mockImplementation(() => { seen.push(video.getAttribute('src')); });
        rerender(<Player src="/b.mp4" />);
        expect(seen).toEqual([null]);
        expect(video.getAttribute('src')).toBe('/b.mp4');
    });

    it('leaves the element without a source (no request) when src is empty', () => {
        const { getByTestId, unmount } = render(<Player src="" />);
        const video = getByTestId('v') as HTMLVideoElement;
        expect(video.hasAttribute('src')).toBe(false);
        unmount();
        expect(video.load).not.toHaveBeenCalled();
    });
});

describe('useMediaDuration', () => {
    const Probe: React.FC<{ src?: string; onBind?: (el: HTMLVideoElement) => void }> = ({ src = '/a.mp4', onBind }) => {
        const ref = useRef<HTMLVideoElement>(null);
        useMediaSource(ref, src);
        const duration = useMediaDuration(ref, src);
        return <video data-testid="v" ref={(el) => { (ref as React.MutableRefObject<HTMLVideoElement | null>).current = el; if (el) onBind?.(el); }}>{duration}</video>;
    };
    const setProps = (el: HTMLMediaElement, props: { readyState?: number; duration?: number }) => {
        for (const [k, v] of Object.entries(props)) Object.defineProperty(el, k, { configurable: true, value: v });
    };

    it('reads the duration at once when metadata is already loaded', () => {
        const { getByTestId } = render(<Probe onBind={(el) => setProps(el, { readyState: 1, duration: 42 })} />);
        expect(getByTestId('v').textContent).toBe('42');
    });

    it('follows loadedmetadata and later durationchange events', () => {
        const { getByTestId } = render(<Probe />);
        const el = getByTestId('v') as HTMLVideoElement;
        expect(el.textContent).toBe('0');
        setProps(el, { duration: 10 });
        act(() => { el.dispatchEvent(new Event('loadedmetadata')); });
        expect(el.textContent).toBe('10');
        setProps(el, { duration: 12.5 });
        act(() => { el.dispatchEvent(new Event('durationchange')); });
        expect(el.textContent).toBe('12.5');
    });

    it.each([Infinity, NaN])('ignores a %s duration (already loaded or via event)', (bad) => {
        const { getByTestId } = render(<Probe onBind={(el) => setProps(el, { readyState: 1, duration: bad })} />);
        const el = getByTestId('v') as HTMLVideoElement;
        expect(el.textContent).toBe('0');
        act(() => { el.dispatchEvent(new Event('durationchange')); });
        expect(el.textContent).toBe('0');
    });

    it('stops listening on unmount', () => {
        const { getByTestId, unmount } = render(<Probe />);
        const el = getByTestId('v') as HTMLVideoElement;
        const remove = vi.spyOn(el, 'removeEventListener');
        unmount();
        expect(remove).toHaveBeenCalledWith('loadedmetadata', expect.any(Function));
        expect(remove).toHaveBeenCalledWith('durationchange', expect.any(Function));
    });
});
