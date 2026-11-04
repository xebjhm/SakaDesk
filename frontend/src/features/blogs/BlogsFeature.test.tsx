import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { BlogsFeature } from './BlogsFeature';
import * as api from './api';
import { clientLog } from '../../utils/clientLog';

vi.mock('./api', () => ({
    getRecentPosts: vi.fn(),
    syncBlogMetadata: vi.fn(),
    getBlogMembersWithThumbnails: vi.fn(),
    getBlogList: vi.fn(),
    getBlogContent: vi.fn(),
    getMemberThumbnailUrl: vi.fn(() => ''),
}));
vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

const CONTENT = {
    meta: { id: '142', member_name: '春野 ひなた', title: '春の日記 42 🌸', published_at: '2026-11-03T09:00:00Z', url: '' },
    content: { html: '<p>春が来た🌸<br><br>はるですね</p>' },
    images: [],
};

const realScrollIntoView = Element.prototype.scrollIntoView;
beforeAll(async () => { await i18n.changeLanguage('en'); });
afterAll(() => { Element.prototype.scrollIntoView = realScrollIntoView; });

beforeEach(() => {
    vi.resetAllMocks(); // call counts and queued once-values do not leak between tests
    vi.mocked(api.getRecentPosts).mockResolvedValue({ service: 'hinatazaka46', posts: [] });
    vi.mocked(api.syncBlogMetadata).mockResolvedValue({ status: 'ok', service: 'hinatazaka46', total_members: 0, total_blogs: 0, last_sync: '' });
    vi.mocked(api.getBlogMembersWithThumbnails).mockResolvedValue({ service: 'hinatazaka46', members: [] });
    vi.mocked(api.getBlogList).mockResolvedValue({ member_id: '9901', member_name: '春野 ひなた', blogs: [] });
    vi.mocked(api.getBlogContent).mockResolvedValue(CONTENT);
    Element.prototype.scrollIntoView = vi.fn();
    useAppStore.setState({ activeService: 'hinatazaka46', targetBlog: null, blogRecentPostsCache: {} });
});

describe('BlogsFeature', () => {
    it('opens the post chosen in search and highlights exact and reading matches', async () => {
        useAppStore.setState({
            targetBlog: {
                blogId: '142', service: 'hinatazaka46', memberId: 9901,
                searchQuery: '春', matchedTerms: ['春', 'はる'], readingTerms: ['はる'],
            },
        });
        const { container } = render(<BlogsFeature />);
        expect(await screen.findByRole('heading', { level: 1, name: '春の日記 42 🌸' })).toBeInTheDocument();
        const marks = (selector: string) => Array.from(container.querySelectorAll(selector)).map((m) => m.textContent);
        expect(marks('mark.search-highlight:not(.reading)')).toEqual(['春']);
        expect(marks('mark.search-highlight.reading')).toEqual(['はる']);
        expect(useAppStore.getState().targetBlog).toBeNull();
        await waitFor(() =>
            expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' }),
        );
    });
});

describe('BlogsFeature breadcrumbs', () => {
    it('logs the recent posts and the background sync with their counts', async () => {
        const post = { id: '142', title: '春の日記 42 🌸', published_at: '2026-11-03T09:00:00Z', url: '', thumbnail: null, member_id: '9901', member_name: '春野 ひなた' };
        vi.mocked(api.getRecentPosts).mockResolvedValue({ service: 'hinatazaka46', posts: [post] });
        render(<BlogsFeature />);
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('blog_load', { target: 'recent', outcome: 'ok', count: 1 }));
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('blog_load', { target: 'sync', outcome: 'ok', count: 1 }));
        // Hinatazaka always adds the mascot (ポカ) to the member list.
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('blog_load', { target: 'members', outcome: 'ok', count: 1 }));
    });

    it('logs a failed search open instead of writing to the console', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(api.getBlogContent).mockRejectedValue(new Error('Failed to fetch blog content: 500'));
        useAppStore.setState({
            targetBlog: { blogId: '142', service: 'hinatazaka46', memberId: 9901, searchQuery: '春' },
        });
        render(<BlogsFeature />);
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('blog_load', { target: 'search_open', outcome: 'error' }));
        // React may still warn through console.error (act); only the feature's own message is checked.
        expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('[BlogsFeature]'), expect.anything());
        consoleError.mockRestore();
    });

    it('lays the screen out on the sheet without its own white background', () => {
        const { container } = render(<BlogsFeature />);
        expect(container.firstChild).not.toHaveClass('bg-white');
        expect(container.firstChild).toHaveClass('min-h-0', 'flex-col');
    });
});

describe('BlogsFeature retry', () => {
    const post = {
        id: '142', title: '春の日記 42 🌸', published_at: '2026-11-03T09:00:00Z', url: '',
        thumbnail: null, member_id: '9901', member_name: '春野 ひなた',
    };

    it('Retry on the feed fetches the recent posts again', async () => {
        vi.mocked(api.syncBlogMetadata).mockRejectedValue(new Error('offline'));
        vi.mocked(api.getRecentPosts)
            .mockRejectedValueOnce(new Error('Failed to fetch recent posts: 500'))
            .mockResolvedValue({ service: 'hinatazaka46', posts: [post] });
        render(<BlogsFeature />);
        fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
        expect(await screen.findByRole('button', { name: /春の日記 42/ })).toBeInTheDocument();
        expect(api.getRecentPosts).toHaveBeenCalledTimes(2);
    });

    it('Retry in the reader loads the same post again instead of returning to the feed', async () => {
        vi.mocked(api.getRecentPosts).mockResolvedValue({ service: 'hinatazaka46', posts: [post] });
        vi.mocked(api.getBlogContent)
            .mockRejectedValueOnce(new Error('Failed to fetch blog content: 500'))
            .mockResolvedValue(CONTENT);
        render(<BlogsFeature />);
        fireEvent.click(await screen.findByRole('button', { name: /春の日記 42/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
        expect(await screen.findByRole('heading', { level: 1, name: '春の日記 42 🌸' })).toBeInTheDocument();
        expect(api.getBlogContent).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('heading', { name: 'Latest Blogs' })).toBeNull();
    });
});

describe('BlogsFeature arrow keys with a dialog open (D2b fix)', () => {
    const meta = (id: string) => ({ id, title: `春の日記 ${id} 🌸`, published_at: `2026-11-0${Number(id) - 140}T09:00:00Z`, url: '', thumbnail: null, cached: true });
    const post = { ...meta('142'), member_id: '9901', member_name: '春野 ひなた' };

    it('← / → leave the post alone while the member timeline dialog is open', async () => {
        vi.mocked(api.getRecentPosts).mockResolvedValue({ service: 'hinatazaka46', posts: [post] });
        vi.mocked(api.getBlogList).mockResolvedValue({
            member_id: '9901', member_name: '春野 ひなた', blogs: [meta('143'), meta('142'), meta('141')],
        });
        render(<BlogsFeature />);
        fireEvent.click(await screen.findByRole('button', { name: /春の日記 142/ }));
        expect(await screen.findByRole('heading', { level: 1, name: '春の日記 42 🌸' })).toBeInTheDocument();
        // Both the older and the newer pill are there once the member's list has arrived.
        await screen.findByRole('button', { name: /Older post/ });
        const contentCalls = vi.mocked(api.getBlogContent).mock.calls.length;

        fireEvent.click(screen.getAllByRole('button', { name: /春野/ })[0]);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(api.getBlogContent).toHaveBeenCalledTimes(contentCalls);
        expect(screen.getByRole('heading', { level: 1, name: '春の日記 42 🌸' })).toBeInTheDocument();
    });
});
