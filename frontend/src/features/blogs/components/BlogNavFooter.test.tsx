import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../../i18n';
import { BlogNavFooter } from './BlogNavFooter';
import type { BlogMeta } from '../../../types';

const post = (id: string, title: string): BlogMeta => ({
    id, title, published_at: '2026-10-25T09:00:00Z', url: '', thumbnail: null, cached: true,
});
const OLDER = post('141', '春の日記 41 🌸');
const NEWER = post('143', '春の日記 43 🌸');

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('BlogNavFooter', () => {
    it('ArrowLeft opens the older post and ArrowRight the newer one', () => {
        const onPrev = vi.fn();
        const onNext = vi.fn();
        render(<BlogNavFooter prevBlog={OLDER} nextBlog={NEWER} onPrev={onPrev} onNext={onNext} />);
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(onPrev).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('ignores an arrow toward a side without a post', () => {
        const onPrev = vi.fn();
        const onNext = vi.fn();
        render(<BlogNavFooter prevBlog={OLDER} nextBlog={null} onPrev={onPrev} onNext={onNext} />);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(onNext).not.toHaveBeenCalled();
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('opens a side on click', () => {
        const onPrev = vi.fn();
        const onNext = vi.fn();
        render(<BlogNavFooter prevBlog={OLDER} nextBlog={NEWER} onPrev={onPrev} onNext={onNext} />);
        fireEvent.click(screen.getByRole('button', { name: /春の日記 41/ }));
        fireEvent.click(screen.getByRole('button', { name: /春の日記 43/ }));
        expect(onPrev).toHaveBeenCalledTimes(1);
        expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('renders nothing without an older or a newer post', () => {
        const { container } = render(<BlogNavFooter prevBlog={null} nextBlog={null} onPrev={vi.fn()} onNext={vi.fn()} />);
        expect(container.firstChild).toBeNull();
    });
});
