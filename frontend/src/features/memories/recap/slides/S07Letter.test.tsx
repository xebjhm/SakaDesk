import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../../i18n';
import { S07Letter } from './S07Letter';
import { LETTER_EXCERPT_CHARS, letterExcerpt } from '../recapCopy';
import { LETTER_TEXT, letterData, message, payload } from '../__fixtures__/payload';
import type { S07LetterData } from '../api';

beforeAll(async () => { await i18n.changeLanguage('ja'); });
afterEach(() => { vi.restoreAllMocks(); });

const renderS07 = (data: S07LetterData, opts: { reducedMotion?: boolean; paused?: boolean } = {}) =>
    render(
        <S07Letter
            data={data} fallback={null} recap={payload()} nickname="ゆき"
            reducedMotion={opts.reducedMotion ?? false} paused={opts.paused ?? false} onMediaEnd={() => {}}
        />,
    );

describe('S07Letter', () => {
    it('her longest letter as a quote, with the nickname replaced, and the count of the replaced text', () => {
        renderS07(letterData({ char_count: 9999 }));
        expect(screen.getByText('いちばん長い手紙。')).toHaveAttribute('data-voice', 'title');
        const quote = screen.getByTestId('s07-text');
        expect(quote).toHaveAttribute('data-voice', 'quote');
        expect(quote).toHaveAttribute('lang', 'ja');
        expect(quote.textContent).toBe(LETTER_TEXT.replace('%%%', 'ゆき'));
        const n = LETTER_TEXT.length - 1;
        expect(screen.getByText(`${n} 文字の想い`)).toHaveAttribute('data-voice', 'narration');
        expect(screen.queryByText(/9999|9,999/)).toBeNull();
    });

    it('shows the letter date in JST as metadata', () => {
        renderS07(letterData({ message: message(30, LETTER_TEXT, { ts: '2026-08-20T15:30:00Z' }) }));
        expect(screen.getByTestId('s07-date')).toHaveTextContent('8月21日');
    });

    it('a large count is grouped', () => {
        renderS07(letterData({ message: message(1, 'あ'.repeat(1240)) }));
        expect(screen.getByText('1,240 文字の想い')).toBeInTheDocument();
    });

    it('a long letter shows its opening up to a sentence end, with an ellipsis, never cut mid-line (D5)', () => {
        const long = '%%%へ。今日はね、ライブのことを書くね。' + 'ずっと楽しみにしていたはず！'.repeat(20) + '最後まで読んでくれてありがとう。';
        renderS07(letterData({ message: message(30, long) }));
        const shown = screen.getByTestId('s07-text').textContent!;
        expect(shown.startsWith('ゆきへ。今日はね')).toBe(true); // the letter's own start
        expect(shown.endsWith('！…')).toBe(true); // a sentence end, then the ellipsis
        expect(Array.from(shown).length).toBeLessThanOrEqual(LETTER_EXCERPT_CHARS + 1);
        expect(screen.getByTestId('s07-text')).toHaveClass('line-clamp-[8]');
        expect(screen.getByTestId('s07-paper').querySelector('[class*="animate-letter"]')).toBeNull();
        // The count is of the whole letter.
        expect(screen.getByText(`${Array.from(long).length - 1} 文字の想い`)).toBeInTheDocument();
    });

    it('letterExcerpt keeps short letters whole and cuts a sentence-less run at the bound', () => {
        expect(letterExcerpt('短い手紙。')).toBe('短い手紙。');
        const run = 'あ'.repeat(200);
        expect(letterExcerpt(run)).toBe(`${'あ'.repeat(LETTER_EXCERPT_CHARS)}…`);
        expect(letterExcerpt('🌸'.repeat(130))).toBe(`${'🌸'.repeat(LETTER_EXCERPT_CHARS)}…`);
    });

    it('reduced motion: the whole letter, scrolled by hand', () => {
        const long = 'あ。'.repeat(200);
        renderS07(letterData({ message: message(30, long) }), { reducedMotion: true });
        expect(screen.getByTestId('s07-text').textContent).toBe(long);
        const paper = screen.getByTestId('s07-paper');
        expect(paper.className).toMatch(/\boverflow-y-auto\b/);
        expect(paper.className).toMatch(/\bpointer-events-auto\b/);
    });

    it('the photo of that time sits faintly behind', () => {
        renderS07(letterData({ photo_url: '/api/media/p.jpg' }));
        expect(screen.getByTestId('s07-photo')).toHaveAttribute('src', '/api/media/p.jpg');
    });

    it('no message: only the title, never 0 or null', () => {
        renderS07(letterData({ message: null }));
        expect(screen.queryByTestId('s07-text')).toBeNull();
        expect(document.body.textContent).not.toMatch(/null|undefined|NaN|0/);
    });
});
