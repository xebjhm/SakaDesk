import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import i18n from '../../i18n';
import { AboutModal } from './AboutModal';

afterEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); });

describe('AboutModal', () => {
    it.each(['en', 'ja', 'zh-TW'])('names the heart button in %s', async (lang) => {
        await act(async () => { await i18n.changeLanguage(lang); });
        render(<AboutModal isOpen onClose={vi.fn()} onOpenDiagnostics={vi.fn()} />);
        const expected = i18n.t('about.madeWithLove');
        expect(expected).not.toBe('about.madeWithLove');
        expect(screen.getByRole('button', { name: expected })).toBeInTheDocument();
    });
});
