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

    it('keeps the feature chips visible when an unselected card is hovered', () => {
        render(<LandingPage onComplete={vi.fn()} />);
        const card = screen.getByRole('button', { name: /日向坂46/ });
        expect(card).toHaveClass('group', 'hover:bg-sunken');
        const chip = screen.getAllByText('Messages')[0];
        expect(chip).toHaveClass('bg-sunken', 'group-hover:bg-card');
    });

    it('does not repeat the group name: the logo is decorative', () => {
        const { container } = render(<LandingPage onComplete={vi.fn()} />);
        const logos = container.querySelectorAll('img');
        expect(logos.length).toBeGreaterThan(0);
        logos.forEach((img) => expect(img).toHaveAttribute('alt', ''));
        expect(screen.queryAllByRole('img')).toHaveLength(0);
    });

    it('is disabled with nothing picked, deselects on a second click and keeps click order', async () => {
        const onComplete = vi.fn();
        render(<LandingPage onComplete={onComplete} />);
        const empty = screen.getByRole('button', { name: 'Select at least one group' });
        expect(empty).toBeDisabled();
        await userEvent.click(empty);
        expect(onComplete).not.toHaveBeenCalled();

        const hinata = screen.getByRole('button', { name: /日向坂46/ });
        await userEvent.click(hinata);
        await userEvent.click(hinata);
        expect(hinata).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Select at least one group' })).toBeDisabled();

        await userEvent.click(screen.getByRole('button', { name: /Yodel/ }));
        await userEvent.click(screen.getByRole('button', { name: /櫻坂46/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Get Started with 2 groups' }));
        expect(onComplete).toHaveBeenCalledWith(['yodel', 'sakurazaka46']);
    });
});
