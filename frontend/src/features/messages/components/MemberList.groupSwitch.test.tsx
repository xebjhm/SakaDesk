import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { MemberList } from './MemberList';
import { clientLog } from '../../../utils/clientLog';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));

beforeAll(async () => { await i18n.changeLanguage('en'); });

const group = (id: string, name: string, service: string) => ({
    id, name, service, dir_name: `${id} ${name}`, group_path: `${service}/messages/${id} ${name}`,
    member_count: 1, is_group_chat: false, is_active: true,
    members: [{ id, name, path: `${service}/messages/${id} ${name}/${id} ${name}` }],
});
const A_GROUP = group('1', 'AlphaMember', 'a46');
const B_GROUP = group('2', 'BetaMember', 'b46');
const A_PATH = A_GROUP.members[0].path;

/** Per-service answer for `/api/content/groups`: a list, an HTTP status, or a hang until released. */
type Answer = { groups: object[] } | { status: number } | { hang: Promise<void>; groups: object[] };
let answers: Record<string, Answer[]>;
let requests: string[];

beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    answers = {};
    requests = [];
    server.use(
        http.get('/api/content/groups', async ({ request }) => {
            const service = new URL(request.url).searchParams.get('service') ?? '';
            requests.push(service);
            const queue = answers[service] ?? [];
            const answer = queue.length > 1 ? queue.shift()! : queue[0];
            if (!answer) return new HttpResponse(null, { status: 500 });
            if ('status' in answer) return new HttpResponse(null, { status: answer.status });
            if ('hang' in answer) await answer.hang;
            return HttpResponse.json({ groups: answer.groups, last_sync: {} });
        }),
        http.post('/api/content/unread_counts', () => HttpResponse.json({ [A_PATH]: 3 })),
    );
});

describe('MemberList group switch', () => {
    it('clears the previous service’s list and badges and shows the spinner until the new list loads', async () => {
        let release = () => {};
        const hang = new Promise<void>(r => { release = r; });
        answers = { a46: [{ groups: [A_GROUP] }], b46: [{ hang, groups: [B_GROUP] }] };
        const { rerender } = render(<MemberList activeService="a46" onSelectGroup={vi.fn()} />);
        expect(await screen.findByText('AlphaMember')).toBeInTheDocument();
        expect(await screen.findByText('3')).toBeInTheDocument(); // A's unread badge

        rerender(<MemberList activeService="b46" onSelectGroup={vi.fn()} />);
        // Immediately, before B answers: nothing of A remains, the spinner shows.
        expect(screen.queryByText('AlphaMember')).not.toBeInTheDocument();
        expect(screen.queryByText('3')).not.toBeInTheDocument();
        expect(screen.getByText(/loading conversations/i)).toBeInTheDocument();
        expect(screen.queryByText(/no conversations/i)).not.toBeInTheDocument();

        await act(async () => { release(); });
        expect(await screen.findByText('BetaMember')).toBeInTheDocument();
        expect(screen.queryByText(/loading conversations/i)).not.toBeInTheDocument();
    });

    it('shows an error state (not the previous list) when the new service’s load fails', async () => {
        answers = { a46: [{ groups: [A_GROUP] }], b46: [{ status: 500 }] };
        const { rerender } = render(<MemberList activeService="a46" onSelectGroup={vi.fn()} />);
        expect(await screen.findByText('AlphaMember')).toBeInTheDocument();
        rerender(<MemberList activeService="b46" onSelectGroup={vi.fn()} />);
        expect(await screen.findByText(/could not load conversations/i)).toBeInTheDocument();
        expect(screen.queryByText('AlphaMember')).not.toBeInTheDocument();
        expect(screen.queryByText(/no conversations/i)).not.toBeInTheDocument();
    });
});

describe('MemberList load failure', () => {
    it('shows an error state with Retry instead of "No conversations", and Retry reloads', async () => {
        answers = { a46: [{ status: 500 }, { groups: [A_GROUP] }] };
        render(<MemberList activeService="a46" onSelectGroup={vi.fn()} />);
        expect(await screen.findByText(/could not load conversations/i)).toBeInTheDocument();
        expect(screen.queryByText(/no conversations/i)).not.toBeInTheDocument();
        expect(clientLog).toHaveBeenCalledWith('sidebar_load', { service: 'a46', reason: 'rejected', outcome: 'error_state' });

        await userEvent.click(screen.getByRole('button', { name: /retry/i }));
        expect(await screen.findByText('AlphaMember')).toBeInTheDocument();
        expect(screen.queryByText(/could not load conversations/i)).not.toBeInTheDocument();
        expect(clientLog).toHaveBeenCalledWith('sidebar_load', { service: 'a46', outcome: 'retry' });
        expect(requests.filter(s => s === 'a46')).toHaveLength(2);
    });

    it('a network failure with no data also shows the error state', async () => {
        server.use(http.get('/api/content/groups', () => HttpResponse.error()));
        render(<MemberList activeService="a46" onSelectGroup={vi.fn()} />);
        expect(await screen.findByText(/could not load conversations/i)).toBeInTheDocument();
        expect(clientLog).toHaveBeenCalledWith('sidebar_load', { service: 'a46', reason: 'failed', outcome: 'error_state' });
    });

    it('keeps the loaded list when a later refresh fails', async () => {
        answers = { a46: [{ groups: [A_GROUP] }, { status: 500 }] };
        const { rerender } = render(<MemberList activeService="a46" isSyncing onSelectGroup={vi.fn()} />);
        expect(await screen.findByText('AlphaMember')).toBeInTheDocument();
        rerender(<MemberList activeService="a46" isSyncing={false} onSelectGroup={vi.fn()} />); // post-sync refresh
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('sidebar_load', { service: 'a46', reason: 'rejected', outcome: 'kept_list' }));
        expect(screen.getByText('AlphaMember')).toBeInTheDocument();
        expect(screen.queryByText(/could not load conversations/i)).not.toBeInTheDocument();
    });
});
