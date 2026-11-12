import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../i18n';
import { memoryMessage } from '../__fixtures__/memories';
import { ThenNowPair, type ThenNowSideView } from './ThenNowPair';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T03:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const side = (year: number, over: Partial<ThenNowSideView> = {}): ThenNowSideView => ({
    items: [memoryMessage({ id: year, ts: `${year}-07-30T12:00:00Z`, text: `${year}年も花火🎆` })],
    ...over,
});

const sides = () => screen.getAllByTestId('then-now-side');

describe('ThenNowPair (slide)', () => {
    it('keeps the approved full sepia on the older card whatever the year, and no gap', () => {
        render(<ThenNowPair then={side(2025)} now={side(2026)} nickname="ゆき" />);
        const [then, now] = sides();
        expect(then.className.split(/\s+/)).toContain('sepia-memories-3');
        expect(now.className).not.toMatch(/\bsepia/);
        expect(screen.queryByTestId('then-now-gap')).toBeNull();
    });

    it('draws only the sides it has', () => {
        render(<ThenNowPair then={null} now={side(2026)} nickname="ゆき" />);
        expect(sides()).toHaveLength(1);
    });
});
