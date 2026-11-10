import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import i18n from '../../../i18n';
import { AUTO_ADVANCE_MS } from './RecapPlayer';
import { Opening } from './Opening';
import { OPENING_REGISTRY, openingPayload, openingSlides } from './openingSlides';
import { overview } from './__fixtures__/payload';
import { STAR_LABEL_SHARE, STAR_LINE_HEIGHT, STAR_SHARE, starGrid } from './openingMembers';
import type { RecapOverview } from './api';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

const openingLogs = () => vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'recap_opening');

const P = (gid: string, mid: string, name: string) => `日向坂46/messages/${gid} ${name}/${mid} ${name}`;

/** Four members: three with a recap (two titled), one tier none; the oshi is not first in the list. */
const multi = (over: Partial<RecapOverview> = {}): RecapOverview => overview({
    members: [
        { member_path: P('40', '64', '松田 好花'), member_id: '64', name: '松田 好花', tier: 'short', oshi: false, title_key: 'recap.titles.morning' },
        { member_path: P('34', '58', '金村 美玖'), member_id: '58', name: '金村 美玖', tier: 'full', oshi: true, title_key: 'recap.titles.first' },
        { member_path: P('50', '70', '河田 陽菜'), member_id: '70', name: '河田 陽菜', tier: 'none', oshi: false, title_key: null },
        { member_path: P('60', '80', '佐々木 美玲'), member_id: '80', name: '佐々木 美玲', tier: 'standard', oshi: false, title_key: null },
    ],
    opening: { star_order: ['58', '80', '64', '70'], first_message: { member_id: '64', ts: '2025-12-31T15:00:07Z' }, oyasumi_total: 812 },
    ...over,
});

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
});
afterEach(() => { vi.useRealTimers(); });

describe('openingSlides', () => {
    it('plays the stars, then the role titles', () => {
        expect(openingSlides(multi()).map((s) => s.key)).toEqual(['o1_stars', 'o2_titles']);
    });

    it('leaves the titles slide out when no member has a title', () => {
        const o = multi();
        o.members = o.members.map((m) => ({ ...m, title_key: null }));
        expect(openingSlides(o).map((s) => s.key)).toEqual(['o1_stars']);
    });

    it('builds a player payload with no member id, so no breadcrumb names a member', () => {
        const p = openingPayload(multi());
        expect(p.member.id).toBe('');
        expect(p.year).toBe(2026);
        expect(p.poster).toBeNull();
    });
});

