// frontend/src/features/blogs/components/BlogCard.tsx
// A post in the recent feed: a level-2 card with the photo on top and the caption below.
import React, { useState, useEffect } from 'react';
import type { RecentPost } from '../../../types';
import { getMemberNameKanji } from '../../../data/memberData';
import { cn } from '../../../utils/classnames';
import { formatBlogDate } from '../../../utils/dateFormatters';
import { useTranslation } from '../../../i18n';
import { clientLog } from '../../../utils/clientLog';

interface BlogCardProps {
    post: RecentPost;
    onClick: () => void;
    size?: 'normal' | 'featured';
}

export const BlogCard: React.FC<BlogCardProps> = ({ post, onClick, size = 'normal' }) => {
    const { i18n } = useTranslation();
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);

    // SD-FE-GAP-B-10: when a parent list recycles this card instance for a
    // different post (pagination / filter change / feed refresh), the <img> src
    // swaps but imageLoaded/imageError persist — showing the new image un-faded
    // (or, if the previous post had errored, permanently hiding a valid new
    // thumbnail behind the placeholder). Reset the load state on thumbnail change.
    useEffect(() => {
        setImageLoaded(false);
        setImageError(false);
    }, [post.thumbnail]);

    const isFeatured = size === 'featured';

    // The button is itself the card (a div may not sit inside a button); its parts are spans.
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'group flex aspect-[3/4] w-full flex-col overflow-hidden rounded-card bg-card text-left shadow-card',
                'transition duration-base ease-standard hover:-translate-y-1 hover:shadow-accent-glow-hover motion-reduce:transform-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            )}
        >
            <span className="relative block min-h-0 flex-1 overflow-hidden bg-expressive-soft">
                {post.thumbnail && !imageError && (
                    <img
                        src={post.thumbnail}
                        alt=""
                        loading="lazy"
                        onLoad={() => setImageLoaded(true)}
                        onError={() => {
                            setImageError(true);
                            clientLog('blog_fallback', { target: 'card_thumb', reason: 'image_error' });
                        }}
                        className={cn(
                            'absolute inset-0 h-full w-full object-cover object-top',
                            'transition duration-base ease-standard group-hover:scale-105 motion-reduce:transform-none',
                            imageLoaded ? 'opacity-100' : 'opacity-0',
                        )}
                    />
                )}
            </span>
            <span className={cn('flex shrink-0 flex-col gap-1', isFeatured ? 'p-4' : 'p-3')}>
                <span className="text-caption text-muted">
                    {formatBlogDate(new Date(post.published_at), i18n.language, 'short')}
                </span>
                <span lang="ja" className={cn('line-clamp-2 font-reading font-semibold text-primary', isFeatured ? 'text-title' : 'text-small')}>
                    {post.title}
                </span>
                <span lang="ja" className="truncate text-caption font-semibold text-accent-strong">
                    {getMemberNameKanji(post.member_name)}
                </span>
            </span>
        </button>
    );
};
