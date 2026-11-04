// frontend/src/features/blogs/components/BlogNavFooter.tsx
// Older / newer post as two floating pills over the bottom of the post (← / → work too).
import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { BlogMeta } from '../../../types';
import { cn } from '../../../utils/classnames';
import { formatBlogDate } from '../../../utils/dateFormatters';
import { useTranslation } from '../../../i18n';
import { ignoresPostKeys } from './arrowKeys';

interface BlogNavFooterProps {
    prevBlog: BlogMeta | null;
    nextBlog: BlogMeta | null;
    onPrev: () => void;
    onNext: () => void;
    /** False while a dialog or the photo viewer is open: ← / → then leave the post alone. */
    keysEnabled?: boolean;
}

const SIDE = cn(
    'pointer-events-auto group flex max-w-[45%] items-center gap-2 rounded-pill bg-pill py-2 shadow-pill',
    'transition-colors duration-fast ease-standard hover:bg-sunken',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group',
);
const CHEVRON = 'h-4 w-4 shrink-0 text-muted transition-colors duration-fast ease-standard group-hover:text-primary';

const truncateTitle = (title: string, maxLen: number = 18) =>
    title.length <= maxLen ? title : title.slice(0, maxLen) + '...';

export const BlogNavFooter: React.FC<BlogNavFooterProps> = ({
    prevBlog,
    nextBlog,
    onPrev,
    onNext,
    keysEnabled = true,
}) => {
    const { t, i18n } = useTranslation();

    // Keyboard navigation (window-wide, except where the keys belong to something else)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!keysEnabled || ignoresPostKeys(e)) return;
            if (e.key === 'ArrowLeft' && prevBlog) {
                onPrev();
            } else if (e.key === 'ArrowRight' && nextBlog) {
                onNext();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [prevBlog, nextBlog, onPrev, onNext, keysEnabled]);

    // Don't render if no navigation available
    if (!prevBlog && !nextBlog) return null;

    const label = (blog: BlogMeta, prefix: string) => (
        <span className="min-w-0">
            <span className="block max-w-[160px] truncate text-small font-semibold text-primary">
                <span className="sr-only">{prefix}:</span>{' '}
                {truncateTitle(blog.title)}
            </span>
            <span className="block text-caption text-muted">
                {formatBlogDate(new Date(blog.published_at), i18n.language, 'short')}
            </span>
        </span>
    );

    return (
        <nav
            aria-label={t('blogs.postNavigation')}
            className="pointer-events-none absolute inset-x-6 bottom-4 z-10 flex items-center justify-between gap-4"
        >
            {prevBlog ? (
                <button type="button" onClick={onPrev} className={cn(SIDE, 'pl-3 pr-4 text-left')}>
                    <ChevronLeft aria-hidden="true" className={CHEVRON} />
                    {label(prevBlog, t('blogs.olderPost'))}
                </button>
            ) : (
                <span />
            )}

            {nextBlog ? (
                <button type="button" onClick={onNext} className={cn(SIDE, 'pl-4 pr-3 text-right')}>
                    {label(nextBlog, t('blogs.newerPost'))}
                    <ChevronRight aria-hidden="true" className={CHEVRON} />
                </button>
            ) : (
                <span />
            )}
        </nav>
    );
};
