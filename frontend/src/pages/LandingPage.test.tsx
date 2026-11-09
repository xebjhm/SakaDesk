import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../i18n';
import { groupRoles } from '../design/tokens';
import { LandingPage } from './LandingPage';

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('LandingPage (D2d)', () => {
    it('is a brand screen: one sheet on the aurora orbs with a serif display heading (R-d)', () => {
        const { container } = render(<LandingPage onComplete={vi.fn()} />);
        expect(container.firstChild).toHaveAttribute('data-scope', 'brand');
        expect(screen.getAllByTestId('atmosphere-orb')).toHaveLength(3);
        const heading = screen.getByRole('heading', { level: 1, name: 'Welcome to SakaDesk' });
        expect(heading).toHaveClass('font-display', 'text-display', 'font-bold');
        expect(heading.closest('.rounded-sheet')).not.toBeNull();
        expect(screen.getByRole('button', { name: /日向坂46/ })).toHaveAttribute('aria-pressed', 'false');
    });

    it('each card is a group marker; a picked card rings in its logo colour (R-d, pending decision D4)', async () => {
        render(<LandingPage onComplete={vi.fn()} />);
        const card = screen.getByTestId('landing-card-sakurazaka46');
        expect(card.style.getPropertyValue('--ds-accent')).toBe(groupRoles('sakurazaka').action);
        expect(card.style.getPropertyValue('--ds-accent-logo')).toBe(groupRoles('sakurazaka').logo);
        expect(card).toHaveClass('bg-card', 'hover:-translate-y-px', 'hover:shadow-accent-glow-hover');
        expect(card).not.toHaveClass('ring-accent-logo');
        await userEvent.click(card);
        expect(card).toHaveAttribute('aria-pressed', 'true');
        expect(card).toHaveClass('ring-2', 'ring-accent-logo', 'shadow-accent-glow');
        expect(within(card).getByTestId('landing-check')).toHaveClass('bg-accent', 'text-inverse');
        expect(within(card).getByTestId('landing-logo')).toHaveClass('ring-2', 'ring-accent-logo');
        expect(within(card).getByText('櫻坂46')).toHaveAttribute('lang', 'ja');
        expect(screen.getByRole('button', { name: 'Get Started' })).toHaveClass('bg-accent-gradient');
    });

    it('keeps the feature chips neutral (e4e4118: bg-gray-100 text-gray-500)', () => {
        render(<LandingPage onComplete={vi.fn()} />);
        const chip = screen.getAllByText('Messages')[0];
        expect(chip).toHaveClass('bg-sunken', 'text-secondary');
    });

    it('does not repeat the group name: the logo is decorative', () => {
        const { container } = render(<LandingPage onComplete={vi.fn()} />);
        const logos = container.querySelectorAll('img');
        expect(logos.length).toBeGreaterThan(0);
        logos.forEach((img) => expect(img).toHaveAttribute('alt', ''));
        expect(screen.queryAllByRole('img')).toHaveLength(0);
    });

    it('blocks Get Started with a reason while nothing is picked, deselects on a second click and keeps click order', async () => {
        const onComplete = vi.fn();
        render(<LandingPage onComplete={onComplete} />);
        const empty = screen.getByRole('button', { name: 'Select at least one group' });
        expect(empty).toHaveAttribute('aria-disabled', 'true');
        await userEvent.click(empty);
        expect(onComplete).not.toHaveBeenCalled();

        const hinata = screen.getByRole('button', { name: /日向坂46/ });
        await userEvent.click(hinata);
        await userEvent.click(hinata);
        expect(hinata).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Select at least one group' })).toHaveAttribute('aria-disabled', 'true');

        await userEvent.click(screen.getByRole('button', { name: /Yodel/ }));
        await userEvent.click(screen.getByRole('button', { name: /櫻坂46/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Get Started with 2 groups' }));
        expect(onComplete).toHaveBeenCalledWith(['yodel', 'sakurazaka46']);
    });
});
