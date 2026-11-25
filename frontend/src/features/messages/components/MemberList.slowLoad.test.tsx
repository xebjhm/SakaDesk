import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { MemberList } from './MemberList';
import { SIDEBAR_POLL_TIMEOUT_MS } from '../../../utils/pollJson';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));

// Poll fast so a later tick happens within the test.
vi.mock('../../../config/uiConstants', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../config/uiConstants')>();
    return {
        ...actual,
        UI_CONSTANTS: { ...actual.UI_CONSTANTS, polling: { ...actual.UI_CONSTANTS.polling, sidebarMs: 50 } },
    };
});

beforeAll(async () => { await i18n.changeLanguage('en'); });
afterEach(() => vi.useRealTimers());

const GROUP = {
    id: '66', name: 'Alice', service: 'hinatazaka46',
    dir_name: '66 Alice', group_path: 'g/66 Alice',
    member_count: 1, is_group_chat: false, is_active: true,
    members: [{ id: '120', name: 'Alice', path: 'g/66 Alice/120 Alice' }],
};

describe('MemberList slow first load', () => {
    it('uses a sidebar timeout longer than the generic poll timeout', () => {
        expect(SIDEBAR_POLL_TIMEOUT_MS).toBeGreaterThan(4000);
    });

    it('keeps the spinner when the first load times out, then shows groups on a later success', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        let calls = 0;
        let openGate = () => {};
        const gate = new Promise<void>(resolve => { openGate = resolve; });
        server.use(
            http.get('/api/content/groups', async () => {
                calls += 1;
                if (calls === 1) await new Promise(() => {}); // hangs until aborted
                await gate; // the retry after the timeout answers only once the test allows it
                return HttpResponse.json({ groups: [GROUP], last_sync: {} });
            }),
            http.post('/api/content/unread_counts', () => HttpResponse.json({})),
        );
        render(<MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} />);
        expect(await screen.findByText(/loading conversations/i)).toBeInTheDocument();

        await act(async () => { await vi.advanceTimersByTimeAsync(SIDEBAR_POLL_TIMEOUT_MS + 100); });
        expect(screen.queryByText(/no conversations/i)).not.toBeInTheDocument();
        expect(screen.getByText(/loading conversations/i)).toBeInTheDocument();

        openGate();
        expect(await screen.findByText('Alice')).toBeInTheDocument();
        expect(screen.queryByText(/loading conversations/i)).not.toBeInTheDocument();
    });

    it('issues exactly one groups request on mount', async () => {
        // This file polls every 50 ms (for the timeout test). An answer landing just before a
        // tick let that tick (a normal poll, not a mount request) fire before 'Alice' was
        // observed, so the count read 2 on a loaded machine. Freeze the poll interval here so
        // only the mount request is counted; the loader's own timers stay real.
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        let calls = 0;
        server.use(
            http.get('/api/content/groups', async () => {
                calls += 1;
                // 46 ms: just before the first 50 ms tick, the window that made this flaky.
                await new Promise((r) => setTimeout(r, 46));
                return HttpResponse.json({ groups: [GROUP], last_sync: {} });
            }),
            http.post('/api/content/unread_counts', () => HttpResponse.json({})),
        );
        render(<MemberList activeService="hinatazaka46" isSyncing={false} onSelectGroup={vi.fn()} />);
        expect(await screen.findByText('Alice')).toBeInTheDocument();
        await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
        expect(calls).toBe(1);
    });

    it('still refreshes when a sync ends', async () => {
        let calls = 0;
        server.use(
            http.get('/api/content/groups', () => {
                calls += 1;
                return HttpResponse.json({ groups: [GROUP], last_sync: {} });
            }),
            http.post('/api/content/unread_counts', () => HttpResponse.json({})),
        );
        const { rerender } = render(<MemberList activeService="hinatazaka46" isSyncing onSelectGroup={vi.fn()} />);
        expect(await screen.findByText('Alice')).toBeInTheDocument();
        const before = calls;
        rerender(<MemberList activeService="hinatazaka46" isSyncing={false} onSelectGroup={vi.fn()} />);
        await waitFor(() => expect(calls).toBeGreaterThan(before));
    });
});
