// frontend/src/features/blogs/components/BlogReader.tsx
// Blog reader component with navigation, oshi theming, and content display

import React, { useEffect, useState, useRef } from 'react';
import DOMPurify from 'dompurify';
import type { BlogMember, BlogMeta, BlogContentResponse } from '../../../types';
import { toGroupId, getMemberByBlogId, getMemberByName, getMemberPenlightHex, getMemberNameKanji } from '../../../data/memberData';
import { getServiceBlogBaseUrl } from '../../../data/services';
import { useBlogTheme } from '../hooks';
import { BlogNavFooter } from './BlogNavFooter';
import { TimelineRail } from './TimelineRail';
import { MediaViewerModal } from '../../../core/media/PhotoDetailModal';
import type { MediaViewerItem } from '../../../core/media/PhotoDetailModal';
import { useAppStore } from '../../../store/appStore';
import { TranslateButton } from '../../../core/common/TranslateButton';
import { useTranslation } from '../../../i18n';

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
    serviceId,
    searchQuery,
    matchedTerms,
    readingTerms,
}) => {
    const theme = useBlogTheme();
    const blogContentRef = useRef<HTMLDivElement>(null);
    const [blogPhotoIndex, setBlogPhotoIndex] = useState<number | null>(null);
    const [blogPhotoItems, setBlogPhotoItems] = useState<MediaViewerItem[]>([]);

    // Translation state — immersive paragraph-by-paragraph display
    const translationEnabled = useAppStore(s => s.translationEnabled);
    const translationTargetLanguage = useAppStore(s => s.translationTargetLanguage) ?? 'en';
    const [blogTranslations, setBlogTranslations] = useState<string[]>([]);
    const [isTranslating, setIsTranslating] = useState(false);
    const [translationPartial, setTranslationPartial] = useState(false);
    const [translationError, setTranslationError] = useState<string | null>(null);
    const { t } = useTranslation();

    // Get group ID for correct member data lookup
    const groupId = toGroupId(serviceId);

    // Get member colors for oshi theming
    // Try with original name, then without spaces (API returns names with spaces like "藤嶌 果歩")
    // ポカ (mascot) should have white background - no oshi colors
    const isMascot = member.id === '000' || member.name === 'ポカ';
    const memberData = isMascot ? null : (
        getMemberByName(member.name, groupId) ??
        getMemberByName(member.name.replace(/\s+/g, ''), groupId) ??
        getMemberByBlogId(member.id, groupId)
    );
    const memberColors = memberData ? getMemberPenlightHex(memberData, groupId) : null;
    const oshiColor1 = memberColors?.[0] ?? '#ffffff';
    const oshiColor2 = memberColors?.[1] ?? '#ffffff';

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

        // Check cache first
        const cacheKey = `translation:blog:${blog.id}:${translationTargetLanguage}`;
        const cached = localStorage.getItem(cacheKey);
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
            });
            if (!res.ok) {
                const detail = await res.json().catch(() => ({}));
                throw new Error(detail.detail || `Request failed: ${res.status}`);
            }
            const data = await res.json();
            if (data.ok && data.translations) {
                setBlogTranslations(data.translations);
                setTranslationPartial(data.partial ?? false);
                try {
                    localStorage.setItem(cacheKey, JSON.stringify(data.translations));
                } catch { /* full */ }
            } else {
                throw new Error('Translation returned not ok');
            }
        } catch (e) {
            setTranslationError(e instanceof Error ? e.message : 'Translation failed');
        } finally {
            setIsTranslating(false);
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

    // Normalize relative URLs in HTML content to absolute URLs
    // Skip /api/ URLs — those are local backend endpoints (e.g., cached blog images)
    const normalizeHtmlUrls = (html: string, baseUrl: string): string => {
        if (!baseUrl) return html;
        return html.replace(
            /(src|href)=(["'])([^"']+)\2/g,
            (match, attr, quote, url) => {
                if (!url) return match;
                if (url.startsWith('//')) return `${attr}=${quote}https:${url}${quote}`;
                if (url.startsWith('/api/')) return match;
                if (url.startsWith('/')) return `${attr}=${quote}${baseUrl}${url}${quote}`;
                if (!url.startsWith('http')) return `${attr}=${quote}${baseUrl}/${url}${quote}`;
                return match;
            }
        );
    };

    // Sanitize HTML content using DOMPurify (XSS protection)
    // DOMPurify is a well-established sanitization library that removes malicious content
    // First normalize URLs to handle cached content with relative URLs
    const baseUrl = getServiceBlogBaseUrl(serviceId);
    const normalizedHtml = content ? normalizeHtmlUrls(content.content.html, baseUrl) : '';
    const sanitizedHtml = normalizedHtml
        ? DOMPurify.sanitize(normalizedHtml, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a', 'img', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li'],
            ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'target', 'rel'],
        })
        : '';

    // Highlight search query matches in blog content.
    // Uses both the raw searchQuery and matchedTerms extracted from snippet
    // <mark> tags. This handles reading-based matches where the query is
    // hiragana (e.g., "かわいい") but the blog text is kanji (e.g., "可愛い").
    // Reading-based matches get blue highlights with dashed border,
    // while exact matches get yellow highlights.
    let processedHtml = sanitizedHtml;
    if ((searchQuery || matchedTerms?.length) && processedHtml) {
        const allTerms = new Set<string>();
        const readingSet = new Set(readingTerms || []);
        if (searchQuery) allTerms.add(searchQuery);
        matchedTerms?.forEach(t => allTerms.add(t));

        // Split into exact and reading term lists
        const exactTermsList = [...allTerms].filter(t => !readingSet.has(t));
        const readTermsList = [...allTerms].filter(t => readingSet.has(t));

        // Helper to escape regex special chars
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Apply reading highlights first (blue), then exact highlights (yellow)
        // Applying exact last means if a term appears in both, exact style wins
        for (const [terms, cssClass] of [
            [readTermsList, 'search-snippet search-highlight reading'],
            [exactTermsList, 'search-snippet search-highlight'],
        ] as [string[], string][]) {
            if (terms.length === 0) continue;
            const escaped = terms.map(escapeRegex);
            escaped.sort((a, b) => b.length - a.length);
            const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
            processedHtml = processedHtml.replace(/>([^<]+)</g, (_match, text) => {
                return '>' + (text as string).replace(regex, `<mark class="${cssClass}">$1</mark>`) + '<';
            });
        }
    }

    // Scroll to first search highlight after content renders
    useEffect(() => {
        if (searchQuery || matchedTerms?.length) {
            const timer = setTimeout(() => {
                document.querySelector('.search-highlight')?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                });
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [searchQuery, matchedTerms, content]);

    // Intercept clicks on blog images to open in photo viewer
    useEffect(() => {
        const container = blogContentRef.current;
        if (!container || !content) return;

        const handleImgClick = (e: Event) => {
            const target = e.target as HTMLElement;
            if (target.tagName !== 'IMG') return;

            const imgSrc = (target as HTMLImageElement).src;
            if (!imgSrc) return;

            // Collect all image srcs from the blog content
            const allImgs = Array.from(container.querySelectorAll('img'));
            const items: MediaViewerItem[] = allImgs
                .map(img => img.src)
                .filter(Boolean)
                .map(src => ({ src, type: 'picture' as const, timestamp: blog.published_at }));

            const clickedIdx = items.findIndex(item => item.src === imgSrc);
            if (clickedIdx !== -1) {
                setBlogPhotoItems(items);
                setBlogPhotoIndex(clickedIdx);
            }
        };

        container.addEventListener('click', handleImgClick);
        return () => container.removeEventListener('click', handleImgClick);
    }, [content, blog.published_at]);

    // Inject translations into blog DOM — immersive style.
    // Walks the <p> child nodes, finds the same <br>-run boundaries used
    // during extraction, and inserts translation text + <br> after each segment.
    // Uses only inline elements and <br> to avoid breaking the <p> flow.
    useEffect(() => {
        const container = blogContentRef.current;
        if (!container || blogTranslations.length === 0) return;

        // Remove previous injections
        container.querySelectorAll('.blog-translation-inline').forEach(el => el.remove());

        const root = container.querySelector('p') ?? container;
        const nodes = Array.from(root.childNodes);

        let segmentIndex = 0;
        let brCount = 0;
        let hasText = false;

        let lastContentNode: ChildNode | null = null;

        const injectTranslation = (afterNode: ChildNode, text: string) => {
            // Insert: <br><span class="blog-translation-inline" style="D">text</span>
            const br = document.createElement('br');
            br.className = 'blog-translation-inline';
            const span = document.createElement('span');
            span.className = 'blog-translation-inline';
            span.style.cssText = `
                color: #555;
                font-style: italic;
                font-size: 14px;
                line-height: 1.65;
                padding-left: 12px;
                border-left: 1.5px solid #d1d5db;
                display: inline-block;
            `;
            span.textContent = text;
            const ref = afterNode.nextSibling;
            root.insertBefore(br, ref);
            root.insertBefore(span, ref);
        };

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];

            if (node.nodeName === 'BR') {
                brCount++;
                if (brCount >= 2 && hasText && lastContentNode) {
                    // End of a segment — inject translation right after the
                    // last text node (before the <br> spacing run)
                    const translation = blogTranslations[segmentIndex];
                    if (translation) {
                        injectTranslation(lastContentNode, translation);
                    }
                    segmentIndex++;
                    hasText = false;
                    lastContentNode = null;
                }
            } else {
                brCount = 0;
                const text = node.textContent?.trim();
                if (text) {
                    hasText = true;
                    lastContentNode = node;
                }
            }
        }

        // Flush final segment
        if (hasText && lastContentNode && segmentIndex < blogTranslations.length) {
            const translation = blogTranslations[segmentIndex];
            if (translation) {
                injectTranslation(lastContentNode, translation);
            }
        }

        return () => {
            container.querySelectorAll('.blog-translation-inline').forEach(el => el.remove());
        };
    }, [blogTranslations]);

    // Reset translations when blog changes
    useEffect(() => {
        setBlogTranslations([]);
        setIsTranslating(false);
        setTranslationPartial(false);
    }, [blog.id]);

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
                    style={{ color: theme.memberNameColor }}
                >
                    {getMemberNameKanji(member.name, groupId)}
                </button>
                <span className="text-gray-400">/</span>
                <span className="text-gray-700 truncate max-w-xs">{blog.title}</span>
            </div>

            {/* Main content area */}
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
                        <article className="max-w-3xl mx-auto px-4 py-6 pr-16 relative">
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
                                        style={{ color: theme.memberNameColor }}
                                    >
                                        {getMemberNameKanji(content.meta.member_name, groupId)}
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
                                                accentColor="#6b7280"
                                                doneLabel={t(translationPartial ? 'translation.translatedPartial' : 'translation.translated')}
                                            />
                                        </span>
                                    )}
                                </div>
                            </header>

                            {/* Blog content - sanitized HTML rendered safely with DOMPurify, then search highlights injected */}
                            <div
                                ref={blogContentRef}
                                className="prose prose-sm max-w-none [&_img]:max-w-full [&_img]:h-auto [&_img]:cursor-pointer blog-content"
                                dangerouslySetInnerHTML={{ __html: processedHtml }}
                            />

                            {/* Blog content link and search highlight styles */}
                            <style>{`
                                .blog-content a {
                                    color: ${theme.linkColor};
                                    text-decoration: none;
                                    border-bottom: 1px solid ${theme.linkUnderlineColor};
                                    transition: border-color 0.2s ease;
                                }
                                .blog-content a:hover {
                                    border-bottom-color: ${theme.linkColor};
                                }
                                .search-highlight {
                                    background-color: rgb(254 240 138);
                                    color: inherit;
                                    border-radius: 2px;
                                    padding: 0 2px;
                                }
                                .search-highlight.reading {
                                    background-color: rgb(219 234 254);
                                    border-bottom: 1.5px dashed rgb(96 165 250);
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

            {/* Blog Photo Viewer */}
            {blogPhotoIndex !== null && blogPhotoItems.length > 0 && (
                <MediaViewerModal
                    mediaItems={blogPhotoItems}
                    currentIndex={blogPhotoIndex}
                    onClose={() => setBlogPhotoIndex(null)}
                    onNavigate={setBlogPhotoIndex}
                />
            )}
        </div>
    );
};
