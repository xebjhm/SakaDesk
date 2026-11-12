import { describe, it, expect, vi, beforeAll, beforeEach, onTestFinished } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import i18n from '../../../i18n';
import { server } from '../../../__tests__/mocks/server';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchDay: vi.fn(), fetchCapsule: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { openChat } from '../../../shell/openChat';
import { fetchCapsule, fetchDay } from '../api';
import { DayView } from './DayView';
import { useAppStore } from '../../../store/appStore';
import { NicknameProvider } from '../shared/useNickname';
import { dayMessage, dayPayload, HIKARU, MIKU, NAO } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('en'); });
// MessageBubble asks for cached translations and transcripts of what it shows (and saves a translation).
beforeEach(() => {
    server.use(
        http.get('/api/app-state/translations', () => HttpResponse.json({})),
        http.patch('/api/app-state/translations', () => HttpResponse.json({})),
        http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
    );
});
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(openChat).mockClear();
    vi.mocked(fetchCapsule).mockReset().mockResolvedValue({ notes: [] });
    vi.mocked(fetchDay).mockReset();
    vi.mocked(fetchDay).mockImplementation(async (_service, query) => (
        query.others
            ? dayPayload({
                members: [MIKU, NAO, HIKARU],
                messages: [
                    ...dayPayload().messages,
                    dayMessage(HIKARU, { id: 9, ts: '2024-09-14T13:00:00Z', text: 'おつかれさま' }),
                ],
                other_services: ['sakurazaka46'],
            })
            : dayPayload()
    ));
});

const renderDay = (props: Partial<React.ComponentProps<typeof DayView>> = {}) => render(
    <NicknameProvider nickname="みーぱん">
        <DayView service="hinatazaka46" date="2024-09-14" {...props} />
    </NicknameProvider>,
);

describe('DayView', () => {
    it('renders every message in time order with the nickname and one number', async () => {
        renderDay();
        const list = await screen.findByTestId('day-merged');
        const text = list.textContent ?? '';
        expect(text.indexOf('リハ終わり！')).toBeLessThan(text.indexOf('最高の景色だった…みーぱん'));
        expect(text).not.toContain('%%%');
        expect(screen.getByText('3 messages')).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/2024/);
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_load', { target: 'day', outcome: 'ok', count: 3 });
    });

    it('shows the holiday name in Japanese', async () => {
        vi.mocked(fetchDay).mockResolvedValue(dayPayload({ date: '2024-11-03' }));
        renderDay({ date: '2024-11-03' });
        expect(await screen.findByText('文化の日')).toHaveAttribute('lang', 'ja');
    });

    it('filters by a member chip', async () => {
        renderDay();
        await screen.findByTestId('day-merged');
        await userEvent.click(screen.getByRole('button', { name: /小坂 菜緒/ }));
        const list = screen.getByTestId('day-merged');
        expect(list.textContent).not.toContain('リハ終わり！');
        expect(within(list).getAllByRole('img').length).toBeGreaterThan(0);
        await userEvent.click(screen.getByRole('button', { name: 'Everyone' }));
        expect(screen.getByTestId('day-merged').textContent).toContain('リハ終わり！');
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'member_filter', outcome: 'on' });
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'member_filter', outcome: 'off' });
    });

    it('shows bubble times on the JST clock and opens no favourite menu (read-only)', async () => {
        const savedTz = process.env.TZ;
        process.env.TZ = 'Asia/Taipei'; // a UTC+8 viewer
        onTestFinished(() => { process.env.TZ = savedTz; });
        renderDay();
        const list = await screen.findByTestId('day-merged');
        // 04:02Z is 13:02 JST, 12:52Z is 21:52 JST, whatever the machine zone.
        expect(within(list).getByText('13:02')).toBeInTheDocument();
        expect(within(list).getByText('21:52')).toBeInTheDocument();
        fireEvent.contextMenu(within(list).getByText('リハ終わり！'));
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('lets a bubble translate with the message path and service', async () => {
        useAppStore.setState({ translationEnabled: true });
        const translate = vi.fn((_body: unknown) => HttpResponse.json({ ok: true, translation: 'Rehearsal done!' }));
        server.use(http.post('/api/translation/translate', async ({ request }) => translate(await request.json())));
        try {
            renderDay();
            await screen.findByTestId('day-merged');
            await userEvent.click(screen.getAllByRole('button', { name: i18n.t('translation.translate') })[0]);
            await waitFor(() => expect(translate).toHaveBeenCalled());
            expect(translate.mock.calls[0][0]).toMatchObject({ message_id: 1, service: 'hinatazaka46', member_path: MIKU.member_path });
        } finally {
            useAppStore.setState({ translationEnabled: false });
        }
    });

    it('refetches with other groups when the switch is on, labels them and logs', async () => {
        renderDay();
        await screen.findByTestId('day-merged');
        expect(screen.queryByTestId('day-service-label')).toBeNull();
        await userEvent.click(screen.getByRole('switch', { name: 'Include other groups' }));
        expect(vi.mocked(fetchDay)).toHaveBeenLastCalledWith('hinatazaka46', { date: '2024-09-14', member: undefined, others: true }, expect.anything());
        expect(await screen.findByTestId('day-service-label')).toHaveTextContent('櫻坂46');
        expect(screen.getByText('おつかれさま')).toBeInTheDocument();
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'other_services', outcome: 'on' });
        // Only the other group's chip carries a group marker.
        expect(screen.getAllByTestId('day-chip-group-marker')).toHaveLength(1);
        expect(screen.getByRole('button', { name: /森田 ひかる/ })).toContainElement(screen.getByTestId('day-chip-group-marker'));
    });

    it('switches to member lanes and logs the mode', async () => {
        renderDay();
        await screen.findByTestId('day-merged');
        await userEvent.click(screen.getByRole('button', { name: 'By member' }));
        expect(screen.getByTestId('day-lanes')).toBeInTheDocument();
        expect(screen.queryByTestId('day-merged')).toBeNull();
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'day_mode', outcome: 'on' });
        await userEvent.click(screen.getByRole('button', { name: 'In time order' }));
        expect(screen.getByTestId('day-merged')).toBeInTheDocument();
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'day_mode', outcome: 'off' });
    });

    it('opens the media viewer on a photo and jumps to her chat at that message', async () => {
        renderDay();
        await screen.findByTestId('day-merged');
        await userEvent.click(screen.getAllByAltText(i18n.t('messageList.attachment'))[0]);
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: 'View in chat' }));
        expect(vi.mocked(openChat)).toHaveBeenCalledWith(expect.objectContaining({ message_id: 2, name: '小坂 菜緒', service: 'hinatazaka46' }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_jump', { target: 'day', has_target: true });
    });

    it('asks only for one person and hides the cross-group switch when a member is given', async () => {
        renderDay({ memberPath: MIKU.member_path });
        await screen.findByTestId('day-merged');
        expect(vi.mocked(fetchDay)).toHaveBeenCalledWith('hinatazaka46', { date: '2024-09-14', member: MIKU.member_path, others: false }, expect.anything());
        expect(screen.queryByRole('switch')).toBeNull();
    });

    it('shows the gentle copy, never a 0, for a day without messages', async () => {
        vi.mocked(fetchDay).mockResolvedValue(dayPayload({ members: [], messages: [] }));
        renderDay();
        expect(await screen.findByText(i18n.t('memories.onThisDay.empty'))).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/\b0 messages\b/);
    });

    it('renders the header slot', async () => {
        renderDay({ headerSlot: <span>slot</span> });
        expect(await screen.findByText('slot')).toBeInTheDocument();
    });

    it('holds the capsule strip of the day under the header', async () => {
        renderDay();
        expect(await screen.findByTestId('capsule-strip')).toBeInTheDocument();
        expect(fetchCapsule).toHaveBeenCalledWith('hinatazaka46', { date: '2024-09-14' }, expect.any(AbortSignal));
    });

    it('keeps the capsule strip on a one-person day (the calendar member filter)', async () => {
        renderDay({ memberPath: '日向坂46/messages/34 金村 美玖/58 金村 美玖' });
        expect(await screen.findByTestId('capsule-strip')).toBeInTheDocument();
        expect(fetchCapsule).toHaveBeenCalledWith('hinatazaka46', { date: '2024-09-14' }, expect.any(AbortSignal));
    });

    it('has no capsule strip when the host turns it off (the card and film strip contexts)', async () => {
        renderDay({ showCapsule: false });
        await screen.findByTestId('day-merged');
        expect(screen.queryByTestId('capsule-strip')).toBeNull();
        expect(fetchCapsule).not.toHaveBeenCalled();
    });
});

