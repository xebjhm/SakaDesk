import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { MemberList } from './MemberList';
import { clientLog } from '../../../utils/clientLog';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));

let groupRequests: string[];

beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    groupRequests = [];
    server.use(
        http.get('/api/content/groups', ({ request }) => {
            groupRequests.push(new URL(request.url).searchParams.get('service') ?? '');
            return HttpResponse.json({ groups: [], last_sync: {} });
        }),
        http.post('/api/content/unread_counts', () => HttpResponse.json({})),
    );
});

const settle = () => new Promise((r) => setTimeout(r, 50));

describe('MemberList kept mounted behind another feature (plan F Task 5)', () => {
    it('loads nothing while paused, not even when a sync ends, and loads at once when shown again', async () => {
        const { rerender } = render(<MemberList activeService="a46" isSyncing paused onSelectGroup={vi.fn()} />);
        await settle();
        expect(groupRequests).toEqual([]);
        rerender(<MemberList activeService="a46" isSyncing={false} paused onSelectGroup={vi.fn()} />);
        await settle();
        expect(groupRequests).toEqual([]);
        expect(clientLog).toHaveBeenCalledWith('sidebar_load', { service: 'a46', outcome: 'deferred', reason: 'hidden' });
        rerender(<MemberList activeService="a46" isSyncing={false} paused={false} onSelectGroup={vi.fn()} />);
        await waitFor(() => expect(groupRequests).toEqual(['a46']));
    });
});
