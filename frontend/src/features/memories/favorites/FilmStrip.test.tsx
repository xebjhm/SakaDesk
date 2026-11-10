import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchDay: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { openChat } from '../../../shell/openChat';
import { fetchDay } from '../api';
import { NicknameProvider } from '../shared/useNickname';
import { MEMBER_PATH } from '../__fixtures__/memories';
import { dayMessage, dayPayload, MIKU } from '../day/__fixtures__';
import { FilmStrip } from './FilmStrip';
import { stopMemoriesVoices, useVoicePlayback } from '../shared/voicePlayback';

beforeAll(async () => { await i18n.changeLanguage('en'); });

/** Five of her messages that day, 10:00 … 14:00 JST; the third is a ★. */
const DAY = dayPayload({
    members: [MIKU],
    messages: [1, 2, 3, 4, 5].map((n) => dayMessage(MIKU, {
        id: n,
        ts: `2024-09-14T0${n}:00:00Z`,
        text: `メッセージ${n}`,
        favorited: n === 3,
    })),
});

beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(openChat).mockClear();
    vi.mocked(fetchDay).mockReset().mockResolvedValue(DAY);
});

function renderStrip(focusId = 3, onClose = vi.fn()) {
    const ui = (id: number) => (
        <NicknameProvider nickname="みーぱん">
            <FilmStrip service="hinatazaka46" memberPath={MEMBER_PATH} date="2024-09-14" focusId={id} onClose={onClose} />
        </NicknameProvider>
    );
    const utils = render(ui(focusId));
    return { onClose, rerender: (id: number) => utils.rerender(ui(id)) };
}

const inDialog = () => screen.getByRole('dialog').contains(document.activeElement);

const focused = () => screen.getByTestId('film-focus');

