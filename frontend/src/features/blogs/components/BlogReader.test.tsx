import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18n from '../../../i18n';
import { BlogReader, type BlogReaderProps } from './BlogReader';
import { formatBlogDate } from '../../../utils/dateFormatters';
import { clientLog } from '../../../utils/clientLog';
import { persisted } from '../../../core/persistence/persisted';
import { useAppStore } from '../../../store/appStore';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));

vi.mock('../../../data/memberData', () => ({
    toGroupId: () => 'hinatazaka',
    getMemberNameKanji: (n: string) => n,
    getMemberByName: (n: string) => (n === '春野 ひなた' ? { nameKanji: n } : null),
    getMemberByBlogId: () => null,
    getMemberPenlightHex: () => ['#5bbee4', '#f2a0c0'],
}));

// The photo viewer is out of scope here: a stand-in shows which photo it opened.
vi.mock('../../../core/media/PhotoDetailModal', async () => {
    const { createElement } = await import('react');
    return {
        MediaViewerModal: ({ currentIndex }: { currentIndex: number }) =>
            createElement('div', { 'data-testid': 'photo-viewer' }, String(currentIndex)),
    };
});

const CONTENT = {
    meta: { id: '142', member_name: '春野 ひなた', title: '春の日記 42 🌸', published_at: '2026-11-03T09:00:00Z', url: '' },
    content: { html: '<p>春が来た🌸<br><br><a href="https://example.com/more">もっと見る</a></p>' },
    images: [],
};

