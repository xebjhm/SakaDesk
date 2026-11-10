import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { CountdownCard } from './CountdownCard';
import { hubCountdown } from './__fixtures__';
import { MEMBER_PATH } from '../__fixtures__/memories';

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('CountdownCard', () => {
    it('counts the days to her birthday', () => {
        render(<CountdownCard countdown={hubCountdown()} go={vi.fn()} />);
        expect(screen.getByTestId('memories-hub-countdown')).toHaveTextContent("12 days until 金村 美玖's birthday");
    });

    it('uses the singular for one day', () => {
        render(<CountdownCard countdown={hubCountdown({ days_left: 1 })} go={vi.fn()} />);
        expect(screen.getByTestId('memories-hub-countdown')).toHaveTextContent("1 day until 金村 美玖's birthday");
    });

    it('says "today" on her birthday, never 0', () => {
        render(<CountdownCard countdown={hubCountdown({ days_left: 0 })} go={vi.fn()} />);
        const card = screen.getByTestId('memories-hub-countdown');
        expect(card).toHaveTextContent("Today is 金村 美玖's birthday");
        expect(card).not.toHaveTextContent(/\b0\b/);
    });

    it('shows only the days before a membership anniversary (one number)', () => {
        render(<CountdownCard countdown={hubCountdown({ kind: 'anniversary', days_left: 30, years: 3 })} go={vi.fn()} />);
        const card = screen.getByTestId('memories-hub-countdown');
        expect(card).toHaveTextContent('30 days until your membership anniversary with 金村 美玖');
        expect(card.textContent?.match(/\d+/g)).toEqual(['30']);
    });

    it('names the year only on the anniversary itself', () => {
        render(<CountdownCard countdown={hubCountdown({ kind: 'anniversary', days_left: 0, years: 3 })} go={vi.fn()} />);
        const card = screen.getByTestId('memories-hub-countdown');
        expect(card).toHaveTextContent('Today is your 3-year membership anniversary');
        expect(card).toHaveTextContent('金村 美玖');
        expect(card.textContent?.match(/\d+/g)).toEqual(['3']);
    });

    it("opens that member's memoir", async () => {
        const go = vi.fn();
        render(<CountdownCard countdown={hubCountdown()} go={go} />);
        await userEvent.click(screen.getByTestId('memories-hub-countdown'));
        expect(go).toHaveBeenCalledWith({ page: 'memoir', memberPath: MEMBER_PATH });
    });

    it('renders nothing without a countdown', () => {
        const { container } = render(<CountdownCard countdown={null} go={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });
});
