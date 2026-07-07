import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { BlogCard } from './BlogCard';
import type { RecentPost } from '../../../types';

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
