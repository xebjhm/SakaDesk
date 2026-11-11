import { useRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useGridColumns } from './useGridColumns';

function Probe() {
    const ref = useRef<HTMLDivElement>(null);
    const { cols, tilePx, width } = useGridColumns(ref);
    return <div ref={ref} data-testid="grid" style={{ paddingLeft: 16, paddingRight: 16 }}>{`${width}:${cols}:${tilePx}`}</div>;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('useGridColumns', () => {
    it('measures the content width (padding excluded) before any ResizeObserver report', () => {
        vi.stubGlobal('ResizeObserver', undefined);
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(832);
        render(<Probe />);
        expect(screen.getByTestId('grid').textContent).toBe(`800:5:${Math.floor((800 - 8 * 4) / 5)}`);
    });

    it('lays out one minimum tile per row while the width is unknown', () => {
        vi.stubGlobal('ResizeObserver', undefined);
        render(<Probe />);
        expect(screen.getByTestId('grid').textContent).toBe('0:1:144');
    });
});
