// frontend/src/features/blogs/components/RecentPostsFeed.tsx
// Latest posts of the active service: the group's expressive orbs behind a frosted header and a card grid.
import React, { useMemo, useRef } from 'react';
import { AlertCircle, Heart, Newspaper, Users } from 'lucide-react';
import type { RecentPost } from '../../../types';
import { BlogCard } from './BlogCard';
import { DynamicBackground } from '../../../core/common/DynamicBackground';
import { Button, Spinner, StatusBlock } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { useAppStore } from '../../../store/appStore';
import type { BlogSelectionMode } from '../../../store/appStore';
import { useTranslation } from '../../../i18n';

interface RecentPostsFeedProps {
    posts: RecentPost[];
    loading: boolean;
    error: string | null;
    syncing?: boolean;
    knownPostIds?: Set<string>;
    onSelectPost: (post: RecentPost) => void;
    onMemberSelect: () => void;
    onRetry: () => void;
    serviceId?: string | null;
}

/**
 * One segment of the feed's All / Favorite control (e4e4118: "padding: 6px 14px", "font-size: 0.75rem",
 * muted text that turns secondary on hover; the selected one a white pill with "0 1px 3px" shadow and
 * the 推 pink "#ff69b4", here the semantic oshi colour since this is the favourite filter).
 */
const FeedModeSegment: React.FC<{ selected: boolean; onClick: () => void; children: React.ReactNode }> = ({
    selected,
    onClick,
    children,
}) => (
    <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className={cn(
            'inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-segment font-medium',
            'transition-colors duration-base ease-standard motion-reduce:transition-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            selected ? 'bg-pill text-semantic-oshi shadow-segment' : 'bg-transparent text-secondary hover:text-primary',
        )}
    >
        {children}
    </button>
);

// Determine which posts should be "hero" (2x2) cards
function getHeroIndices(totalPosts: number): Set<number> {
    const heroes = new Set<number>();
    if (totalPosts > 0) heroes.add(0);
    if (totalPosts > 5) heroes.add(5);
    if (totalPosts > 11) heroes.add(11);
    return heroes;
}

