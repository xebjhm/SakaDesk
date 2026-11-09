// frontend/src/features/blogs/components/BlogCard.tsx
// A post in the recent feed, in its original (e4e4118) layout: the photo tile fills the card and
// a small frosted caption card floats over its bottom-right corner, deliberately offset past the
// photo edge (e4e4118: "bottom/right -8px", featured "-12px").
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
    // e4e4118 values are quoted where a token stands in for them.
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                // e4e4118: "-translate-y-1.5" on hover, "transition-transform duration-500 ease-out".
                'group relative isolate block aspect-[3/4] w-full cursor-pointer text-left',
                // Reduced motion: the hover look (aura, glows) stays, nothing moves.
                'transition-transform duration-lift ease-out hover:-translate-y-1.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                'focus-visible:outline-none',
            )}
        >
            {/* The hover aura behind the tile (e4e4118: "-inset-3 rounded-3xl", "blur(24px)", logo 30 → action 15 hex alpha). */}
            <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-3 -z-10 rounded-xl bg-accent-aura opacity-0 blur-xl transition-opacity duration-lift group-hover:opacity-100 motion-reduce:transition-none"
            />

            {/* The photo tile (e4e4118: "rounded-xl", featured "rounded-2xl"; "0 6px 24px -6px" at rest). */}
            <span
                data-testid="blog-card-tile"
                className={cn(
                    'absolute inset-0 block overflow-hidden bg-accent-tile shadow-tile',
                    'transition-shadow duration-lift group-hover:shadow-tile-hover motion-reduce:transition-none',
                    isFeatured ? 'rounded-lg' : 'rounded-md',
                )}
            >
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
                            // e4e4118: "transition-all duration-700 ease-out", "scale-105" on hover.
                            'absolute inset-0 h-full w-full object-cover object-top',
                            'transition duration-zoom ease-out group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100',
                            imageLoaded ? 'opacity-100' : 'opacity-0',
                        )}
                    />
                )}
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-tile-vignette" />
                <span
                    aria-hidden="true"
                    className={cn(
                        'pointer-events-none absolute inset-0 opacity-0 ring-2 ring-inset ring-accent transition-opacity group-focus-visible:opacity-100',
                        isFeatured ? 'rounded-lg' : 'rounded-md',
                    )}
                />
            </span>

            {/* The caption card (e4e4118: padding "8px 10px" / "12px 14px", radius "8px" / "12px",
                min/max width "95px"/"150px" and "130px"/"200px"; it nudges up-left by "4px" on hover). */}
            <span
                data-testid="blog-card-caption"
                className={cn(
                    'absolute z-20 block border border-tile-glass bg-tile-glass text-left shadow-caption backdrop-blur-lg backdrop-saturate-180',
                    'transition-caption group-hover:-translate-x-1 group-hover:-translate-y-1 group-hover:shadow-caption-hover',
                    'motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:translate-y-0',
                    isFeatured
                        ? '-bottom-3 -right-3 min-w-[130px] max-w-[200px] rounded-md px-3.5 py-3'
                        : '-bottom-2 -right-2 min-w-[95px] max-w-[150px] rounded-sm px-2.5 py-2',
                )}
            >
                <span className={cn('block font-medium uppercase tracking-wider text-muted', isFeatured ? 'mb-1 text-tile-date-lg' : 'mb-0.5 text-tile-date')}>
                    {formatBlogDate(new Date(post.published_at), i18n.language, 'short')}
                </span>
                <span
                    lang="ja"
                    className={cn(
                        'line-clamp-2 font-reading text-primary',
                        isFeatured ? 'text-tile-title-lg font-medium' : 'text-tile-title font-semibold',
                        // After the size: tailwind-merge drops a leading that precedes a font size.
                        'leading-snug',
                    )}
                >
                    {post.title}
                </span>
                <span
                    lang="ja"
                    className={cn(
                        'block truncate font-semibold tracking-wide text-accent-strong',
                        isFeatured ? 'mt-1.5 text-tile-name-lg' : 'mt-1 text-tile-name',
                    )}
                >
                    {getMemberNameKanji(post.member_name)}
                </span>
            </span>
        </button>
    );
};
