import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { MemberList } from './MemberList';

// Poll fast so the failing second poll happens within the test.
vi.mock('../../../config/uiConstants', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../config/uiConstants')>();
    return {
        ...actual,
        UI_CONSTANTS: { ...actual.UI_CONSTANTS, polling: { ...actual.UI_CONSTANTS.polling, sidebarMs: 50 } },
    };
});

const PATH = '日向坂46/messages/66 石塚 瑶季/120 石塚 瑶季';

describe('MemberList unread badge — poll failure', () => {
    it('keeps the last known badge when a later unread_counts poll fails', async () => {
        let calls = 0;
        server.use(
            http.get('/api/content/groups', () =>
                HttpResponse.json({
                    groups: [{
                        id: '66', name: '石塚 瑶季', service: 'hinatazaka46',
                        dir_name: '66 石塚 瑶季', group_path: '日向坂46/messages/66 石塚 瑶季',
                        member_count: 1, is_group_chat: false, is_active: true,
                        members: [{ id: '120', name: '石塚 瑶季', path: PATH }],
                    }],
                    last_sync: {},
                }),
            ),
            http.post('/api/content/unread_counts', () => {
                calls += 1;
                return calls === 1
                    ? HttpResponse.json({ [PATH]: 3 })
                    : new HttpResponse(null, { status: 500 });
            }),
        );
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(<MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} />);

        expect(await screen.findByText('3')).toBeInTheDocument();
        // Wait until at least two further (failing) polls have happened.
        await waitFor(() => expect(calls).toBeGreaterThanOrEqual(3));
        expect(screen.getByText('3')).toBeInTheDocument();
        consoleError.mockRestore();
    });
});
