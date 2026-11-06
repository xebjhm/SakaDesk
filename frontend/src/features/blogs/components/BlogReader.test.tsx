import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../../i18n';
import { BlogReader, type BlogReaderProps } from './BlogReader';
import { formatBlogDate } from '../../../utils/dateFormatters';
import { clientLog } from '../../../utils/clientLog';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));

vi.mock('../../../data/memberData', () => ({
    toGroupId: () => 'hinatazaka',
    getMemberNameKanji: (n: string) => n,
    getMemberByName: (n: string) => (n === '春野 ひなた' ? { nameKanji: n } : null),
    getMemberByBlogId: () => null,
    getMemberPenlightHex: () => ['#5bbee4', '#f2a0c0'],
}));

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

    it('announces loading', () => {
        render(<BlogReader {...props({ content: null, loading: true })} />);
        expect(screen.getByRole('status')).toHaveTextContent('Loading post...');
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
