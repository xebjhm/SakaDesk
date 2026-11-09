import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TranscribeButton } from './TranscribeButton';

describe('TranscribeButton neutral look', () => {
    it('idle dark button is neutral: subtle border, secondary text, no inline accent', () => {
        render(<TranscribeButton state="idle" onClick={vi.fn()} />);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('border-subtle', 'text-secondary', 'hover:text-primary');
        expect(button.getAttribute('style') ?? '').not.toMatch(/color|background/);
    });

    it('loading dark label is neutral', () => {
        render(<TranscribeButton state="loading" onClick={vi.fn()} />);
        const label = screen.getByText('Recognizing...', { exact: false });
        expect(label).toHaveClass('text-secondary');
        expect(label.getAttribute('style') ?? '').not.toMatch(/color/);
    });

    it('error keeps its danger colour', () => {
        render(<TranscribeButton state="error" onClick={vi.fn()} />);
        expect(screen.getByRole('button').getAttribute('style') ?? '').toMatch(/color/);
    });
});
