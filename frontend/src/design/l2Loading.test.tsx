import React, { createRef } from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import i18n from '../i18n';
import { useAppStore } from '../store/appStore';
import { useUpgradeStore } from '../core/upgrade/upgradeStore';
import { UpdateActions } from '../core/upgrade/UpdateActions';
import { MemberSelectModal } from '../features/blogs/components/MemberSelectModal';
import { MemberTimelineModal } from '../features/blogs/components/MemberTimelineModal';
import { RecentPostsFeed } from '../features/blogs/components/RecentPostsFeed';
import { BlogReader, type BlogReaderProps } from '../features/blogs/components/BlogReader';
import { CalendarModal } from '../core/modals/CalendarModal';
import { DiagnosticsModal } from '../core/modals/DiagnosticsModal';
import { SearchModal, type SearchModalHandle } from '../features/search/SearchModal';
import { TranscribeButton } from '../core/media/TranscribeButton';
import { TranslateButton } from '../core/common/TranslateButton';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../data/memberData', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../data/memberData')>()),
    getMemberNameKanji: (n: string) => n,
    getMemberByName: () => null,
    getMemberByBlogId: () => null,
}));
vi.mock('../shell/hooks/useAuth', () => ({
    useAuth: () => ({
        connectedServices: [], disconnectedServices: [],
        isServiceConnected: () => false, isServiceDisconnected: () => false,
        getServiceExpiresAt: () => null, getScheduledRefreshServices: () => [],
    }),
}));

const SLOW = i18n.t('loading.slow', { lng: 'en' });
const VERY_SLOW = i18n.t('loading.verySlow', { lng: 'en' });

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
/** StatusBlock's stage (hidden, shown, slow, verySlow); immediate pressed-state spinners elsewhere do not count. */
const stage = () => document.querySelector('[data-stage]')?.getAttribute('data-stage');
const spinnerCount = () => (stage() === 'hidden' ? 0 : document.querySelectorAll('[data-stage] svg.animate-spin').length);

/** The shared wait contract: nothing at 199 ms, spinner at 200, slow copy at 3 s, explanation plus bar at 10 s. */
function expectStages(label: string) {
    advance(199);
    expect(spinnerCount()).toBe(0);
    advance(1);
    expect(spinnerCount()).toBeGreaterThan(0);
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    advance(2799);
    expect(screen.queryByText(SLOW)).toBeNull();
    advance(1);
    expect(screen.getByText(SLOW)).toBeInTheDocument();
    advance(6999);
    expect(screen.queryByText(VERY_SLOW)).toBeNull();
    advance(1);
    expect(screen.getByText(VERY_SLOW)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
}

const members = [{ id: '9901', name: '春野 ひなた', thumbnail: null }];
const blogs = [{ id: '1', title: '今日の日記 🌸', published_at: '2026-11-03T09:00:00Z', url: '', thumbnail: null, cached: true }];
const selectProps = (over: object = {}) => ({
    isOpen: true, onClose: vi.fn(), members, loading: false, error: null, onSelectMember: vi.fn(), onRetry: vi.fn(), serviceId: 'hinatazaka46', ...over,
}) as React.ComponentProps<typeof MemberSelectModal>;
const timelineProps = (over: object = {}) => ({
    isOpen: true, onClose: vi.fn(), member: { id: '9901', name: '春野 ひなた' }, blogs, loading: false, error: null,
    onSelectBlog: vi.fn(), onRetry: vi.fn(), onOpenPhotoGallery: vi.fn(), ...over,
}) as React.ComponentProps<typeof MemberTimelineModal>;
const feedProps = (over: object = {}) => ({
    posts: [], loading: false, error: null, syncing: false, onSelectPost: vi.fn(), onMemberSelect: vi.fn(), onRetry: vi.fn(), serviceId: 'hinatazaka46', ...over,
}) as React.ComponentProps<typeof RecentPostsFeed>;
const readerProps = (over: Partial<BlogReaderProps> = {}): BlogReaderProps => ({
    content: null, member: { id: '9901', name: '春野 ひなた' },
    blog: { id: '142', title: '春の日記 🌸', published_at: '2026-11-03T09:00:00Z', url: '', thumbnail: null, cached: true },
    memberBlogs: [], currentIndex: -1, loading: false, error: null, onBack: vi.fn(), onRetry: vi.fn(), onNavigate: vi.fn(),
    onMemberClick: vi.fn(), serviceId: 'hinatazaka46', ...over,
});

describe('blog screens on StatusBlock', () => {
    it('member select: staged loading, error keeps its title and Retry (primary), empty is unchanged', () => {
        const { rerender } = render(<MemberSelectModal {...selectProps({ loading: true })} />);
        expectStages(i18n.t('blogs.loadingMembers'));
        const p = selectProps({ error: 'boom 失敗' });
        rerender(<MemberSelectModal {...p} />);
        expect(screen.getByRole('alert')).toHaveTextContent('boom 失敗');
        fireEvent.click(screen.getByRole('button', { name: i18n.t('blogs.retry') }));
        expect(p.onRetry).toHaveBeenCalledTimes(1);
        rerender(<MemberSelectModal {...selectProps({ members: [] })} />);
        expect(screen.getByRole('status')).toHaveTextContent(i18n.t('blogs.noMembersFound'));
    });

    it('member timeline: staged loading, error Retry, empty', () => {
        const { rerender } = render(<MemberTimelineModal {...timelineProps({ loading: true })} />);
        expectStages(i18n.t('blogs.loadingTimeline'));
        const p = timelineProps({ error: '失敗 ❌' });
        rerender(<MemberTimelineModal {...p} />);
        expect(screen.getByRole('alert')).toHaveTextContent('失敗 ❌');
        fireEvent.click(screen.getByRole('button', { name: i18n.t('blogs.retry') }));
        expect(p.onRetry).toHaveBeenCalledTimes(1);
        rerender(<MemberTimelineModal {...timelineProps({ blogs: [] })} />);
        expect(screen.getByRole('status')).toHaveTextContent(i18n.t('blogs.noBlogPostsFound'));
    });

    it('recent feed: staged loading, first-sync hint as the slow line, error Retry, empty', () => {
        const { rerender } = render(<RecentPostsFeed {...feedProps({ loading: true })} />);
        expectStages(i18n.t('blogs.loadingPosts'));
        rerender(<RecentPostsFeed {...feedProps({ syncing: true })} />);
        advance(200);
        expect(screen.getAllByRole('status').some((e) => e.textContent?.includes(i18n.t('blogs.syncingBlogs')))).toBe(true);
        const p = feedProps({ error: 'x' });
        rerender(<RecentPostsFeed {...p} />);
        expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('blogs.feedLoadFailed'));
        fireEvent.click(screen.getByRole('button', { name: i18n.t('blogs.retry') }));
        expect(p.onRetry).toHaveBeenCalledTimes(1);
        rerender(<RecentPostsFeed {...feedProps()} />);
        expect(screen.getByText(i18n.t('blogs.noBlogPostsFound'))).toBeInTheDocument();
    });

    it('first sync shows the hint at the slow stage', () => {
        render(<RecentPostsFeed {...feedProps({ syncing: true })} />);
        advance(3000);
        expect(screen.getByText(i18n.t('blogs.firstSyncHint'))).toBeInTheDocument();
    });

    it('blog reader: staged loading and error Retry', () => {
        const { rerender } = render(<BlogReader {...readerProps({ loading: true })} />);
        expectStages(i18n.t('blogs.loadingPost'));
        const p = readerProps({ error: 'x' });
        rerender(<BlogReader {...p} />);
        expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('blogs.postLoadFailed'));
        fireEvent.click(screen.getByRole('button', { name: i18n.t('blogs.retry') }));
        expect(p.onRetry).toHaveBeenCalledTimes(1);
    });
});

