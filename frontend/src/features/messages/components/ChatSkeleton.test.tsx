import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ChatSkeleton } from './ChatSkeleton';

describe('ChatSkeleton', () => {
    it('is hidden from assistive tech (the StatusBlock around it carries the label)', () => {
        const { container } = render(<ChatSkeleton />);
        const root = container.firstElementChild as HTMLElement;
        expect(root).toHaveAttribute('aria-hidden', 'true');
        expect(root).toHaveAttribute('data-testid', 'chat-skeleton');
    });

    it('draws 6 message rows, each an avatar circle plus 1 or 2 bubble blocks, alternating', () => {
        const { getAllByTestId } = render(<ChatSkeleton />);
        const rows = getAllByTestId('chat-skeleton-row');
        expect(rows).toHaveLength(6);
        const bubbleCounts = rows.map((row) => {
            const skeletons = Array.from(row.querySelectorAll('[data-skeleton]'));
            const circles = skeletons.filter((el) => el.className.includes('aspect-square'));
            expect(circles).toHaveLength(1);
            return skeletons.length - circles.length;
        });
        bubbleCounts.forEach((n) => expect([1, 2]).toContain(n));
        // Alternating: no two neighbouring rows share the same bubble count.
        for (let i = 1; i < bubbleCounts.length; i += 1) expect(bubbleCounts[i]).not.toBe(bubbleCounts[i - 1]);
    });

    it('uses default-tone (veil) placeholders that stop pulsing under reduced motion', () => {
        const { container } = render(<ChatSkeleton />);
        const skeletons = Array.from(container.querySelectorAll('[data-skeleton]'));
        expect(skeletons.length).toBeGreaterThan(6);
        for (const el of skeletons) {
            expect(el.className).toContain('bg-skeleton-veil');
            expect(el.className).toContain('motion-reduce:animate-none');
        }
    });

    it('is a fixed pattern, not random (two renders match)', () => {
        const a = render(<ChatSkeleton />).container.innerHTML;
        const b = render(<ChatSkeleton />).container.innerHTML;
        expect(a).toBe(b);
    });
});
