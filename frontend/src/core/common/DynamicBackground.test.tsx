import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DynamicBackground } from './DynamicBackground';

describe('DynamicBackground', () => {
    it('draws three orbs from the group ambient tokens, with no inline colour or stylesheet', () => {
        const { container } = render(<DynamicBackground />);
        const layer = container.firstChild as HTMLElement;
        expect(layer).toHaveAttribute('aria-hidden', 'true');
        expect(layer).toHaveClass('pointer-events-none', 'absolute', 'inset-0');
        for (const n of [1, 2, 3]) {
            const orb = layer.querySelector(`.bg-group-ambient-${n}`) as HTMLElement;
            expect(orb).not.toBeNull();
            expect(orb.getAttribute('style')).toBeNull();
            expect(orb).toHaveClass(`w-[var(--ds-group-ambient-${n}-size)]`, `opacity-[var(--ds-group-ambient-${n}-opacity)]`);
            expect(orb).toHaveClass('motion-reduce:animate-none');
        }
        expect(container.querySelector('style')).toBeNull();
    });

    it('maps the breathing orb keyframe variable to the token opacity', () => {
        const { container } = render(<DynamicBackground />);
        const orb = container.querySelector('.bg-group-ambient-3') as HTMLElement;
        expect(orb).toHaveClass('animate-orb-breathe', '[--orb-opacity:var(--ds-group-ambient-3-opacity)]');
    });
});