describe('Opening', () => {
    it('draws every member as an equal-size star in star_order, with no numbers', () => {
        render(<Opening overview={multi()} onDone={() => {}} />);
        expect(screen.getByTestId('recap-stage')).toHaveAttribute('data-slide', 'o1_stars');
        expect(screen.getByText('わたしの2026')).toBeInTheDocument();
        const stars = screen.getAllByTestId('opening-star');
        expect(stars.map((s) => s.getAttribute('data-member'))).toEqual(['58', '80', '64', '70']);
        const sizes = new Set(stars.map((s) => s.querySelector('svg')?.getAttribute('class')));
        expect(sizes.size).toBe(1);
        // The year in the title is the only digit on the slide: no counts, no oyasumi total, no ranks.
        const text = screen.getByTestId('slide-o1_stars').textContent ?? '';
        expect(text.replace('2026', '')).not.toMatch(/\d/);
        expect(text).not.toContain('812');
        // Member names are her identity: marked Japanese.
        expect(screen.getByText('金村 美玖')).toHaveAttribute('lang', 'ja');
        // The first message of the year is a label on her star, not a rank.
        expect(stars[2]).toHaveTextContent('今年最初の一通');
        expect(openingLogs()).toContainEqual(['recap_opening', { phase: 'show', count: 4 }]);
    });

    it('fits every star of a 60-member roster on the stage, all the same size', () => {
        const big = multi();
        big.members = Array.from({ length: 60 }, (_, i) => ({
            member_path: P(String(100 + i), String(200 + i), `メンバー${i}`), member_id: String(200 + i),
            name: `とても長い名前のメンバー${i}`, tier: 'short' as const, oshi: i === 0, title_key: null,
        }));
        big.opening = { star_order: big.members.map((m) => m.member_id), first_message: null, oyasumi_total: null };
        render(<Opening overview={big} onDone={() => {}} />);
        const stars = screen.getAllByTestId('opening-star');
        expect(stars).toHaveLength(60);
        const grid = screen.getByRole('list', { name: '今年の星々' });
        const cols = Number(grid.getAttribute('data-cols'));
        const rows = Number(grid.getAttribute('data-rows'));
        expect(cols * rows).toBeGreaterThanOrEqual(60);
        // The grid is a size container split into cols x rows cells; the star is sized in
        // container units from the row count, so every row fits the stage.
        expect(grid.className).toContain('[container-type:size]');
        expect(grid.className).toContain('[grid-template-rows:repeat(var(--star-rows),minmax(0,1fr))]');
        expect(grid.style.getPropertyValue('--star-rows')).toBe(String(rows));
        expect(grid.style.getPropertyValue('--star-size')).toContain(`${(STAR_SHARE * 100) / rows}cqh`);
        for (const star of stars) {
            expect(star.querySelector('svg')?.getAttribute('class')).toContain('h-[var(--star-size)]');
        }
        expect(new Set(stars.map((s) => s.querySelector('svg')?.getAttribute('class'))).size).toBe(1);
    });

    it('shows one role-title chip per titled member in star order, without ranks or numbers', () => {
        render(<Opening overview={multi()} onDone={() => {}} />);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(screen.getByTestId('recap-stage')).toHaveAttribute('data-slide', 'o2_titles');
        const rows = screen.getAllByTestId('opening-title');
        expect(rows.map((r) => r.textContent)).toEqual([
            '金村 美玖いちばん長く、そばにいてくれた人',
            '松田 好花いちばん“おはよう”をくれた朝の光',
        ]);
        expect(screen.getByTestId('slide-o2_titles').textContent).not.toMatch(/\d/);
    });

    it('the slide title is serif display and the narration the smaller sans', () => {
        render(<Opening overview={multi()} onDone={() => {}} />);
        for (const key of ['o1_stars', 'o2_titles']) {
            const slide = screen.getByTestId(`slide-${key}`);
            const title = slide.querySelector('[data-voice="title"]')!;
            expect(title.className).toMatch(/\bfont-display\b/);
            expect(title.hasAttribute('lang')).toBe(false);
            const narration = slide.querySelector('[data-voice="narration"]')!;
            expect(narration.className).toMatch(/\bfont-sans\b/);
            expect(narration.className).toMatch(/\btext-small\b/);
            if (key === 'o1_stars') fireEvent.keyDown(window, { key: 'ArrowRight' });
        }
    });

    it('ends after the last slide (→ past the end) and logs it', () => {
        const onDone = vi.fn();
        render(<Opening overview={multi()} onDone={onDone} />);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(onDone).toHaveBeenCalledWith('end');
        expect(openingLogs()).toContainEqual(['recap_opening', { phase: 'end', count: 2 }]);
    });

    it('← steps back and Esc closes to the list', () => {
        const onDone = vi.fn();
        render(<Opening overview={multi()} onDone={onDone} />);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(screen.getByTestId('recap-stage')).toHaveAttribute('data-slide', 'o1_stars');
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onDone).toHaveBeenCalledWith('close');
        expect(openingLogs()).toContainEqual(['recap_opening', { phase: 'close' }]);
    });

    it('auto-advances, holds while paused and holds its reveals', () => {
        vi.useFakeTimers();
        render(<Opening overview={multi()} onDone={() => {}} />);
        fireEvent.keyDown(window, { key: ' ' });
        expect(screen.getByTestId('recap-stage')).toHaveAttribute('data-paused', 'true');
        const star = screen.getAllByTestId('opening-star')[0];
        expect(star.style.animationPlayState).toBe('paused');
        act(() => { vi.advanceTimersByTime(AUTO_ADVANCE_MS * 2); });
        expect(screen.getByTestId('recap-stage')).toHaveAttribute('data-slide', 'o1_stars');
        fireEvent.keyDown(window, { key: ' ' });
        act(() => { vi.advanceTimersByTime(AUTO_ADVANCE_MS); });
        expect(screen.getByTestId('recap-stage')).toHaveAttribute('data-slide', 'o2_titles');
    });

    it('draws still with reduced motion', () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
        render(<Opening overview={multi()} onDone={() => {}} />);
        for (const star of screen.getAllByTestId('opening-star')) expect(star.className).not.toMatch(/animate-/);
    });

    it('registers exactly the two opening slides', () => {
        expect(Object.keys(OPENING_REGISTRY).sort()).toEqual(['o1_stars', 'o2_titles']);
    });
});

describe('starGrid', () => {
    it('always has a cell for every member and keeps three columns for small rosters', () => {
        for (let n = 1; n <= 200; n += 1) {
            const { cols, rows } = starGrid(n);
            expect(cols * rows, String(n)).toBeGreaterThanOrEqual(n);
            expect(cols * (rows - 1), String(n)).toBeLessThan(n); // no empty row
        }
        expect(starGrid(9)).toEqual({ cols: 3, rows: 3 });
        expect(starGrid(60).rows).toBeLessThanOrEqual(10);
    });

    it('a star and its two caption lines fit inside one cell', () => {
        expect(STAR_SHARE + 2 * STAR_LABEL_SHARE * STAR_LINE_HEIGHT).toBeLessThanOrEqual(1);
    });
});
