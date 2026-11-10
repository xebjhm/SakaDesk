import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VirtuosoMockContext } from 'react-virtuoso';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchNameMoments: vi.fn(), fetchDay: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { fetchDay, fetchNameMoments } from '../api';
import { MEMBER_PATH, memoryMessage } from '../__fixtures__/memories';
import { dayMessage, dayPayload, MIKU } from '../day/__fixtures__';
import { NicknameProvider } from '../shared/useNickname';
import type { NameMomentsPayload } from '../types';
import { NameMoments } from './NameMoments';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

/** Newest first: 2025-01-03 (two sentences of one message), then 2024-09-14. */
function payload(year?: number): NameMomentsPayload {
    const items: NameMomentsPayload['items'] = [
        { message: memoryMessage({ id: 9, ts: '2025-01-03T01:00:00Z', avatar_url: '/api/content/media/a2.jpg' }), sentence: '%%%、あけおめ！' },
        { message: memoryMessage({ id: 9, ts: '2025-01-03T01:00:00Z', avatar_url: '/api/content/media/a2.jpg' }), sentence: '今年も%%%と一緒に。' },
        { message: memoryMessage({ id: 4, ts: '2024-09-14T12:52:00Z', avatar_url: '/api/content/media/a1.jpg' }), sentence: '％％％、おはよう🌸' },
    ];
    return {
        years: [2025, 2024],
        items: year === undefined ? items : items.filter((i) => new Date(i.message.ts).getUTCFullYear() === year),
    };
}

beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(fetchNameMoments).mockReset().mockImplementation(async (_s, _m, year) => payload(year));
    vi.mocked(fetchDay).mockReset().mockResolvedValue(dayPayload({
        members: [MIKU],
        messages: [dayMessage(MIKU, { id: 4, ts: '2024-09-14T12:52:00Z', text: '％％％、おはよう🌸' })],
    }));
});

function renderNames(onBack = vi.fn()) {
    render(
        // jsdom has no layout: the real list gets a viewport that fits every row.
        <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 60 }}>
            <NicknameProvider nickname="みーぱん">
                <NameMoments service="hinatazaka46" memberPath={MEMBER_PATH} name="金村 美玖" onBack={onBack} />
            </NicknameProvider>
        </VirtuosoMockContext.Provider>,
    );
    return { onBack };
}

describe('NameMoments', () => {
    it('lists her sentences newest first with the nickname underlined and replaced', async () => {
        renderNames();
        expect(screen.getByRole('heading', { name: '名前を呼ばれた瞬間' })).toBeInTheDocument();
        const rows = await screen.findAllByTestId('name-moment');
        expect(rows).toHaveLength(3);
        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
        expect(rows[0]).toHaveTextContent('みーぱん、あけおめ！');
        expect(rows[2]).toHaveTextContent('みーぱん、おはよう🌸');
        const name = within(rows[2]).getByText('みーぱん');
        expect(name.tagName).toBe('SPAN');
        expect(name).toHaveClass('underline');
        expect(within(rows[2]).getByTestId('memory-text')).toHaveAttribute('lang', 'ja');
        // her avatar at the time
        expect(within(rows[0]).getByRole('img')).toHaveAttribute('src', '/api/content/avatar/a2.jpg?w=64');
        expect(within(rows[2]).getByRole('img')).toHaveAttribute('src', '/api/content/avatar/a1.jpg?w=64');
        expect(vi.mocked(fetchNameMoments).mock.calls[0]?.slice(0, 3)).toEqual(['hinatazaka46', MEMBER_PATH, undefined]);
    });

    it('filters by year through the backend, newest year first, and back to all', async () => {
        renderNames();
        await screen.findAllByTestId('name-moment');
        const group = screen.getByRole('group');
        const pills = within(group).getAllByRole('button').map((b) => b.textContent);
        expect(pills).toEqual(['すべて', '2025', '2024']);
        expect(within(group).getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'true');

        await userEvent.click(within(group).getByRole('button', { name: '2024' }));
        await waitFor(() => expect(vi.mocked(fetchNameMoments).mock.lastCall?.[2]).toBe(2024));
        await waitFor(() => expect(screen.getAllByTestId('name-moment')).toHaveLength(1));
        // the year pills stay while the filtered list loads and after it
        expect(within(screen.getByRole('group')).getByRole('button', { name: '2025' })).toBeInTheDocument();
        expect(within(screen.getByRole('group')).getByRole('button', { name: '2024' })).toHaveAttribute('aria-pressed', 'true');

        await userEvent.click(within(screen.getByRole('group')).getByRole('button', { name: 'すべて' }));
        await waitFor(() => expect(vi.mocked(fetchNameMoments).mock.lastCall?.[2]).toBeUndefined());
        await waitFor(() => expect(screen.getAllByTestId('name-moment')).toHaveLength(3));
    });

    it('opens the film strip of that day at the message', async () => {
        renderNames();
        const rows = await screen.findAllByTestId('name-moment');
        await userEvent.click(rows[2]);
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        // 12:52 UTC is 21:52 JST on the 14th
        await waitFor(() => expect(vi.mocked(fetchDay).mock.calls[0]?.[1]).toEqual({ date: '2024-09-14', member: MEMBER_PATH }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'film_strip', outcome: 'on' });
    });

    it('goes back to the binder', async () => {
        const { onBack } = renderNames();
        await userEvent.click(screen.getByRole('button', { name: '生写真帳へ' }));
        expect(onBack).toHaveBeenCalled();
    });

    it('shows a gentle empty state without moments', async () => {
        vi.mocked(fetchNameMoments).mockResolvedValue({ years: [], items: [] });
        renderNames();
        expect(await screen.findByText('ここには、名前を呼んでくれた瞬間が並びます')).toBeInTheDocument();
        expect(screen.queryByTestId('name-moment')).not.toBeInTheDocument();
        expect(screen.queryByRole('group')).not.toBeInTheDocument();
    });
});
