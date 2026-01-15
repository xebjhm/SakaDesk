// frontend/src/components/features/blogs/BlogNavFooter.tsx
import React, { useEffect } from 'react';
import { BlogMeta } from '../../../types';

interface BlogNavFooterProps {
    prevBlog: BlogMeta | null;
    nextBlog: BlogMeta | null;
    onPrev: () => void;
    onNext: () => void;
}

export const BlogNavFooter: React.FC<BlogNavFooterProps> = ({
    prevBlog,
    nextBlog,
    onPrev,
    onNext,
}) => {
    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' && prevBlog) {
                onPrev();
            } else if (e.key === 'ArrowRight' && nextBlog) {
                onNext();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [prevBlog, nextBlog, onPrev, onNext]);

    // Don't render if no navigation available
    if (!prevBlog && !nextBlog) return null;

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const truncateTitle = (title: string, maxLen: number = 18) => {
        if (title.length <= maxLen) return title;
        return title.slice(0, maxLen) + '...';
    };

    return (
        <div
            className="absolute bottom-0 left-0 right-12 flex items-center justify-between px-4 py-3 z-10"
            style={{
                background: 'linear-gradient(to top, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.8) 100%)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
            }}
        >
            {/* Previous Blog */}
            {prevBlog ? (
                <button
                    onClick={onPrev}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100/80 transition-colors group text-left"
                >
                    <svg
                        className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors flex-shrink-0"
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
                    <div className="min-w-0">
                        <div
                            className="text-sm font-medium text-gray-700 truncate"
                            style={{ maxWidth: '150px' }}
                        >
                            {truncateTitle(prevBlog.title)}
                        </div>
                        <div className="text-xs text-gray-400">
                            {formatDate(prevBlog.published_at)}
                        </div>
                    </div>
                </button>
            ) : (
                <div /> // Spacer
            )}

            {/* Next Blog */}
            {nextBlog ? (
                <button
                    onClick={onNext}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100/80 transition-colors group text-right"
                >
                    <div className="min-w-0">
                        <div
                            className="text-sm font-medium text-gray-700 truncate"
                            style={{ maxWidth: '150px' }}
                        >
                            {truncateTitle(nextBlog.title)}
                        </div>
                        <div className="text-xs text-gray-400">
                            {formatDate(nextBlog.published_at)}
                        </div>
                    </div>
                    <svg
                        className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                        />
                    </svg>
                </button>
            ) : (
                <div /> // Spacer
            )}
        </div>
    );
};