const neverFetch = () => vi.fn(() => new Promise(() => {}));

describe('calendar, diagnostics and search on StatusBlock', () => {
    it('calendar: staged loading', () => {
        vi.stubGlobal('fetch', neverFetch());
        render(<CalendarModal isOpen onClose={vi.fn()} conversationPath="/c/あ" onSelectDate={vi.fn()} />);
        expectStages(i18n.t('loading.label'));
    });

    it('diagnostics: staged loading, then an error whose Retry re-runs the load', async () => {
        vi.stubGlobal('fetch', neverFetch());
        const { unmount } = render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        expectStages(i18n.t('loading.label'));
        unmount();

        const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch diagnostics 失敗')).mockImplementation(() => new Promise(() => {}));
        vi.stubGlobal('fetch', fetchMock);
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch diagnostics 失敗');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: i18n.t('loading.retry') }));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenLastCalledWith('/api/diagnostics');
    });

    describe('search', () => {
        beforeEach(() => {
            Element.prototype.scrollIntoView = vi.fn();
            useAppStore.setState({ activeService: 'hinatazaka46', selectedServices: ['hinatazaka46'], selectedConversations: {} });
        });
        const open = () => {
            const ref = createRef<SearchModalHandle>();
            render(<SearchModal ref={ref} />);
            act(() => ref.current!.open());
            const input = screen.getByRole('textbox');
            fireEvent.change(input, { target: { value: '春 🌸' } });
        };
        const isSearch = (u: unknown) => String(u).startsWith('/api/search?');

        it('staged loading while a query is pending', () => {
            vi.stubGlobal('fetch', vi.fn((u: string) => (isSearch(u) ? new Promise(() => {}) : Promise.resolve({ ok: true, json: async () => ({}) }))));
            open();
            expectStages(i18n.t('loading.label'));
        });

        it('a failed search keeps its title and Retry re-runs the last query', async () => {
            const fetchMock = vi.fn((u: string) => (isSearch(u) ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) }) : Promise.resolve({ ok: true, json: async () => ({}) })));
            vi.stubGlobal('fetch', fetchMock);
            open();
            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
            expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('search.searchFailed'));
            const searches = () => fetchMock.mock.calls.filter(([u]) => isSearch(u)).length;
            expect(searches()).toBe(1);
            fireEvent.click(screen.getByRole('button', { name: i18n.t('loading.retry') }));
            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
            expect(searches()).toBe(2);
            expect(String(fetchMock.mock.calls.filter(([u]) => isSearch(u))[1]![0])).toContain(encodeURIComponent('春 🌸'));
        });

        it('load more uses the Button loading state: aria-busy, no native disabled, no raw spinner', async () => {
            const result = { results: Array.from({ length: 50 }, (_, i) => ({ type: 'message', id: `m${i}`, service: 'hinatazaka46', member_name: 'あ', member_id: '1', text: `t${i}`, timestamp: '2026-11-03T09:00:00Z', highlight: [], path: 'p' })), total_count: 90, has_more: true };
            let pendingMore = true;
            vi.stubGlobal('fetch', vi.fn((u: string) => {
                if (!isSearch(u)) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (String(u).includes('offset=50') && pendingMore) return new Promise(() => {});
                return Promise.resolve({ ok: true, json: async () => result });
            }));
            open();
            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
            const more = screen.getByRole('button', { name: i18n.t('search.loadMore') });
            expect(more).not.toHaveAttribute('aria-busy', 'true');
            fireEvent.click(more);
            pendingMore = true;
            const busy = screen.getByRole('button', { name: new RegExp(i18n.t('search.loadMore')) });
            expect(busy).toHaveAttribute('aria-busy', 'true');
            expect(busy).not.toHaveAttribute('disabled');
            expect(busy.querySelector('svg.animate-spin')).toHaveClass('motion-reduce:animate-none');
        });
    });
});

