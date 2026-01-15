// frontend/src/components/features/BlogsFeature.tsx
import React, { useState, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { BlogMember, BlogMeta, BlogContentResponse, RecentPost } from '../../types';
import { getBlogMembers, getBlogList, getBlogContent, getRecentPosts } from '../../api/blogs';
import { useAppStore } from '../../stores/appStore';
import { RecentPostsFeed, MemberSelectGrid, MemberTimeline, BlogNavFooter, TimelineRail } from './blogs';
import { getMemberColors } from '../../data/memberColors';
import { DynamicBackground } from '../ui/DynamicBackground';
import { getThemeForService } from '../../config/groupThemes';

type ViewState =
    | { view: 'recent' }
    | { view: 'members' }
    | { view: 'timeline'; member: BlogMember }
    | { view: 'reader'; blog: BlogMeta; member: BlogMember; content: BlogContentResponse | null; fromView: 'recent' | 'timeline' };

export const BlogsFeature: React.FC = () => {
    const { activeService } = useAppStore();
    const [viewState, setViewState] = useState<ViewState>({ view: 'recent' });

    // Data states
    const [recentPosts, setRecentPosts] = useState<RecentPost[]>([]);
    const [members, setMembers] = useState<BlogMember[]>([]);
    const [blogs, setBlogs] = useState<BlogMeta[]>([]);

    // Cache states for navigation
    const [memberBlogsCache, setMemberBlogsCache] = useState<Map<string, BlogMeta[]>>(new Map());
    const [contentCache, setContentCache] = useState<Map<string, BlogContentResponse>>(new Map());

    // UI states
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset to recent view when service changes
    useEffect(() => {
        setViewState({ view: 'recent' });
        setRecentPosts([]);
        setMembers([]);
        setBlogs([]);
        setMemberBlogsCache(new Map());
        setContentCache(new Map());
        setError(null);
    }, [activeService]);

    // Load recent posts when in recent view
    useEffect(() => {
        if (viewState.view !== 'recent' || !activeService) return;

        setLoading(true);
        setError(null);
        getRecentPosts(activeService, 20)
            .then(res => setRecentPosts(res.posts))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [viewState.view, activeService]);

    // Load members when in members view
    useEffect(() => {
        if (viewState.view !== 'members' || !activeService) return;

        setLoading(true);
        setError(null);
        getBlogMembers(activeService)
            .then(res => setMembers(res.members))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [viewState.view, activeService]);

    // Load blog list when in timeline view
    useEffect(() => {
        if (viewState.view !== 'timeline' || !activeService) return;

        setLoading(true);
        setError(null);
        getBlogList(activeService, viewState.member.id)
            .then(res => setBlogs(res.blogs))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [viewState, activeService]);

    // Load member's blog list when entering reader view (for navigation)
    useEffect(() => {
        if (viewState.view !== 'reader' || !activeService) return;

        const memberId = viewState.member.id;
        // Check cache first
        if (memberBlogsCache.has(memberId)) return;

        // Fetch and cache
        getBlogList(activeService, memberId)
            .then(res => {
                setMemberBlogsCache(prev => {
                    const newCache = new Map(prev);
                    newCache.set(memberId, res.blogs);
                    return newCache;
                });
            })
            .catch(() => {
                // Silent fail - navigation just won't be available
            });
    }, [viewState, activeService, memberBlogsCache]);

    // Load content when entering reader view (with caching)
    useEffect(() => {
        if (viewState.view !== 'reader' || !activeService || viewState.content) return;

        const blogId = viewState.blog.id;

        // Check content cache first
        const cachedContent = contentCache.get(blogId);
        if (cachedContent) {
            setViewState(prev =>
                prev.view === 'reader' ? { ...prev, content: cachedContent } : prev
            );
            return;
        }

        setLoading(true);
        setError(null);
        getBlogContent(activeService, blogId)
            .then(content => {
                // Add to cache (keep last 5)
                setContentCache(prev => {
                    const newCache = new Map(prev);
                    if (newCache.size >= 5) {
                        const firstKey = newCache.keys().next().value;
                        if (firstKey) newCache.delete(firstKey);
                    }
                    newCache.set(blogId, content);
                    return newCache;
                });
                setViewState(prev =>
                    prev.view === 'reader' ? { ...prev, content } : prev
                );
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [viewState, activeService, contentCache]);

    if (!activeService) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-500">
                サービスを選択してください
            </div>
        );
    }

    // Handle navigation from recent posts to reader
    const handleSelectRecentPost = (post: RecentPost) => {
        // Convert RecentPost to BlogMeta format for reader
        const blogMeta: BlogMeta = {
            id: post.id,
            title: post.title,
            published_at: post.published_at,
            url: post.url,
            thumbnail: post.thumbnail,
            cached: false, // Will be determined when content loads
        };
        const member: BlogMember = {
            id: post.member_id,
            name: post.member_name,
        };
        setViewState({ view: 'reader', blog: blogMeta, member, content: null, fromView: 'recent' });
    };

    // Handle navigation from timeline to reader
    const handleSelectBlog = (blog: BlogMeta) => {
        if (viewState.view === 'timeline') {
            setViewState({ view: 'reader', blog, member: viewState.member, content: null, fromView: 'timeline' });
        }
    };

    // Handle back navigation
    const handleBack = () => {
        if (viewState.view === 'reader') {
            // Go back to where we came from
            if (viewState.fromView === 'timeline') {
                setViewState({ view: 'timeline', member: viewState.member });
            } else {
                setViewState({ view: 'recent' });
            }
        } else if (viewState.view === 'timeline') {
            setViewState({ view: 'members' });
        } else if (viewState.view === 'members') {
            setViewState({ view: 'recent' });
        }
    };

    // Retry handler
    const handleRetry = () => {
        setError(null);
        // Re-trigger the current view's data fetch by toggling loading
        const currentView = viewState.view;
        setViewState({ view: 'recent' });
        setTimeout(() => {
            if (currentView === 'recent') {
                setViewState({ view: 'recent' });
            } else if (currentView === 'members') {
                setViewState({ view: 'members' });
            } else if (currentView === 'timeline' && viewState.view === 'timeline') {
                setViewState({ view: 'timeline', member: viewState.member });
            }
        }, 0);
    };

    // Handle navigation within reader (prev/next/jump)
    const handleNavigateBlog = useCallback((blog: BlogMeta) => {
        if (viewState.view !== 'reader') return;
        setViewState({
            view: 'reader',
            blog,
            member: viewState.member,
            content: null, // Will be loaded by effect (or from cache)
            fromView: viewState.fromView,
        });
    }, [viewState]);

    // Get current member's blogs and current index for navigation
    const getMemberBlogsNavigation = () => {
        if (viewState.view !== 'reader') return { memberBlogs: [], currentIndex: -1 };
        const memberBlogs = memberBlogsCache.get(viewState.member.id) || [];
        const currentIndex = memberBlogs.findIndex(b => b.id === viewState.blog.id);
        return { memberBlogs, currentIndex };
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
            {/* Recent Posts Feed */}
            {viewState.view === 'recent' && (
                <RecentPostsFeed
                    posts={recentPosts}
                    loading={loading}
                    error={error}
                    onSelectPost={handleSelectRecentPost}
                    onMemberSelect={() => setViewState({ view: 'members' })}
                    onRetry={handleRetry}
                    serviceId={activeService}
                />
            )}

            {/* Member Select Grid */}
            {viewState.view === 'members' && (
                <MemberSelectGrid
                    members={members}
                    loading={loading}
                    error={error}
                    onBack={() => setViewState({ view: 'recent' })}
                    onSelectMember={(member) => setViewState({ view: 'timeline', member })}
                    onRetry={handleRetry}
                />
            )}

            {/* Member Timeline */}
            {viewState.view === 'timeline' && (
                <MemberTimeline
                    member={viewState.member}
                    blogs={blogs}
                    loading={loading}
                    error={error}
                    onBack={handleBack}
                    onSelectBlog={handleSelectBlog}
                    onRetry={handleRetry}
                />
            )}

            {/* Blog Reader */}
            {viewState.view === 'reader' && (() => {
                const { memberBlogs, currentIndex } = getMemberBlogsNavigation();
                return (
                    <BlogReader
                        content={viewState.content}
                        member={viewState.member}
                        blog={viewState.blog}
                        memberBlogs={memberBlogs}
                        currentIndex={currentIndex}
                        loading={loading}
                        error={error}
                        onBack={handleBack}
                        onRetry={handleRetry}
                        onNavigate={handleNavigateBlog}
                        serviceId={activeService}
                    />
                );
            })()}
        </div>
    );
};

// Blog Reader component with navigation
interface BlogReaderProps {
    content: BlogContentResponse | null;
    member: BlogMember;
    blog: BlogMeta;
    memberBlogs: BlogMeta[];
    currentIndex: number;
    loading: boolean;
    error: string | null;
    onBack: () => void;
    onRetry: () => void;
    onNavigate: (blog: BlogMeta) => void;
    serviceId: string | null;
}

const BlogReader: React.FC<BlogReaderProps> = ({
    content,
    member,
    blog,
    memberBlogs,
    currentIndex,
    loading,
    error,
    onBack,
    onRetry,
    onNavigate,
    serviceId,
}) => {
    // Get member colors for oshi theming
    const memberColors = getMemberColors(member.name);
    const oshiColor = memberColors?.[0] ?? '#5bbbb5';

    // Get group theme for ambient background
    const theme = getThemeForService(serviceId);

    // Navigation helpers (index 0 = newest, higher index = older)
    // "Prev" goes to older posts (higher index), "Next" goes to newer posts (lower index)
    const prevBlog = currentIndex < memberBlogs.length - 1 ? memberBlogs[currentIndex + 1] : null;
    const nextBlog = currentIndex > 0 ? memberBlogs[currentIndex - 1] : null;

    const handlePrev = () => prevBlog && onNavigate(prevBlog);
    const handleNext = () => nextBlog && onNavigate(nextBlog);
    const handleRailSelect = (index: number) => {
        if (memberBlogs[index]) onNavigate(memberBlogs[index]);
    };

    // Sanitize HTML content using DOMPurify (XSS protection)
    const sanitizedHtml = content
        ? DOMPurify.sanitize(content.content.html, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a', 'img', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li'],
            ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'target', 'rel'],
        })
        : '';

    return (
        <div className="flex flex-col h-full relative" style={{ background: theme.surface.background }}>
            {/* Ambient Dynamic Background */}
            <DynamicBackground theme={theme} />

            {/* Breadcrumb */}
            <div className="px-4 py-2 border-b border-gray-200/60 backdrop-blur-sm bg-white/70 flex items-center gap-2 text-sm shrink-0 relative z-10">
                <button
                    onClick={onBack}
                    className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
                >
                    <svg
                        className="w-4 h-4 text-gray-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 19l-7-7 7-7"
                        />
                    </svg>
                </button>
                <span style={{ color: oshiColor }}>{member.name}</span>
                <span className="text-gray-400">/</span>
                <span className="text-gray-700 truncate max-w-xs">{blog.title}</span>
            </div>

            {/* Main content area with timeline rail */}
            <div className="flex-1 flex relative overflow-hidden z-10">
                {/* Content */}
                <div className="flex-1 overflow-y-auto pb-20 bg-white/75 backdrop-blur-sm">
                    {/* Loading */}
                    {loading && (
                        <div className="flex items-center justify-center h-32">
                            <div
                                className="animate-spin rounded-full h-8 w-8 border-b-2"
                                style={{ borderColor: oshiColor }}
                            />
                        </div>
                    )}

                    {/* Error */}
                    {error && !loading && (
                        <div className="p-4 text-center">
                            <p className="text-red-600 mb-2">{error}</p>
                            <button
                                onClick={onRetry}
                                className="px-4 py-2 text-white rounded-lg"
                                style={{ backgroundColor: oshiColor }}
                            >
                                Retry
                            </button>
                        </div>
                    )}

                    {/* Blog Content */}
                    {!loading && !error && content && (
                        <article className="max-w-3xl mx-auto px-4 py-6 pr-16">
                            <header className="mb-6">
                                <h1
                                    className="text-2xl font-bold text-gray-900 mb-2"
                                    style={{ fontFamily: '"Noto Serif JP", serif' }}
                                >
                                    {content.meta.title}
                                </h1>
                                <div className="flex items-center gap-3 text-sm text-gray-500">
                                    <span style={{ color: oshiColor }}>
                                        {content.meta.member_name}
                                    </span>
                                    <span>-</span>
                                    <time>
                                        {new Date(content.meta.published_at).toLocaleDateString('ja-JP', {
                                            year: 'numeric',
                                            month: 'long',
                                            day: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                    </time>
                                </div>
                            </header>

                            {/* Blog content - sanitized HTML rendered safely */}
                            <div
                                className="prose prose-sm max-w-none [&_img]:max-w-full [&_img]:h-auto"
                                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                            />

                            {/* External link */}
                            <footer className="mt-8 pt-4 border-t border-gray-200">
                                <a
                                    href={content.meta.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:underline text-sm"
                                    style={{ color: oshiColor }}
                                >
                                    View original post →
                                </a>
                            </footer>
                        </article>
                    )}
                </div>

                {/* Timeline Rail */}
                {memberBlogs.length > 1 && (
                    <TimelineRail
                        blogs={memberBlogs}
                        currentIndex={currentIndex}
                        oshiColor={oshiColor}
                        onSelect={handleRailSelect}
                    />
                )}

                {/* Navigation Footer */}
                <BlogNavFooter
                    prevBlog={prevBlog}
                    nextBlog={nextBlog}
                    onPrev={handlePrev}
                    onNext={handleNext}
                />
            </div>
        </div>
    );
};
