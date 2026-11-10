import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import { openChat } from '../../../shell/openChat';
import { NicknameProvider } from '../shared/useNickname';
import { BurstStack } from './BurstStack';
import { photo } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    vi.mocked(openChat).mockClear();
    vi.mocked(clientLog).mockClear();
});

const ITEMS = [
    photo(3, '2024-09', { caption: '連写1、%%%' }),
    photo(4, '2024-09', { text: '連写2' }),
    photo(5, '2024-09'),
];

const renderStack = () => render(
    <NicknameProvider nickname="みーぱん">
        <BurstStack items={ITEMS} title="September 2024" nameOf={() => '金村 美玖'} sepia="sepia-memories-1" />
    </NicknameProvider>,
);

describe('BurstStack', () => {
    it('shows a stacked still with the photo count', () => {
        renderStack();
        const stack = screen.getByRole('button', { name: /3 photos/ });
        expect(stack.querySelectorAll('img')).toHaveLength(1);
        expect(stack.querySelector('img')).toHaveClass('sepia-memories-1');
        expect(stack.querySelector('img')).toHaveAttribute('loading', 'lazy');
    });

    it('opens the sequence in order with each caption beside it', async () => {
        renderStack();
        await userEvent.click(screen.getByRole('button', { name: /3 photos/ }));
        const dialog = await screen.findByRole('dialog');
        const rows = within(dialog).getAllByTestId('burst-frame');
        expect(rows).toHaveLength(3);
        expect(rows[0].querySelector('img')).toHaveAttribute('src', expect.stringContaining('/3.jpg'));
        expect(rows[2].querySelector('img')).toHaveAttribute('src', expect.stringContaining('/5.jpg'));
        expect(within(rows[0]).getByTestId('memory-text')).toHaveTextContent('連写1、みーぱん');
        expect(within(rows[1]).getByTestId('memory-text')).toHaveTextContent('連写2');
        expect(within(rows[2]).queryByTestId('memory-text')).toBeNull();
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'album_burst', outcome: 'on' });
    });

    it('jumps to her chat from a frame', async () => {
        renderStack();
        await userEvent.click(screen.getByRole('button', { name: /3 photos/ }));
        const rows = within(await screen.findByRole('dialog')).getAllByTestId('burst-frame');
        await userEvent.click(within(rows[1]).getByRole('button', { name: 'View in chat' }));
        expect(vi.mocked(openChat)).toHaveBeenCalledWith(expect.objectContaining({ message_id: 4 }));
        // the jump closes the sequence, and the close is logged like any other
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'album_burst', outcome: 'off' });
    });

    it('marks a favourite inside the burst with the yellow star', async () => {
        render(
            <NicknameProvider nickname="みーぱん">
                <BurstStack items={[ITEMS[0], { ...ITEMS[1], favorited: true }, ITEMS[2]]} title="September 2024" nameOf={() => '金村 美玖'} sepia="" />
            </NicknameProvider>,
        );
        const stack = screen.getByRole('button', { name: /3 photos/ });
        expect(within(stack).getByTestId('burst-star')).toHaveClass('text-semantic-star');
        await userEvent.click(stack);
        const rows = within(await screen.findByRole('dialog')).getAllByTestId('burst-frame');
        expect(within(rows[1]).getByTestId('burst-frame-star')).toHaveClass('text-semantic-star');
        expect(within(rows[0]).queryByTestId('burst-frame-star')).toBeNull();
    });
});
