// frontend/src/features/blogs/components/BlogReader.tsx
// Blog reader: breadcrumb, the post at a readable width, older/newer pills and the timeline rail.

import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import { AlertCircle, ChevronLeft } from 'lucide-react';
import type { BlogMember, BlogMeta, BlogContentResponse } from '../../../types';
import { toGroupId, getMemberNameKanji } from '../../../data/memberData';
import { getServiceBlogBaseUrl } from '../../../data/services';
import { useBlogTranslationVisibility, useInlineBlogTranslations } from '../hooks';
import { BlogNavFooter } from './BlogNavFooter';
import { TimelineRail } from './TimelineRail';
import { BlogBody } from './BlogBody';
import { buildBlogFragment, highlightKey, parseHighlightKey } from '../blogHtml';
import { MediaViewerModal } from '../../../core/media/PhotoDetailModal';
import type { MediaViewerItem } from '../../../core/media/PhotoDetailModal';
import { useAppStore } from '../../../store/appStore';
import { TranslateButton } from '../../../core/common/TranslateButton';
import { IconButton, StatusBlock } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';
import { aiErrorKey } from '../../../i18n/aiError';
import { persisted } from '../../../core/persistence/persisted';
import { readCachedTranslation } from '../../../core/persistence/translationLoader';
import { formatBlogDate } from '../../../utils/dateFormatters';
import { resolveWash } from '../memberWash';
import { clientLog } from '../../../utils/clientLog';
import { loadLanguageFaces } from '../../../design/fonts';
import { openExternal } from '../../../utils/openExternal';

export interface BlogReaderProps {
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
    /** False while a blog dialog is open: ← / → must not change the post behind it. */
    keysEnabled?: boolean;
    serviceId: string;
    searchQuery?: string;
    matchedTerms?: string[];
    readingTerms?: string[];
}