const props = (over: Partial<BlogReaderProps> = {}): BlogReaderProps => ({
    content: CONTENT,
    member: { id: '9901', name: '春野 ひなた' },
    blog: { id: '142', title: '春の日記 42 🌸', published_at: '2026-11-03T09:00:00Z', url: '', thumbnail: null, cached: true },
    memberBlogs: [],
    currentIndex: -1,
    loading: false,
    error: null,
    onBack: vi.fn(),
    onRetry: vi.fn(),
    onNavigate: vi.fn(),
    onMemberClick: vi.fn(),
    serviceId: 'hinatazaka46',
    ...over,
});

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('BlogReader', () => {
    it('marks the post title, member names and body as Japanese and uses the accent roles', () => {
        const { container } = render(<BlogReader {...props()} />);
        const title = screen.getByRole('heading', { level: 1 });
        expect(title).toHaveAttribute('lang', 'ja');
        for (const name of screen.getAllByRole('button', { name: '春野 ひなた' })) {
            expect(name).toHaveAttribute('lang', 'ja');
            expect(name).toHaveClass('text-accent-strong');
        }
        expect(container.querySelector('article > div[lang="ja"]')).not.toBeNull();
        expect(container.innerHTML).not.toMatch(/-group-(subtle|strong|accent)|ring-group\b/);
    });

    it('breadcrumbs a post that has no member wash', () => {
        render(<BlogReader {...props({ member: { id: '000', name: 'ポカ' } })} />);
        expect(clientLog).toHaveBeenCalledWith('blog_fallback', { target: 'wash', reason: 'mascot' });
    });

    it('sets the post in the reading type at a readable width', () => {
        const { container } = render(<BlogReader {...props()} />);
        expect(container.querySelector('article')).toHaveClass('max-w-2xl', 'px-8');
        const body = screen.getByText(/春が来た/).closest('div');
        expect(body).toHaveClass('text-reading');
        expect(body).not.toHaveClass('font-reading'); // the serif is for titles only
        expect(screen.getByRole('heading', { level: 1, name: '春の日記 42 🌸' })).toHaveClass('text-heading', 'font-reading');
    });

    it('dates the post in the app language', () => {
        const { container } = render(<BlogReader {...props()} />);
        const time = container.querySelector('time')!;
        expect(time).toHaveAttribute('dateTime', '2026-11-03T09:00:00Z');
        expect(time.textContent).toBe(formatBlogDate(new Date('2026-11-03T09:00:00Z'), 'en', 'long'));
    });

    it('goes back and opens the member timeline from the breadcrumb', () => {
        const p = props();
        render(<BlogReader {...p} />);
        fireEvent.click(screen.getByRole('button', { name: 'Back to latest blogs' }));
        fireEvent.click(screen.getAllByRole('button', { name: '春野 ひなた' })[0]);
        expect(p.onBack).toHaveBeenCalledTimes(1);
        expect(p.onMemberClick).toHaveBeenCalledTimes(1);
    });

    it('shows a translated error with a retry instead of the raw message', () => {
        const p = props({ content: null, error: 'Failed to fetch blog content: 500' });
        render(<BlogReader {...p} />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('This post could not be loaded');
        expect(alert).not.toHaveTextContent('Failed to fetch');
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(p.onRetry).toHaveBeenCalledTimes(1);
    });

    it('announces loading', async () => {
        render(<BlogReader {...props({ content: null, loading: true })} />);
        expect(await screen.findByRole('status', { name: 'Loading post...' })).toHaveTextContent('Loading post...');
    });

    it('paints the member penlight wash from member data through CSS variables', () => {
        const { container } = render(<BlogReader {...props()} />);
        const wash = container.querySelector('.bg-member-wash') as HTMLElement;
        expect(wash).toHaveAttribute('aria-hidden', 'true');
        expect(wash.style.getPropertyValue('--ds-member-wash-1')).toBe('#5bbee4');
        expect(wash.style.getPropertyValue('--ds-member-wash-2')).toBe('#f2a0c0');
        // The gradients come from the utility, not from an inline style or stylesheet.
        expect(container.querySelector('style')).toBeNull();
        expect(container.querySelector('[style*="gradient"]')).toBeNull();
    });

    it('paints no wash for the mascot', () => {
        const { container } = render(<BlogReader {...props({ member: { id: '000', name: 'ポカ' } })} />);
        const wash = container.querySelector('.bg-member-wash') as HTMLElement;
        expect(wash.getAttribute('style')).toBeNull();
    });

    it('keeps the rail column even before the member post list arrives', () => {
        const { container } = render(<BlogReader {...props()} />);
        expect(container.querySelector('.w-14.shrink-0')).not.toBeNull();
    });
});

describe('BlogReader translate with a failing cache read', () => {
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); useAppStore.setState({ translationEnabled: false }); });

    it('treats the failed read as a miss, logs it and still calls the translate API', async () => {
        useAppStore.setState({ translationEnabled: true });
        vi.spyOn(persisted, 'getTranslations').mockRejectedValue(new TypeError('Failed to fetch'));
        vi.spyOn(persisted, 'putTranslations').mockResolvedValue(undefined);
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, translations: ['spring'] }) });
        vi.stubGlobal('fetch', fetchMock);
        render(<BlogReader {...props()} />);
        fireEvent.click(screen.getByRole('button', { name: /translate/i }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/translation/translate', expect.anything()));
        expect(clientLog).toHaveBeenCalledWith('translation_batch_failed', { count: 1, error_type: 'typeerror', caller: 'blog' });
    });
});

