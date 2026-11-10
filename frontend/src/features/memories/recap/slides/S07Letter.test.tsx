import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../../i18n';
import { S07Letter } from './S07Letter';
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

/** jsdom has no layout: give the letter an overflow so the scroll is armed. */
function fakeOverflow(scrollHeight: number, clientHeight: number) {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight);
}

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

    it('scrolls a letter taller than its paper, and the scroll freezes while paused', () => {
        fakeOverflow(900, 300);
        const { rerender } = renderS07(letterData());
        const scroller = screen.getByTestId('s07-scroll');
        expect(scroller.className).toMatch(/\banimate-letter-scroll\b/);
        expect(scroller.style.getPropertyValue('--letter-scroll')).toBe('-600px');
        expect(scroller.style.animationPlayState).toBe('running');
        rerender(
            <S07Letter data={letterData()} fallback={null} recap={payload()} nickname="ゆき" reducedMotion={false} paused onMediaEnd={() => {}} />,
        );
        expect(screen.getByTestId('s07-scroll').style.animationPlayState).toBe('paused');
    });

    it('a letter that fits does not scroll', () => {
        fakeOverflow(200, 300);
        renderS07(letterData());
        expect(screen.getByTestId('s07-scroll').className).not.toMatch(/animate-letter-scroll/);
    });

    it('reduced motion: no scroll animation, the paper can be scrolled by hand', () => {
        fakeOverflow(900, 300);
        renderS07(letterData(), { reducedMotion: true });
        expect(screen.getByTestId('s07-scroll').className).not.toMatch(/animate-/);
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
