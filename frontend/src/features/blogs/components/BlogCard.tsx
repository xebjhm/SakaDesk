// frontend/src/features/blogs/components/BlogCard.tsx
// Portrait Gallery Card - Clean Modern Minimalist Design
// Horizontal labels, glass morphism, consistent member name color
import React, { useState } from 'react';
import type { RecentPost } from '../../../types';
import { getMemberNameKanji } from '../../../data/memberData';
import { useBlogTheme } from '../hooks';

interface BlogCardProps {
    post: RecentPost;
    onClick: () => void;
    size?: 'normal' | 'featured';
}

export const BlogCard: React.FC<BlogCardProps> = ({ post, onClick, size = 'normal' }) => {
    const theme = useBlogTheme();
    const [isHovered, setIsHovered] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);

    // Use theme colors for card effects
    const oshiPrimary = theme.primaryColor;
    const oshiSecondary = theme.secondaryColor;

    // Format date elegantly
    const date = new Date(post.published_at);
    const formattedDate = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
    }).toUpperCase();

    // Sizing based on card type
    const isFeatured = size === 'featured';

    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`
                blog-card group relative w-full cursor-pointer
                aspect-[3/4] transition-transform duration-500 ease-out
                focus:outline-none
                ${isHovered ? '-translate-y-1.5' : 'translate-y-0'}
            `}
            style={{ overflow: 'visible' }}
        >
            {/* Oshi Glow - Soft colored aura behind card on hover */}
            <div
                className="absolute -inset-3 -z-10 rounded-3xl transition-opacity duration-500"
                style={{
                    background: `radial-gradient(ellipse at center, ${oshiPrimary}30 0%, ${oshiSecondary}15 50%, transparent 70%)`,
                    filter: 'blur(24px)',
                    opacity: isHovered ? 1 : 0,
                }}
            />

            {/* Image Container - 3:4 Portrait */}
            <div
                className={`
                    relative w-full h-full overflow-hidden
                    ${isFeatured ? 'rounded-2xl' : 'rounded-xl'}
                    transition-shadow duration-500
                `}
                style={{
                    boxShadow: isHovered
                        ? `0 16px 40px -10px ${oshiPrimary}35, 0 8px 24px -8px rgba(0, 0, 0, 0.18)`
                        : '0 6px 24px -6px rgba(0, 0, 0, 0.12)',
                }}
            >
                {/* Placeholder gradient while loading */}
                {(!imageLoaded || imageError || !post.thumbnail) && (
                    <div
                        className="absolute inset-0"
                        style={{
                            background: `linear-gradient(145deg, ${oshiPrimary}18 0%, ${oshiSecondary}12 100%)`,
                        }}
                    />
                )}

                {/* Actual image */}
                {post.thumbnail && !imageError && (
                    <img
                        src={post.thumbnail}
                        alt={post.title}
                        className={`
                            absolute inset-0 w-full h-full object-cover object-top
                            transition-all duration-700 ease-out
                            ${imageLoaded ? 'opacity-100' : 'opacity-0'}
                            ${isHovered ? 'scale-105' : 'scale-100'}
                        `}
                        onLoad={() => setImageLoaded(true)}
                        onError={() => setImageError(true)}
                        loading="lazy"
                    />
                )}

                {/* Soft bottom vignette */}
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        background: 'linear-gradient(to top, rgba(0,0,0,0.05) 0%, transparent 20%)',
                    }}
                />

                {/* Focus ring for accessibility */}
                <div
                    className={`
                        absolute inset-0 pointer-events-none
                        opacity-0 group-focus-visible:opacity-100 transition-opacity
                        ${isFeatured ? 'rounded-2xl' : 'rounded-xl'}
                    `}
                    style={{ boxShadow: `inset 0 0 0 3px ${oshiPrimary}` }}
                />
            </div>

            {/* Label - Clean glass morphism, bottom-right anchor */}
            <div
                className={`
                    absolute z-20 text-left
                    transition-all duration-400
                    ${isHovered ? 'translate-x-[-4px] translate-y-[-4px]' : ''}
                `}
                style={{
                    bottom: isFeatured ? '-12px' : '-8px',
                    right: isFeatured ? '-12px' : '-8px',
                    padding: isFeatured ? '12px 14px' : '8px 10px',
                    minWidth: isFeatured ? '130px' : '95px',
                    maxWidth: isFeatured ? '200px' : '150px',
                    background: 'rgba(255, 255, 255, 0.92)',
                    backdropFilter: 'blur(16px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                    borderRadius: isFeatured ? '12px' : '8px',
                    border: '1px solid rgba(255, 255, 255, 0.6)',
                    boxShadow: isHovered
                        ? `0 10px 28px -6px ${oshiPrimary}40, 0 6px 16px -4px rgba(0, 0, 0, 0.1)`
                        : `0 6px 20px -6px rgba(0, 0, 0, 0.1)`,
                    transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.4s ease',
                }}
            >
                {/* Date - Small, muted, top */}
                <span
                    className="block font-medium tracking-wider"
                    style={{
                        fontSize: isFeatured ? '0.6rem' : '0.5rem',
                        color: '#a0a0a0',
                        marginBottom: isFeatured ? '4px' : '2px',
                    }}
                >
                    {formattedDate}
                </span>

                {/* Title - Serif, elegant */}
                <h3
                    className="line-clamp-2 leading-snug"
                    style={{
                        fontFamily: '"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif',
                        fontSize: isFeatured ? '0.9rem' : '0.75rem',
                        fontWeight: isFeatured ? 500 : 600,
                        color: '#1f2937',
                        letterSpacing: '0.01em',
                        margin: 0,
                    }}
                >
                    {post.title}
                </h3>

                {/* Member name - Theme color, kanji only */}
                <span
                    className="block font-semibold"
                    style={{
                        fontSize: isFeatured ? '0.7rem' : '0.6rem',
                        color: theme.memberNameColor,
                        marginTop: isFeatured ? '6px' : '4px',
                        letterSpacing: '0.02em',
                    }}
                >
                    {getMemberNameKanji(post.member_name)}
                </span>
            </div>
        </button>
    );
};
