// frontend/src/features/blogs/BlogsFeature.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { BlogMember, BlogMeta, BlogContentResponse, RecentPost, BlogMemberWithThumbnail } from '../../types';
import { getBlogMembersWithThumbnails, getBlogList, getBlogContent, getRecentPosts, syncBlogMetadata } from './api';
import { useAppStore } from '../../store/appStore';
import { RecentPostsFeed, MemberTimelineModal, BlogReader } from './components';
import { MemberSelectModal } from './components/MemberSelectModal';

type ViewState =
    | { view: 'recent' }
    | { view: 'reader'; blog: BlogMeta; member: BlogMember; content: BlogContentResponse | null; fromView: 'recent' | 'timeline'; searchQuery?: string };

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

    // Watch for search navigation target
    const targetBlog = useAppStore((state) => state.targetBlog);
    const setTargetBlog = useAppStore((state) => state.setTargetBlog);

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
    const [isSyncing, setIsSyncing] = useState(false);

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

    // Open a specific blog when navigating from search results
    useEffect(() => {
        if (!targetBlog || !activeService || targetBlog.service !== activeService) return;

        const openTargetBlog = async () => {
            try {
                const content = await getBlogContent(activeService, targetBlog.blogId);
                const meta = content.meta;
                setViewState({
                    view: 'reader',
                    blog: {
                        id: String(meta.id),
                        title: meta.title,
                        published_at: meta.published_at,
                        url: meta.url,
                        thumbnail: null,
                        cached: true,
                    },
                    member: {
                        id: String(targetBlog.memberId),
                        name: meta.member_name,
                    },
                    content,
                    fromView: 'recent',
                    searchQuery: targetBlog.searchQuery,
                });
            } catch (err) {
                console.error('[BlogsFeature] Failed to open blog from search', err);
            }
        };

        openTargetBlog();
        setTargetBlog(null);
    }, [targetBlog, activeService, setTargetBlog]);

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

    // Auto-sync blog metadata when entering recent view
    // Runs in background, shows subtle indicator, then refreshes posts
    useEffect(() => {
        if (viewState.view !== 'recent' || !activeService) return;

        // Capture service at effect start to detect if it changes during async ops
        const serviceAtStart = activeService;
        let cancelled = false;

        // Start background sync
        setIsSyncing(true);
        syncBlogMetadata(serviceAtStart)
            .then(() => {
                // Check if service changed while syncing - abort if so
                if (cancelled) return null;
                // Sync complete - re-fetch posts to show any new content
                const memberIds = selectionMode === 'favorite' && favorites.length > 0
                    ? favorites
                    : undefined;
                return getRecentPosts(serviceAtStart, 20, memberIds);
            })
            .then(res => {
                // Only update state if we're still on the same service
                if (!cancelled && res) {
                    setRecentPosts(res.posts);
                }
            })
            .catch(() => {
                // Silent fail - user still sees cached data
                console.debug('Blog sync failed (non-fatal)');
            })
            .finally(() => {
                if (!cancelled) {
                    setIsSyncing(false);
                }
            });

        // Cleanup: mark as cancelled if service/view changes before sync completes
        return () => {
            cancelled = true;
        };
    }, [activeService, viewState.view]); // Only re-sync when service or view changes

    // Pre-fetch members when service is connected (for instant modal open)
    // This runs once when the service changes, not when modal opens
    useEffect(() => {
        if (!activeService) return;
        // Skip if we already have members loaded for this service
        if (membersWithThumbnails.length > 0) return;

        // Fetch in background without showing loading state
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
            .catch(() => {
                // Silent fail on pre-fetch - will retry when modal opens
            });
    }, [activeService, membersWithThumbnails.length]);

    // Load members when modal opens (fallback if pre-fetch failed)
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

    // Handle navigation within reader (prev/next/jump)
    // NOTE: Must be declared before early return to satisfy Rules of Hooks
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
                    syncing={isSyncing}
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
                        serviceId={activeService ?? ''}
                        searchQuery={viewState.searchQuery}
                    />
                );
            })()}
        </div>
    );
};
