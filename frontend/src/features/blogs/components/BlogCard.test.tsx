import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { BlogCard } from './BlogCard';
import type { RecentPost } from '../../../types';
import i18n from '../../../i18n';
import { clientLog } from '../../../utils/clientLog';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));

// The kanji lookup is static data; stub to a stable value.
vi.mock('../../../data/memberData', () => ({
  getMemberNameKanji: (n: string) => n,
}));

const makePost = (over: Partial<RecentPost>): RecentPost => ({
  id: 'p1',
  title: 'Title',
  published_at: '2026-07-07T00:00:00Z',
  url: 'https://example.com/1',
  thumbnail: 'https://example.com/a.jpg',
  member_id: '1',
  member_name: '佐々木 久美',
  ...over,
});

describe('BlogCard image state reset on post change (SD-FE-GAP-B-10)', () => {
  it('un-fades (resets imageLoaded) when the post thumbnail changes', () => {
    const postA = makePost({ id: 'A', thumbnail: 'https://example.com/a.jpg' });
    const { container, rerender } = render(<BlogCard post={postA} onClick={() => {}} />);

    const imgA = container.querySelector('img')!;
    expect(imgA).toBeTruthy();
    // Simulate A's image loading — it becomes fully opaque.
    fireEvent.load(imgA);
    expect(container.querySelector('img')!.className).toContain('opacity-100');

    // Recycle the same card instance for a DIFFERENT post/thumbnail.
    const postB = makePost({ id: 'B', thumbnail: 'https://example.com/b.jpg' });
    rerender(<BlogCard post={postB} onClick={() => {}} />);

    const imgB = container.querySelector('img')!;
    expect(imgB.getAttribute('src')).toBe('https://example.com/b.jpg');
    // Must start un-faded again (opacity-0), not inherit A's loaded state.
    expect(imgB.className).toContain('opacity-0');
    expect(imgB.className).not.toContain('opacity-100');
  });

  it('re-renders the <img> for a new post after the previous one errored', () => {
    const postA = makePost({ id: 'A', thumbnail: 'https://example.com/a.jpg' });
    const { container, rerender } = render(<BlogCard post={postA} onClick={() => {}} />);

    // A's image fails → the <img> is unmounted (guard: thumbnail && !imageError).
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();

    // New valid post recycled into the same slot must show its <img> again.
    const postB = makePost({ id: 'B', thumbnail: 'https://example.com/b.jpg' });
    rerender(<BlogCard post={postB} onClick={() => {}} />);

    const imgB = container.querySelector('img');
    expect(imgB).toBeTruthy();
    expect(imgB!.getAttribute('src')).toBe('https://example.com/b.jpg');
  });
});

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('BlogCard e4e4118 tile', () => {
  it('is a button named by the date, title and member; the photo is decorative', () => {
    render(<BlogCard post={makePost({ title: '春の日記 🌸', published_at: '2026-07-07T12:00:00Z' })} onClick={() => {}} />);
    const button = screen.getByRole('button');
    expect(button).toHaveAccessibleName(/Jul 7.*春の日記 🌸.*佐々木 久美/);
    expect(button.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('lets the photo tile fill the card and lifts it on hover', () => {
    render(<BlogCard post={makePost({})} onClick={() => {}} />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('relative', 'aspect-[3/4]', 'isolate', 'hover:-translate-y-1.5', 'duration-lift', 'ease-out');
    expect(button).not.toHaveClass('bg-card', 'overflow-hidden');
    const tile = screen.getByTestId('blog-card-tile');
    expect(tile).toHaveClass('absolute', 'inset-0', 'overflow-hidden', 'rounded-md', 'bg-accent-tile', 'shadow-tile', 'group-hover:shadow-tile-hover');
    expect(button.querySelector('img')).toHaveClass('group-hover:scale-105', 'duration-zoom', 'motion-reduce:transition-none');
    expect(tile.querySelector('.bg-tile-vignette')).not.toBeNull();
    expect(button.querySelector('.bg-accent-aura')).toHaveClass('-inset-3', '-z-10', 'blur-xl', 'opacity-0', 'group-hover:opacity-100', 'motion-reduce:transition-none');
  });

  it('floats the caption card over the bottom-right corner, offset past the photo edge', () => {
    render(<BlogCard post={makePost({})} onClick={() => {}} />);
    const caption = screen.getByTestId('blog-card-caption');
    expect(caption).toHaveClass(
      'absolute', '-bottom-2', '-right-2', 'rounded-sm', 'px-2.5', 'py-2', 'min-w-[95px]', 'max-w-[150px]',
      'bg-tile-glass', 'border-tile-glass', 'backdrop-blur-lg', 'shadow-caption',
      'group-hover:-translate-x-1', 'group-hover:-translate-y-1', 'group-hover:shadow-caption-hover', 'ease-spring',
    );
  });

  it('uses the larger offsets, padding and radius on a featured card', () => {
    render(<BlogCard post={makePost({ title: 'T' })} onClick={() => {}} size="featured" />);
    expect(screen.getByTestId('blog-card-tile')).toHaveClass('rounded-lg');
    expect(screen.getByTestId('blog-card-caption')).toHaveClass('-bottom-3', '-right-3', 'rounded-md', 'px-3.5', 'py-3', 'min-w-[130px]', 'max-w-[200px]');
    expect(screen.getByText('T')).toHaveClass('text-tile-title-lg', 'font-medium');
  });

  it('sets the date in small caps above a serif Japanese title and the member in the accent', () => {
    render(<BlogCard post={makePost({ title: '春の日記', member_name: '佐々木 久美' })} onClick={() => {}} />);
    const date = screen.getByText('Jul 7');
    expect(date).toHaveClass('text-tile-date', 'uppercase', 'tracking-wider', 'text-muted');
    expect(date).not.toHaveAttribute('lang');
    const title = screen.getByText('春の日記');
    expect(title).toHaveAttribute('lang', 'ja');
    expect(title).toHaveClass('font-reading', 'text-tile-title', 'font-semibold', 'line-clamp-2', 'leading-snug', 'text-primary');
    const name = screen.getByText('佐々木 久美');
    expect(name).toHaveAttribute('lang', 'ja');
    expect(name).toHaveClass('text-tile-name', 'font-semibold', 'text-accent-strong');
  });

  it('shows an accent focus ring over the photo', () => {
    render(<BlogCard post={makePost({})} onClick={() => {}} />);
    const ring = screen.getByTestId('blog-card-tile').querySelector('.ring-accent');
    expect(ring).toHaveClass('ring-2', 'ring-inset', 'opacity-0', 'group-focus-visible:opacity-100');
  });

  it('breadcrumbs a broken thumbnail', () => {
    const { container } = render(<BlogCard post={makePost({})} onClick={() => {}} />);
    fireEvent.error(container.querySelector('img')!);
    expect(clientLog).toHaveBeenCalledWith('blog_fallback', { target: 'card_thumb', reason: 'image_error' });
  });
});
