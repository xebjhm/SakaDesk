import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import i18n from '../../../../i18n';
import { S09Special } from './S09Special';
import { message, payload, specialData, stub } from '../__fixtures__/payload';
import type { S09SpecialData } from '../api';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const renderS09 = (data: S09SpecialData, paused = false) =>
    render(<S09Special data={data} fallback={null} recap={payload()} nickname="ゆき" reducedMotion={false} paused={paused} onMediaEnd={() => {}} />);

describe('S09Special', () => {
    it('one ticket stub per special day', () => {
        renderS09(specialData());
        expect(screen.getByText('特別な日。')).toHaveAttribute('data-voice', 'title');
        expect(screen.getAllByTestId('s09-stub')).toHaveLength(4);
        expect(screen.getByText('彼女の誕生日')).toBeInTheDocument();
        expect(screen.getByText('新しい年の、はじまり')).toBeInTheDocument();
        expect(screen.getByText('あなたが出会った、記念の日')).toBeInTheDocument();
    });

    it('a midnight stub shows the seconds in monospace', () => {
        renderS09(specialData());
        const bday = screen.getAllByTestId('s09-stub')[0];
        const time = within(bday).getByTestId('s09-seconds');
        expect(time).toHaveTextContent(/^0:00:07$/);
        expect(time.className).toMatch(/\bfont-mono\b/);
        expect(within(bday).getByText('お誕生日、ありがとう')).toHaveAttribute('data-voice', 'quote');
    });

    it('a stub without seconds shows its JST date instead', () => {
        renderS09({ stubs: [stub('anniversary', { message: message(53, 'またね', { ts: '2026-07-24T15:30:00Z' }) })] });
        const s = screen.getByTestId('s09-stub');
        expect(within(s).queryByTestId('s09-seconds')).toBeNull();
        expect(within(s).getByTestId('s09-date')).toHaveTextContent('7月25日');
    });

    it('sealed Christmas shows only its opening line, no message', () => {
        renderS09({ stubs: [{ kind: 'christmas', message: message(99, '秘密のメリークリスマス'), seconds_after_midnight: 5, sealed: true }] });
        const s = screen.getByTestId('s09-stub');
        expect(s).toHaveAttribute('data-sealed', 'true');
        expect(within(s).getByText('12月25日に、ここが開きます。')).toBeInTheDocument();
        expect(within(s).getByText('クリスマス')).toBeInTheDocument();
        expect(screen.queryByText(/秘密/)).toBeNull();
        expect(within(s).queryByTestId('s09-seconds')).toBeNull();
        expect(within(s).queryByTestId('s09-date')).toBeNull();
        expect(s.querySelector('[data-voice="quote"]')).toBeNull();
    });

    it('opened Christmas shows its message', () => {
        renderS09({ stubs: [stub('christmas', { message: message(54, 'メリークリスマス🎄', { ts: '2026-12-25T03:00:00Z' }) })] });
        expect(screen.getByText('メリークリスマス🎄')).toHaveAttribute('data-voice', 'quote');
        expect(screen.queryByText('12月25日に、ここが開きます。')).toBeNull();
    });

    it('the anniversary stub never implies she knew the fan\'s day', () => {
        renderS09({ stubs: [stub('anniversary')] });
        const note = screen.getByText('この日も、彼女のことばが届いていた。');
        expect(note).toHaveAttribute('data-voice', 'narration');
    });

    it('the nickname is replaced on a stub', () => {
        renderS09({ stubs: [stub('birthday', { message: message(51, '%%%、ありがとう'), seconds_after_midnight: 0 })] });
        expect(screen.getByText('ゆき、ありがとう')).toBeInTheDocument();
        expect(screen.getByTestId('s09-seconds')).toHaveTextContent('0:00:00');
    });

    it('stubs freeze while paused', () => {
        renderS09(specialData(), true);
        for (const s of screen.getAllByTestId('s09-stub')) expect(s.style.animationPlayState).toBe('paused');
    });
});
