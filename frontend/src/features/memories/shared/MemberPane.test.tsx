import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { MEMBER_PANE_MIN_REM, MEMBER_PANE_WIDTH, MemberPane, type MemberPaneItem } from './MemberPane';

beforeAll(async () => { await i18n.changeLanguage('en'); });

const items: MemberPaneItem[] = [
    { key: 'a', memberPath: '日向坂46/messages/34 金村 美玖/58 金村 美玖', name: '金村 美玖', avatarUrl: '/api/content/media/hinatazaka46/a.jpg', oshi: true, trailing: <span>12</span> },
    { key: 'b', memberPath: '日向坂46/messages/1 小坂 菜緒/1 小坂 菜緒', name: '小坂 菜緒' },
];

describe('MemberPane', () => {
    it('marks the oshi in the oshi tone, never the group accent', () => {
        render(<MemberPane items={items} selectedKey="b" onSelect={() => {}} />);
        const marker = screen.getByTestId('member-pane-oshi');
        expect(marker.getAttribute('class')).toMatch(/semantic-oshi/);
        expect(marker.getAttribute('class')).not.toMatch(/accent/);
        expect(screen.getAllByTestId('member-pane-oshi')).toHaveLength(1);
    });

    it('keeps the name on its own line and puts the trailing detail below it (D1, N2)', () => {
        render(
            <MemberPane
                items={[{ key: 'c', name: '高井 俐香', oshi: true, trailing: '1 hour 1 min' }]}
                selectedKey={null}
                onSelect={() => {}}
            />,
        );
        const name = screen.getByTestId('member-pane-name');
        const line = screen.getByTestId('member-pane-name-line');
        const trailing = screen.getByTestId('member-pane-trailing');
        // The name line holds the name and the heart only; the trailing is not on it.
        expect(line.contains(name)).toBe(true);
        expect(line.contains(screen.getByTestId('member-pane-oshi'))).toBe(true);
        expect(line.contains(trailing)).toBe(false);
        // Name and detail stack in one column beside the avatar.
        expect(line.parentElement).toBe(trailing.parentElement);
        expect(line.parentElement).toHaveClass('flex-col', 'min-w-0', 'flex-1');
        expect(name).toHaveClass('min-w-0', 'truncate');
        expect(name).toHaveAttribute('title', '高井 俐香');
        expect(trailing).toHaveClass('min-w-0', 'truncate');
        expect(trailing).toHaveAttribute('title', '1 hour 1 min');
    });

    it('stacks the all row the same way, so 「全員」 never truncates beside its total (N2)', () => {
        render(<MemberPane items={items} selectedKey={null} onSelect={() => {}} allLabel="全員" allTrailing="7 小時 59 分" />);
        const label = screen.getByTestId('member-pane-all-label');
        const total = screen.getByTestId('member-pane-all-trailing');
        expect(label.parentElement).toBe(total.parentElement);
        expect(label.parentElement).toHaveClass('flex-col');
        expect(total).toHaveAttribute('title', '7 小時 59 分');
    });

    it('at its minimum width the name line still fits a five-character name and the heart (N2)', () => {
        // 960 x 640 is the smallest window; the pane then gets its clamp minimum.
        expect(MEMBER_PANE_WIDTH).toBe(`w-[clamp(${MEMBER_PANE_MIN_REM}rem,24%,15rem)]`);
        const rem = 16;
        const body = 14; // --ds-font-body-size
        const pane = MEMBER_PANE_MIN_REM * rem;
        // nav p-2 (2 x 8), a scrollbar (8), row px-3 (2 x 12), avatar (32), gap-3 (12).
        const nameLine = pane - 16 - 8 - 24 - 32 - 12;
        // 「正源司 陽子」: five CJK glyphs and a space, then gap-1 (4) and the 14 px heart.
        const longName = 5 * body + body / 3 + 4 + 14;
        expect(nameLine).toBeGreaterThanOrEqual(longName);
    });

    it('fires onSelect with the item and marks the selected row', async () => {
        const onSelect = vi.fn();
        render(<MemberPane items={items} selectedKey="a" onSelect={onSelect} />);
        expect(screen.getByRole('button', { name: /金村 美玖/ })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('button', { name: /小坂 菜緒/ })).not.toHaveAttribute('aria-current');
        await userEvent.click(screen.getByRole('button', { name: /小坂 菜緒/ }));
        expect(onSelect).toHaveBeenCalledWith('b');
    });

    it('shows the all row first when asked and selects it with a null key', async () => {
        const onSelect = vi.fn();
        render(<MemberPane items={items} selectedKey={null} onSelect={onSelect} allLabel="Everyone" />);
        const rows = screen.getAllByRole('button');
        expect(rows[0]).toHaveTextContent('Everyone');
        expect(rows[0]).toHaveAttribute('aria-current', 'true');
        await userEvent.click(screen.getByRole('button', { name: /小坂/ }));
        await userEvent.click(rows[0]);
        expect(onSelect).toHaveBeenLastCalledWith(null);
    });

    it('resizes the avatar through the avatar route and marks names as Japanese', () => {
        render(<MemberPane items={items} selectedKey={null} onSelect={() => {}} />);
        const img = screen.getByRole('button', { name: /金村/ }).querySelector('img');
        expect(img?.getAttribute('src')).toMatch(/^\/api\/content\/avatar\/hinatazaka46\/a\.jpg\?w=\d+$/);
        expect(screen.getByText('金村 美玖')).toHaveAttribute('lang', 'ja');
        expect(screen.getByText('12')).toBeInTheDocument();
    });

    it('never shows a trailing 0 (a person or the all row without items shows no number)', () => {
        render(
            <MemberPane
                items={[{ key: 'z', name: '二部 ひな', trailing: 0 }, { key: 'y', name: '小坂 菜緒', trailing: 3 }]}
                selectedKey={null}
                onSelect={() => {}}
                allLabel="All"
                allTrailing={0}
            />,
        );
        expect(screen.getByRole('button', { name: /二部 ひな/ }).textContent).not.toContain('0');
        expect(screen.getByRole('button', { name: /All/ }).textContent).not.toContain('0');
        expect(screen.getByRole('button', { name: /小坂 菜緒/ })).toHaveTextContent('3');
    });
});
