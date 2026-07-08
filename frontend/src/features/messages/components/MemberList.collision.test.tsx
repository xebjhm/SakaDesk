import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { MemberList } from './MemberList';

// Regression for the cross-service unread-badge collision: two groups in
// different services share the numeric id 79. The sidebar must key unread by
// each conversation's unique path (not by id), so the Sakurazaka member's 39
// unread never lands on the Hinatazaka group chat (which the phone reports 0).
// Under the old id-keyed map, the LIVE card would render "39".
describe('MemberList unread badge — cross-service id collision', () => {
    const LIVE_PATH = '日向坂46/messages/79 17th Single LIVE';
    const NAKAGAWA_PATH = '櫻坂46/messages/79 中川 智尋/134 中川 智尋';
    const ISHIZUKA_PATH = '日向坂46/messages/66 石塚 瑶季/120 石塚 瑶季';

    const groups = [
        {
            // Sakurazaka member DM — same id 79, real unread. Filtered from the
            // hinatazaka display, but still present in the counts computation.
            id: '79', name: '中川 智尋', service: 'sakurazaka46',
            dir_name: '79 中川 智尋', group_path: '櫻坂46/messages/79 中川 智尋',
            member_count: 1, is_group_chat: false, is_active: true, server_unread_count: 39,
            members: [{ id: '134', name: '中川 智尋', path: NAKAGAWA_PATH }],
        },
        {
            // Hinatazaka group chat — same id 79, phone says 0 unread.
            id: '79', name: '17th Single LIVE', service: 'hinatazaka46',
            dir_name: '79 17th Single LIVE', group_path: LIVE_PATH,
            member_count: 13, is_group_chat: true, is_active: true, server_unread_count: 0,
            members: [{ id: '120', name: '石塚 瑶季', path: `${LIVE_PATH}/120 石塚 瑶季` }],
        },
        {
            // Positive control: a hinatazaka member with genuine unread (5) must
            // still show its badge, proving badges render at all.
            id: '66', name: '石塚 瑶季', service: 'hinatazaka46',
            dir_name: '66 石塚 瑶季', group_path: '日向坂46/messages/66 石塚 瑶季',
            member_count: 1, is_group_chat: false, is_active: true, server_unread_count: 5,
            members: [{ id: '120', name: '石塚 瑶季', path: ISHIZUKA_PATH }],
        },
    ];

    it('shows each conversation its own count, never a same-id neighbour’s', async () => {
        server.use(
            http.get('/api/content/groups', () =>
                HttpResponse.json({ groups, last_sync: {} }),
            ),
            // Local counts lag the phone: every conversation reports 39 unread.
            http.post('/api/content/unread_counts', async ({ request }) => {
                const body = (await request.json()) as Record<string, unknown>;
                const out: Record<string, number> = {};
                for (const path of Object.keys(body)) out[path] = 39;
                return HttpResponse.json(out);
            }),
        );

        render(<MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} />);

        // Positive control renders with its own capped count (min(39, 5) = 5).
        expect(await screen.findByText('5')).toBeInTheDocument();
        // The LIVE group chat is present…
        expect(screen.getByText(/17th Single LIVE/)).toBeInTheDocument();
        // …but shows NO badge — the Sakurazaka id-79 "39" must not bleed onto it.
        expect(screen.queryByText('39')).not.toBeInTheDocument();
    });
});
