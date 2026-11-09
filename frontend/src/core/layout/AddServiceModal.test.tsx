import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { AddServiceModal } from './AddServiceModal';
import { groupRoles } from '../../design/tokens';
import { resetDialogStack } from '../../design/dialog/dialogStack';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => resetDialogStack());

describe('AddServiceModal (R-c)', () => {
    it('is a brand dialog with the aurora header', () => {
        render(<AddServiceModal selectedServices={[]} onClose={vi.fn()} />);
        const dialog = screen.getByRole('dialog', { name: 'Add Service' });
        expect(dialog).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByTestId('modal-header')).toHaveClass('bg-expressive-header');
    });

    it('makes each card a marker of its own group that lights up in that colour on hover', () => {
        render(<AddServiceModal selectedServices={[]} onClose={vi.fn()} />);
        const sakura = screen.getByRole('button', { name: /櫻坂46/ });
        expect(sakura.style.getPropertyValue('--ds-group-accent')).toBe(groupRoles('sakurazaka').action);
        expect(sakura).toHaveClass('border-subtle', 'hover:border-accent', 'hover:shadow-accent-glow-hover', 'focus-visible:ring-accent');
        const hinata = screen.getByRole('button', { name: /日向坂46/ });
        expect(hinata.style.getPropertyValue('--ds-group-accent')).toBe(groupRoles('hinatazaka').action);
    });

    it('marks the group name as Japanese content', () => {
        render(<AddServiceModal selectedServices={[]} onClose={vi.fn()} />);
        expect(screen.getByText('櫻坂46')).toHaveAttribute('lang', 'ja');
    });
});
