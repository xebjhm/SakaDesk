import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { MemberList } from './MemberList';

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('MemberList sync pill (M9)', () => {
    it('sits below the scrolling list, not floating over it', async () => {
        server.use(
            http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
            http.post('/api/content/unread_counts', () => HttpResponse.json({})),
        );
        render(<MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} onSyncNow={vi.fn()} />);
        const syncNow = await screen.findByRole('button', { name: /sync now/i });
        const footer = syncNow.closest('[data-testid="sync-footer"]') as HTMLElement;
        expect(footer).not.toBeNull();
        expect(footer.className).not.toMatch(/absolute|fixed/);
        const scroller = footer.previousElementSibling as HTMLElement;
        expect(scroller).toHaveClass('overflow-y-auto');
        expect(scroller.contains(footer)).toBe(false);
    });
});
