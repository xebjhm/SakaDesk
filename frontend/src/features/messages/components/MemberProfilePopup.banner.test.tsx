import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../i18n';
import { MemberProfilePopup } from './MemberProfilePopup';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

// The profile card's banner is the official layer (docs/design/DESIGN_SYSTEM.md): the group's
// chat-header style, a filled title gradient, or for Sakurazaka a white header with the thin
// title bar under it.
describe('MemberProfilePopup banner per group', () => {
    it.each([
        ['hinatazaka46', 'gradient'],
        ['sakurazaka46', 'light'],
        ['nogizaka46', 'gradient'],
        ['yodel', 'gradient'],
        [undefined, 'gradient'],
    ] as const)('%s uses the %s header', (service, style) => {
        render(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="森田 ひかる 🌸" activeService={service} />);
        const banner = screen.getByTestId('profile-banner');
        const close = screen.getByRole('button', { name: i18n.t('common.close') });
        if (style === 'light') {
            expect(banner).toHaveClass('bg-sheet');
            expect(banner).not.toHaveClass('bg-group-title');
            expect(screen.getByTestId('profile-title-bar')).toHaveClass('bg-group-title-bar');
            expect(close).not.toHaveClass('bg-viewer-control'); // a ghost close on the white header
        } else {
            expect(banner).toHaveClass('bg-group-title');
            expect(screen.queryByTestId('profile-title-bar')).toBeNull();
            expect(close).toHaveClass('bg-viewer-control'); // an overlay close on the gradient
        }
        expect(screen.getByRole('dialog', { name: /森田 ひかる/ })).toBeInTheDocument();
    });
});
