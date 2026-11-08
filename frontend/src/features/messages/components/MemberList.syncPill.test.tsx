import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { MemberList } from './MemberList';

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('MemberList sync pill', () => {
    it('stays floating and the list keeps bottom padding to scroll clear of it', async () => {
        server.use(
            http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
            http.post('/api/content/unread_counts', () => HttpResponse.json({})),
        );
        render(<MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} onSyncNow={vi.fn()} />);
        const syncNow = await screen.findByRole('button', { name: /sync now/i });
        const pill = syncNow.closest('[data-testid="sync-pill"]') as HTMLElement;
        expect(pill).not.toBeNull();
        expect(pill).toHaveClass('absolute', 'bottom-3', 'pointer-events-none');
        const scroller = pill.previousElementSibling as HTMLElement;
        expect(scroller).toHaveClass('overflow-y-auto', 'pb-16');
        expect(scroller.contains(pill)).toBe(false);
    });
});
