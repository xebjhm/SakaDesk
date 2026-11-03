import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import { persisted } from '../../core/persistence/persisted';
import { clientLog } from '../../utils/clientLog';
import * as ringtoneModule from '../incomingCall/ringtone';
import { ENDED_HOLD_MS, RING_TIMEOUT_MS } from '../incomingCall/useIncomingCall';
import i18n from '../../i18n';
import { CallPopupApp } from './CallPopupApp';
import { resetCallPopupBridge } from './callPopupBridge';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
const log = vi.mocked(clientLog);

const PATH = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const INFO = {
    call_id: 1, service: 'hinatazaka46', path: PATH, is_group_chat: false,
    group_id: '34', member_id: '58', message_id: 10,
};
const voice = (id: number, timestamp = '2026-11-01T10:00:00Z') => ({
    id, timestamp, type: 'voice', is_favorite: false, content: null,
    media_file: `messages/34 金村 美玖/58 金村 美玖/voice/${id}.m4a`,
});
const MEMBER = { id: 58, name: '金村 美玖', phone_image_local: '/img/p.jpg' };

interface Opts {
    info?: unknown | 'notfound' | 'error';
    settings?: unknown | 'error';
    messages?: unknown | 'error';
    conversation?: unknown | 'error';
}

let posts: Array<{ callId: string; body: Record<string, unknown> }>;
let puts: string[];
const events = () => posts.map(p => p.body.event);

function mockBackend(o: Opts = {}) {
    const err = () => new HttpResponse(null, { status: 500 });
    server.use(
        http.get('/api/call-popup/calls/:id', ({ params }) => {
            if (o.info === 'notfound') return new HttpResponse(null, { status: 404 });
            if (o.info === 'error') return err();
            return HttpResponse.json(o.info ?? { ...INFO, call_id: Number(params.id) });
        }),
        http.get('/api/settings', () => o.settings === 'error'
            ? err() : HttpResponse.json(o.settings ?? { call_popup_enabled: true, language: 'en' })),
        http.get('/api/content/messages_by_path', () => o.messages === 'error'
            ? err() : HttpResponse.json(o.messages ?? { messages: [voice(10)], member: MEMBER })),
        http.get('/api/app-state/conversation', () => o.conversation === 'error'
            ? err() : HttpResponse.json(o.conversation ?? {})),
        http.get('/api/app-state/prefs', () => HttpResponse.json({})),
        http.post('/api/call-popup/calls/:id/events', async ({ params, request }) => {
            posts.push({ callId: String(params.id), body: await request.json() as Record<string, unknown> });
            return new HttpResponse(null, { status: 204 });
        }),
        http.put('/api/read-states', ({ request }) => { puts.push(request.url); return HttpResponse.json({}); }),
    );
}

const writeSpies = () => [
    vi.spyOn(persisted, 'setPref'),
    vi.spyOn(persisted, 'setConv'),
    vi.spyOn(persisted, 'setConvBeacon'),
    vi.spyOn(persisted, 'flushNow'),
];
let spies: ReturnType<typeof writeSpies>;

async function start(id = 1) {
    await act(async () => { window.__sakadeskCallPopup!.start(id); });
}
const settled = () => act(async () => { await vi.advanceTimersByTimeAsync(50); });

beforeEach(() => {
    resetCallPopupBridge();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    posts = [];
    puts = [];
    log.mockClear();
    spies = writeSpies();
});
afterEach(() => {
    // Read-only page: nothing was ever written, in any case.
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(puts).toEqual([]);
    vi.restoreAllMocks();
    vi.useRealTimers();
});

const render_ = () => render(<CallPopupApp preload={() => Promise.resolve()} />);
const ringing = async () => {
    mockBackend();
    const view = render_();
    await start();
    await waitFor(() => expect(events()).toContain('ringing'));
    return view;
};

