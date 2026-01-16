// frontend/src/components/features/blogs/RecentPostsFeed.tsx
// Portrait Gallery Feed - Multi-group themed with dynamic ambient background
import React, { useMemo } from 'react';
import { RecentPost } from '../../../types';
import { BlogCard } from './BlogCard';
import { DynamicBackground } from '../../ui/DynamicBackground';
import { getThemeForService } from '../../../config/groupThemes';
import { useAppStore, BlogSelectionMode } from '../../../stores/appStore';

interface RecentPostsFeedProps {
    posts: RecentPost[];
    loading: boolean;
    error: string | null;
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
    onSelectPost,
    onMemberSelect,
    onRetry,
    serviceId = null,
}) => {
    // Get selection mode from store for toggle UI state
    // Use serviceId even if empty string - the store handles it gracefully
    const effectiveServiceId = serviceId || 'default';
    // Direct property access for proper Zustand reactivity (don't use method call)
    const selectionMode = useAppStore((state) => state.blogSelectionModes[effectiveServiceId] ?? 'all');
    const setBlogSelectionMode = useAppStore((state) => state.setBlogSelectionMode);

    // Posts are already filtered by the API based on selectionMode - use directly
    const heroIndices = useMemo(() => getHeroIndices(posts.length), [posts.length]);
    const theme = useMemo(() => getThemeForService(serviceId), [serviceId]);

    const handleModeChange = (mode: BlogSelectionMode) => {
        setBlogSelectionMode(effectiveServiceId, mode);
    };

    return (
        <div className="feed-container" style={{ background: theme.surface.background }}>
            {/* Ambient Dynamic Background */}
            <DynamicBackground theme={theme} />

            {/* Glass Header */}
            <header className="feed-header">
                <div className="feed-header__inner">
                    <div className="feed-header__titles">
                        <h2 className="feed-header__main">Latest Blogs</h2>
                    </div>

                    <div className="feed-header__actions">
                        {/* All/Favorite Toggle */}
                        <div className="feed-mode-toggle">
                            <button
                                onClick={() => handleModeChange('all')}
                                className={`feed-mode-toggle__btn ${selectionMode === 'all' ? 'feed-mode-toggle__btn--active' : ''}`}
                            >
                                All
                            </button>
                            <button
                                onClick={() => handleModeChange('favorite')}
                                className={`feed-mode-toggle__btn ${selectionMode === 'favorite' ? 'feed-mode-toggle__btn--active' : ''}`}
                            >
                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                </svg>
                                Favorite
                            </button>
                        </div>

                        {/* Member Select Button */}
                        <button
                            onClick={onMemberSelect}
                            className="feed-header__btn"
                            style={{
                                background: `linear-gradient(135deg, ${theme.primaryColor}15 0%, ${theme.secondaryColor}10 100%)`,
                                borderColor: `${theme.primaryColor}30`,
                            }}
                        >
                            <div
                                className="feed-header__btn-bg"
                                style={{ background: theme.interaction.buttonGradient }}
                            />
                            <span className="feed-header__btn-text">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                </svg>
                                Select Member
                            </span>
                        </button>
                    </div>
                </div>
            </header>

            {/* Content Area */}
            <main className="feed-content">
                {/* Loading State */}
                {loading && (
                    <div className="feed-state">
                        <div className="feed-spinner">
                            <div
                                className="feed-spinner__ring"
                                style={{ background: `conic-gradient(from 0deg, transparent, ${theme.primaryColor})` }}
                            />
                            <div className="feed-spinner__center" />
                        </div>
                        <span className="feed-state__text">Loading posts...</span>
                    </div>
                )}

                {/* Error State */}
                {error && !loading && (
                    <div className="feed-state">
                        <div className="feed-state__icon feed-state__icon--error">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <p className="feed-state__text">{error}</p>
                        <button
                            onClick={onRetry}
                            className="feed-state__retry"
                            style={{ background: theme.interaction.buttonGradient }}
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Portrait Gallery Grid */}
                {!loading && !error && posts.length > 0 && (
                    <div className="portrait-gallery">
                        <div className="portrait-grid">
                            {posts.map((post, index) => {
                                const isHero = heroIndices.has(index);
                                return (
                                    <div
                                        key={post.id}
                                        className={`portrait-grid__item animate-card-reveal ${isHero ? 'portrait-grid__item--hero' : ''}`}
                                        style={{ animationDelay: `${index * 50}ms` }}
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
                    </div>
                )}

                {/* Empty State */}
                {!loading && !error && posts.length === 0 && (
                    <div className="feed-state">
                        <div
                            className="feed-state__icon"
                            style={{
                                background: `linear-gradient(135deg, ${theme.primaryColor}12 0%, ${theme.secondaryColor}08 100%)`,
                                borderColor: `${theme.primaryColor}20`,
                            }}
                        >
                            {selectionMode === 'favorite' ? (
                                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                </svg>
                            ) : (
                                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                                </svg>
                            )}
                        </div>
                        <p className="feed-state__text">
                            {selectionMode === 'favorite'
                                ? 'No posts from favorite members'
                                : 'No blog posts found'}
                        </p>
                        <p className="feed-state__hint">
                            {selectionMode === 'favorite'
                                ? 'Add members to favorites to see their posts here'
                                : 'Select a service and sync to load blogs'}
                        </p>
                    </div>
                )}
            </main>

            {/* Styles */}
            <style>{`
                /* ========================================
                   FEED CONTAINER
                   ======================================== */
                @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;500;600;700&display=swap');

                .feed-container {
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    overflow: hidden;
                }

                /* ========================================
                   HEADER - Glass morphism
                   ======================================== */
                .feed-header {
                    position: relative;
                    z-index: 10;
                    flex-shrink: 0;
                }

                .feed-header__inner {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 18px 24px;
                    background: rgba(255, 255, 255, 0.72);
                    backdrop-filter: blur(20px) saturate(180%);
                    -webkit-backdrop-filter: blur(20px) saturate(180%);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.4);
                }

                .feed-header__titles {
                    display: flex;
                    align-items: baseline;
                    gap: 12px;
                }

                .feed-header__main {
                    font-family: "Noto Serif JP", "Yu Mincho", serif;
                    font-size: 1.4rem;
                    font-weight: 600;
                    color: #5d95ae;
                    letter-spacing: 0.02em;
                    margin: 0;
                }

                .feed-header__sub {
                    font-size: 0.65rem;
                    font-weight: 500;
                    color: ${theme.text.muted};
                    letter-spacing: 0.12em;
                    text-transform: uppercase;
                }

                .feed-header__btn {
                    position: relative;
                    padding: 10px 18px;
                    border-radius: 9999px;
                    font-size: 0.85rem;
                    font-weight: 500;
                    border: 1px solid;
                    cursor: pointer;
                    overflow: hidden;
                    transition: all 0.3s ease;
                }

                .feed-header__btn:hover {
                    box-shadow: 0 4px 20px ${theme.interaction.hoverGlow};
                }

                .feed-header__btn-bg {
                    position: absolute;
                    inset: 0;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                }

                .feed-header__btn:hover .feed-header__btn-bg {
                    opacity: 1;
                }

                .feed-header__btn-text {
                    position: relative;
                    z-index: 1;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: ${theme.text.secondary};
                    transition: color 0.3s ease;
                }

                .feed-header__btn:hover .feed-header__btn-text {
                    color: white;
                }

                .feed-header__actions {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                /* ========================================
                   MODE TOGGLE - All/Favorite
                   ======================================== */
                .feed-mode-toggle {
                    display: flex;
                    align-items: center;
                    gap: 2px;
                    padding: 3px;
                    background: rgba(0, 0, 0, 0.05);
                    border-radius: 9999px;
                }

                .feed-mode-toggle__btn {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    padding: 6px 14px;
                    border-radius: 9999px;
                    font-size: 0.75rem;
                    font-weight: 500;
                    color: ${theme.text.muted};
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .feed-mode-toggle__btn:hover {
                    color: ${theme.text.secondary};
                }

                .feed-mode-toggle__btn--active {
                    background: white;
                    color: #ff69b4;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
                }

                .feed-mode-toggle__btn--active:hover {
                    color: #ff69b4;
                }

                /* ========================================
                   CONTENT AREA
                   ======================================== */
                .feed-content {
                    position: relative;
                    z-index: 1;
                    flex: 1;
                    overflow-y: auto;
                    overflow-x: hidden;
                }

                .portrait-gallery {
                    padding: 24px;
                    padding-right: 32px;
                }

                /* ========================================
                   STATES (Loading, Error, Empty)
                   ======================================== */
                .feed-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 280px;
                    gap: 16px;
                    padding: 24px;
                }

                .feed-spinner {
                    position: relative;
                    width: 44px;
                    height: 44px;
                }

                .feed-spinner__ring {
                    position: absolute;
                    inset: 0;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }

                .feed-spinner__center {
                    position: absolute;
                    inset: 4px;
                    border-radius: 50%;
                    background: white;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }

                .feed-state__icon {
                    padding: 20px;
                    border-radius: 20px;
                    background: linear-gradient(135deg, ${theme.primaryColor}10 0%, ${theme.secondaryColor}08 100%);
                    border: 1px solid ${theme.primaryColor}18;
                    color: #c4c4c4;
                }

                .feed-state__icon--error {
                    background: rgba(239, 68, 68, 0.08);
                    border-color: rgba(239, 68, 68, 0.15);
                    color: #f87171;
                }

                .feed-state__text {
                    font-size: 0.875rem;
                    color: ${theme.text.secondary};
                    text-align: center;
                    margin: 0;
                }

                .feed-state__hint {
                    font-size: 0.8rem;
                    color: ${theme.text.muted};
                    margin: 0;
                }

                .feed-state__retry {
                    padding: 10px 24px;
                    border-radius: 9999px;
                    color: white;
                    font-weight: 500;
                    border: none;
                    cursor: pointer;
                    box-shadow: 0 4px 15px ${theme.interaction.hoverGlow};
                    transition: transform 0.3s ease;
                }

                .feed-state__retry:hover {
                    transform: scale(1.05);
                }

                /* ========================================
                   PORTRAIT GRID - Bento layout
                   ======================================== */
                .portrait-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
                    grid-auto-rows: 1fr;
                    grid-auto-flow: dense;
                    gap: 20px;
                }

                .portrait-grid__item {
                    overflow: visible;
                }

                .portrait-grid__item--hero {
                    grid-column: span 2;
                    grid-row: span 2;
                }

                /* Card reveal animation */
                @keyframes card-reveal {
                    from {
                        opacity: 0;
                        transform: translateY(20px) scale(0.97);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }

                .animate-card-reveal {
                    animation: card-reveal 0.45s cubic-bezier(0.4, 0, 0.2, 1) backwards;
                }

                /* Responsive */
                @media (max-width: 640px) {
                    .portrait-grid {
                        grid-template-columns: repeat(2, 1fr);
                        gap: 16px;
                    }
                    .portrait-gallery {
                        padding: 16px;
                        padding-right: 20px;
                    }
                    .feed-header__inner {
                        padding: 14px 16px;
                    }
                    .feed-header__main {
                        font-size: 1.2rem;
                    }
                }

                @media (min-width: 641px) and (max-width: 900px) {
                    .portrait-grid {
                        grid-template-columns: repeat(3, 1fr);
                    }
                }

                @media (min-width: 901px) and (max-width: 1200px) {
                    .portrait-grid {
                        grid-template-columns: repeat(4, 1fr);
                    }
                }

                @media (min-width: 1201px) {
                    .portrait-grid {
                        grid-template-columns: repeat(5, 1fr);
                        gap: 24px;
                    }
                }

                /* Reduced motion */
                @media (prefers-reduced-motion: reduce) {
                    .animate-card-reveal {
                        animation: none;
                    }
                }
            `}</style>
        </div>
    );
};
