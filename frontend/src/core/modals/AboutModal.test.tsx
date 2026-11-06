import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import i18n from '../../i18n';
import { AboutModal } from './AboutModal';

afterEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); });

describe('AboutModal', () => {
    it('is a brand dialog with the aurora header and a serif wordmark (D7)', () => {
        render(<AboutModal isOpen onClose={vi.fn()} onOpenDiagnostics={vi.fn()} />);
        expect(screen.getByRole('dialog')).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByTestId('modal-header')).toHaveClass('bg-expressive-header');
        expect(screen.getByText('SakaDesk', { selector: 'h3' })).toHaveClass('font-display', 'font-bold');
        expect(screen.getByRole('link', { name: /github\.com/ })).toHaveClass('focus-visible:ring-accent');
    });

    it.each(['en', 'ja', 'zh-TW'])('names the heart button in %s', async (lang) => {
        await act(async () => { await i18n.changeLanguage(lang); });
        render(<AboutModal isOpen onClose={vi.fn()} onOpenDiagnostics={vi.fn()} />);
        const expected = i18n.t('about.madeWithLove');
        expect(expected).not.toBe('about.madeWithLove');
        expect(screen.getByRole('button', { name: expected })).toBeInTheDocument();
    });
});
