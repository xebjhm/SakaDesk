// frontend/src/features/blogs/components/TimelineSection.tsx
import React, { useState } from 'react';
import type { BlogMeta } from '../../../types';
import { formatMonthYear, formatShortDate } from '../../../utils/classnames';

interface TimelineSectionProps {
    year: number;
    month: number;
    blogs: BlogMeta[];
    defaultExpanded: boolean;
    onSelectBlog: (blog: BlogMeta) => void;
    memberColors?: [string, string] | null;
}

export const TimelineSection: React.FC<TimelineSectionProps> = ({
    year,
    month,
    blogs,
    defaultExpanded,
    onSelectBlog,
    memberColors,
}) => {
    const [expanded, setExpanded] = useState(defaultExpanded);

    // Format month header
    const monthLabel = formatMonthYear(month, year);
    const postCount = blogs.length;

    const accentColor = memberColors?.[0] ?? '#7cc7e8';

    return (
        <div
            className="mb-3 rounded-2xl overflow-hidden transition-all duration-300"
            style={{
                background: 'rgba(255, 255, 255, 0.7)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                boxShadow: expanded ? '0 8px 30px -10px rgba(0, 0, 0, 0.1)' : '0 2px 10px rgba(0, 0, 0, 0.05)',
            }}
        >
            {/* Month Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full px-5 py-4 flex items-center justify-between transition-all duration-200 hover:bg-white/50"
            >
                <div className="flex items-center gap-3">
                    {/* Chevron */}
                    <div
                        className="w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300"
                        style={{
                            background: expanded ? accentColor : 'rgba(0, 0, 0, 0.05)',
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
                        className="text-lg font-bold tracking-tight transition-colors duration-300"
                        style={{ color: expanded ? accentColor : '#666' }}
                    >
                        {monthLabel}
                    </span>
                </div>

                {/* Post count */}
                <span
                    className="text-sm font-medium px-3 py-1 rounded-full transition-all duration-300"
                    style={{
                        background: expanded ? `${accentColor}15` : 'rgba(0, 0, 0, 0.05)',
                        color: expanded ? accentColor : '#999',
                    }}
                >
                    {postCount} {postCount === 1 ? 'post' : 'posts'}
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
                            memberColors={memberColors}
                            index={index}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

interface TimelineBlogItemProps {
    blog: BlogMeta;
    onClick: () => void;
    memberColors?: [string, string] | null;
    index: number;
}

const TimelineBlogItem: React.FC<TimelineBlogItemProps> = ({ blog, onClick, memberColors, index }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [imageError, setImageError] = useState(false);
    const date = new Date(blog.published_at);
    const dayLabel = formatShortDate(date);

    const accentColor = memberColors?.[0] ?? '#7cc7e8';

    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className="w-full p-3 flex items-start gap-4 text-left transition-all duration-300 rounded-xl group"
            style={{
                background: isHovered ? `${accentColor}10` : 'transparent',
                animationDelay: `${index * 30}ms`,
            }}
        >
            {/* Thumbnail */}
            <div
                className="w-[120px] h-[90px] shrink-0 rounded-xl overflow-hidden transition-all duration-300"
                style={{
                    boxShadow: isHovered
                        ? `0 8px 25px -5px ${accentColor}40`
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
                            background: memberColors
                                ? `linear-gradient(135deg, ${memberColors[0]}30, ${memberColors[1]}30)`
                                : 'linear-gradient(135deg, #f0f0f0, #e0e0e0)',
                        }}
                    >
                        <svg
                            className="w-8 h-8 text-gray-300"
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
                {/* Title */}
                <h3
                    className="font-semibold leading-snug line-clamp-2 transition-colors duration-300"
                    style={{
                        color: isHovered ? accentColor : '#333',
                    }}
                >
                    {blog.title}
                </h3>

                {/* Date */}
                <span className="text-sm text-gray-400 mt-1.5 block">
                    {dayLabel}
                </span>
            </div>

            {/* Cached indicator + Arrow */}
            <div className="shrink-0 flex items-center gap-2 mt-2">
                {blog.cached && (
                    <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: accentColor }}
                        title="Cached"
                    />
                )}
                <svg
                    className={`w-4 h-4 transition-all duration-300 ${isHovered ? 'translate-x-1 opacity-100' : 'opacity-0'}`}
                    style={{ color: accentColor }}
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