export const RecentPostsFeed: React.FC<RecentPostsFeedProps> = ({
    posts,
    loading,
    error,
    syncing = false,
    knownPostIds,
    onSelectPost,
    onMemberSelect,
    onRetry,
    serviceId = null,
}) => {
    // Use serviceId even if empty string - the store handles it gracefully
    const effectiveServiceId = serviceId || 'default';
    // Direct property access for proper Zustand reactivity (don't use method call)
    const selectionMode = useAppStore((state) => state.blogSelectionModes[effectiveServiceId] ?? 'all');
    const setBlogSelectionMode = useAppStore((state) => state.setBlogSelectionMode);
    const heroIndices = useMemo(() => getHeroIndices(posts.length), [posts.length]);
    const { t } = useTranslation();

    const scrollerRef = useRef<HTMLDivElement>(null);

    const handleModeChange = (mode: BlogSelectionMode) => {
        // Clicking the pill that is already active changes nothing: keep the reader's place.
        if (mode === selectionMode) return;
        // A different filter is a different list: start at its top, not at the old offset.
        if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
        setBlogSelectionMode(effectiveServiceId, mode);
    };

    return (
        <section aria-labelledby="blogs-feed-title" className="relative flex h-full min-h-0 flex-col">
            {/* Expressive orbs (L2 atmosphere); the frosted header and the grid sit above them */}
            <DynamicBackground />

            <header className="relative z-10 flex shrink-0 items-center justify-between gap-4 border-b border-frost bg-frost px-6 pb-3 pt-5 backdrop-blur-frost backdrop-saturate-180">
                <div className="flex min-w-0 items-baseline gap-3">
                    <h2 id="blogs-feed-title" className="font-reading text-heading font-semibold text-accent-strong">
                        {t('blogs.latestBlogs')}
                    </h2>
                    {syncing && (
                        <span role="status" className="flex items-center gap-1 text-caption text-muted">
                            <Spinner size="sm" tone="current" decorative />
                            {t('blogs.checkingUpdates')}
                        </span>
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-3">
                    {/* e4e4118's segmented control: one grey track ("padding: 3px", "gap: 2px",
                        "rgba(0, 0, 0, 0.05)"); p-0.5 plus a transparent 1 px border makes the 3 px inset. */}
                    <div
                        role="group"
                        aria-label={t('blogs.postsFrom')}
                        className="inline-flex items-center gap-0.5 rounded-full border border-transparent bg-segment-track p-0.5"
                    >
                        <FeedModeSegment selected={selectionMode === 'all'} onClick={() => handleModeChange('all')}>
                            {t('blogs.all')}
                        </FeedModeSegment>
                        <FeedModeSegment selected={selectionMode === 'favorite'} onClick={() => handleModeChange('favorite')}>
                            <Heart
                                aria-hidden="true"
                                className={cn('h-3.5 w-3.5', selectionMode === 'favorite' && 'text-semantic-oshi-solid')}
                                fill="currentColor"
                            />
                            {t('blogs.favorite')}
                        </FeedModeSegment>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="border border-accent-wash bg-accent-wash text-secondary hover:bg-accent-gradient hover:text-inverse hover:shadow-accent-glow-hover"
                        onClick={onMemberSelect}
                    >
                        <Users aria-hidden="true" className="h-4 w-4" />
                        {t('blogs.selectMember')}
                    </Button>
                </div>
            </header>

            <div ref={scrollerRef} data-testid="feed-scroller" className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                {loading && <StatusBlock kind="loading" variant="block" surface="blog_feed" label={t('blogs.loadingPosts')} />}

                {error && !loading && (
                    <StatusBlock
                        kind="error"
                        variant="block"
                        surface="blog_feed"
                        retryVariant="primary"
                        icon={<AlertCircle className="h-8 w-8" />}
                        title={t('blogs.feedLoadFailed')}
                        onRetry={onRetry}
                        retryLabel={t('blogs.retry')}
                    />
                )}

                {!loading && !error && posts.length > 0 && (
                    <div className="grid auto-rows-fr grid-flow-dense grid-cols-2 gap-4 p-6 min-[641px]:grid-cols-3 min-[641px]:gap-5 min-[901px]:grid-cols-4 min-[1201px]:grid-cols-5 min-[1201px]:gap-6">
                        {posts.map((post, index) => {
                            const isHero = heroIndices.has(index);
                            const isNew = knownPostIds && knownPostIds.size > 0 && !knownPostIds.has(post.id);
                            // Known posts (or initial load): sequential stagger delay
                            // New posts (from background sync): random delay for a "light up" effect
                            const delay = isNew ? Math.random() * 400 : index * 50;
                            return (
                                <div
                                    key={post.id}
                                    className={cn('animate-reveal motion-reduce:animate-none', isHero && 'col-span-2 row-span-2')}
                                    style={{ animationDelay: `${delay}ms` }}
                                >
                                    <BlogCard
                                        post={post}
                                        onClick={() => onSelectPost(post)}
                                        size={isHero ? 'featured' : 'normal'}
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* First sync: no posts yet and the background sync is running */}
                {!loading && !error && posts.length === 0 && syncing && (
                    <StatusBlock kind="loading" variant="fill" surface="blog_feed" label={t('blogs.syncingBlogs')} slowHint={t('blogs.firstSyncHint')} />
                )}

                {!loading && !error && posts.length === 0 && !syncing && (
                    <StatusBlock
                        kind="empty"
                        variant="block"
                        surface="blog_feed"
                        icon={selectionMode === 'favorite' ? <Heart className="h-10 w-10 text-semantic-oshi" /> : <Newspaper className="h-10 w-10" />}
                        title={selectionMode === 'favorite' ? t('blogs.noPostsFromFavorites') : t('blogs.noBlogPostsFound')}
                        hint={selectionMode === 'favorite' ? t('blogs.addMembersHint') : t('blogs.selectServiceHint')}
                    />
                )}
            </div>
        </section>
    );
};
