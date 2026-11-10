import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { MemberPane, type MemberPaneItem } from './MemberPane';

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

    it('gives the name the room first: a long trailing detail truncates before the name (D1)', () => {
        render(
            <MemberPane
                items={[{ key: 'c', name: '高井 俐香', oshi: true, trailing: '1 hour 1 min' }]}
                selectedKey={null}
                onSelect={() => {}}
            />,
        );
        const name = screen.getByTestId('member-pane-name');
        const trailing = screen.getByTestId('member-pane-trailing');
        // The name no longer grows into a fixed share and truncates only after the trailing.
        expect(name).not.toHaveClass('flex-1');
        expect(name).toHaveClass('min-w-0', 'shrink', 'truncate');
        expect(name).toHaveAttribute('title', '高井 俐香');
        // The trailing detail gives its width up first and truncates on its own.
        expect(trailing).not.toHaveClass('shrink-0');
        expect(trailing).toHaveClass('min-w-0', 'shrink-[1000]', 'truncate', 'ml-auto');
        expect(trailing).toHaveAttribute('title', '1 hour 1 min');
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