export const BlogReader: React.FC<BlogReaderProps> = ({
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
    keysEnabled = true,
    serviceId,
    searchQuery,
    matchedTerms,
    readingTerms,
}) => {
    const blogContentRef = useRef<HTMLDivElement>(null);
    // Aborts the in-flight translate-all POST when the blog changes, so a stale
    // result can't be injected over a different blog.
    const translateAbortRef = useRef<AbortController | null>(null);
    const [blogPhotoIndex, setBlogPhotoIndex] = useState<number | null>(null);
    const [blogPhotoItems, setBlogPhotoItems] = useState<MediaViewerItem[]>([]);

    // Translation state — immersive paragraph-by-paragraph display
    const translationEnabled = useAppStore(s => s.translationEnabled);
    const translationTargetLanguage = useAppStore(s => s.translationTargetLanguage) ?? 'en';
    const [blogTranslations, setBlogTranslations] = useState<string[]>([]);
    const [isTranslating, setIsTranslating] = useState(false);
    const [translationPartial, setTranslationPartial] = useState(false);
    const [translationError, setTranslationError] = useState<string | null>(null);
    // Auto-expand on completion, collapse on scroll-away / blog switch, manual toggle.
    const { expanded: translationsExpanded, toggle: toggleTranslations } =
        useBlogTranslationVisibility(blogTranslations.length, blogContentRef);
    const { t, i18n } = useTranslation();
    const reducedMotion = useReducedMotion();

    // Get group ID for correct member data lookup
    const groupId = toGroupId(serviceId);

    // Member penlight wash (data-driven, DESIGN_SYSTEM.md): CSS variables, or none.
    const { style: washStyle, fallback: washFallback } = resolveWash(member, groupId);
    useEffect(() => {
        if (washFallback) clientLog('blog_fallback', { target: 'wash', reason: washFallback });
    }, [washFallback, blog.id]);

    /**
     * Split the blog content DOM into logical paragraph segments.
     * Walks child nodes of the blog container, grouping text/inline nodes
     * between runs of 2+ <br> elements.
     */
    const extractParagraphSegments = (): string[] => {
        const container = blogContentRef.current;
        if (!container) return [];

        const segments: string[] = [];
        // Find the main <p> or use the container itself
        const root = container.querySelector('p') ?? container;
        const nodes = Array.from(root.childNodes);

        let currentText: string[] = [];
        let brCount = 0;

        for (const node of nodes) {
            if (node.nodeName === 'BR') {
                brCount++;
                if (brCount >= 2 && currentText.length > 0) {
                    const text = currentText.join('').trim();
                    if (text) segments.push(text);
                    currentText = [];
                    brCount = 0;
                }
            } else {
                brCount = 0;
                const text = node.textContent ?? '';
                if (text) currentText.push(text);
            }
        }
        // Flush remaining
        const remaining = currentText.join('').trim();
        if (remaining) segments.push(remaining);

        return segments;
    };

    const handleTranslateAll = async () => {
        if (!content || isTranslating) return;

        // Supersede any prior in-flight translation and track this one so a blog
        // change can abort it before it writes stale paragraphs over a new blog.
        translateAbortRef.current?.abort();
        const controller = new AbortController();
        translateAbortRef.current = controller;

        // Check cache first
        const cacheKey = `translation:blog:${blog.id}:${translationTargetLanguage}`;
        const cached = (await readCachedTranslation(cacheKey, 'blog')) ?? null;
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed)) {
                    setBlogTranslations(parsed);
                    return;
                }
            } catch { /* invalid cache, re-translate */ }
        }

        const paragraphs = extractParagraphSegments();
        if (paragraphs.length === 0) return;

        setIsTranslating(true);
        setTranslationPartial(false);
        setTranslationError(null);

        try {
            const res = await fetch('/api/translation/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'blog_full',
                    service: serviceId,
                    paragraphs,
                    target_language: translationTargetLanguage,
                }),
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                const err = new Error(body.detail || `Request failed: ${res.status}`);
                (err as Error & { code?: string }).code = body.code;
                throw err;
            }
            const data = await res.json();
            if (controller.signal.aborted) return;  // blog changed mid-flight
            if (data.ok && data.translations) {
                setBlogTranslations(data.translations);
                setTranslationPartial(data.partial ?? false);
                persisted.putTranslations({ [cacheKey]: JSON.stringify(data.translations) }).catch(() => {});
            } else {
                throw new Error('Translation returned not ok');
            }
        } catch (e) {
            // Aborted because the user navigated to another blog — not a failure.
            if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
            setTranslationError(t(aiErrorKey((e as Error & { code?: string })?.code)));
        } finally {
            if (!controller.signal.aborted) setIsTranslating(false);
        }
    };

    // Navigation helpers (index 0 = newest, higher index = older)
    // "Prev" goes to older posts (higher index), "Next" goes to newer posts (lower index)
    const prevBlog = currentIndex < memberBlogs.length - 1 ? memberBlogs[currentIndex + 1] : null;
    const nextBlog = currentIndex > 0 ? memberBlogs[currentIndex - 1] : null;

    const handlePrev = () => prevBlog && onNavigate(prevBlog);
    const handleNext = () => nextBlog && onNavigate(nextBlog);
    const handleRailSelect = (index: number) => {
        if (memberBlogs[index]) onNavigate(memberBlogs[index]);
    };

    // The post body: sanitized into a DOM fragment whose URLs are resolved against the blog host
    // (loopback and app URLs dropped, except the cached-image endpoint) with search terms marked
    // on its text nodes (blogHtml.ts).
    // It is never serialized, edited or re-parsed as an HTML string. Reading
    // matches get the reading mark (fill + dashed underline), exact matches the exact mark.
    const baseUrl = getServiceBlogBaseUrl(serviceId);
    const postHtml = content?.content.html ?? '';
    const termsKey = highlightKey(searchQuery, matchedTerms, readingTerms);
    const postFragment = useMemo(
        () => (postHtml ? buildBlogFragment(postHtml, parseHighlightKey(termsKey), baseUrl) : null),
        [postHtml, baseUrl, termsKey],
    );

    // Scroll to the first search highlight after content renders (instant with reduced motion)
    useEffect(() => {
        if (searchQuery || matchedTerms?.length) {
            const timer = setTimeout(() => {
                document.querySelector('.search-highlight')?.scrollIntoView({
                    behavior: reducedMotion ? 'auto' : 'smooth',
                    block: 'center',
                });
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [searchQuery, matchedTerms, content, reducedMotion]);

    // Clicks inside the post. An image opens the photo viewer. A link never navigates the app
    // window: a web link opens in the browser (openExternal), anything else does nothing.
    useEffect(() => {
        const container = blogContentRef.current;
        if (!container || !content) return;

        const openPhotoViewer = (img: HTMLImageElement) => {
            const imgSrc = img.src;
            if (!imgSrc) return;
            const items: MediaViewerItem[] = Array.from(container.querySelectorAll('img'))
                .map(el => el.src)
                .filter(Boolean)
                .map(src => ({ src, type: 'picture' as const, timestamp: blog.published_at }));
            const clickedIdx = items.findIndex(item => item.src === imgSrc);
            if (clickedIdx !== -1) {
                setBlogPhotoItems(items);
                setBlogPhotoIndex(clickedIdx);
            }
        };

        const postLink = (target: EventTarget | null): HTMLAnchorElement | null => {
            const anchor = target instanceof Element ? target.closest('a') : null;
            return anchor && container.contains(anchor) ? anchor : null;
        };

        const handleClick = (e: MouseEvent) => {
            const link = postLink(e.target);
            if (link) e.preventDefault();
            const target = e.target as HTMLElement;
            if (target.tagName === 'IMG') {
                openPhotoViewer(target as HTMLImageElement);
                return;
            }
            if (link) openExternal(link.getAttribute('href'), 'blog_post');
        };

        // A middle click would open the link in a new window.
        const handleAuxClick = (e: MouseEvent) => {
            if (e.button !== 1) return;
            const link = postLink(e.target);
            if (!link) return;
            e.preventDefault();
            openExternal(link.getAttribute('href'), 'blog_post');
        };

        container.addEventListener('click', handleClick);
        container.addEventListener('auxclick', handleAuxClick);
        return () => {
            container.removeEventListener('click', handleClick);
            container.removeEventListener('auxclick', handleAuxClick);
        };
    }, [content, blog.published_at]);

    // Inject translations into the blog DOM (immersive, per paragraph) while expanded.
    useInlineBlogTranslations(blogContentRef, blogTranslations, translationsExpanded, translationTargetLanguage);

    // The translation language's own faces (a Chinese translation in Noto Sans TC, not JP glyphs).
    useEffect(() => {
        if (translationsExpanded) loadLanguageFaces(translationTargetLanguage);
    }, [translationsExpanded, translationTargetLanguage]);

    // Reset translations when blog changes
    useEffect(() => {
        translateAbortRef.current?.abort();  // cancel a translate-all still running for the old blog
        setBlogTranslations([]);
        setIsTranslating(false);
        setTranslationPartial(false);
        setTranslationError(null);  // else a prior blog's error sticks on the new blog's button
    }, [blog.id]);

    return (
        <div className="relative flex h-full min-h-0 flex-col">
            {/* Member penlight wash: two soft corner glows (bg-member-wash) */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-member-wash" style={washStyle} />

            {/* Breadcrumb */}
            <div className="relative flex shrink-0 items-center gap-1 px-4 pb-2 pt-3 text-small">
                <IconButton
                    size="sm"
                    aria-label={t('blogs.back')}
                    icon={<ChevronLeft className="h-4 w-4" />}
                    onClick={onBack}
                />
                <button
                    type="button"
                    onClick={onMemberClick}
                    lang="ja"
                    className="rounded-pill px-2 py-1 font-semibold text-accent-strong transition-colors duration-fast ease-standard hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {getMemberNameKanji(member.name, groupId)}
                </button>
                <span aria-hidden="true" className="text-muted">/</span>
                <span lang="ja" className="min-w-0 truncate px-1 text-secondary">{blog.title}</span>
            </div>

            <div className="relative flex min-h-0 flex-1">
                {/* Post column: scrolls; older/newer float over its bottom */}
                <div className="relative min-w-0 flex-1">
                    <div className="h-full overflow-y-auto">
                        {loading && <StatusBlock kind="loading" variant="block" surface="blog_reader" label={t('blogs.loadingPost')} labelVisibility="always" />}

                        {error && !loading && (
                            <StatusBlock
                                kind="error"
                                variant="block"
                                surface="blog_reader"
                                retryVariant="primary"
                                icon={<AlertCircle className="h-8 w-8" />}
                                title={t('blogs.postLoadFailed')}
                                onRetry={onRetry}
                                retryLabel={t('blogs.retry')}
                            />
                        )}

                        {!loading && !error && content && (
                            <article className="mx-auto w-full max-w-2xl px-8 pb-24 pt-6">
                                <header className="mb-8 flex flex-col gap-2">
                                    <h1 lang="ja" className="phrase-break text-balance font-reading text-heading font-semibold text-primary">{content.meta.title}</h1>
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted">
                                        <button
                                            type="button"
                                            onClick={onMemberClick}
                                            lang="ja"
                                            className="rounded-pill font-semibold text-accent-strong decoration-group underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                        >
                                            {getMemberNameKanji(content.meta.member_name, groupId)}
                                        </button>
                                        <span aria-hidden="true">·</span>
                                        <time dateTime={content.meta.published_at}>
                                            {formatBlogDate(new Date(content.meta.published_at), i18n.language, 'long')}
                                        </time>
                                        {translationEnabled && (
                                            <span className="ml-auto">
                                                <TranslateButton
                                                    state={
                                                        isTranslating ? 'loading'
                                                            : translationError ? 'error'
                                                            : blogTranslations.length > 0 ? 'done'
                                                            : 'idle'
                                                    }
                                                    onClick={handleTranslateAll}
                                                    error={translationError}
                                                    doneLabel={t(translationPartial ? 'translation.translatedPartial' : 'translation.translated')}
                                                    expanded={translationsExpanded}
                                                    onToggleExpanded={toggleTranslations}
                                                />
                                            </span>
                                        )}
                                    </div>
                                </header>

                                {/* Sanitized DOM fragment with its search marks (blogHtml.ts) */}
                                <BlogBody fragment={postFragment} containerRef={blogContentRef} />
                            </article>
                        )}
                    </div>

                    <BlogNavFooter
                        prevBlog={prevBlog}
                        nextBlog={nextBlog}
                        onPrev={handlePrev}
                        onNext={handleNext}
                        keysEnabled={keysEnabled}
                    />
                </div>

                {/* Rail column: always reserved, so the post does not shift when the list arrives */}
                <div className="relative z-10 w-14 shrink-0">
                    {memberBlogs.length > 1 && (
                        <TimelineRail
                            blogs={memberBlogs}
                            currentIndex={currentIndex}
                            onSelect={handleRailSelect}
                        />
                    )}
                </div>
            </div>

            {/* Blog Photo Viewer (D2c) */}
            {blogPhotoIndex !== null && blogPhotoItems.length > 0 && (
                <MediaViewerModal
                    mediaItems={blogPhotoItems}
                    currentIndex={blogPhotoIndex}
                    onClose={() => setBlogPhotoIndex(null)}
                    onNavigate={setBlogPhotoIndex}
                    sequence="reading"
                />
            )}
        </div>
    );
};
