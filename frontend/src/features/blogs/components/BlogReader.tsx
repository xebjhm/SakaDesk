// frontend/src/features/blogs/components/BlogReader.tsx
// Blog reader component with navigation, oshi theming, and content display

import React from 'react';
import DOMPurify from 'dompurify';
import type { BlogMember, BlogMeta, BlogContentResponse } from '../../../types';
import { getMemberColors, getMemberNameJp } from '../../../data/memberColors';
import { useBlogTheme } from '../hooks';
import { BlogNavFooter } from './BlogNavFooter';
import { TimelineRail } from './TimelineRail';

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
}) => {
    const theme = useBlogTheme();

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
    // DOMPurify is a well-established sanitization library that removes malicious content
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
                    style={{ color: theme.memberNameColor }}
                >
                    {getMemberNameJp(member.name)}
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
                                        style={{ color: theme.memberNameColor }}
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
                                    color: ${theme.linkColor};
                                    text-decoration: none;
                                    border-bottom: 1px solid ${theme.linkUnderlineColor};
                                    transition: border-color 0.2s ease;
                                }
                                .blog-content a:hover {
                                    border-bottom-color: ${theme.linkColor};
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
