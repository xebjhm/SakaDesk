import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { clientLog } from '../../utils/clientLog';
import { LETTERS_WAIT_MS } from './hooks/useRoomLetters';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);
// The sidebar is a stand-in: one button per room, so a test can switch rooms directly.
vi.mock('./components/MemberList', () => ({
    MemberList: ({ onSelectGroup }: { onSelectGroup: (dir: string, group: boolean, name: string) => void }) => (
        <nav>
            {ROOMS.map((r) => (
                <button key={r.dir} type="button" onClick={() => onSelectGroup(r.dir, false, r.name)}>{`open ${r.id}`}</button>
            ))}
        </nav>
    ),
}));
// The menu (and its media gallery) records the list state it is handed (M6 / M7).
const menu: { status?: string; retry?: () => void } = {};
vi.mock('./components/ConversationMenu', () => ({
    ConversationMenu: ({ messagesStatus, onRetryMessages }: { messagesStatus?: string; onRetryMessages?: () => void }) => {
        menu.status = messagesStatus;
        menu.retry = onRetryMessages;
        return null;
    },
}));

import { MessagesFeature } from './MessagesFeature';
import { CHAT_LOAD_TIMEOUT_MS } from './chatLoadState';

const SERVICE = 'hinatazaka46';
const ROOMS = [
    { id: 'A', dir: '日向坂46/messages/34 金村 美玖/58 金村 美玖', name: '金村 美玖', text: 'A のメッセージ 🌸' },
    { id: 'B', dir: '日向坂46/messages/12 小坂 菜緒/20 小坂 菜緒', name: '小坂 菜緒 🍓', text: 'B のメッセージ 🎀' },
    { id: 'C', dir: '日向坂46/messages/40 正源司 陽子/90 正源司 陽子', name: '正源司 陽子', text: 'C のメッセージ ☀️' },
    // Letters are cached per room for the module's life: each letters test uses its own room.
    { id: 'D', dir: '日向坂46/messages/41 藤嶌 果歩/91 藤嶌 果歩', name: '藤嶌 果歩', text: 'D のメッセージ 🐬' },
    { id: 'E', dir: '日向坂46/messages/42 渡辺 莉奈/92 渡辺 莉奈', name: '渡辺 莉奈', text: 'E のメッセージ 🍰' },
    { id: 'F', dir: '日向坂46/messages/43 山下 葉留花/93 山下 葉留花', name: '山下 葉留花', text: 'F のメッセージ 🌷' },
] as const;
type RoomId = (typeof ROOMS)[number]['id'];
const room = (id: RoomId) => ROOMS.find((r) => r.id === id)!;

const LABEL = 'メッセージを読み込み中...';
const SLOW = 'まだメッセージを読み込んでいます…';
const VERY_SLOW = 'メッセージの多いトークは、開くまで少し時間がかかります。';
const FAILED = 'メッセージを読み込めませんでした';
const FAILED_HINT = '保存したデータはそのままです。もう一度お試しください。';
const TIMEOUT = '読み込みに時間がかかりすぎています';
const TIMEOUT_HINT = 'アプリがまだ処理中かもしれません。少し待ってからもう一度お試しください。';
const RETRY = 'もう一度';
const SECRET = 'SECRET-DETAIL /home/someone/日向坂46';

const props = { appSettings: null, syncProgress: { state: 'idle' } as never, syncVersion: 0 };

/** The reply each room's message list gets; replaced per test. */
let replies: Record<RoomId, () => Promise<Response> | Response>;
let letterReplies: Record<RoomId, () => Promise<Response> | Response>;
const listCalls: Record<string, number> = {};
const listSignals: Record<string, AbortSignal[]> = {};

