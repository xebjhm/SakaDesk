// frontend/src/features/blogs/components/RecentPostsFeed.tsx
// Latest posts of the active service: the group's expressive orbs behind a frosted header and a card grid.
import React, { useMemo } from 'react';
import { AlertCircle, Heart, Newspaper, RefreshCw, Users } from 'lucide-react';
import type { RecentPost } from '../../../types';
import { BlogCard } from './BlogCard';
import { BlogStatus } from './BlogStatus';
import { DynamicBackground } from '../../../core/common/DynamicBackground';
import { Button, Pill } from '../../../design/primitives';
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

    const handleModeChange = (mode: BlogSelectionMode) => {
        setBlogSelectionMode(effectiveServiceId, mode);
    };

    return (
        <section aria-labelledby="blogs-feed-title" className="relative flex h-full min-h-0 flex-col">
            {/* Expressive orbs (L2 atmosphere); the frosted header and the grid sit above them */}
            <DynamicBackground />

            <header className="relative z-10 flex shrink-0 items-center justify-between gap-4 bg-frost px-6 pb-3 pt-5 backdrop-blur-lg">
                <div className="flex min-w-0 items-baseline gap-3">
                    <h2 id="blogs-feed-title" className="font-reading text-heading font-semibold text-group-title">
                        {t('blogs.latestBlogs')}
                    </h2>
                    {syncing && (
                        <span role="status" className="flex items-center gap-1 text-caption text-muted">
                            <RefreshCw aria-hidden="true" className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                            {t('blogs.checkingUpdates')}
                        </span>
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-3">
                    <div role="group" aria-label={t('blogs.postsFrom')} className="flex items-center gap-1">
                        <Pill selected={selectionMode === 'all'} onClick={() => handleModeChange('all')}>
                            {t('blogs.all')}
                        </Pill>
                        <Pill tone="oshi" selected={selectionMode === 'favorite'} onClick={() => handleModeChange('favorite')}>
                            <Heart aria-hidden="true" className="h-3 w-3" fill="currentColor" />
                            {t('blogs.favorite')}
                        </Pill>
                    </div>
                    <Button
                        variant="tonal"
                        size="sm"
                        className="hover:bg-accent-gradient hover:text-inverse hover:shadow-accent-glow-hover"
                        onClick={onMemberSelect}
                    >
                        <Users aria-hidden="true" className="h-4 w-4" />
                        {t('blogs.selectMember')}
                    </Button>
                </div>
            </header>

            <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                {loading && <BlogStatus kind="loading" title={t('blogs.loadingPosts')} />}

                {error && !loading && (
                    <BlogStatus
                        kind="error"
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
                    <BlogStatus kind="loading" fill title={t('blogs.syncingBlogs')} hint={t('blogs.firstSyncHint')} />
                )}

                {!loading && !error && posts.length === 0 && !syncing && (
                    <BlogStatus
                        kind="empty"
                        icon={selectionMode === 'favorite' ? <Heart className="h-10 w-10 text-semantic-oshi" /> : <Newspaper className="h-10 w-10" />}
                        title={selectionMode === 'favorite' ? t('blogs.noPostsFromFavorites') : t('blogs.noBlogPostsFound')}
                        hint={selectionMode === 'favorite' ? t('blogs.addMembersHint') : t('blogs.selectServiceHint')}
                    />
                )}
            </div>
        </section>
    );
};
