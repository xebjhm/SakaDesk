import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { clientLog } from '../../../utils/clientLog';
import { MemberList } from './MemberList';

const renders = { badge: 0 };
vi.mock('../../../config/uiConstants', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../config/uiConstants')>();
    return { UI_CONSTANTS: { ...actual.UI_CONSTANTS, polling: { ...actual.UI_CONSTANTS.polling, sidebarMs: 50 } } };
});
vi.mock('../../../utils/clientLog', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../utils/clientLog')>()),
    clientLog: vi.fn(),
}));
vi.mock('../../../design/primitives', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../design/primitives')>();
    // Badge renders once per tile per MemberList render: it counts the list's renders.
    return { ...actual, Badge: (p: { count: number }) => { renders.badge += 1; return actual.Badge(p); } };
});

const group = {
    id: '34', name: '金村 美玖', service: 'hinatazaka46', dir_name: '34 金村 美玖', group_path: 'g/34',
    member_count: 1, is_group_chat: false, is_active: true, members: [{ id: '58', name: '金村 美玖', path: 'g/34/58' }],
};
let groupRequests = 0;
let served: Record<string, unknown>[] = [group];

describe('MemberList with unchanged answers (UI health P-F1)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        renders.badge = 0;
        groupRequests = 0;
        served = [group];
        vi.mocked(clientLog).mockClear();
        server.use(
            http.get('/api/content/groups', () => {
                groupRequests += 1;
                return HttpResponse.json({ groups: served, last_sync: { hinatazaka46: '2026-11-01T00:00:00Z' } });
            }),
            http.post('/api/content/unread_counts', () => HttpResponse.json({ 'g/34/58': 2 })),
        );
    });

    it('does not re-render on ticks that bring the same list, and says so once', async () => {
        render(<MemberList onSelectGroup={() => {}} activeService="hinatazaka46" />);
        await screen.findByText('金村 美玖');
        await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
        const settled = renders.badge;
        // Wait for several more 50 ms ticks to be answered (counted, not slept).
        const before = groupRequests;
        await waitFor(() => expect(groupRequests).toBeGreaterThanOrEqual(before + 3));
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('sidebar_load', { service: 'hinatazaka46', outcome: 'unchanged' }));
        expect(renders.badge).toBe(settled);
        const unchanged = vi.mocked(clientLog).mock.calls.filter(([e, f]) => e === 'sidebar_load' && f?.outcome === 'unchanged');
        expect(unchanged).toHaveLength(1);
    });

    it('a changed answer re-renders and re-arms the breadcrumb: the next unchanged streak logs again', async () => {
        const unchangedLogs = () => vi.mocked(clientLog).mock.calls.filter(([e, f]) => e === 'sidebar_load' && f?.outcome === 'unchanged').length;
        render(<MemberList onSelectGroup={() => {}} activeService="hinatazaka46" />);
        await screen.findByText('金村 美玖');
        await waitFor(() => expect(unchangedLogs()).toBe(1));
        const settled = renders.badge;

        // A bumped count, then a new room: each is a changed answer.
        served = [{ ...group, server_unread_count: 4 }];
        await waitFor(() => expect(renders.badge).toBeGreaterThan(settled));
        served = [...served, { ...group, id: '35', name: '小坂 菜緒', dir_name: '35 小坂 菜緒', group_path: 'g/35', members: [{ id: '59', name: '小坂 菜緒', path: 'g/35/59' }] }];
        expect(await screen.findByText('小坂 菜緒')).toBeInTheDocument();

        // The streak after the change is logged again (a second breadcrumb, once for that streak).
        await waitFor(() => expect(unchangedLogs()).toBe(2));
        const rendered = renders.badge;
        const before = groupRequests;
        await waitFor(() => expect(groupRequests).toBeGreaterThanOrEqual(before + 3));
        expect(unchangedLogs()).toBe(2);
        expect(renders.badge).toBe(rendered);
    });
});
