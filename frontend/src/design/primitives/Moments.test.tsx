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
            expect(o.className).toContain('pointer-events-none');
        });
        expect(screen.getByText('content')).toBeInTheDocument();
        expect(screen.queryByTestId('atmosphere-fade')).toBeNull();
    });
    it('Atmosphere orbs are square boxes so the circular gradient never meets a flat edge', () => {
        render(<Atmosphere><p>content</p></Atmosphere>);
        screen.getAllByTestId('atmosphere-orb').forEach((o) => {
            expect(o.className).toContain('aspect-square');
            expect(o.className).toContain('rounded-full');
            expect(o.className.split(/\s+/).filter((c) => /^h-/.test(c))).toEqual([]);
        });
    });
    it('Atmosphere fade masks only the orb layer, never the children', () => {
        render(<Atmosphere fade><p>content</p></Atmosphere>);
        const layer = screen.getByTestId('atmosphere-fade');
        expect(layer.className).toContain('mask-fade-y');
        expect(layer.className).toContain('absolute inset-0');
        expect(layer.querySelectorAll('[data-testid="atmosphere-orb"]')).toHaveLength(3);
        expect(layer.contains(screen.getByText('content'))).toBe(false);
    });
    it('CelebrationToast is a polite status with sparkles hidden under reduced motion', () => {
        render(<CelebrationToast title="Sync complete" description="12,846 messages" />);
        const toast = screen.getByRole('status');
        expect(toast).toHaveAttribute('aria-live', 'polite');
        const sparkles = toast.querySelectorAll('[data-sparkle]');
        expect(sparkles).toHaveLength(10);
        sparkles.forEach((s) => {
            expect(s.className).toContain('motion-reduce:hidden');
            expect(s.className).toContain('pointer-events-none');
        });
        expect(toast.className).toContain('animate-toast-in');
        expect(toast.className).toContain('motion-reduce:animate-none');
        expect(toast.className).not.toContain('overflow-hidden');
    });
    it('MilestoneCard shows the number in the display face with tabular numerals and 26 confetti', () => {
        render(<MilestoneCard value="365" label="days" />);
        const n = screen.getByText('365');
        expect(n.className).toContain('font-display');
        expect(n.className).toContain('tabular-nums');
        const confetti = document.querySelectorAll('[data-confetti]');
        expect(confetti).toHaveLength(26);
        confetti.forEach((c) => {
            expect(c.className).toContain('motion-reduce:hidden');
            expect(c.className).toContain('pointer-events-none');
        });
        expect(confetti[0].parentElement!.className).toContain('motion-reduce:animate-none');
    });
    it('MilestoneCard keeps the pastel surface but a neutral numeral and no glow', () => {
        render(<MilestoneCard value="365" label="days" />);
        const n = screen.getByText('365');
        expect(n).toHaveClass('text-primary');
        expect(n.className).not.toContain('accent');
        const card = n.parentElement!;
        expect(card).toHaveClass('bg-expressive-soft', 'border-accent-border');
        expect(card.className).not.toContain('shadow-accent-glow');
    });
});
