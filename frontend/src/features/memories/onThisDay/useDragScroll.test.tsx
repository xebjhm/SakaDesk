import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useDragScroll } from './useDragScroll';

function Strip({ onClick }: { onClick: () => void }) {
    const { ref, handlers } = useDragScroll<HTMLDivElement>();
    return (
        <div data-testid="strip" ref={ref} {...handlers}>
            <button type="button" onClick={onClick}>col</button>
        </div>
    );
}

describe('useDragScroll', () => {
    it('scrolls with a pointer drag and swallows the click that ends it', () => {
        const onClick = vi.fn();
        render(<Strip onClick={onClick} />);
        const strip = screen.getByTestId('strip');
        strip.scrollLeft = 100;
        const col = screen.getByRole('button');
        fireEvent.pointerDown(col, { button: 0, clientX: 200, pointerId: 1 });
        fireEvent.pointerMove(col, { clientX: 150, pointerId: 1 });
        expect(strip.scrollLeft).toBe(150);
        fireEvent.pointerUp(col, { clientX: 150, pointerId: 1 });
        fireEvent.click(col);
        expect(onClick).not.toHaveBeenCalled();
        // The next plain click goes through.
        fireEvent.click(col);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('lets a tiny movement through as a click', () => {
        const onClick = vi.fn();
        render(<Strip onClick={onClick} />);
        const col = screen.getByRole('button');
        fireEvent.pointerDown(col, { button: 0, clientX: 200, pointerId: 1 });
        fireEvent.pointerMove(col, { clientX: 197, pointerId: 1 });
        fireEvent.pointerUp(col, { clientX: 197, pointerId: 1 });
        fireEvent.click(col);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('maps the vertical wheel to horizontal scroll', () => {
        render(<Strip onClick={() => {}} />);
        const strip = screen.getByTestId('strip');
        strip.scrollLeft = 0;
        fireEvent.wheel(strip, { deltaY: 80 });
        expect(strip.scrollLeft).toBe(80);
    });
});
