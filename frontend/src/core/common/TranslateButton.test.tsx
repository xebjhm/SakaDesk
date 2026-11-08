import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TranslateButton } from './TranslateButton';

describe('TranslateButton done state', () => {
    it('renders a static pill when no toggle handler is given', () => {
        render(<TranslateButton state="done" onClick={vi.fn()} doneLabel="✓ translated" />);
        expect(screen.getByText('✓ translated')).toBeInTheDocument();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders the pill as an expand/collapse toggle when onToggleExpanded is given', () => {
        const onToggle = vi.fn();
        const { rerender } = render(
            <TranslateButton state="done" onClick={vi.fn()} doneLabel="✓ translated" expanded onToggleExpanded={onToggle} />,
        );
        const button = screen.getByRole('button', { name: /translated/ });
        expect(button).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(button);
        expect(onToggle).toHaveBeenCalledTimes(1);

        rerender(
            <TranslateButton state="done" onClick={vi.fn()} doneLabel="✓ translated" expanded={false} onToggleExpanded={onToggle} />,
        );
        expect(screen.getByRole('button', { name: /translated/ })).toHaveAttribute('aria-expanded', 'false');
    });
});

describe('TranslateButton neutral look', () => {
    it('idle button is neutral: secondary text, primary on hover, no inline accent colour', () => {
        render(<TranslateButton state="idle" onClick={vi.fn()} />);
        const button = screen.getByRole('button');
        expect(button.className).toContain('text-secondary');
        expect(button.className).toContain('hover:text-primary');
        expect(button.getAttribute('style') ?? '').not.toMatch(/color|background/);
    });
});

describe('TranslateButton icon-only', () => {
    it('shows only an icon with an accessible name and tooltip', () => {
        render(<TranslateButton state="idle" onClick={vi.fn()} iconOnly />);
        const button = screen.getByRole('button', { name: 'Translate' });
        expect(button.textContent).toBe('');
        expect(button).toHaveAttribute('title', 'Translate');
        expect(button.className).toContain('text-secondary');
    });

    it('loading is disabled with the translating label; error keeps its icon and label', () => {
        const { rerender } = render(<TranslateButton state="loading" onClick={vi.fn()} iconOnly />);
        expect(screen.getByRole('button', { name: 'Translating...' })).toBeDisabled();
        rerender(<TranslateButton state="error" onClick={vi.fn()} iconOnly error="boom" />);
        expect(screen.getByRole('button', { name: /fail/i })).toBeInTheDocument();
        // The error is the icon's tooltip and description, never in-flow text that would widen the column
        const button = screen.getByRole('button', { name: /fail/i });
        expect(button.getAttribute('title')).toContain('boom');
        expect(button).toHaveAccessibleDescription('boom');
        expect(button).toHaveClass('text-semantic-danger');
        expect(screen.getByText('boom')).toHaveClass('sr-only');
        expect(document.querySelector('p')).toBeNull();
    });
});
