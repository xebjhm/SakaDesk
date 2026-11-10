import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../i18n';
import { MemoryText } from './MemoryText';
import { NicknameProvider } from './useNickname';
import { NICKNAME_MASK } from './nicknameMask';

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('MemoryText', () => {
    it('replaces both placeholder forms with the nickname and keeps emoji', () => {
        render(<MemoryText text={'%%%ちゃん🌸 ありがとう、％％％！'} nickname="みーちゃん" />);
        const p = screen.getByTestId('memory-text');
        expect(p).toHaveTextContent('みーちゃんちゃん🌸 ありがとう、みーちゃん！');
        expect(p).toHaveAttribute('lang', 'ja');
        expect(p.className).toMatch(/whitespace-pre-wrap/);
    });

    it('underlines each replaced span when asked', () => {
        render(<MemoryText text={'%%%、また明日ね ％％％'} nickname="ひな" underlineNickname />);
        const marks = screen.getAllByText('ひな');
        expect(marks).toHaveLength(2);
        for (const m of marks) {
            expect(m.tagName).toBe('SPAN');
            expect(m).toHaveClass('underline', 'decoration-accent', 'underline-offset-4');
        }
    });

    it('does not underline without the flag', () => {
        render(<MemoryText text="%%%" nickname="ひな" />);
        expect(screen.getByTestId('memory-text').querySelector('.underline')).toBeNull();
    });

    it('masks the placeholder when there is no nickname', () => {
        render(<MemoryText text="%%%、おやすみ" />);
        expect(screen.getByTestId('memory-text')).toHaveTextContent(`${NICKNAME_MASK}、おやすみ`);
        expect(screen.getByTestId('memory-text').textContent).not.toContain('%%%');
    });

    it('treats a blank nickname as none', () => {
        render(<MemoryText text="%%%" nickname="  " />);
        expect(screen.getByTestId('memory-text')).toHaveTextContent(NICKNAME_MASK);
    });

    it('reads the nickname from the Memories provider by default', () => {
        render(<NicknameProvider nickname="ゆう"><MemoryText text="%%%へ" /></NicknameProvider>);
        expect(screen.getByTestId('memory-text')).toHaveTextContent('ゆうへ');
    });

    it('inserts a nickname with $ literally', () => {
        render(<MemoryText text="%%%" nickname="$&$1" />);
        expect(screen.getByTestId('memory-text')).toHaveTextContent('$&$1');
    });

    it('highlights a keyword with emoji and CJK around it, underlined like the nickname', () => {
        render(<MemoryText text={'🎆花火🎆、今年も花火大会！'} highlight="花火" />);
        const marks = screen.getAllByTestId('memory-text-highlight');
        expect(marks).toHaveLength(2);
        for (const m of marks) {
            expect(m).toHaveTextContent('花火');
            expect(m).toHaveClass('underline', 'decoration-accent', 'underline-offset-4');
        }
        expect(screen.getByTestId('memory-text')).toHaveTextContent('🎆花火🎆、今年も花火大会！');
    });

    it('never highlights the keyword inside the fan\'s nickname, and keeps the text runs whole', () => {
        render(<MemoryText text={'%%%、花火きれい'} nickname="花火ちゃん" highlight="花火" />);
        const p = screen.getByTestId('memory-text');
        expect(screen.getAllByTestId('memory-text-highlight')).toHaveLength(1);
        expect(p).toHaveTextContent('花火ちゃん、花火きれい');
        // The nickname and the text up to the keyword are one text node.
        expect(p.firstChild?.textContent).toBe('花火ちゃん、');
    });

    it('marks the keyword with the mark tone and passes the voice attribute', () => {
        render(<MemoryText text="花火の夜" highlight="花火" highlightTone="mark" data-voice="quote" />);
        const m = screen.getByTestId('memory-text-highlight');
        expect(m.tagName).toBe('MARK');
        expect(m).toHaveClass('bg-mark-exact');
        expect(screen.getByTestId('memory-text')).toHaveAttribute('data-voice', 'quote');
    });

    it('highlights nothing for a blank or absent keyword', () => {
        render(<MemoryText text="花火の夜" highlight="" />);
        expect(screen.queryByTestId('memory-text-highlight')).toBeNull();
    });
});
