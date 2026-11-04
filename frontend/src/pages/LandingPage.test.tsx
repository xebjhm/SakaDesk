import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../i18n';
import { LandingPage } from './LandingPage';

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('LandingPage (D2d)', () => {
    it('is one sheet on the canvas with toggle cards and no inline colours', () => {
        const { container } = render(<LandingPage onComplete={vi.fn()} />);
        expect(container.firstChild).toHaveClass('bg-group-canvas');
        expect(screen.getByRole('heading', { level: 1, name: 'Welcome to SakaDesk' }).closest('.rounded-sheet')).not.toBeNull();
        expect(container.querySelectorAll('[style]')).toHaveLength(0);
        expect(screen.getByRole('button', { name: /日向坂46/ })).toHaveAttribute('aria-pressed', 'false');
    });

    it('a picked card is a subtle selection with a filled check disc', async () => {
        render(<LandingPage onComplete={vi.fn()} />);
        const card = screen.getByRole('button', { name: /日向坂46/ });
        await userEvent.click(card);
        expect(card).toHaveAttribute('aria-pressed', 'true');
        expect(card).toHaveClass('bg-group-subtle', 'border-group-subtle');
        expect(card.querySelector('span[aria-hidden="true"]')).toHaveClass('bg-group-accent', 'text-inverse');
        expect(screen.getByRole('button', { name: 'Get Started' })).toHaveClass('bg-group-accent');
    });
});
