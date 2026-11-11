import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { installMediaTileHarness } from '../../../__tests__/mediaTileHarness';
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
    year,
    name: '金村 美玖',
    avatarUrl: null,
    items: [memoryMessage({ id: year, ts: `${year}-07-30T12:00:00Z`, text: `${year}年も花火🎆` })],
    ...over,
});

const sides = () => screen.getAllByTestId('then-now-side');

describe('ThenNowPair (pane)', () => {
    it('ages the older side with its year\'s sepia and leaves today clear', () => {
        render(<ThenNowPair variant="pane" then={side(2024)} now={side(2026)} />);
        const [then, now] = sides();
        expect(then.className.split(/\s+/)).toContain('sepia-memories-2');
        expect(now.className).not.toMatch(/\bsepia/);
        expect(within(then).getByText('2024年')).toHaveClass('font-display');
        expect(within(now).getByText('2026年')).toBeInTheDocument();
    });

    it('shows the years between the sides as the pair\'s one number', () => {
        render(<ThenNowPair variant="pane" then={side(2024)} now={side(2026)} />);
        expect(screen.getByTestId('then-now-gap')).toHaveTextContent('2年');
    });

    it('never shows a 0 gap', () => {
        render(<ThenNowPair variant="pane" then={side(2026)} now={side(2026)} />);
        expect(screen.queryByTestId('then-now-gap')).toBeNull();
        expect(screen.queryByText(/0年/)).toBeNull();
    });

    it('a first-week pair has an arrow between the sides, no number', () => {
        render(
            <ThenNowPair
                variant="pane"
                then={side(2024, { range: ['2024-03-01', '2024-03-07'], label: 'はじめの一週間' })}
                now={side(2026, { range: ['2026-11-04', '2026-11-10'], label: 'この一週間' })}
            />,
        );
        const gap = screen.getByTestId('then-now-gap');
        expect(gap.textContent).not.toMatch(/\d/);
        expect(screen.getByText('はじめの一週間')).toBeInTheDocument();
        expect(screen.getByText('この一週間')).toBeInTheDocument();
    });

    it('lights the shared keyword on both sides', () => {
        render(<ThenNowPair variant="pane" then={side(2024)} now={side(2026)} sharedKeyword="花火" />);
        for (const s of sides()) {
            const marks = within(s).getAllByTestId('memory-text-highlight');
            expect(marks).toHaveLength(1);
            expect(marks[0]).toHaveTextContent('花火');
        }
    });

    it('names each side only when the sides are different people', () => {
        const { unmount } = render(<ThenNowPair variant="pane" then={side(2024)} now={side(2026)} />);
        expect(screen.queryByText('金村 美玖')).toBeNull();
        unmount();
        render(<ThenNowPair variant="pane" then={side(2024)} now={side(2026, { name: '小坂 菜緒' })} />);
        const [then, now] = sides();
        expect(within(then).getByText('金村 美玖')).toHaveAttribute('lang', 'ja');
        expect(within(now).getByText('小坂 菜緒')).toHaveAttribute('lang', 'ja');
    });

    it('draws a photo through the thumbnail route and a voice as a lazy ▶', async () => {
        const h = installMediaTileHarness();
        render(
            <ThenNowPair
                variant="pane"
                then={side(2024, { items: [memoryMessage({ id: 5, type: 'picture', text: null, media_url: '/api/content/media/hinatazaka46/p.jpg' })] })}
                now={side(2026, { items: [memoryMessage({ id: 6, type: 'voice', text: null, duration_s: 12, media_url: '/api/content/media/hinatazaka46/v.m4a' })] })}
            />,
        );
        const [then, now] = sides();
        expect(within(then).getByTestId('memory-thumb')).toBeInTheDocument();
        await waitFor(() => expect(h.requested()).toHaveLength(1));
        expect(h.requested()[0]).toContain('/api/content/thumb');
        expect(within(now).getByRole('button')).toHaveTextContent('00:12');
    });
});

describe('ThenNowPair (slide)', () => {
    it('keeps the approved full sepia on the older card whatever the year, and no gap', () => {
        render(<ThenNowPair variant="slide" then={side(2025)} now={side(2026)} nickname="ゆき" />);
        const [then, now] = sides();
        expect(then.className.split(/\s+/)).toContain('sepia-memories-3');
        expect(now.className).not.toMatch(/\bsepia/);
        expect(screen.queryByTestId('then-now-gap')).toBeNull();
    });

    it('draws only the sides it has', () => {
        render(<ThenNowPair variant="slide" then={null} now={side(2026)} nickname="ゆき" />);
        expect(sides()).toHaveLength(1);
    });
});
