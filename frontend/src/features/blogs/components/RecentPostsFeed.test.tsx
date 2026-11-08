import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import i18n from '../../../i18n';
import { useAppStore } from '../../../store/appStore';
import { RecentPostsFeed } from './RecentPostsFeed';
import type { RecentPost } from '../../../types';

vi.mock('../../../data/memberData', () => ({ getMemberNameKanji: (n: string) => n }));

const posts: RecentPost[] = Array.from({ length: 7 }, (_, i) => ({
    id: `p${i}`, title: `春の日記 ${i} 🌸`, published_at: '2026-11-03T09:00:00Z', url: '',
    thumbnail: null, member_id: '9901', member_name: '春野 ひなた',
}));

const props = (over: Partial<ComponentProps<typeof RecentPostsFeed>> = {}) => ({
    posts, loading: false, error: null, syncing: false,
    onSelectPost: vi.fn(), onMemberSelect: vi.fn(), onRetry: vi.fn(), serviceId: 'hinatazaka46',
    ...over,
});

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => { useAppStore.setState({ blogSelectionModes: {} }); });

describe('RecentPostsFeed', () => {
    it('shows every post as a card button that opens it', () => {
        const p = props();
        render(<RecentPostsFeed {...p} />);
        fireEvent.click(screen.getByRole('button', { name: /春の日記 3/ }));
        expect(p.onSelectPost).toHaveBeenCalledWith(posts[3]);
    });

    it('makes posts 0 and 5 the 2×2 hero cards and reveals the cards', () => {
        const { container } = render(<RecentPostsFeed {...props()} />);
        const items = container.querySelectorAll('.animate-reveal');
        expect(items).toHaveLength(7);
        expect(items[0]).toHaveClass('col-span-2', 'row-span-2');
        expect(items[1]).not.toHaveClass('col-span-2');
        expect(items[5]).toHaveClass('col-span-2', 'row-span-2');
    });

    it('switches between all and favourite posts with neutral pills', () => {
        render(<RecentPostsFeed {...props()} />);
        expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Favorite' }));
        expect(useAppStore.getState().blogSelectionModes.hinatazaka46).toBe('favorite');
        expect(screen.getByRole('group', { name: 'Show posts from' })).toBeInTheDocument();
    });

    it('opens the member dialog from a secondary button', () => {
        const p = props();
        render(<RecentPostsFeed {...p} />);
        const button = screen.getByRole('button', { name: 'Select Member' });
        expect(button).not.toHaveClass('bg-group-accent');
        fireEvent.click(button);
        expect(p.onMemberSelect).toHaveBeenCalledTimes(1);
    });

    it('shows a translated error with a retry instead of the raw message', () => {
        const p = props({ posts: [], error: 'Failed to fetch recent posts: 500' });
        render(<RecentPostsFeed {...p} />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Blog posts could not be loaded');
        expect(alert).not.toHaveTextContent('Failed to fetch');
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(p.onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows the favourites empty state', () => {
        useAppStore.setState({ blogSelectionModes: { hinatazaka46: 'favorite' } });
        render(<RecentPostsFeed {...props({ posts: [] })} />);
        expect(screen.getByText('No posts from favorite members')).toBeInTheDocument();
    });

    it('keeps the ambient orbs, drawn from group tokens, and has no inline stylesheet', () => {
        const { container } = render(<RecentPostsFeed {...props()} />);
        expect(container.querySelector('style')).toBeNull();
        expect(container.querySelectorAll('.bg-expressive-orb-1, .bg-expressive-orb-2, .bg-expressive-orb-3')).toHaveLength(3);
        expect(screen.getByRole('heading', { name: 'Latest Blogs' })).toHaveClass('font-reading', 'text-accent-strong');
    });

    it('puts the header on frosted glass (blur 20, saturate 180, white hairline) and rests the select-member button on the accent wash with a hover glow', () => {
        render(<RecentPostsFeed {...props()} />);
        const header = screen.getByRole('banner');
        expect(header).toHaveClass('bg-frost', 'backdrop-blur-frost', 'backdrop-saturate-180', 'border-b', 'border-frost');
        const button = screen.getByRole('button', { name: 'Select Member' });
        expect(button).toHaveClass('bg-accent-wash', 'border', 'border-accent-wash', 'text-secondary', 'hover:bg-accent-gradient', 'hover:text-inverse', 'hover:shadow-accent-glow-hover');
        expect(button).not.toHaveClass('bg-accent-tonal');
    });

    it('draws All / Favorite as one segmented control: a grey track holding both segments', () => {
        render(<RecentPostsFeed {...props()} />);
        const track = screen.getByRole('group', { name: 'Show posts from' });
        expect(track).toHaveClass('inline-flex', 'rounded-full', 'bg-segment-track', 'gap-0.5', 'p-0.5', 'border', 'border-transparent');
        const segments = track.querySelectorAll('button');
        expect(segments).toHaveLength(2);
        segments.forEach((segment) => {
            expect(segment).toHaveClass('rounded-full', 'px-3.5', 'py-1.5', 'text-segment', 'font-medium');
            expect(segment).not.toHaveClass('shadow-pill', 'ring-1');
        });
    });

    it('raises the selected segment as a white pill in the oshi colour, the other muted on the track', () => {
        render(<RecentPostsFeed {...props()} />);
        const all = screen.getByRole('button', { name: 'All' });
        const favorite = screen.getByRole('button', { name: 'Favorite' });
        expect(all).toHaveAttribute('aria-pressed', 'true');
        expect(all).toHaveClass('bg-pill', 'shadow-segment', 'text-semantic-oshi');
        expect(favorite).toHaveClass('bg-transparent', 'text-muted', 'hover:text-secondary');
        expect(favorite).not.toHaveClass('shadow-segment');
        fireEvent.click(favorite);
        expect(favorite).toHaveAttribute('aria-pressed', 'true');
        expect(favorite).toHaveClass('bg-pill', 'shadow-segment', 'text-semantic-oshi');
        expect(favorite.querySelector('svg')).toHaveClass('h-3.5', 'w-3.5', 'text-semantic-oshi-solid');
        expect(all).toHaveClass('text-muted');
    });

    it('draws the favourites empty-state heart in the oshi colour', () => {
        useAppStore.setState({ blogSelectionModes: { hinatazaka46: 'favorite' } });
        const { container } = render(<RecentPostsFeed {...props({ posts: [] })} />);
        expect(container.querySelector('svg.text-semantic-oshi')).not.toBeNull();
    });
});
