import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { loadLanguageFaces } from '../../design/fonts';
import { InlineTranslation } from './InlineTranslation';
import { color } from '../../design/tokens/color';
import { contrastRatio } from '../../design/contrast';

vi.mock('../../design/fonts', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../design/fonts')>()),
    loadLanguageFaces: vi.fn(),
}));

describe('InlineTranslation (UI health #10, #12)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('marks the translation with its language, upright for CJK, and loads its faces', async () => {
        render(<InlineTranslation translation="早安🌸" variant="message" lang="zh-TW" defaultExpanded />);
        const text = screen.getByText('早安🌸');
        expect(text).toHaveAttribute('lang', 'zh-TW');
        expect(text).not.toHaveClass('italic');
        expect(text).toHaveClass('break-words', 'text-muted');
        expect(vi.mocked(loadLanguageFaces)).toHaveBeenCalledWith('zh-TW');
    });

    it('keeps English blog translations italic', () => {
        render(<InlineTranslation translation="Good morning" variant="blog" lang="en" defaultExpanded />);
        expect(screen.getByText('Good morning')).toHaveClass('italic');
    });

    it('says whether it is open and names the re-run button', async () => {
        render(<InlineTranslation translation="Hello" variant="message" lang="en" onRerun={vi.fn()} />);
        const toggle = screen.getByRole('button', { name: /Translate/ });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', { name: 'Re-translate' })).toBeInTheDocument();
    });

    it('uses no hard-coded colours', () => {
        const { container } = render(<InlineTranslation translation="x" variant="blog" lang="en" defaultExpanded onRerun={vi.fn()} />);
        expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b|slate-|style="[^"]*color/i);
    });

    // The message bubble's `bg-card` is the only surface that hosts the muted translation text.
    // Moving it onto a tinted or sunken surface would fail `text-muted` here; extend this table
    // (and re-check the contrast) when that happens.
    it('translation text and toggle reach 4.5:1 on the card and sheet surfaces', () => {
        for (const fg of [color.text.muted, color.text.secondary]) {
            for (const bg of [color.surface.card, color.surface.sheet]) {
                expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
            }
        }
    });
});
