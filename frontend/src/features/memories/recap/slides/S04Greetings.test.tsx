import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import i18n from '../../../../i18n';
import { S04Greetings } from './S04Greetings';
import { greetingsData, payload } from '../__fixtures__/payload';
import type { S04GreetingsData } from '../api';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const renderS04 = (data: S04GreetingsData, fallback: string | null = null) =>
    render(<S04Greetings data={data} fallback={fallback} recap={payload()} nickname="ゆき" reducedMotion={false} paused={false} onMediaEnd={() => {}} />);

describe('S04Greetings', () => {
    it('her first ohayo, her latest-hour oyasumi and the oyasumi count', () => {
        renderS04(greetingsData());
        expect(screen.getByText('おはようと、おやすみ。')).toHaveAttribute('data-voice', 'title');
        expect(screen.getByText('今年最初の、おはよう')).toBeInTheDocument();
        expect(screen.getByText('おはよう、ゆき')).toHaveAttribute('data-voice', 'quote');
        expect(screen.getByText('いちばん遅い時間の、おやすみ')).toBeInTheDocument();
        expect(screen.getByText('おやすみ🌙')).toHaveAttribute('data-voice', 'quote');
        expect(screen.getByText('180回の「おやすみ」で、一日を締めくくった。')).toBeInTheDocument();
    });

    it('each card shows the clock time of its message as HH:MM in JST', () => {
        renderS04(greetingsData({
            first_ohayo: { ...greetingsData().first_ohayo!, ts: '2026-01-02T21:12:30Z' },
            latest_oyasumi: { ...greetingsData().latest_oyasumi!, ts: '2026-03-04T16:47:00Z' },
        }));
        const [morning, evening] = screen.getAllByTestId('s04-card');
        expect(within(morning).getByTestId('s04-time')).toHaveTextContent(/^06:12$/);
        expect(within(evening).getByTestId('s04-time')).toHaveTextContent(/^01:47$/);
        expect(within(evening).getByTestId('s04-time')).toHaveAttribute('datetime', '2026-03-04T16:47:00Z');
    });

    it('a card whose timestamp cannot be read shows no time', () => {
        renderS04(greetingsData({ latest_oyasumi: null, first_ohayo: { ...greetingsData().first_ohayo!, ts: 'nope' } }));
        expect(screen.queryByTestId('s04-time')).toBeNull();
        expect(document.body.textContent).not.toMatch(/null|undefined|NaN|Invalid/);
    });

    it('a morning fallback is labelled as morning words, never as an ohayo', () => {
        renderS04(greetingsData({ first_ohayo: { ...greetingsData().first_ohayo!, text: '朝の散歩' } }), 'morning');
        expect(screen.getByText('今年最初の、朝のことば')).toBeInTheDocument();
        expect(screen.getByText('一日のはじまりと、おわりに。')).toBeInTheDocument();
        expect(screen.queryByText(/おはよう/)).toBeNull();
    });

    it('the arigato variant names its own word and count', () => {
        renderS04(greetingsData({ variant: 'arigato', oyasumi_count: 9, latest_oyasumi: greetingsData().first_ohayo }), 'variant');
        expect(screen.getByText('いちばん遅い時間の、ありがとう')).toBeInTheDocument();
        expect(screen.getByText('「ありがとう」を、9回。')).toBeInTheDocument();
        expect(screen.queryByText(/おやすみ/)).toBeNull();
    });

    it('only the evening: no morning card and no empty label', () => {
        renderS04(greetingsData({ first_ohayo: null }));
        expect(screen.getByText('一日のおわりに。')).toBeInTheDocument();
        expect(screen.queryByText(/今年最初/)).toBeNull();
        expect(screen.getAllByTestId('s04-card')).toHaveLength(1);
    });

    it('only the morning: no count and never null or 0', () => {
        renderS04(greetingsData({ latest_oyasumi: null, oyasumi_count: null, distinct_days: null }));
        expect(screen.getByText('一日のはじまりに。')).toBeInTheDocument();
        expect(screen.queryByText(/回/)).toBeNull();
        // The message's clock time is metadata, not a statistic (controller ruling), so it is left out here.
        for (const time of screen.queryAllByTestId('s04-time')) time.remove();
        expect(document.body.textContent).not.toMatch(/null|undefined|NaN|0/);
    });
});