describe('DayView keeps the previous day (F24)', () => {
    it('a day step keeps the previous day visible and aria-busy, and swaps when ready', async () => {
        const { rerender } = renderDay();
        await screen.findByTestId('day-merged');
        let finish: (v: ReturnType<typeof dayPayload>) => void = () => {};
        vi.mocked(fetchDay).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        rerender(
            <NicknameProvider nickname="みーぱん">
                <DayView service="hinatazaka46" date="2024-09-15" />
            </NicknameProvider>,
        );
        await waitFor(() => expect(fetchDay).toHaveBeenLastCalledWith('hinatazaka46', expect.objectContaining({ date: '2024-09-15' }), expect.anything()));
        const kept = screen.getByTestId('day-merged');
        expect(kept.textContent).toContain('リハ終わり！');
        expect(kept.closest('[aria-busy="true"]')).not.toBeNull();
        expect(kept.closest('[inert]')).not.toBeNull();
        finish(dayPayload({ date: '2024-09-15', messages: [dayMessage(MIKU, { id: 77, ts: '2024-09-15T03:00:00Z', text: '次の日 🍜' })] }));
        await waitFor(() => expect(screen.getByTestId('day-merged').textContent).toContain('次の日 🍜'));
        expect(screen.getByTestId('day-merged').closest('[aria-busy="true"]')).toBeNull();
    });
});

describe('DayView never keeps an empty day', () => {
    it('a step away from an empty day shows the loading state, not the empty line under the new date', async () => {
        vi.mocked(fetchDay).mockResolvedValueOnce(dayPayload({ messages: [] }));
        const { rerender } = renderDay();
        expect(await screen.findByText('No memories from this day here yet. Try opening another day.')).toBeInTheDocument();
        vi.mocked(fetchDay).mockImplementationOnce(() => new Promise(() => {}));
        rerender(
            <NicknameProvider nickname="みーぱん">
                <DayView service="hinatazaka46" date="2024-09-15" />
            </NicknameProvider>,
        );
        expect(screen.queryByText('No memories from this day here yet. Try opening another day.')).toBeNull();
        await waitFor(() => expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument());
    });
});