const roomOf = (path: string | null) => ROOMS.find((r) => r.dir === path);
const okList = (id: RoomId) => () => HttpResponse.json({
    member: { id: id, name: room(id).name, path: room(id).dir, thumbnail_local: null, thumbnail: null, portrait: null, phone_image: null },
    messages: [{ id: 1, timestamp: '2024-01-15T09:00:00Z', type: 'text', content: room(id).text, is_favorite: false, media_file: null, width: null, height: null }],
    total_count: 1,
    max_message_id: 1,
});
const noLetters = () => HttpResponse.json({ letters: [] });

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
}
/** A list reply that waits for the gate, then answers with the room's messages. */
function gated(id: RoomId) {
    const gate = deferred();
    return { reply: async () => { await gate.promise; return okList(id)(); }, open: gate.resolve };
}

function serve() {
    server.use(
        http.get('/api/content/messages_by_path', ({ request }) => {
            const path = new URL(request.url).searchParams.get('path');
            const r = roomOf(path)!;
            listCalls[r.id] = (listCalls[r.id] ?? 0) + 1;
            (listSignals[r.id] ??= []).push(request.signal);
            return replies[r.id]();
        }),
        http.get('/api/chat/letters_local', ({ request }) => {
            const path = new URL(request.url).searchParams.get('member_path') ?? new URL(request.url).searchParams.get('path');
            const r = roomOf(path);
            return r ? letterReplies[r.id]() : noLetters();
        }),
        http.get('/api/account/profile', () => HttpResponse.json({ name: 'me', avatars: [] })),
        http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
        http.get('/api/chat/streak/:id', () => HttpResponse.json({ status: 'unavailable' })),
        http.get('/api/app-state/translations', () => HttpResponse.json({})),
        http.put('/api/read-states', () => HttpResponse.json({ ok: true })),
    );
}

const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const flush = () => advance(0);
const timeline = () => screen.getByTestId('chat-timeline');
const skeleton = () => screen.queryByTestId('chat-skeleton');
const loadingStatus = () => screen.queryByRole('status', { name: LABEL });
const hasText = (text: string) => !!screen.queryByText(text);

/** Mount with room A open and loaded. */
async function mountOnA() {
    useAppStore.setState({
        activeService: SERVICE,
        selectedConversations: { [SERVICE]: { path: room('A').dir, name: room('A').name, isGroupChat: false } },
    });
    const utils = render(<MessagesFeature {...props} />);
    await flush();
    await flush();
    expect(hasText(room('A').text)).toBe(true);
    return utils;
}

async function open(id: RoomId) {
    fireEvent.click(screen.getByRole('button', { name: `open ${id}` }));
    // Effects only: no timer moves.
    await act(async () => { await Promise.resolve(); });
}

