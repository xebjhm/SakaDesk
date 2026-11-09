import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useRef } from 'react';
import { useAnchorRect } from './useAnchorRect';

const Probe = ({ enabled }: { enabled: boolean }) => {
    const ref = useRef<HTMLDivElement>(null);
    const rect = useAnchorRect(ref, enabled);
    return <div ref={ref} data-testid="anchor">{rect ? `${rect.left},${rect.top},${rect.width},${rect.height}` : 'none'}</div>;
};

const box = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

afterEach(() => vi.restoreAllMocks());

describe('useAnchorRect', () => {
    it('measures while enabled and follows a window resize (no ResizeObserver in jsdom)', () => {
        const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(box(80, 64, 600, 400));
        render(<Probe enabled />);
        expect(screen.getByTestId('anchor')).toHaveTextContent('80,64,600,400');
        spy.mockReturnValue(box(80, 64, 500, 380));
        act(() => { window.dispatchEvent(new Event('resize')); });
        expect(screen.getByTestId('anchor')).toHaveTextContent('80,64,500,380');
    });

    it('measures nothing while disabled', () => {
        render(<Probe enabled={false} />);
        expect(screen.getByTestId('anchor')).toHaveTextContent('none');
    });
});
