// frontend/src/components/features/BlogsFeature.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { BlogMember, BlogMeta, BlogContentResponse, RecentPost, BlogMemberWithThumbnail } from '../../types';
import { getBlogMembersWithThumbnails, getBlogList, getBlogContent, getRecentPosts } from '../../api/blogs';
import { useAppStore } from '../../stores/appStore';
import { RecentPostsFeed, BlogNavFooter, TimelineRail, MemberTimelineModal } from './blogs';
import { MemberSelectModal } from './blogs/MemberSelectModal';
import { getMemberColors, getMemberNameJp } from '../../data/memberColors';

type ViewState =
    | { view: 'recent' }
    | { view: 'reader'; blog: BlogMeta; member: BlogMember; content: BlogContentResponse | null; fromView: 'recent' | 'timeline' };

// Stable empty array to avoid creating new references
const EMPTY_FAVORITES: string[] = [];

// Hardcoded mascot member (ポカ) - backend may not return this
const POKA_MEMBER: BlogMemberWithThumbnail = {
    id: '000',
    name: 'ポカ',
    thumbnail: null, // Will use fallback/placeholder
};

export const BlogsFeature: React.FC = () => {
    const activeService = useAppStore((state) => state.activeService);
    const favorites = useAppStore((state) => state.favorites[activeService ?? ''] || EMPTY_FAVORITES);
    // Get selection mode for API fetching - when 'favorite', fetch only from favorited members
    const selectionMode = useAppStore((state) => state.blogSelectionModes[activeService ?? ''] ?? 'all');
    // Watch for blog view reset trigger (when user clicks blog icon in feature rail)
    const blogViewResetCounter = useAppStore((state) => state.blogViewResetCounter);

    // Stable key for favorites to prevent unnecessary re-fetches
    const favoritesKey = useMemo(() => favorites.join(','), [favorites]);

    const [viewState, setViewState] = useState<ViewState>({ view: 'recent' });

    // Modal state for member selection
    const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
    const [membersWithThumbnails, setMembersWithThumbnails] = useState<BlogMemberWithThumbnail[]>([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [membersError, setMembersError] = useState<string | null>(null);

    // Modal state for member timeline
    const [isTimelineModalOpen, setIsTimelineModalOpen] = useState(false);
    const [timelineMember, setTimelineMember] = useState<BlogMember | null>(null);
    const [timelineBlogs, setTimelineBlogs] = useState<BlogMeta[]>([]);
    const [timelineLoading, setTimelineLoading] = useState(false);
    const [timelineError, setTimelineError] = useState<string | null>(null);

    // Data states
    const [recentPosts, setRecentPosts] = useState<RecentPost[]>([]);

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
        setMemberBlogsCache(new Map());
        setContentCache(new Map());
        setError(null);
        setMembersWithThumbnails([]);
        setMembersError(null);
        // Reset timeline modal state
        setIsTimelineModalOpen(false);
        setTimelineMember(null);
        setTimelineBlogs([]);
        setTimelineError(null);
    }, [activeService]);

    // Reset to recent view when blog icon is clicked in feature rail
    useEffect(() => {
        if (blogViewResetCounter > 0) {
            setViewState({ view: 'recent' });
            setIsTimelineModalOpen(false);
            setIsMemberModalOpen(false);
        }
    }, [blogViewResetCounter]);

    // Load recent posts when in recent view
    // When selectionMode is 'favorite', fetch 20 latest posts from favorited members only
    // When selectionMode is 'all', fetch 20 latest posts from all members
    useEffect(() => {
        if (viewState.view !== 'recent' || !activeService) return;

        // Determine member IDs to fetch - use favorites when in favorite mode
        const memberIds = selectionMode === 'favorite' && favorites.length > 0
            ? favorites
            : undefined;

        setLoading(true);
        setError(null);
        getRecentPosts(activeService, 20, memberIds)
            .then(res => setRecentPosts(res.posts))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [viewState.view, activeService, selectionMode, favoritesKey]);

    // Load members when modal opens
    useEffect(() => {
        if (!isMemberModalOpen || !activeService) return;
        // Skip if we already have members loaded
        if (membersWithThumbnails.length > 0) return;

        setMembersLoading(true);
        setMembersError(null);
        getBlogMembersWithThumbnails(activeService)
            .then(res => {
                let members = res.members;
                // Add ポカ (mascot) if not already in the list - only for hinatazaka
                if (activeService.toLowerCase().includes('hinata')) {
                    const hasPokaId = members.some(m => m.id === '000');
                    const hasPokaName = members.some(m => m.name === 'ポカ');
                    if (!hasPokaId && !hasPokaName) {
                        members = [...members, POKA_MEMBER];
                    }
                }
                setMembersWithThumbnails(members);
            })
            .catch(e => setMembersError(e.message))
            .finally(() => setMembersLoading(false));
    }, [isMemberModalOpen, activeService, membersWithThumbnails.length]);

    // Load blog list when timeline modal opens
    useEffect(() => {
        if (!isTimelineModalOpen || !timelineMember || !activeService) return;

        setTimelineLoading(true);
        setTimelineError(null);
        getBlogList(activeService, timelineMember.id)
            .then(res => setTimelineBlogs(res.blogs))
            .catch(e => setTimelineError(e.message))
            .finally(() => setTimelineLoading(false));
    }, [isTimelineModalOpen, timelineMember, activeService]);

    // Refs to access caches without adding them to effect dependencies
    const memberBlogsCacheRef = React.useRef(memberBlogsCache);
    memberBlogsCacheRef.current = memberBlogsCache;
    const contentCacheRef = React.useRef(contentCache);
    contentCacheRef.current = contentCache;

    // Track which blog IDs we've already started fetching to prevent duplicate requests
    const fetchingMemberBlogsRef = React.useRef<Set<string>>(new Set());
    const fetchingContentRef = React.useRef<Set<string>>(new Set());

    // Load member's blog list when entering reader view (for navigation)
    useEffect(() => {
        if (viewState.view !== 'reader' || !activeService) return;

        const memberId = viewState.member.id;

        // Check cache first (via ref)
        if (memberBlogsCacheRef.current.has(memberId)) return;

        // Check if already fetching
        if (fetchingMemberBlogsRef.current.has(memberId)) return;
        fetchingMemberBlogsRef.current.add(memberId);

        // Fetch and cache
        getBlogList(activeService, memberId)
            .then(res => {
                setMemberBlogsCache(cache => {
                    const newCache = new Map(cache);
                    newCache.set(memberId, res.blogs);
                    return newCache;
                });
            })
            .catch(() => {
                // Silent fail - navigation just won't be available
            })
            .finally(() => {
                fetchingMemberBlogsRef.current.delete(memberId);
            });
    }, [viewState, activeService]);

    // Load content when entering reader view (with caching)
    useEffect(() => {
        if (viewState.view !== 'reader' || !activeService || viewState.content) return;

        const blogId = viewState.blog.id;

        // Check content cache first (via ref)
        const cachedContent = contentCacheRef.current.get(blogId);
        if (cachedContent) {
            setViewState(prev =>
                prev.view === 'reader' && !prev.content ? { ...prev, content: cachedContent } : prev
            );
            return;
        }

        // Check if already fetching
        if (fetchingContentRef.current.has(blogId)) return;
        fetchingContentRef.current.add(blogId);

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
                    prev.view === 'reader' && !prev.content ? { ...prev, content } : prev
                );
            })
            .catch(e => setError(e.message))
            .finally(() => {
                setLoading(false);
                fetchingContentRef.current.delete(blogId);
            });
    }, [viewState, activeService]);

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

    // Handle navigation from timeline modal to reader
    const handleSelectBlogFromTimeline = (blog: BlogMeta) => {
        if (timelineMember) {
            setIsTimelineModalOpen(false);
            setViewState({ view: 'reader', blog, member: timelineMember, content: null, fromView: 'timeline' });
        }
    };

    // Handle back navigation
    const handleBack = () => {
        if (viewState.view === 'reader') {
            // Go back to where we came from
            if (viewState.fromView === 'timeline') {
                // Re-open the timeline modal for the same member
                setTimelineMember(viewState.member);
                setIsTimelineModalOpen(true);
            }
            setViewState({ view: 'recent' });
        }
    };

    // Handle member selection from modal - opens timeline modal
    const handleMemberSelect = (member: BlogMemberWithThumbnail) => {
        setIsMemberModalOpen(false);
        setTimelineMember({ id: member.id, name: member.name });
        setTimelineBlogs([]); // Reset blogs for new member
        setIsTimelineModalOpen(true);
    };

    // Handle members retry
    const handleMembersRetry = () => {
        setMembersError(null);
        setMembersWithThumbnails([]);
        // Will trigger re-fetch via effect
    };

    // Handle timeline retry
    const handleTimelineRetry = () => {
        setTimelineError(null);
        setTimelineBlogs([]);
        // Will trigger re-fetch via effect
    };

    // Retry handler for main content
    const handleRetry = () => {
        setError(null);
        // Re-trigger the current view's data fetch by toggling loading
        setViewState({ view: 'recent' });
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
            {/* Member Select Modal */}
            <MemberSelectModal
                isOpen={isMemberModalOpen}
                onClose={() => setIsMemberModalOpen(false)}
                members={membersWithThumbnails}
                loading={membersLoading}
                error={membersError}
                onSelectMember={handleMemberSelect}
                onRetry={handleMembersRetry}
                serviceId={activeService ?? ''}
            />

            {/* Member Timeline Modal */}
            {timelineMember && (
                <MemberTimelineModal
                    isOpen={isTimelineModalOpen}
                    onClose={() => setIsTimelineModalOpen(false)}
                    member={timelineMember}
                    blogs={timelineBlogs}
                    loading={timelineLoading}
                    error={timelineError}
                    onSelectBlog={handleSelectBlogFromTimeline}
                    onRetry={handleTimelineRetry}
                />
            )}

            {/* Recent Posts Feed */}
            {viewState.view === 'recent' && (
                <RecentPostsFeed
                    posts={recentPosts}
                    loading={loading}
                    error={error}
                    onSelectPost={handleSelectRecentPost}
                    onMemberSelect={() => setIsMemberModalOpen(true)}
                    onRetry={handleRetry}
                    serviceId={activeService ?? ''}
                />
            )}

            {/* Blog Reader */}
            {viewState.view === 'reader' && (() => {
                const { memberBlogs, currentIndex } = getMemberBlogsNavigation();
                const handleMemberClick = () => {
                    // Open timeline modal for the current member
                    setTimelineMember(viewState.member);
                    setTimelineBlogs([]);
                    setIsTimelineModalOpen(true);
                };
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
                        onMemberClick={handleMemberClick}
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
    onMemberClick: () => void;
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
    onMemberClick,
}) => {
    // Get member colors for oshi theming
    // Try with original name, then without spaces (API returns names with spaces like "藤嶌 果歩")
    // ポカ (mascot) should have white background - no oshi colors
    const isMascot = member.id === '000' || member.name === 'ポカ';
    const memberColors = isMascot ? null : (getMemberColors(member.name) ?? getMemberColors(member.name.replace(/\s+/g, '')));
    const oshiColor1 = memberColors?.[0] ?? '#ffffff';
    const oshiColor2 = memberColors?.[1] ?? '#ffffff';

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
        <div className="flex flex-col h-full relative bg-white">
            {/* Two-color oshi background - top-left and bottom-right corners */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: `
                        radial-gradient(ellipse 80% 50% at 0% 0%, ${oshiColor1}1a 0%, transparent 50%),
                        radial-gradient(ellipse 60% 40% at 100% 100%, ${oshiColor2}1a 0%, transparent 50%)
                    `,
                }}
            />

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
                <button
                    onClick={onMemberClick}
                    className="font-medium transition-all duration-200 hover:opacity-70"
                    style={{ color: '#5d95ae' }}
                >
                    {getMemberNameJp(member.name)}
                </button>
                <span className="text-gray-400">/</span>
                <span className="text-gray-700 truncate max-w-xs">{blog.title}</span>
            </div>

            {/* Main content area with timeline rail */}
            <div className="flex-1 flex relative overflow-hidden z-10">
                {/* Content */}
                <div className="flex-1 overflow-y-auto pb-20">
                    {/* Loading */}
                    {loading && (
                        <div className="flex items-center justify-center h-32">
                            <div
                                className="animate-spin rounded-full h-8 w-8 border-b-2"
                                style={{ borderColor: oshiColor1 }}
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
                                style={{ backgroundColor: oshiColor1 }}
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
                                    <button
                                        onClick={onMemberClick}
                                        className="font-medium transition-all duration-200 hover:opacity-70"
                                        style={{ color: '#5d95ae' }}
                                    >
                                        {getMemberNameJp(content.meta.member_name)}
                                    </button>
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

                            {/* Blog content - sanitized HTML rendered safely with DOMPurify */}
                            <div
                                className="prose prose-sm max-w-none [&_img]:max-w-full [&_img]:h-auto blog-content"
                                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                            />

                            {/* Blog content link styles */}
                            <style>{`
                                .blog-content a {
                                    color: #5d95ae;
                                    text-decoration: none;
                                    border-bottom: 1px solid #5d95ae40;
                                    transition: border-color 0.2s ease;
                                }
                                .blog-content a:hover {
                                    border-bottom-color: #5d95ae;
                                }
                            `}</style>

                        </article>
                    )}
                </div>

                {/* Timeline Rail */}
                {memberBlogs.length > 1 && (
                    <TimelineRail
                        blogs={memberBlogs}
                        currentIndex={currentIndex}
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
