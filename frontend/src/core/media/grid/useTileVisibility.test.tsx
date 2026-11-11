import { useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useTileVisibility, useTileVisibilityState } from './useTileVisibility';

class StubObserver {
    static all: StubObserver[] = [];
    observed = new Set<Element>();
    disconnect = vi.fn();
    constructor(public cb: IntersectionObserverCallback, public options: IntersectionObserverInit) {
        StubObserver.all.push(this);
    }
    observe(el: Element) { this.observed.add(el); }
    unobserve(el: Element) { this.observed.delete(el); }
    fire(el: Element, isIntersecting: boolean) {
        this.cb([{ target: el, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
}

function Probe({ id, root }: { id: string; root?: Element | null }) {
    const ref = useRef<HTMLDivElement>(null);
    const v = useTileVisibility(ref, root ?? null);
    return <div ref={ref} data-testid={id}>{v}</div>;
}

beforeEach(() => {
    StubObserver.all = [];
    vi.stubGlobal('IntersectionObserver', StubObserver);
});
afterEach(() => vi.unstubAllGlobals());

describe('useTileVisibility', () => {
    it('shares one observer per root and reports visible / near', () => {
        const root = document.createElement('div');
        const { unmount } = render(<><Probe id="a" root={root} /><Probe id="b" root={root} /></>);
        expect(StubObserver.all).toHaveLength(1);
        const io = StubObserver.all[0];
        expect(io.options).toEqual({ root, rootMargin: '0px' });
        expect(screen.getByTestId('a').textContent).toBe('near');
        act(() => io.fire(screen.getByTestId('a'), true));
        expect(screen.getByTestId('a').textContent).toBe('visible');
        expect(screen.getByTestId('b').textContent).toBe('near');
        act(() => io.fire(screen.getByTestId('a'), false));
        expect(screen.getByTestId('a').textContent).toBe('near');
        unmount();
        expect(io.observed.size).toBe(0);
        expect(io.disconnect).toHaveBeenCalledTimes(1);
    });

    it('uses a separate observer for the viewport and another root', () => {
        render(<><Probe id="a" /><Probe id="b" root={document.createElement('div')} /></>);
        expect(StubObserver.all).toHaveLength(2);
        expect(StubObserver.all[0].options.root).toBeNull();
    });

    it('reports known only after the first observer callback', () => {
        function StateProbe() {
            const ref = useRef<HTMLDivElement>(null);
            const { priority, known } = useTileVisibilityState(ref);
            return <div ref={ref} data-testid="s">{`${priority}:${known}`}</div>;
        }
        render(<StateProbe />);
        expect(screen.getByTestId('s').textContent).toBe('near:false');
        act(() => StubObserver.all[0].fire(screen.getByTestId('s'), false));
        expect(screen.getByTestId('s').textContent).toBe('near:true');
    });

    it('treats every tile as visible without IntersectionObserver', () => {
        vi.stubGlobal('IntersectionObserver', undefined);
        render(<Probe id="a" />);
        expect(screen.getByTestId('a').textContent).toBe('visible');
    });
});
