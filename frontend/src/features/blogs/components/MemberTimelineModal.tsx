// frontend/src/features/blogs/components/MemberTimelineModal.tsx
import React, { useMemo, useEffect, useState, useRef } from 'react';
import type { BlogMember, BlogMeta } from '../../../types';
import { getMemberNameKanji } from '../../../data/memberData';
import { useBlogTheme } from '../hooks';
import type { BlogTheme } from '../hooks';
import { formatMonthYear, formatShortDate } from '../../../utils/classnames';
import { useTranslation } from '../../../i18n';

interface MemberTimelineModalProps {
    isOpen: boolean;
    onClose: () => void;
    member: BlogMember;
    blogs: BlogMeta[];
    loading: boolean;
    error: string | null;
    onSelectBlog: (blog: BlogMeta) => void;
    onRetry: () => void;
}

interface MonthGroup {
    year: number;
    month: number;
    blogs: BlogMeta[];
}

export const MemberTimelineModal: React.FC<MemberTimelineModalProps> = ({
    isOpen,
    onClose,
    member,
    blogs,
    loading,
    error,
    onSelectBlog,
    onRetry,
}) => {
    const theme = useBlogTheme();
    const { t } = useTranslation();
    // Get kanji-only name using centralized helper
    const memberNameJp = getMemberNameKanji(member.name);

    // Use ref to track latest onClose callback without triggering effect re-runs
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    // Close on escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onCloseRef.current();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    // Group blogs by year-month
    const monthGroups = useMemo(() => {
        const groups = new Map<string, MonthGroup>();

        for (const blog of blogs) {
            const date = new Date(blog.published_at);
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            const key = `${year}-${month}`;

            if (!groups.has(key)) {
                groups.set(key, { year, month, blogs: [] });
            }
            groups.get(key)!.blogs.push(blog);
        }

        // Sort by date descending (newest first)
        return Array.from(groups.values()).sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.month - a.month;
        });
    }, [blogs]);

    // Determine which months to expand by default (last 3 months)
    const expandedMonths = useMemo(() => {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        const expandedSet = new Set<string>();

        // Calculate last 3 months
        for (let i = 0; i < 3; i++) {
            let year = currentYear;
            let month = currentMonth - i;
            if (month <= 0) {
                month += 12;
                year -= 1;
            }
            expandedSet.add(`${year}-${month}`);
        }

        return expandedSet;
    }, []);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            onClick={onClose}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

            {/* Modal */}
            <div
                className="relative w-full max-w-3xl max-h-[85vh] mx-4 rounded-3xl overflow-hidden flex flex-col animate-modal-in"
                style={{
                    background: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div
                    className="px-6 py-4 shrink-0 border-b border-gray-100"
                    style={{
                        background: 'rgba(255, 255, 255, 0.9)',
                    }}
                >
                    <div className="flex items-center justify-between">
                        <h2
                            className="text-xl font-bold"
                            style={{ color: theme.memberNameColor }}
                        >
                            {memberNameJp}
                        </h2>
                        {blogs.length > 0 && (
                            <span className="text-sm text-gray-400">
                                {t('blogs.post', { count: blogs.length })}
                            </span>
                        )}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4">
                    {/* Loading */}
                    {loading && (
                        <div className="flex flex-col items-center justify-center h-48 gap-4">
                            <div className="relative">
                                <div
                                    className="w-10 h-10 rounded-full animate-spin"
                                    style={{
                                        background: `conic-gradient(from 0deg, transparent, ${theme.primaryColor})`,
                                    }}
                                />
                                <div className="absolute inset-1 rounded-full bg-white" />
                            </div>
                            <span className="text-sm text-gray-400 tracking-wide">{t('blogs.loadingTimeline')}</span>
                        </div>
                    )}

                    {/* Error */}
                    {error && !loading && (
                        <div className="flex flex-col items-center justify-center h-48 gap-4">
                            <div
                                className="p-4 rounded-2xl"
                                style={{
                                    background: 'rgba(255, 99, 99, 0.1)',
                                    border: '1px solid rgba(255, 99, 99, 0.2)',
                                }}
                            >
                                <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <p className="text-sm text-gray-600">{error}</p>
                            <button
                                onClick={onRetry}
                                className="px-4 py-2 rounded-full text-white text-sm font-medium transition-all duration-300 hover:scale-105"
                                style={{
                                    background: theme.interaction.buttonGradient,
                                }}
                            >
                                {t('blogs.retry')}
                            </button>
                        </div>
                    )}

                    {/* Timeline */}
                    {!loading && !error && monthGroups.length > 0 && (
                        <div className="space-y-3">
                            {monthGroups.map((group, index) => (
                                <TimelineMonthSection
                                    key={`${group.year}-${group.month}`}
                                    year={group.year}
                                    month={group.month}
                                    blogs={group.blogs}
                                    defaultExpanded={expandedMonths.has(`${group.year}-${group.month}`)}
                                    onSelectBlog={onSelectBlog}
                                    animationDelay={index * 50}
                                    theme={theme}
                                />
                            ))}
                        </div>
                    )}

                    {/* Empty state */}
                    {!loading && !error && blogs.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-48 gap-4">
                            <div
                                className="p-5 rounded-2xl"
                                style={{
                                    background: 'linear-gradient(135deg, rgba(124, 199, 232, 0.1) 0%, rgba(93, 194, 181, 0.1) 100%)',
                                }}
                            >
                                <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                                </svg>
                            </div>
                            <p className="text-sm text-gray-500">{t('blogs.noBlogPostsFound')}</p>
                        </div>
                    )}
                </div>

                {/* Close hint */}
                <div className="px-6 py-2 text-center border-t border-gray-100">
                    <span className="text-xs text-gray-400">{t('blogs.tapOutsideToClose')}</span>
                </div>
            </div>

            {/* CSS Animations */}
            <style>{`
                @keyframes modal-in {
                    from {
                        opacity: 0;
                        transform: scale(0.95) translateY(10px);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1) translateY(0);
                    }
                }
                .animate-modal-in {
                    animation: modal-in 0.2s ease-out forwards;
                }
                @keyframes fade-in-up {
                    from {
                        opacity: 0;
                        transform: translateY(10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                .animate-fade-in-up {
                    animation: fade-in-up 0.3s ease-out forwards;
                    opacity: 0;
                }
            `}</style>
        </div>
    );
};

