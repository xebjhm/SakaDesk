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
});