describe('spinners on the Spinner primitive', () => {
    it('transcribe: decorative glyph next to the text, static under reduced motion', () => {
        const { container } = render(<TranscribeButton state="loading" onClick={vi.fn()} />);
        const glyph = container.querySelector('svg.animate-spin');
        expect(glyph).toHaveClass('motion-reduce:animate-none');
        expect(glyph).toHaveAttribute('aria-hidden', 'true');
        expect(container).toHaveTextContent(i18n.t('transcription.transcribing'));
    });

    it('translate: both layouts use a decorative Spinner (the button keeps its own accessible name)', () => {
        const { container, rerender } = render(<TranslateButton state="loading" onClick={vi.fn()} />);
        expect(container.querySelector('svg.animate-spin')).toHaveClass('motion-reduce:animate-none');
        rerender(<TranslateButton state="loading" onClick={vi.fn()} iconOnly />);
        expect(container.querySelector('svg.animate-spin')).toHaveClass('motion-reduce:animate-none');
        expect(container.querySelector('svg.animate-spin')).toHaveAttribute('aria-hidden', 'true');
        expect(container.querySelector('[role="status"]')).toBeNull();
        expect(screen.getByRole('button')).toHaveAttribute('aria-label');
    });
});

describe('UpdateActions progress', () => {
    it('keeps role=progressbar with its label and aria-valuenow', () => {
        useUpgradeStore.setState({
            versionInfo: { has_update: true, latest_version: '9.9.9', upgrade_supported: true } as never,
            status: { state: 'downloading', progress: 42, error: null, version: '9.9.9' } as never,
        });
        render(<UpdateActions />);
        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '42');
        expect(bar).toHaveAttribute('aria-label', expect.stringContaining('9.9.9'));
    });
});

describe('visible loading titles (the label is not sr-only outside reduced motion)', () => {
    const visible = (text: string) => {
        const el = screen.getAllByText(text)[0]!;
        expect(el.className).not.toContain('sr-only');
    };

    it('blog and dialog loading blocks show their title text', () => {
        const { unmount } = render(<MemberSelectModal {...selectProps({ loading: true })} />);
        advance(200);
        visible(i18n.t('blogs.loadingMembers'));
        unmount();
        const t2 = render(<MemberTimelineModal {...timelineProps({ loading: true })} />);
        advance(200);
        visible(i18n.t('blogs.loadingTimeline'));
        t2.unmount();
        const t3 = render(<RecentPostsFeed {...feedProps({ loading: true })} />);
        advance(200);
        visible(i18n.t('blogs.loadingPosts'));
        t3.unmount();
        render(<BlogReader {...readerProps({ loading: true })} />);
        advance(200);
        visible(i18n.t('blogs.loadingPost'));
    });

    it('first sync shows its title, then the hint under it, and keeps the hint at 10 s', () => {
        render(<RecentPostsFeed {...feedProps({ syncing: true })} />);
        advance(200);
        visible(i18n.t('blogs.syncingBlogs'));
        advance(2800);
        expect(screen.getByText(i18n.t('blogs.firstSyncHint'))).toBeInTheDocument();
        advance(7000);
        expect(screen.getByText(i18n.t('blogs.firstSyncHint'))).toBeInTheDocument();
        visible(i18n.t('blogs.syncingBlogs'));
    });

    it('the DialogStatus adapter shows a given title visibly', async () => {
        const { DialogStatus } = await import('../core/common/DialogStatus');
        render(<DialogStatus kind="loading" title="読み込み中… 🌸" />);
        advance(200);
        visible('読み込み中… 🌸');
    });
});