// Timeline Month Section Component
interface TimelineMonthSectionProps {
    year: number;
    month: number;
    blogs: BlogMeta[];
    defaultExpanded: boolean;
    onSelectBlog: (blog: BlogMeta) => void;
    animationDelay: number;
    theme: BlogTheme;
}

const TimelineMonthSection: React.FC<TimelineMonthSectionProps> = ({
    year,
    month,
    blogs,
    defaultExpanded,
    onSelectBlog,
    animationDelay,
    theme,
}) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const { t } = useTranslation();

    // Format month header
    const monthLabel = formatMonthYear(month, year);
    const postCount = blogs.length;

    return (
        <div
            className="rounded-2xl overflow-hidden transition-all duration-300 animate-fade-in-up"
            style={{
                background: 'rgba(255, 255, 255, 0.7)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                boxShadow: expanded ? '0 8px 30px -10px rgba(0, 0, 0, 0.1)' : '0 2px 10px rgba(0, 0, 0, 0.05)',
                animationDelay: `${animationDelay}ms`,
            }}
        >
            {/* Month Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full px-4 py-3 flex items-center justify-between transition-all duration-200 hover:bg-white/50"
            >
                <div className="flex items-center gap-3">
                    {/* Chevron */}
                    <div
                        className="w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300"
                        style={{
                            background: expanded ? theme.primaryColor : 'rgba(0, 0, 0, 0.05)',
                        }}
                    >
                        <svg
                            className={`w-3 h-3 transition-all duration-300 ${expanded ? 'rotate-90' : ''}`}
                            style={{ color: expanded ? 'white' : '#999' }}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2.5}
                                d="M9 5l7 7-7 7"
                            />
                        </svg>
                    </div>

                    {/* Month label */}
                    <span
                        className="text-base font-bold tracking-tight transition-colors duration-300"
                        style={{ color: expanded ? theme.primaryColor : '#666' }}
                    >
                        {monthLabel}
                    </span>
                </div>

                {/* Post count */}
                <span
                    className="text-sm font-medium px-3 py-1 rounded-full transition-all duration-300"
                    style={{
                        background: expanded ? `${theme.primaryColor}15` : 'rgba(0, 0, 0, 0.05)',
                        color: expanded ? theme.primaryColor : '#999',
                    }}
                >
                    {t('blogs.post', { count: postCount })}
                </span>
            </button>

            {/* Blog Items */}
            {expanded && (
                <div className="px-3 pb-3">
                    {blogs.map((blog, index) => (
                        <TimelineBlogItem
                            key={blog.id}
                            blog={blog}
                            onClick={() => onSelectBlog(blog)}
                            index={index}
                            theme={theme}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// Timeline Blog Item Component
interface TimelineBlogItemProps {
    blog: BlogMeta;
    onClick: () => void;
    index: number;
    theme: BlogTheme;
}

const TimelineBlogItem: React.FC<TimelineBlogItemProps> = ({ blog, onClick, index, theme }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [imageError, setImageError] = useState(false);
    const { t } = useTranslation();
    const date = new Date(blog.published_at);
    const dayLabel = formatShortDate(date);

    // Check if published within 24 hours
    const isRecent = useMemo(() => {
        const now = new Date();
        const publishedAt = new Date(blog.published_at);
        const hoursDiff = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);
        return hoursDiff <= 24;
    }, [blog.published_at]);

    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className="w-full p-3 flex items-start gap-4 text-left transition-all duration-300 rounded-xl group"
            style={{
                background: isHovered ? `${theme.primaryColor}10` : 'transparent',
                animationDelay: `${index * 30}ms`,
            }}
        >
            {/* Thumbnail */}
            <div
                className="w-[100px] h-[75px] shrink-0 rounded-xl overflow-hidden transition-all duration-300"
                style={{
                    boxShadow: isHovered
                        ? `0 8px 25px -5px ${theme.primaryColor}40`
                        : '0 4px 15px -5px rgba(0, 0, 0, 0.1)',
                }}
            >
                {blog.thumbnail && !imageError ? (
                    <img
                        src={blog.thumbnail}
                        alt={blog.title}
                        className={`w-full h-full object-cover transition-transform duration-500 ${isHovered ? 'scale-110' : 'scale-100'}`}
                        loading="lazy"
                        onError={() => setImageError(true)}
                    />
                ) : (
                    <div
                        className="w-full h-full flex items-center justify-center"
                        style={{
                            background: `linear-gradient(135deg, ${theme.primaryColor}20, ${theme.secondaryColor || theme.primaryColor}15)`,
                        }}
                    >
                        <svg
                            className="w-6 h-6 text-gray-300"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                        </svg>
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 py-1">
                {/* Title - Noto Serif JP font */}
                <h3
                    className="font-medium leading-snug line-clamp-2 transition-colors duration-300"
                    style={{
                        fontFamily: '"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif',
                        color: isHovered ? theme.primaryColor : '#333',
                    }}
                >
                    {blog.title}
                </h3>

                {/* Date */}
                <span className="text-sm text-gray-400 mt-1.5 block">
                    {dayLabel}
                </span>
            </div>

            {/* Recent indicator (24h) + Arrow */}
            <div className="shrink-0 flex items-center gap-2 mt-2">
                {isRecent && (
                    <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: theme.primaryColor }}
                        title={t('blogs.publishedRecently')}
                    />
                )}
                <svg
                    className={`w-4 h-4 transition-all duration-300 ${isHovered ? 'translate-x-1 opacity-100' : 'opacity-0'}`}
                    style={{ color: theme.primaryColor }}
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
            </div>
        </button>
    );
};
