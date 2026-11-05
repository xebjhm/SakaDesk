import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';
import { Atmosphere } from './Atmosphere';
import { CelebrationToast, MilestoneCard } from './Celebration';

describe('brand-moment primitives', () => {
    it('EmptyState: soft circle, display-face title, optional action', () => {
        render(<EmptyState icon={<span>i</span>} title="No favourites yet" description="Right-click a message" action={<button>Go</button>} />);
        const title = screen.getByRole('heading', { name: 'No favourites yet' });
        expect(title.className).toContain('font-display');
        expect(screen.getByTestId('empty-state-circle').className).toContain('bg-expressive-soft');
        expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
    });
    it('Atmosphere draws three orbs that stop with reduced motion', () => {
        render(<Atmosphere><p>content</p></Atmosphere>);
        const orbs = screen.getAllByTestId('atmosphere-orb');
        expect(orbs).toHaveLength(3);
        orbs.forEach((o, i) => {
            expect(o.className).toContain(`bg-expressive-orb-${i + 1}`);
            expect(o.className).toContain('motion-reduce:animate-none');
        });
        expect(screen.getByText('content')).toBeInTheDocument();
    });
    it('CelebrationToast is a polite status with sparkles hidden under reduced motion', () => {
        render(<CelebrationToast title="Sync complete" description="12,846 messages" />);
        const toast = screen.getByRole('status');
        expect(toast).toHaveAttribute('aria-live', 'polite');
        const sparkles = toast.querySelectorAll('[data-sparkle]');
        expect(sparkles).toHaveLength(10);
        sparkles.forEach((s) => expect(s.className).toContain('motion-reduce:hidden'));
    });
    it('MilestoneCard shows the number in the display face with tabular numerals and 26 confetti', () => {
        render(<MilestoneCard value="365" label="days" />);
        const n = screen.getByText('365');
        expect(n.className).toContain('font-display');
        expect(n.className).toContain('tabular-nums');
        expect(document.querySelectorAll('[data-confetti]')).toHaveLength(26);
    });
});
