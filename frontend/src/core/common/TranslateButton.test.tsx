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
