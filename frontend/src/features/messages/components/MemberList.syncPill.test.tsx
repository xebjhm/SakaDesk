import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { MemberList } from './MemberList';
import { FeatureActiveContext } from '../../../design/featureActive';

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

describe('MemberList last-synced label', () => {
    afterEach(() => vi.useRealTimers());

    const NOW = new Date('2026-11-13T12:00:00Z');
    const mount = () => {
        // Only the clock is faked: msw and the testing library keep their real timers.
        vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
        server.use(
            http.get('/api/content/groups', () => HttpResponse.json({
                groups: [], last_sync: { hinatazaka46: new Date(NOW.getTime() - 10_000).toISOString() },
            })),
            http.post('/api/content/unread_counts', () => HttpResponse.json({})),
        );
        const tree = (active: boolean) => (
            <FeatureActiveContext.Provider value={active}>
                <MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} paused={!active} />
            </FeatureActiveContext.Provider>
        );
        return { ...render(tree(true)), tree };
    };
    const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

    it('advances by itself while idle, with no new answer from the server', async () => {
        mount();
        expect(await screen.findByText('Last synced just now')).toBeInTheDocument();
        tick(2 * 60_000);
        expect(screen.getByText('Last synced 2m ago')).toBeInTheDocument();
    });

    it('does not tick while its feature is hidden, and reads afresh when shown', async () => {
        const { rerender, tree } = mount();
        await screen.findByText('Last synced just now');
        rerender(tree(false));
        expect(vi.getTimerCount()).toBe(0);
        tick(5 * 60_000);
        expect(screen.getByText('Last synced just now')).toBeInTheDocument();
        rerender(tree(true));
        expect(screen.getByText('Last synced 5m ago')).toBeInTheDocument();
        tick(60_000);
        expect(screen.getByText('Last synced 6m ago')).toBeInTheDocument();
    });
});
