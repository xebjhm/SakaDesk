// frontend/src/components/features/blogs/MemberTimeline.tsx
import React, { useMemo } from 'react';
import { BlogMember, BlogMeta } from '../../../types';
import { TimelineSection } from './TimelineSection';
import { getMemberColors, getPenlightGradient } from '../../../data/memberColors';

interface MemberTimelineProps {
    member: BlogMember;
    blogs: BlogMeta[];
    loading: boolean;
    error: string | null;
    onBack: () => void;
    onSelectBlog: (blog: BlogMeta) => void;
    onRetry: () => void;
}

interface MonthGroup {
    year: number;
    month: number;
    blogs: BlogMeta[];
}

export const MemberTimeline: React.FC<MemberTimelineProps> = ({
    member,
    blogs,
    loading,
    error,
    onBack,
    onSelectBlog,
    onRetry,
}) => {
    const memberColors = getMemberColors(member.name);

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

    return (
        <div className="flex flex-col h-full overflow-hidden bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
            {/* Animated Background */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div
                    className="absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-30 blur-3xl"
                    style={{
                        background: memberColors
                            ? `radial-gradient(circle, ${memberColors[0]} 0%, transparent 70%)`
                            : 'radial-gradient(circle, #7cc7e8 0%, transparent 70%)',
                        animation: 'float 15s ease-in-out infinite',
                    }}
                />
                <div
                    className="absolute -bottom-32 -left-32 w-80 h-80 rounded-full opacity-25 blur-3xl"
                    style={{
                        background: memberColors
                            ? `radial-gradient(circle, ${memberColors[1]} 0%, transparent 70%)`
                            : 'radial-gradient(circle, #5dc2b5 0%, transparent 70%)',
                        animation: 'float 12s ease-in-out infinite reverse',
                    }}
                />
            </div>

            {/* Header */}
            <div
                className="relative px-6 py-5 shrink-0"
                style={{
                    background: 'rgba(255, 255, 255, 0.85)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    borderBottom: '1px solid rgba(0, 0, 0, 0.05)',
                }}
            >
                <div className="flex items-center gap-4">
                    {/* Back Button */}
                    <button
                        onClick={onBack}
                        className="p-2 rounded-xl hover:bg-gray-100/80 transition-all duration-200 group"
                    >
                        <svg
                            className="w-5 h-5 text-gray-500 group-hover:text-gray-700 transition-colors"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>

                    {/* Member Color Accent */}
                    {memberColors && (
                        <div className="flex gap-1.5">
                            <div
                                className="w-3 h-3 rounded-full"
                                style={{ background: memberColors[0], boxShadow: `0 0 10px ${memberColors[0]}60` }}
                            />
                            <div
                                className="w-3 h-3 rounded-full"
                                style={{
                                    background: memberColors[1],
                                    boxShadow: `0 0 10px ${memberColors[1]}60`,
                                    border: memberColors[1] === '#ffffff' ? '1px solid #ddd' : 'none',
                                }}
                            />
                        </div>
                    )}

                    {/* Title */}
                    <div className="flex-1">
                        <h2
                            className="text-2xl font-bold tracking-tight"
                            style={{
                                background: memberColors
                                    ? getPenlightGradient(memberColors, 135)
                                    : 'linear-gradient(135deg, #333333 0%, #1a1a2e 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                            }}
                        >
                            {member.name}
                        </h2>
                        {blogs.length > 0 && (
                            <p className="text-xs text-gray-400 tracking-wider mt-0.5">
                                {blogs.length} posts
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="relative flex-1 overflow-y-auto">
                {/* Loading */}
                {loading && (
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                        <div className="relative">
                            <div
                                className="w-12 h-12 rounded-full animate-spin"
                                style={{
                                    background: memberColors
                                        ? `conic-gradient(from 0deg, transparent, ${memberColors[0]})`
                                        : 'conic-gradient(from 0deg, transparent, #7cc7e8)',
                                }}
                            />
                            <div className="absolute inset-1 rounded-full bg-white" />
                        </div>
                        <span className="text-sm text-gray-400 tracking-wide">Loading timeline...</span>
                    </div>
                )}

                {/* Error */}
                {error && !loading && (
                    <div className="flex flex-col items-center justify-center h-64 gap-4 px-6">
                        <div
                            className="p-4 rounded-2xl"
                            style={{
                                background: 'rgba(255, 99, 99, 0.1)',
                                border: '1px solid rgba(255, 99, 99, 0.2)',
                            }}
                        >
                            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <p className="text-gray-600 text-center">{error}</p>
                        <button
                            onClick={onRetry}
                            className="px-6 py-2.5 rounded-full text-white font-medium transition-all duration-300 hover:scale-105"
                            style={{
                                background: memberColors
                                    ? getPenlightGradient(memberColors, 135)
                                    : 'linear-gradient(135deg, #7cc7e8 0%, #5dc2b5 100%)',
                                boxShadow: memberColors
                                    ? `0 4px 15px ${memberColors[0]}40`
                                    : '0 4px 15px rgba(124, 199, 232, 0.4)',
                            }}
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Timeline */}
                {!loading && !error && monthGroups.length > 0 && (
                    <div className="p-4">
                        {monthGroups.map((group, index) => (
                            <div
                                key={`${group.year}-${group.month}`}
                                className="animate-fade-in-up"
                                style={{ animationDelay: `${index * 50}ms` }}
                            >
                                <TimelineSection
                                    year={group.year}
                                    month={group.month}
                                    blogs={group.blogs}
                                    defaultExpanded={expandedMonths.has(`${group.year}-${group.month}`)}
                                    onSelectBlog={onSelectBlog}
                                    memberColors={memberColors}
                                />
                            </div>
                        ))}
                    </div>
                )}

                {/* Empty state */}
                {!loading && !error && blogs.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-64 gap-4 px-6">
                        <div
                            className="p-6 rounded-3xl"
                            style={{
                                background: memberColors
                                    ? `linear-gradient(135deg, ${memberColors[0]}15, ${memberColors[1]}15)`
                                    : 'linear-gradient(135deg, rgba(124, 199, 232, 0.1) 0%, rgba(93, 194, 181, 0.1) 100%)',
                                border: memberColors
                                    ? `1px solid ${memberColors[0]}30`
                                    : '1px solid rgba(124, 199, 232, 0.2)',
                            }}
                        >
                            <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                            </svg>
                        </div>
                        <p className="text-gray-500">No blog posts found</p>
                    </div>
                )}
            </div>

            {/* CSS Animations */}
            <style>{`
                @keyframes float {
                    0%, 100% { transform: translate(0, 0); }
                    50% { transform: translate(-20px, 20px); }
                }
                @keyframes fade-in-up {
                    from {
                        opacity: 0;
                        transform: translateY(15px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                .animate-fade-in-up {
                    animation: fade-in-up 0.4s ease-out forwards;
                    opacity: 0;
                }
            `}</style>
        </div>
    );
};
