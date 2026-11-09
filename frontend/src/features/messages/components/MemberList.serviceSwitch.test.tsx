import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { MemberList } from './MemberList';
import { clientLog } from '../../../utils/clientLog';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));

const group = (id: string, name: string, service: string) => ({
    id, name, service, dir_name: `${id} ${name}`, group_path: `${service}/messages/${id} ${name}`,
    member_count: 1, is_group_chat: false, is_active: true,
    members: [{ id, name, path: `${service}/messages/${id} ${name}/${id} ${name}` }],
});

/** Resolvers for `/api/content/groups` requests, in arrival order, keyed by service. */
let pending: Array<{ service: string; respond: () => void }>;
let groupRequests: string[];

beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    pending = [];
    groupRequests = [];
    server.use(
        http.get('/api/content/groups', ({ request }) => {
            const service = new URL(request.url).searchParams.get('service') ?? '';
            groupRequests.push(service);
            return new Promise<Response>(resolve => {
                pending.push({
                    service,
                    respond: () => resolve(HttpResponse.json({
                        groups: [group(service === 'a46' ? '1' : '2', service === 'a46' ? 'AlphaMember' : 'BetaMember', service)],
                        last_sync: {},
                    })),
                });
            });
        }),
        http.post('/api/content/unread_counts', () => HttpResponse.json({})),
    );
});

describe('MemberList request supersession', () => {
    it('switching service while a request is pending shows the new service, ignoring the late old response', async () => {
        const { rerender } = render(<MemberList activeService="a46" onSelectGroup={vi.fn()} />);
        await waitFor(() => expect(groupRequests).toContain('a46'));
        rerender(<MemberList activeService="b46" onSelectGroup={vi.fn()} />);
        await waitFor(() => expect(groupRequests).toContain('b46'));

        // B answers first, then A's late response arrives.
        await act(async () => { pending.filter(p => p.service === 'b46').forEach(p => p.respond()); });
        expect(await screen.findByText(/BetaMember/)).toBeInTheDocument();
        await act(async () => { pending.filter(p => p.service === 'a46').forEach(p => p.respond()); });
        await act(async () => { await new Promise(r => setTimeout(r, 50)); });
        expect(screen.queryByText(/AlphaMember/)).not.toBeInTheDocument();
        expect(screen.getByText(/BetaMember/)).toBeInTheDocument();
        expect(clientLog).toHaveBeenCalledWith('poll_skipped', { key: 'groups_a46', reason: 'stale_service' });
    });

    it('a post-sync refresh while a request is in flight issues a fresh request', async () => {
        const { rerender } = render(<MemberList activeService="a46" isSyncing={true} onSelectGroup={vi.fn()} />);
        await waitFor(() => expect(groupRequests).toHaveLength(1));
        rerender(<MemberList activeService="a46" isSyncing={false} onSelectGroup={vi.fn()} />);
        await waitFor(() => expect(groupRequests).toHaveLength(2));
        await act(async () => { pending.forEach(p => p.respond()); });
        expect(await screen.findByText(/AlphaMember/)).toBeInTheDocument();
        expect(clientLog).not.toHaveBeenCalledWith('poll_skipped', expect.anything());
    });

    it('a normal launch logs no poll breadcrumb', async () => {
        render(<MemberList activeService="a46" isSyncing={false} onSelectGroup={vi.fn()} />);
        await waitFor(() => expect(groupRequests.length).toBeGreaterThan(0));
        await act(async () => { pending.forEach(p => p.respond()); });
        expect(await screen.findByText(/AlphaMember/)).toBeInTheDocument();
        expect(clientLog).not.toHaveBeenCalled();
    });
});
