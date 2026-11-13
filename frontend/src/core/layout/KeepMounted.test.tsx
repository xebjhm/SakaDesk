import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeepMounted } from './KeepMounted';
import { useFeatureActive } from '../../design/featureActive';

const Probe = () => <span data-testid="probe">{useFeatureActive() ? 'active' : 'hidden'}</span>;

describe('KeepMounted', () => {
    it('shows its child normally while active', () => {
        render(<KeepMounted active><Probe /></KeepMounted>);
        const box = screen.getByTestId('kept-feature');
        expect(box).not.toHaveAttribute('inert');
        expect(box.style.contentVisibility).toBe('');
        expect(screen.getByTestId('probe')).toHaveTextContent('active');
    });

    it('keeps the same child mounted, inert and skipped from rendering while hidden', () => {
        const { rerender } = render(<KeepMounted active><Probe /></KeepMounted>);
        const node = screen.getByTestId('probe');
        rerender(<KeepMounted active={false}><Probe /></KeepMounted>);
        const box = screen.getByTestId('kept-feature');
        expect(screen.getByTestId('probe')).toBe(node);
        expect(box).toHaveAttribute('inert');
        expect(box.style.contentVisibility).toBe('hidden');
        expect(node).toHaveTextContent('hidden');
    });
});