describe('BlogReader search highlight', () => {
    const realScrollIntoView = Element.prototype.scrollIntoView;
    beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });
    afterAll(() => { Element.prototype.scrollIntoView = realScrollIntoView; });

    // The check-1 payload of audit lead post-sanitize-search-highlight-markup-injection: the
    // server sanitizer keeps an <img> alt as escaped text that looks like markup.
    const HOSTILE = {
        ...CONTENT,
        content: {
            html: '<p>今日は桜を見に行きました。<img src="/api/blogs/image?service=hinatazaka46&amp;blog_id=142&amp;filename=img_0.jpg" alt="&gt;XSSTERM&lt;img src=x onerror=globalThis.__xss=1&gt;"/></p>',
        },
    };

    it('never turns attribute text into markup', () => {
        const { container } = render(
            <BlogReader {...props({ content: HOSTILE, searchQuery: '桜', matchedTerms: ['桜', 'XSSTERM'] })} />,
        );
        expect(container.querySelector('[onerror]')).toBeNull();
        const imgs = container.querySelectorAll('article img');
        expect(imgs).toHaveLength(1);
        expect(imgs[0].getAttribute('alt')).toBe('>XSSTERM<img src=x onerror=globalThis.__xss=1>');
        expect(Array.from(container.querySelectorAll('mark')).map((m) => m.textContent)).toEqual(['桜']);
    });

    it('keeps a forged mark in the post as text', () => {
        const forged = { ...CONTENT, content: { html: '<p>&lt;mark&gt;XSSTERM&lt;/mark&gt; 春</p>' } };
        const { container } = render(<BlogReader {...props({ content: forged })} />);
        expect(container.querySelector('mark')).toBeNull();
        expect(container.querySelector('article p')!.textContent).toBe('<mark>XSSTERM</mark> 春');
    });

    it('marks exact and reading matches with their classes', () => {
        const { container } = render(
            <BlogReader {...props({ searchQuery: '春', matchedTerms: ['春', 'もっと'], readingTerms: ['もっと'] })} />,
        );
        const marks = (selector: string) => Array.from(container.querySelectorAll(selector)).map((m) => m.textContent);
        expect(marks('mark.search-highlight:not(.reading)')).toEqual(['春']);
        expect(marks('mark.search-highlight.reading')).toEqual(['もっと']);
    });
});

describe('BlogReader links', () => {
    let open: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        open = vi.spyOn(window, 'open').mockReturnValue(null);
        vi.mocked(clientLog).mockClear();
    });
    afterEach(() => open.mockRestore());

    const LINKS = {
        ...CONTENT,
        content: {
            html: '<p><a href="https://example.com/more">web</a> <a href="mailto:a@example.com">mail</a> '
                + '<a href="/api/blogs/image?service=hinatazaka46&amp;blog_id=1&amp;filename=img_0.jpg">local</a> '
                + '<a href="https://example.com/photo"><img src="/api/blogs/image?service=hinatazaka46&amp;blog_id=142&amp;filename=img_0.jpg" alt="photo"></a></p>',
        },
    };

    it('opens a web link in the browser and never navigates the window', () => {
        render(<BlogReader {...props({ content: LINKS })} />);
        expect(fireEvent.click(screen.getByRole('link', { name: 'web' }))).toBe(false);
        expect(open).toHaveBeenCalledWith('https://example.com/more', '_blank', 'noopener,noreferrer');
        expect(clientLog).toHaveBeenCalledWith('external_link', { surface: 'blog_post', outcome: 'opened' });
    });

    it('does nothing for a link that is not a web page', () => {
        // The sanitizer has already dropped the href of a mailto: link, so the anchor is inert;
        // a click must still never navigate the window.
        render(<BlogReader {...props({ content: LINKS })} />);
        expect(fireEvent.click(screen.getByText('mail'))).toBe(false);
        expect(open).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledWith('external_link', { surface: 'blog_post', outcome: 'blocked', reason: 'invalid' });
    });

    it('treats a link to the local image endpoint as a relative link on the official site', () => {
        // Only <img src> may keep the app-relative cached-image URL; on a link it resolves against
        // the blog base like any relative href and opens in the browser, never in the window.
        render(<BlogReader {...props({ content: LINKS })} />);
        expect(fireEvent.click(screen.getByText('local'))).toBe(false);
        expect(open).toHaveBeenCalledWith(
            'https://www.hinatazaka46.com/api/blogs/image?service=hinatazaka46&blog_id=1&filename=img_0.jpg',
            '_blank', 'noopener,noreferrer',
        );
    });

    it('opens the photo viewer for a linked image instead of the link', () => {
        render(<BlogReader {...props({ content: LINKS })} />);
        expect(fireEvent.click(screen.getByAltText('photo'))).toBe(false);
        expect(open).not.toHaveBeenCalled();
        expect(screen.getByTestId('photo-viewer')).toHaveTextContent('0');
    });

    it('opens a middle-clicked web link in the browser', () => {
        render(<BlogReader {...props({ content: LINKS })} />);
        const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
        expect(fireEvent(screen.getByRole('link', { name: 'web' }), event)).toBe(false);
        expect(open).toHaveBeenCalledTimes(1);
    });
});