describe('CallPopupApp', () => {
    it('loads the call, rings, and renders the non-ASCII name', async () => {
        await ringing();
        expect(events()).toEqual(['ringing']);
        expect(posts[0].callId).toBe('1');
        expect(screen.getAllByText('金村 美玖').length).toBeGreaterThan(0);
        expect(document.documentElement.classList.contains('sd-call-popup-doc')).toBe(true);
        expect(log).toHaveBeenCalledWith('call_popup_start', { call_id: 1 });
    });

    it('answer posts answered with the message id, and the end of the voice posts ended', async () => {
        await ringing();
        fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
        await waitFor(() => expect(events()).toContain('answered'));
        expect(posts.find(p => p.body.event === 'answered')!.body.message_id).toBe(10);
        fireEvent.ended(screen.getByTestId('call-audio'));
        await act(async () => { await vi.advanceTimersByTimeAsync(ENDED_HOLD_MS + 50); });
        await waitFor(() => expect(events()).toContain('ended'));
    });

    it('decline posts declined', async () => {
        await ringing();
        fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
        await waitFor(() => expect(events()).toContain('declined'));
    });

    it('an unanswered ring posts timeout', async () => {
        await ringing();
        await act(async () => { await vi.advanceTimersByTimeAsync(RING_TIMEOUT_MS + 50); });
        await waitFor(() => expect(events()).toContain('timeout'));
    });

    it('skips with no_photo when the member has no images and renders nothing', async () => {
        mockBackend({ messages: { messages: [voice(10)], member: { id: 58, name: '金村 美玖' } } });
        render_();
        await start();
        await waitFor(() => expect(events()).toEqual(['skipped']));
        expect(posts[0].body.reason).toBe('no_photo');
        expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    });

    it('skips with already_read when the read state covers the voice', async () => {
        mockBackend({ conversation: { value: JSON.stringify({ lastReadId: 10, readCount: 1, revealedIds: [] }) } });
        render_();
        await start();
        await waitFor(() => expect(events()).toEqual(['skipped']));
        expect(posts[0].body.reason).toBe('already_read');
    });

    it('a call the backend no longer knows posts nothing and logs info_not_found', async () => {
        mockBackend({ info: 'notfound' });
        render_();
        await start();
        await settled();
        expect(posts).toEqual([]);
        expect(log).toHaveBeenCalledWith('call_popup_error', { call_id: 1, error_type: 'info_not_found' });
    });

    it.each([
        ['info_failed', { info: 'error' }],
        ['settings_failed', { settings: 'error' }],
        ['messages_failed', { messages: 'error' }],
        ['read_state_failed', { conversation: 'error' }],
    ] as const)('posts error %s when that fetch fails', async (type, opts) => {
        mockBackend(opts as Opts);
        render_();
        await start();
        await waitFor(() => expect(events()).toEqual(['error']));
        expect(posts[0].body.error_type).toBe(type);
        expect(posts[0].body.error_type).toMatch(/^[a-z0-9_]{1,40}$/);
        expect(log).toHaveBeenCalledWith('call_popup_error', { call_id: 1, error_type: type });
    });

    it('cancel while ringing unmounts the call and posts nothing afterwards', async () => {
        await ringing();
        const before = posts.length;
        act(() => window.__sakadeskCallPopup!.cancel(1));
        await settled();
        expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
        expect(posts.length).toBe(before);
    });

    it('cancel for another call id is ignored', async () => {
        await ringing();
        act(() => window.__sakadeskCallPopup!.cancel(99));
        expect(screen.getByRole('button', { name: 'Answer' })).toBeInTheDocument();
    });

    it('a second start remounts a fresh call', async () => {
        await ringing();
        fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
        await waitFor(() => expect(events()).toContain('declined'));
        await start(2);
        await waitFor(() => expect(posts.some(p => p.callId === '2' && p.body.event === 'ringing')).toBe(true));
    });

    it('unmounting mid-ring posts no cancelled', async () => {
        const { unmount } = await ringing();
        unmount();
        await settled();
        expect(events()).toEqual(['ringing']);
    });

    it('start(2) while call 1 rings supersedes it: call 1 posts nothing more, call 2 rings', async () => {
        await ringing();
        await start(2);
        await waitFor(() => expect(posts.some(p => p.callId === '2' && p.body.event === 'ringing')).toBe(true));
        await settled();
        expect(posts.filter(p => p.callId === '1').map(p => p.body.event)).toEqual(['ringing']);
        expect(posts.filter(p => p.callId === '2').map(p => p.body.event)).toEqual(['ringing']);
        expect(screen.getByRole('button', { name: 'Answer' })).toBeInTheDocument();
    });

    it('posts error start_failed when the startup language step throws', async () => {
        mockBackend();
        // Only the persisted-language branch of applyStartupLanguage can throw out of start().
        vi.spyOn(persisted, 'getPref').mockReturnValue('ja' as never);
        vi.spyOn(i18n, 'changeLanguage').mockRejectedValue(new Error('boom'));
        render_();
        await start();
        await waitFor(() => expect(events()).toEqual(['error']));
        expect(posts[0].body.error_type).toBe('start_failed');
        expect(posts[0].body.error_type).toMatch(/^[a-z0-9_]{1,40}$/);
        expect(log).toHaveBeenCalledWith('call_popup_error', { call_id: 1, error_type: 'start_failed' });
    });

    it('a render crash is logged and posted as error render_failed, with no cancelled after it', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(ringtoneModule, 'getRingtone').mockImplementation(() => { throw new Error('boom'); });
        mockBackend();
        render_();
        await start();
        await waitFor(() => expect(events()).toContain('error'));
        await settled();
        const err = posts.find(p => p.body.event === 'error')!;
        expect(err.body.error_type).toBe('render_failed');
        expect(log).toHaveBeenCalledWith('call_popup_error', { call_id: 1, error_type: 'render_failed' });
        expect(events()).not.toContain('cancelled');
        expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    });

    it('rings exactly the reserved voice when a newer one arrived, and logs message_mismatch', async () => {
        mockBackend({
            messages: {
                messages: [voice(10), voice(11, '2026-11-02T10:00:00Z')],
                member: MEMBER,
            },
        });
        render_();
        await start();
        await waitFor(() => expect(events()).toContain('ringing'));
        expect(log).toHaveBeenCalledWith('call_popup_error', { call_id: 1, error_type: 'message_mismatch' });
        fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
        await waitFor(() => expect(events()).toContain('answered'));
        expect(posts.find(p => p.body.event === 'answered')!.body.message_id).toBe(10);
    });

    it('does not log message_mismatch when the reserved voice is the newest', async () => {
        await ringing();
        expect(log).not.toHaveBeenCalledWith('call_popup_error', expect.objectContaining({ error_type: 'message_mismatch' }));
    });

    it('a start that arrives before the page mounts is queued and rings after mount', async () => {
        mockBackend();
        window.__sakadeskCallPopup!.start(1);
        expect(posts).toEqual([]);
        render_();
        await waitFor(() => expect(events()).toEqual(['ringing']));
        expect(posts[0].callId).toBe('1');
        expect(screen.getByRole('button', { name: 'Answer' })).toBeInTheDocument();
    });

    it('a cancel before mount drops the queued start: it never rings', async () => {
        mockBackend();
        window.__sakadeskCallPopup!.start(1);
        window.__sakadeskCallPopup!.cancel(1);
        render_();
        await settled();
        expect(posts).toEqual([]);
        expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    });

    it('the newest queued start wins', async () => {
        mockBackend();
        window.__sakadeskCallPopup!.start(1);
        window.__sakadeskCallPopup!.start(2);
        render_();
        await waitFor(() => expect(events()).toEqual(['ringing']));
        expect(posts[0].callId).toBe('2');
    });

    it('the global exists before any mount', () => {
        expect(window.__sakadeskCallPopup).toBeDefined();
    });

    it('the inset halo follows the phase', async () => {
        const { container } = await ringing();
        const halo = () => container.querySelector('.sd-call-halo--inset');
        expect(halo()).toHaveAttribute('data-phase', 'ringing');
        fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
        await waitFor(() => expect(halo()).toHaveAttribute('data-phase', 'connected'));
    });

    it('starts the ringtone on ringing, stops it on leaving ringing and on unmount', async () => {
        const rt = { start: vi.fn(), stop: vi.fn() };
        vi.spyOn(ringtoneModule, 'getRingtone').mockReturnValue(rt);
        await ringing();
        expect(rt.start).toHaveBeenCalledTimes(1);
        expect(rt.stop).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
        await waitFor(() => expect(rt.stop).toHaveBeenCalledTimes(1));
    });

    it('stops the ringtone when unmounted while ringing', async () => {
        const rt = { start: vi.fn(), stop: vi.fn() };
        vi.spyOn(ringtoneModule, 'getRingtone').mockReturnValue(rt);
        const { unmount } = await ringing();
        unmount();
        expect(rt.stop).toHaveBeenCalledTimes(1);
        expect(events()).toEqual(['ringing']);
    });

    it("tags the call's breadcrumbs with surface popup", async () => {
        await ringing();
        fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
        await waitFor(() => expect(events()).toContain('declined'));
        const own = new Set(['call_popup_start', 'call_popup_error']);
        const callLogs = log.mock.calls.filter(c => !own.has(c[0]));
        expect(callLogs.length).toBeGreaterThan(0);
        for (const [, fields] of callLogs) expect(fields).toMatchObject({ surface: 'popup' });
    });
});
