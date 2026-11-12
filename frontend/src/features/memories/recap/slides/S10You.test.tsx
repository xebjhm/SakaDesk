import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../../i18n';
import { S10You } from './S10You';
import { message, payload, youData } from '../__fixtures__/payload';
import type { S10YouData } from '../api';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const renderS10 = (data: S10YouData, fallback: string | null = null, paused = false, year = 2026) =>
    render(<S10You data={data} fallback={fallback} recap={payload({ year })} nickname="ゆき" reducedMotion={false} paused={paused} onMediaEnd={() => {}} />);

afterEach(() => { vi.useRealTimers(); });

describe('S10You', () => {
    it('renders no message text from the payload, even if a message carries text', () => {
        const base = youData();
        if (base.invite) throw new Error('fixture');
        // The backend sends the favourite without text; even a payload that had it must not show it.
        const leaky: S10YouData = {
            ...base,
            first_favorite: {
                ...message(60, '%%%、ひみつのことば', { caption: 'ひみつのキャプション', media_url: '/api/media/secret.jpg', ts: '2026-02-01T10:00:00Z' }),
                favorited_at: '2026-02-03T10:00:00Z',
            },
        };
        const { container } = renderS10(leaky);
        const text = document.body.textContent ?? '';
        expect(text).not.toContain('ひみつ');
        expect(text).not.toContain('ゆき、');
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('[data-voice="quote"]')).toBeNull();
    });

    it('the fan\'s stars as bookmarks with the one number, and the letters as envelopes', () => {
        renderS10(youData());
        expect(screen.getByText('あなたも、ここにいた。')).toHaveAttribute('data-voice', 'title');
        expect(screen.getByText('今年、12回の★を残した。')).toHaveAttribute('data-voice', 'narration');
        expect(screen.getAllByTestId('s10-bookmark')).toHaveLength(12);
        const envelopes = screen.getAllByTestId('s10-envelope');
        expect(envelopes).toHaveLength(2);
        expect(envelopes[0]).toHaveTextContent('3月1日');
        expect(envelopes[0]).toHaveTextContent('美玖ちゃんへ');
        expect(screen.getByText('あなたが書いた手紙')).toBeInTheDocument();
        // One statistic: the letters count is not printed beside the favourites count.
        expect(screen.queryByText(/2通/)).toBeNull();
    });

    it('the star keeps its semantic yellow', () => {
        renderS10(youData());
        for (const b of screen.getAllByTestId('s10-bookmark')) {
            expect(b.querySelector('svg')?.getAttribute('class')).toMatch(/\btext-semantic-star\b/);
        }
    });

    it('the first logged star shows its day', () => {
        renderS10(youData());
        expect(screen.getByText('今年はじめての★は、2月3日。')).toBeInTheDocument();
    });

    it('bookmarks are capped so the book stays inside the stage', () => {
        renderS10(youData({ favorites_count: 340 }));
        expect(screen.getAllByTestId('s10-bookmark')).toHaveLength(12);
        expect(screen.getByText('今年、340回の★を残した。')).toBeInTheDocument();
    });

    it('only letters: the letters count is the number, no book', () => {
        renderS10(youData({ favorites_count: null, first_favorite: null }));
        expect(screen.getByText('今年、2通の手紙を書いた。')).toBeInTheDocument();
        expect(screen.queryByTestId('s10-bookmark')).toBeNull();
        expect(document.body.textContent).not.toMatch(/null|undefined|NaN/);
    });

    it('invite: a gentle forward-looking line that never claims she saw any letter', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-12-10T03:00:00Z'));
        renderS10({ invite: true }, 'invite');
        expect(screen.getByText('来年は、あなたの足あとも。')).toHaveAttribute('data-voice', 'title');
        expect(screen.getByText('心に残ったメッセージに★をつけると、ここに並びます。')).toBeInTheDocument();
        expect(screen.getByText('あなたが送った手紙も、ここに並びます。')).toBeInTheDocument();
        const text = document.body.textContent ?? '';
        expect(text).not.toMatch(/読ん|見て|知って|覚え|0/);
        expect(screen.queryByTestId('s10-bookmark')).toBeNull();
    });

    it('invite on a past year\'s recap never says "next year"', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2027-01-02T00:00:00Z'));
        renderS10({ invite: true }, 'invite', false, 2026);
        expect(screen.getByText('これからは、あなたの足あとも。')).toHaveAttribute('data-voice', 'title');
        expect(screen.queryByText(/来年/)).toBeNull();
    });

    it('the fan\'s letter line is not marked as Japanese (it is the fan\'s own text)', () => {
        renderS10(youData());
        const lines = screen.getAllByTestId('s10-letter-line');
        expect(lines.length).toBeGreaterThan(0);
        for (const el of lines) expect(el.closest('[lang="ja"]')).toBeNull();
    });

    it('freezes while paused', () => {
        renderS10(youData(), null, true);
        expect(screen.getByTestId('s10-book').style.animationPlayState).toBe('paused');
    });
});