describe('MessagesFeature: the chat timeline is never blank while a room loads (L5)', () => {
    beforeAll(async () => { await i18n.changeLanguage('ja'); });
    beforeEach(() => {
        vi.useFakeTimers();
        vi.mocked(clientLog).mockClear();
        menu.status = undefined;
        menu.retry = undefined;
        for (const k of Object.keys(listCalls)) delete listCalls[k];
        for (const k of Object.keys(listSignals)) delete listSignals[k];
        replies = { A: okList('A'), B: okList('B'), C: okList('C'), D: okList('D'), E: okList('E'), F: okList('F') };
        letterReplies = { A: noLetters, B: noLetters, C: noLetters, D: noLetters, E: noLetters, F: noLetters };
        serve();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('F1: an uncached room shows the skeleton (never the previous room), then the slow and very-slow copy', async () => {
        await mountOnA();
        const b = gated('B');
        replies.B = b.reply;
        await open('B');

        await advance(199);
        expect(hasText(room('A').text)).toBe(false);
        expect(skeleton()).toBeNull();
        expect(timeline().querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();

        await advance(1);
        expect(skeleton()).not.toBeNull();
        expect(loadingStatus()).not.toBeNull();
        expect(hasText(room('A').text)).toBe(false);

        await advance(2799); // 2999
        expect(hasText(SLOW)).toBe(false);
        await advance(1); // 3000
        expect(hasText(SLOW)).toBe(true);

        await advance(6999); // 9999
        expect(hasText(VERY_SLOW)).toBe(false);
        expect(screen.queryByRole('progressbar')).toBeNull();
        await advance(1); // 10000
        expect(hasText(VERY_SLOW)).toBe(true);
        expect(screen.getByRole('progressbar')).toBeInTheDocument();

        b.open();
        await flush();
        expect(hasText(room('B').text)).toBe(true);
        expect(skeleton()).toBeNull();
        // CJK and emoji room name in the loaded header.
        expect(screen.getByRole('heading', { name: room('B').name })).toBeInTheDocument();
    });

    it('F1: a room answering at 250 ms keeps the skeleton until 600 ms (min-visible), and the box is never empty', async () => {
        await mountOnA();
        const b = gated('B');
        replies.B = b.reply;
        await open('B');
        for (let t = 0; t <= 800; t += 50) {
            if (t === 250) b.open();
            if (t > 0) await advance(50);
            const box = timeline();
            const showsStatus = !!box.querySelector('[role="status"]');
            const showsList = hasText(room('B').text);
            expect(showsStatus || showsList, `at ${t} ms`).toBe(true);
            expect(hasText(room('A').text), `at ${t} ms`).toBe(false);
            if (t >= 200 && t < 600) expect(skeleton(), `at ${t} ms`).not.toBeNull();
            if (t < 600) expect(showsList, `at ${t} ms`).toBe(false);
            if (t >= 600) expect(showsList, `at ${t} ms`).toBe(true);
        }
    });

    it('F2: messages in but letters pending keeps the skeleton; letters ready shows the list', async () => {
        await mountOnA();
        const letters = deferred();
        letterReplies.D = async () => { await letters.promise; return noLetters(); };
        await open('D');
        await advance(1000);
        expect(listCalls.D).toBe(1);
        expect(hasText(room('D').text)).toBe(false);
        expect(skeleton()).not.toBeNull();
        // The list itself is loaded: the gallery is ready, only the timeline waits for letters.
        expect(menu.status).toBe('ready');
        letters.resolve();
        await flush();
        expect(hasText(room('D').text)).toBe(true);
        expect(skeleton()).toBeNull();
    });

    it('F2: letters that never answer release the list at LETTERS_WAIT_MS', async () => {
        await mountOnA();
        letterReplies.E = () => new Promise<Response>(() => {});
        await open('E');
        await advance(LETTERS_WAIT_MS - 1);
        expect(hasText(room('E').text)).toBe(false);
        expect(loadingStatus()).not.toBeNull();
        await advance(1);
        expect(hasText(room('E').text)).toBe(true);
    });

    it('a cached room renders at once with no skeleton at any time, while it refreshes', async () => {
        await mountOnA();
        await open('B');
        await advance(1000);
        expect(hasText(room('B').text)).toBe(true);
        const refresh = gated('A');
        replies.A = refresh.reply;
        await open('A');
        expect(hasText(room('A').text)).toBe(true);
        for (let t = 0; t < 1000; t += 50) {
            await advance(50);
            expect(skeleton(), `at ${t} ms`).toBeNull();
            expect(hasText(room('A').text), `at ${t} ms`).toBe(true);
            expect(menu.status).toBe('ready');
        }
        refresh.open();
        await flush();
        expect(hasText(room('A').text)).toBe(true);
    });

    it('F4: a server error shows the failure copy and Retry, never the error text; Retry refetches', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await mountOnA();
        replies.B = () => HttpResponse.json({ detail: SECRET }, { status: 500 });
        await open('B');
        await advance(300);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(FAILED);
        expect(alert).toHaveTextContent(FAILED_HINT);
        expect(alert).not.toHaveTextContent(TIMEOUT);
        expect(document.body.textContent).not.toContain('SECRET-DETAIL');
        expect(menu.status).toBe('error');
        expect(clientLog).toHaveBeenCalledWith('chat_load', { outcome: 'error_state', reason: 'error', error_code: 500 });
        // No log carries the room path or the error text.
        for (const call of [...errors.mock.calls, ...warns.mock.calls]) {
            const s = JSON.stringify(call);
            expect(s).not.toContain('SECRET-DETAIL');
            expect(s).not.toContain(room('B').dir);
        }

        replies.B = okList('B');
        fireEvent.click(screen.getByRole('button', { name: RETRY }));
        // Past reveal + minVisible: once the retry's skeleton has shown, it stays 400 ms.
        await advance(700);
        expect(listCalls.B).toBe(2);
        expect(hasText(room('B').text)).toBe(true);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(menu.status).toBe('ready');
    });

    it('F4: a load still pending at 60 s times out with its own copy, Retry and a ui_wait breadcrumb', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await mountOnA();
        replies.B = () => new Promise<Response>(() => {});
        await open('B');
        expect(CHAT_LOAD_TIMEOUT_MS).toBe(60_000);
        await advance(CHAT_LOAD_TIMEOUT_MS - 1);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(loadingStatus()).not.toBeNull();
        await advance(1);
        await flush();
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(TIMEOUT);
        expect(alert).toHaveTextContent(TIMEOUT_HINT);
        expect(alert).not.toHaveTextContent(FAILED);
        expect(listSignals.B[0].aborted).toBe(true);
        expect(clientLog).toHaveBeenCalledWith('chat_load', { outcome: 'error_state', reason: 'timeout' });
        expect(clientLog).toHaveBeenCalledWith('ui_wait', expect.objectContaining({ surface: 'chat_room', phase: 'timeout' }));
        const [, fields] = vi.mocked(clientLog).mock.calls.find(([e, f]) => e === 'ui_wait' && (f as { phase?: string }).phase === 'timeout')!;
        expect((fields as { wait_ms: number }).wait_ms).toBeGreaterThanOrEqual(CHAT_LOAD_TIMEOUT_MS);
        expect(menu.status).toBe('error');

        replies.B = okList('B');
        fireEvent.click(screen.getByRole('button', { name: RETRY }));
        // Past reveal + minVisible: once the retry's skeleton has shown, it stays 400 ms.
        await advance(700);
        expect(hasText(room('B').text)).toBe(true);
    });

    it('aborts a superseded fetch when another room is opened', async () => {
        await mountOnA();
        replies.B = () => new Promise<Response>(() => {});
        await open('B');
        await advance(100);
        expect(listSignals.B[0].aborted).toBe(false);
        await open('C');
        await advance(300);
        expect(listSignals.B[0].aborted).toBe(true);
        expect(hasText(room('C').text)).toBe(true);
        // The abandoned fetch never shows a failure.
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('unmounting mid-load aborts the fetch without a failure log', async () => {
        const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { unmount } = await mountOnA();
        replies.B = () => new Promise<Response>(() => {});
        await open('B');
        await advance(100);
        unmount();
        await advance(1000);
        expect(listSignals.B[0].aborted).toBe(true);
        expect(warns.mock.calls.some((c) => String(c[0]).includes('fetchMessages failed'))).toBe(false);
    });

    it.each([
        ['times out', () => new Promise<Response>(() => {}), CHAT_LOAD_TIMEOUT_MS + 1000, { outcome: 'kept_room', reason: 'timeout' }],
        ['fails', () => HttpResponse.json({ detail: SECRET }, { status: 500 }), 1000, { outcome: 'kept_room', reason: 'error', error_code: 500 }],
    ] as const)('a background refresh of the room on screen that %s keeps the room (no alert, gallery ready)', async (_name, reply, wait, breadcrumb) => {
        const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { rerender } = await mountOnA();
        replies.A = reply;
        rerender(<MessagesFeature {...props} syncVersion={1} />);
        await flush();
        expect(listCalls.A).toBe(2);
        for (let t = 0; t < wait; t += 5000) {
            await advance(Math.min(5000, wait - t));
            expect(hasText(room('A').text)).toBe(true);
            expect(screen.queryByRole('alert')).toBeNull();
            expect(skeleton()).toBeNull();
            expect(menu.status).toBe('ready');
        }
        await flush();
        expect(hasText(room('A').text)).toBe(true);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(menu.status).toBe('ready');
        expect(document.body.textContent).not.toContain('SECRET-DETAIL');
        // A breadcrumb (codes only) records the failed refresh.
        const failed = warns.mock.calls.find((c) => String(c[0]).includes('fetchMessages failed'));
        expect(failed?.[1]).toMatchObject({ background: true });
        expect(JSON.stringify(warns.mock.calls)).not.toContain(room('A').dir);
        // The production breadcrumb (codes and the HTTP status only) records the kept room.
        expect(vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'chat_load')).toEqual([['chat_load', breadcrumb]]);
        if (wait > CHAT_LOAD_TIMEOUT_MS) {
            expect(clientLog).toHaveBeenCalledWith('ui_wait', expect.objectContaining({ surface: 'chat_room', phase: 'timeout' }));
        }
    });

    it('a superseded fetch that answers late never commits over the new room', async () => {
        await mountOnA();
        const b = gated('B');
        replies.B = b.reply;
        await open('B');
        await advance(100);
        await open('C');
        await advance(700);
        expect(hasText(room('C').text)).toBe(true);
        b.open();
        await advance(1000);
        expect(hasText(room('C').text)).toBe(true);
        expect(hasText(room('B').text)).toBe(false);
        expect(screen.getByRole('heading', { name: room('C').name })).toBeInTheDocument();
    });

    it('the skeleton stays min-visible when the letters end the wait just after reveal', async () => {
        await mountOnA();
        const letters = deferred();
        letterReplies.F = async () => { await letters.promise; return noLetters(); };
        await open('F');
        await advance(150); // messages already in, letters pending
        expect(listCalls.F).toBe(1);
        await advance(60); // 210: revealed
        expect(skeleton()).not.toBeNull();
        letters.resolve();
        await flush();
        await advance(379); // 589
        expect(skeleton()).not.toBeNull();
        expect(hasText(room('F').text)).toBe(false);
        await advance(11); // 600 = reveal + minVisible
        expect(skeleton()).toBeNull();
        expect(hasText(room('F').text)).toBe(true);
    });

    it('a refetch of the same room keeps its 60 s deadline (a sync mid-load does not restart it)', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { rerender } = await mountOnA();
        replies.B = () => new Promise<Response>(() => {});
        await open('B');
        await advance(30_000);
        rerender(<MessagesFeature {...props} syncVersion={1} />);
        await flush();
        expect(listCalls.B).toBe(2);
        expect(listSignals.B[0].aborted).toBe(true);
        await advance(29_999);
        expect(screen.queryByRole('alert')).toBeNull();
        await advance(1);
        await flush();
        expect(screen.getByRole('alert')).toHaveTextContent(TIMEOUT);
    });

    it('the gallery list state follows the same derivation: loading while the room is pending', async () => {
        await mountOnA();
        expect(menu.status).toBe('ready');
        const b = gated('B');
        replies.B = b.reply;
        await open('B');
        expect(menu.status).toBe('loading');
        b.open();
        await advance(600);
        expect(menu.status).toBe('ready');
    });

    it('the header sync pill uses a decorative spinner that stops under reduced motion', async () => {
        useAppStore.setState({
            activeService: SERVICE,
            selectedConversations: { [SERVICE]: { path: room('A').dir, name: room('A').name, isGroupChat: false } },
        });
        const { container } = render(<MessagesFeature {...props} syncProgress={{ state: 'running' } as never} />);
        await flush();
        const spinner = container.querySelector('header svg[data-spinner]');
        expect(spinner).not.toBeNull();
        expect(spinner).toHaveAttribute('aria-hidden', 'true');
        expect(spinner?.getAttribute('class')).toContain('motion-reduce:animate-none');
        // Pill-sized, as before the Spinner swap.
        expect(spinner?.getAttribute('class')).toContain('h-3');
        expect(spinner?.getAttribute('class')).not.toContain('h-4');
    });
});
