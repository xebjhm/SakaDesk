import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../i18n';
import { YearStrip } from './YearStrip';
import type { OnThisDayYear } from '../types';
import { memoryMessage } from '../__fixtures__/memories';

beforeAll(async () => { await i18n.changeLanguage('en'); });

const years = (): OnThisDayYear[] => [2023, 2024].map((year) => ({
    year, has_messages: true, message_count: 1, member_count: 1, more: null, thumb: null,
    preview: [{ ...memoryMessage({ id: year, text: `${year}の言葉` }), name: '金村 美玖' }],
}));

describe('YearStrip', () => {
    it('scrolls to the newest year only when the month-day changes, not on a new years array', () => {
        const width = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(700);
        try {
            const { rerender } = render(<YearStrip years={years()} resetKey="09-14" onOpen={() => {}} />);
            const strip = screen.getByTestId('otd-strip');
            expect(strip.scrollLeft).toBe(700);
            strip.scrollLeft = 40;
            rerender(<YearStrip years={years()} resetKey="09-14" onOpen={() => {}} />);
            expect(strip.scrollLeft).toBe(40);
            rerender(<YearStrip years={years()} resetKey="09-15" onOpen={() => {}} />);
            expect(strip.scrollLeft).toBe(700);
        } finally {
            width.mockRestore();
        }
    });
});
