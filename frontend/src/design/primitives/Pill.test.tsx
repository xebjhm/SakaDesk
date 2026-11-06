import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from './Pill';

describe('Pill', () => {
    it('selected follows the accent roles (spec section 8): subtle fill, border, strong text', () => {
        render(<Pill selected>All</Pill>);
        const pill = screen.getByRole('button', { name: 'All' });
        expect(pill).toHaveAttribute('aria-pressed', 'true');
        expect(pill).toHaveClass('bg-accent-subtle', 'text-accent-strong', 'ring-accent-border');
        expect(pill).not.toHaveClass('bg-sunken');
    });

    it('unselected stays a quiet white pill', () => {
        render(<Pill>Favorite</Pill>);
        const pill = screen.getByRole('button', { name: 'Favorite' });
        expect(pill).toHaveAttribute('aria-pressed', 'false');
        expect(pill).toHaveClass('bg-pill', 'text-secondary');
    });

    it('tone="oshi" selected uses the oshi roles, not the accent', () => {
        render(<Pill selected tone="oshi">Favorite</Pill>);
        const pill = screen.getByRole('button', { name: 'Favorite' });
        expect(pill).toHaveClass('bg-semantic-oshi-subtle', 'text-semantic-oshi', 'ring-semantic-oshi');
        expect(pill).not.toHaveClass('bg-accent-subtle', 'text-accent-strong', 'ring-accent-border');
    });

    it('tone="oshi" unselected stays a quiet white pill', () => {
        render(<Pill tone="oshi">Favorite</Pill>);
        expect(screen.getByRole('button', { name: 'Favorite' })).toHaveClass('bg-pill', 'text-secondary');
    });
});
