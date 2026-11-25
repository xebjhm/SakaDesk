import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { pullKey } from './keys';
import { PullHistory } from './PullHistory';
import { gachaPull, missingPull } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const PULLS = [
    gachaPull({ pull_index: 1, rarity: 'sr', reason: 'midnight' }, { id: 2 }),
    gachaPull({ pull_index: 0 }, { id: 1 }),
    missingPull({ jst_date: '2026-11-08' }),
];

describe('PullHistory', () => {
    it('lists every pull as a small capsule in its rarity colour with its date, in the given (newest-first) order', () => {
        render(<PullHistory pulls={PULLS} selectedKey={null} onSelect={vi.fn()} />);
        const list = screen.getByRole('list', { name: 'これまでに出た思い出' });
        const items = within(list).getAllByRole('button');
        expect(items).toHaveLength(3);
        expect(items[0]?.innerHTML).toContain('bg-memories-rarity-sr');
        expect(items[1]?.innerHTML).toContain('bg-memories-rarity-n');
        expect(items[2]?.innerHTML).toContain('bg-memories-rarity-r');
        expect(items[0]).toHaveTextContent('11/10');
        expect(items[2]).toHaveTextContent('11/8');
        expect(items[0]).toHaveAccessibleName(/SR/);
    });

    it('scrolls inside itself', () => {
        render(<PullHistory pulls={PULLS} selectedKey={null} onSelect={vi.fn()} />);
        expect(screen.getByRole('list', { name: 'これまでに出た思い出' })).toHaveClass('overflow-x-auto');
    });

    it('reopens a card on click and marks the open one', async () => {
        const onSelect = vi.fn();
        render(<PullHistory pulls={PULLS} selectedKey={pullKey(PULLS[1]!)} onSelect={onSelect} />);
        const items = screen.getAllByRole('button');
        expect(items[1]).toHaveAttribute('aria-current', 'true');
        await userEvent.click(items[2]!);
        expect(onSelect).toHaveBeenCalledWith(PULLS[2]);
    });

    it('renders nothing without pulls', () => {
        const { container } = render(<PullHistory pulls={[]} selectedKey={null} onSelect={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });
});
