import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { BlogsFeature } from './BlogsFeature';
import * as api from './api';

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