describe('FilmStrip', () => {
    it("loads her day and centres the focus between that day's neighbours", async () => {
        renderStrip();
        expect(await screen.findByTestId('film-focus')).toHaveTextContent('メッセージ3');
        expect(vi.mocked(fetchDay).mock.calls[0]?.[1]).toEqual({ date: '2024-09-14', member: MEMBER_PATH });
        expect(screen.getByRole('dialog', { name: /The rest of this day/ })).toBeInTheDocument();
        const frames = screen.getAllByTestId('film-frame');
        expect(frames.map((f) => f.textContent)).toEqual([
            expect.stringContaining('メッセージ1'), expect.stringContaining('メッセージ2'),
            expect.stringContaining('メッセージ3'),
            expect.stringContaining('メッセージ4'), expect.stringContaining('メッセージ5'),
        ]);
        // Times on the JST clock; the ★ in the semantic star colour.
        expect(within(focused()).getByText('12:00')).toBeInTheDocument();
        expect(within(focused()).getByTestId('film-star')).toHaveClass('text-semantic-star');
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_load', { target: 'film_strip', outcome: 'ok', count: 5 });
    });

    it('moves older / newer with the arrows and the keys, stopping at the edges', async () => {
        renderStrip(2);
        await screen.findByTestId('film-focus');
        const older = screen.getByRole('button', { name: 'Previous message' });
        const newer = screen.getByRole('button', { name: 'Next message' });

        await userEvent.click(older);
        expect(focused()).toHaveTextContent('メッセージ1');
        expect(older).toBeDisabled();
        await userEvent.keyboard('{ArrowLeft}');
        expect(focused()).toHaveTextContent('メッセージ1');
        expect(within(focused()).queryByTestId('film-star')).toBeNull();

        await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
        expect(focused()).toHaveTextContent('メッセージ5');
        expect(newer).toBeDisabled();
        await userEvent.click(older);
        expect(focused()).toHaveTextContent('メッセージ4');
    });

    it('focuses a neighbour frame when it is clicked', async () => {
        renderStrip();
        await screen.findByTestId('film-focus');
        await userEvent.click(screen.getByRole('button', { name: /メッセージ4/ }));
        expect(focused()).toHaveTextContent('メッセージ4');
    });

    it('jumps to the chat at the focused message and closes', async () => {
        const { onClose } = renderStrip();
        await screen.findByTestId('film-focus');
        await userEvent.keyboard('{ArrowRight}');
        await userEvent.click(screen.getByRole('button', { name: 'View in chat' }));
        expect(vi.mocked(openChat)).toHaveBeenCalledWith(expect.objectContaining({
            service: 'hinatazaka46', path: MEMBER_PATH, name: '金村 美玖', message_id: 4,
        }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_jump', { target: 'favorites', has_target: true });
        expect(onClose).toHaveBeenCalled();
    });

    it('offers a retry when the day cannot be loaded', async () => {
        vi.mocked(fetchDay).mockRejectedValueOnce(new Error('x'));
        renderStrip();
        await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
        expect(await screen.findByTestId('film-focus')).toHaveTextContent('メッセージ3');
    });

    it('keeps the keys working after a neighbour click replaces the focused element', async () => {
        renderStrip();
        await screen.findByTestId('film-focus');
        await userEvent.click(screen.getByRole('button', { name: /メッセージ4/ }));
        expect(focused()).toHaveTextContent('メッセージ4');
        expect(inDialog()).toBe(true);
        await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
        expect(focused()).toHaveTextContent('メッセージ2');
    });

    it('moves focus off a button the edge disabled, so the keys keep working', async () => {
        renderStrip(4);
        await screen.findByTestId('film-focus');
        const newer = screen.getByRole('button', { name: 'Next message' });
        act(() => newer.focus());
        await userEvent.keyboard('{ArrowRight}');
        expect(focused()).toHaveTextContent('メッセージ5');
        expect(newer).toBeDisabled();
        expect(document.activeElement).not.toBe(newer);
        expect(inDialog()).toBe(true);
        await userEvent.keyboard('{ArrowLeft}');
        expect(focused()).toHaveTextContent('メッセージ4');
    });

    it("leaves ← / → to the voice player's slider", async () => {
        vi.mocked(fetchDay).mockResolvedValue(dayPayload({
            members: [MIKU],
            messages: [
                dayMessage(MIKU, { id: 1, ts: '2024-09-14T01:00:00Z', text: 'まえ' }),
                dayMessage(MIKU, {
                    id: 2, ts: '2024-09-14T02:00:00Z', type: 'voice', text: null, duration_s: 30,
                    media_url: '/api/content/media/hinatazaka46/x/voice/2.m4a',
                }),
            ],
        }));
        renderStrip(2);
        await screen.findByTestId('film-focus');
        await userEvent.click(within(focused()).getByRole('button', { name: 'Play voice' }));
        const slider = focused().querySelector('input[type="range"]') as HTMLInputElement;
        expect(slider).not.toBeNull();
        act(() => slider.focus());
        await userEvent.keyboard('{ArrowLeft}');
        expect(focused().querySelector('audio')).not.toBeNull();
        act(() => stopMemoriesVoices());
    });

    it('plays its focused voice alone', async () => {
        vi.mocked(fetchDay).mockResolvedValue(dayPayload({
            members: [MIKU],
            messages: [dayMessage(MIKU, {
                id: 2, ts: '2024-09-14T02:00:00Z', type: 'voice', text: null,
                media_url: '/api/content/media/hinatazaka46/x/voice/2.m4a',
            })],
        }));
        act(() => useVoicePlayback.getState().play('board|elsewhere|9'));
        renderStrip(2);
        await screen.findByTestId('film-focus');
        await userEvent.click(within(focused()).getByRole('button', { name: 'Play voice' }));
        expect(useVoicePlayback.getState().playing).toBe('strip|messages/34 金村 美玖/58 金村 美玖|2');
        act(() => stopMemoriesVoices());
    });

    it('logs one breadcrumb and opens on the first message when the focus is missing', async () => {
        renderStrip(999);
        expect(await screen.findByTestId('film-focus')).toHaveTextContent('メッセージ1');
        const skips = vi.mocked(clientLog).mock.calls.filter(([event]) => event === 'memories_skip');
        expect(skips).toEqual([['memories_skip', { target: 'film_strip', reason: 'focus_missing', message_id: 999 }]]);
    });

    it('starts again on a new focus id', async () => {
        const { rerender } = renderStrip(3);
        await screen.findByTestId('film-focus');
        await userEvent.keyboard('{ArrowRight}');
        expect(focused()).toHaveTextContent('メッセージ4');
        rerender(1);
        expect(focused()).toHaveTextContent('メッセージ1');
    });
});
