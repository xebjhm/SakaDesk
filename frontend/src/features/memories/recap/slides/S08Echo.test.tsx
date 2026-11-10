import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import i18n from '../../../../i18n';
import { S08Echo } from './S08Echo';
import { echoData, message, payload } from '../__fixtures__/payload';
import type { S08EchoData } from '../api';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const renderS08 = (data: S08EchoData, fallback: string | null = null, paused = false, recap = payload(), nickname = 'ゆき') =>
    render(<S08Echo data={data} fallback={fallback} recap={recap} nickname={nickname} reducedMotion={false} paused={paused} onMediaEnd={() => {}} />);

describe('S08Echo', () => {
    it('last year on the same day: two cards, the older one sepia, dated in JST', () => {
        renderS08(echoData());
        expect(screen.getByText('去年の、同じ日。')).toHaveAttribute('data-voice', 'title');
        const [then, now] = screen.getAllByTestId('s08-card');
        expect(then.className).toMatch(/\bsepia\b/);
        expect(now.className).not.toMatch(/\bsepia\b/);
        expect(within(then).getByTestId('s08-date')).toHaveTextContent('2025年7月30日');
        expect(within(now).getByTestId('s08-date')).toHaveTextContent('2026年7月30日');
        expect(within(now).getByText((_, el) => el?.getAttribute('data-voice') === 'quote' && el.textContent === 'ゆき、今年も花火！')).toBeInTheDocument();
    });

    it('the shared keyword lights up in both cards', () => {
        renderS08(echoData());
        const marks = screen.getAllByTestId('s08-keyword');
        expect(marks).toHaveLength(2);
        for (const m of marks) {
            expect(m.tagName).toBe('MARK');
            expect(m).toHaveTextContent('花火');
        }
        expect(screen.getByText('あの頃も、いまも、同じことば。')).toHaveAttribute('data-voice', 'narration');
    });

    it('no shared keyword: nothing is marked', () => {
        renderS08(echoData({ shared_keyword: null }));
        expect(screen.queryByTestId('s08-keyword')).toBeNull();
    });

    it('a keyword that sits inside the nickname replacement is still found in the replaced text', () => {
        renderS08(echoData({ shared_keyword: '花火', now: message(41, '花火と%%%', { ts: '2026-07-30T12:30:00Z' }) }));
        const now = screen.getAllByTestId('s08-card')[1];
        expect(within(now).getByTestId('s08-keyword')).toHaveTextContent('花火');
        expect(now.textContent).toContain('花火とゆき');
    });

    it('a keyword inside the fan\'s nickname is not marked as her word', () => {
        renderS08(
            echoData({ shared_keyword: '花火', now: message(41, '%%%、花火きれい', { ts: '2026-07-30T12:30:00Z' }) }),
            null, false, payload(), '花火ちゃん',
        );
        const now = screen.getAllByTestId('s08-card')[1];
        expect(within(now).getAllByTestId('s08-keyword')).toHaveLength(1);
        expect(now.textContent).toContain('花火ちゃん、花火きれい');
        // The nickname itself is plain text, the mark comes after it.
        const quote = within(now).getByText((_, el) => el?.getAttribute('data-voice') === 'quote');
        expect(quote.firstChild?.textContent).toBe('花火ちゃん、');
    });

    it('another day never claims "the same day"', () => {
        renderS08(echoData({ then: message(40, '花火の夜', { ts: '2025-08-10T12:00:00Z' }) }));
        expect(screen.getByText('あの頃と、いま。')).toBeInTheDocument();
        expect(screen.queryByText(/同じ日/)).toBeNull();
    });

    it('first_week mode: the first week and now, labelled, no number', () => {
        renderS08(
            echoData({ mode: 'first_week', years_apart: null, shared_keyword: null,
                then: message(40, 'はじめまして', { ts: '2024-07-25T12:00:00Z' }) }),
            'first_week',
        );
        expect(screen.getByText('はじめての一週間と、いま。')).toBeInTheDocument();
        expect(screen.getByText('はじめての週')).toBeInTheDocument();
        expect(screen.getByText('いま')).toBeInTheDocument();
        expect(screen.getAllByTestId('s08-card')[0].className).toMatch(/\bsepia\b/);
        expect(screen.queryByText(/年前|null|undefined/)).toBeNull();
    });

    it('first_week mode without a subscription start says "the first week on record", never "yours"', () => {
        const recap = payload({ member: { ...payload().member, subscription_start: null } });
        renderS08(
            echoData({ mode: 'first_week', years_apart: null, shared_keyword: null,
                then: message(40, 'はじめまして', { ts: '2024-07-25T12:00:00Z' }) }),
            'first_week', false, recap,
        );
        expect(screen.getByText('記録に残る、最初の一週間と、いま。')).toBeInTheDocument();
        expect(screen.getByText('記録に残る最初の週')).toBeInTheDocument();
        expect(screen.queryByText(/はじめての/)).toBeNull();
    });

    it('the reveal freezes while paused', () => {
        renderS08(echoData(), null, true);
        for (const card of screen.getAllByTestId('s08-card')) expect(card.style.animationPlayState).toBe('paused');
    });
});
