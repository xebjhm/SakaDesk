// frontend/src/components/features/blogs/TimelineRail.tsx
import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { BlogMeta } from '../../../types';

interface TimelineRailProps {
    blogs: BlogMeta[];
    currentIndex: number;
    oshiColor: string;
    onSelect: (index: number) => void;
}

// Group blogs by year for section markers
interface YearGroup {
    year: number;
    startIndex: number;
    count: number;
}

// Fisheye zoom configuration
const ZOOM_CONFIG = {
    dwellTime: 400,
    dwellTolerance: 10,
    magnifiedWindow: 50,
    magnification: 5,
    transitionMs: 300, // Slightly longer for smoother feel
};

export const TimelineRail: React.FC<TimelineRailProps> = ({
    blogs,
    currentIndex,
    oshiColor,
    onSelect,
}) => {
    const railRef = useRef<HTMLDivElement>(null);
    const [hoverInfo, setHoverInfo] = useState<{
        y: number;
        index: number;
    } | null>(null);

    // Zoom state
    const [isZoomed, setIsZoomed] = useState(false);
    const [zoomCenter, setZoomCenter] = useState<number | null>(null);
    const dwellTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastHoverIndexRef = useRef<number | null>(null);

    // Group blogs by year
    const yearGroups = useMemo((): YearGroup[] => {
        if (blogs.length === 0) return [];

        const groups: YearGroup[] = [];
        let currentYear = -1;

        blogs.forEach((blog, index) => {
            const year = new Date(blog.published_at).getFullYear();
            if (year !== currentYear) {
                if (groups.length > 0) {
                    groups[groups.length - 1].count = index - groups[groups.length - 1].startIndex;
                }
                groups.push({ year, startIndex: index, count: 0 });
                currentYear = year;
            }
        });

        if (groups.length > 0) {
            groups[groups.length - 1].count = blogs.length - groups[groups.length - 1].startIndex;
        }

        return groups;
    }, [blogs]);

    // Get month label for a blog
    const getMonthLabel = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    };

    // Fisheye mapping: index → normalized position (0-1)
    const indexToNormalizedPosition = useCallback((index: number): number => {
        if (blogs.length <= 1) return 0;
        const normalizedIndex = index / (blogs.length - 1);

        if (!isZoomed || zoomCenter === null) {
            return normalizedIndex;
        }

        const center = zoomCenter / (blogs.length - 1);
        const windowSize = ZOOM_CONFIG.magnifiedWindow / (blogs.length - 1);
        const mag = ZOOM_CONFIG.magnification;

        const dist = normalizedIndex - center;
        const absDist = Math.abs(dist);

        if (absDist <= windowSize) {
            const t = absDist / windowSize;
            const eased = t * t * (3 - 2 * t);
            const expandedDist = dist * (1 + (mag - 1) * (1 - eased));
            return center + expandedDist;
        } else {
            const magnifiedSpace = windowSize * mag;
            const remainingSpace = (1 - magnifiedSpace * 2) / 2;
            const normalRemaining = 0.5 - windowSize;

            if (dist > 0) {
                const outsideDist = absDist - windowSize;
                const compressedDist = outsideDist * (remainingSpace / Math.max(normalRemaining, 0.001));
                return center + magnifiedSpace + compressedDist;
            } else {
                const outsideDist = absDist - windowSize;
                const compressedDist = outsideDist * (remainingSpace / Math.max(normalRemaining, 0.001));
                return center - magnifiedSpace - compressedDist;
            }
        }
    }, [blogs.length, isZoomed, zoomCenter]);

    // Inverse fisheye mapping: normalized position (0-1) → index
    const normalizedPositionToIndex = useCallback((pos: number): number => {
        if (blogs.length <= 1) return 0;

        if (!isZoomed || zoomCenter === null) {
            return Math.round(pos * (blogs.length - 1));
        }

        const center = zoomCenter / (blogs.length - 1);
        const windowSize = ZOOM_CONFIG.magnifiedWindow / (blogs.length - 1);
        const mag = ZOOM_CONFIG.magnification;
        const magnifiedSpace = windowSize * mag;

        const dist = pos - center;
        const absDist = Math.abs(dist);

        let normalizedIndex: number;

        if (absDist <= magnifiedSpace) {
            const sign = dist >= 0 ? 1 : -1;
            const originalDist = (absDist / mag);
            normalizedIndex = center + sign * originalDist;
        } else {
            const remainingSpace = (1 - magnifiedSpace * 2) / 2;
            const normalRemaining = 0.5 - windowSize;

            if (dist > 0) {
                const compressedDist = absDist - magnifiedSpace;
                const originalDist = compressedDist * (normalRemaining / Math.max(remainingSpace, 0.001));
                normalizedIndex = center + windowSize + originalDist;
            } else {
                const compressedDist = absDist - magnifiedSpace;
                const originalDist = compressedDist * (normalRemaining / Math.max(remainingSpace, 0.001));
                normalizedIndex = center - windowSize - originalDist;
            }
        }

        return Math.round(Math.max(0, Math.min(1, normalizedIndex)) * (blogs.length - 1));
    }, [blogs.length, isZoomed, zoomCenter]);

    // Clear dwell timer on cleanup
    useEffect(() => {
        return () => {
            if (dwellTimerRef.current) {
                clearTimeout(dwellTimerRef.current);
            }
        };
    }, []);

    // Handle mouse move
    const handleMouseMove = (e: React.MouseEvent) => {
        if (!railRef.current || blogs.length === 0) return;
        const rect = railRef.current.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const padding = 30;
        const usableHeight = rect.height - padding * 2;

        const normalizedY = Math.max(0, Math.min(1, (y - padding) / usableHeight));
        const index = normalizedPositionToIndex(normalizedY);
        const clampedIndex = Math.max(0, Math.min(blogs.length - 1, index));

        setHoverInfo({ y, index: clampedIndex });

        // Dwell detection for zoom activation
        if (!isZoomed) {
            const lastIndex = lastHoverIndexRef.current;
            const indexChanged = lastIndex === null ||
                Math.abs(clampedIndex - lastIndex) > ZOOM_CONFIG.dwellTolerance;

            if (indexChanged) {
                if (dwellTimerRef.current) {
                    clearTimeout(dwellTimerRef.current);
                }
                lastHoverIndexRef.current = clampedIndex;

                dwellTimerRef.current = setTimeout(() => {
                    setZoomCenter(clampedIndex);
                    setIsZoomed(true);
                }, ZOOM_CONFIG.dwellTime);
            }
        } else {
            if (zoomCenter !== null && Math.abs(clampedIndex - zoomCenter) > ZOOM_CONFIG.dwellTolerance * 2) {
                setZoomCenter(clampedIndex);
            }
        }
    };

    const handleMouseLeave = () => {
        if (dwellTimerRef.current) {
            clearTimeout(dwellTimerRef.current);
            dwellTimerRef.current = null;
        }
        lastHoverIndexRef.current = null;
        setIsZoomed(false);
        setZoomCenter(null);
        setHoverInfo(null);
    };

    const handleClick = () => {
        if (hoverInfo) {
            onSelect(hoverInfo.index);
        }
    };

    if (blogs.length === 0) return null;

    const padding = 30;
    const getYFromIndex = (index: number, ref: HTMLDivElement | null) => {
        if (!ref) return padding;
        const usableHeight = ref.clientHeight - padding * 2;
        const normalizedPos = indexToNormalizedPosition(index);
        return padding + normalizedPos * usableHeight;
    };

    return (
        <div
            ref={railRef}
            className="absolute right-0 top-1/2 -translate-y-1/2 w-14 flex flex-col items-center cursor-pointer select-none"
            style={{ height: '70%', minHeight: '300px' }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
        >
            {/* Background track - subtle, minimal */}
            <div
                className="absolute left-1/2 -translate-x-1/2 rounded-full"
                style={{
                    top: padding,
                    bottom: padding,
                    width: isZoomed ? '3px' : '2px',
                    backgroundColor: '#e5e7eb',
                    transition: `width ${ZOOM_CONFIG.transitionMs}ms cubic-bezier(0.4, 0, 0.2, 1)`,
                }}
            />

            {/* Soft gradient overlay when zoomed - like light through a lens */}
            {isZoomed && zoomCenter !== null && (
                <div
                    className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
                    style={{
                        top: padding,
                        bottom: padding,
                        width: '20px',
                        background: `radial-gradient(ellipse 100% 30% at 50% ${
                            ((zoomCenter / Math.max(blogs.length - 1, 1)) * 100)
                        }%, ${oshiColor}15 0%, transparent 70%)`,
                        opacity: 1,
                        transition: `opacity ${ZOOM_CONFIG.transitionMs}ms ease-out`,
                    }}
                />
            )}

            {/* Year markers */}
            {yearGroups.map((group, idx) => {
                const position = getYFromIndex(group.startIndex, railRef.current);
                const prevGroup = yearGroups[idx - 1];
                const prevPosition = prevGroup
                    ? getYFromIndex(prevGroup.startIndex, railRef.current)
                    : -100;

                if (idx > 0 && position - prevPosition < 24) return null;

                return (
                    <div
                        key={group.year}
                        className="absolute flex items-center"
                        style={{
                            top: position,
                            right: '100%',
                            marginRight: '8px',
                            transform: 'translateY(-50%)',
                            transition: `top ${ZOOM_CONFIG.transitionMs}ms cubic-bezier(0.4, 0, 0.2, 1)`,
                        }}
                    >
                        <span
                            className="text-xs font-medium whitespace-nowrap"
                            style={{
                                color: '#9ca3af',
                                letterSpacing: '0.02em',
                            }}
                        >
                            {group.year}
                        </span>
                        <div
                            className="ml-1.5"
                            style={{
                                width: '6px',
                                height: '1px',
                                backgroundColor: '#d1d5db',
                            }}
                        />
                    </div>
                );
            })}

            {/* Current position indicator - elegant dot with soft glow */}
            <div
                className="absolute left-1/2 rounded-full"
                style={{
                    top: getYFromIndex(currentIndex, railRef.current),
                    width: '10px',
                    height: '10px',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: oshiColor,
                    boxShadow: `0 0 12px ${oshiColor}60, 0 0 4px ${oshiColor}40`,
                    transition: `top ${ZOOM_CONFIG.transitionMs}ms cubic-bezier(0.4, 0, 0.2, 1)`,
                }}
            />

            {/* Hover indicator and tooltip */}
            {hoverInfo && blogs[hoverInfo.index] && (
                <>
                    {/* Hover dot - delicate ring instead of solid dot */}
                    <div
                        className="absolute left-1/2 rounded-full pointer-events-none"
                        style={{
                            top: hoverInfo.y,
                            width: '14px',
                            height: '14px',
                            transform: 'translate(-50%, -50%)',
                            border: `2px solid ${isZoomed ? oshiColor : '#9ca3af'}`,
                            backgroundColor: 'transparent',
                            opacity: isZoomed ? 0.9 : 0.6,
                            transition: `border-color ${ZOOM_CONFIG.transitionMs}ms ease, opacity ${ZOOM_CONFIG.transitionMs}ms ease`,
                        }}
                    />

                    {/* Tooltip card */}
                    <div
                        className="absolute right-full mr-4 bg-white rounded-xl pointer-events-none z-50 overflow-hidden"
                        style={{
                            top: Math.min(
                                Math.max(hoverInfo.y, 180),
                                (railRef.current?.clientHeight || 400) - 180
                            ),
                            transform: 'translateY(-50%)',
                            minWidth: '180px',
                            maxWidth: '240px',
                            boxShadow: `
                                0 4px 24px -4px ${oshiColor}25,
                                0 8px 32px -8px rgba(0, 0, 0, 0.12),
                                0 0 0 1px rgba(0, 0, 0, 0.03)
                            `,
                        }}
                    >
                        {/* Thumbnail */}
                        {blogs[hoverInfo.index].thumbnail && (
                            <div
                                className="w-full bg-cover bg-center"
                                style={{
                                    aspectRatio: '3/4',
                                    backgroundImage: `url(${blogs[hoverInfo.index].thumbnail})`,
                                }}
                            />
                        )}
                        <div className="px-3 py-2.5">
                            <div
                                className="text-sm font-medium text-gray-800 line-clamp-2 leading-snug"
                                style={{ fontFamily: '"Noto Serif JP", serif' }}
                            >
                                {blogs[hoverInfo.index].title}
                            </div>
                            <div className="flex items-center justify-between mt-1.5">
                                <span className="text-xs text-gray-400">
                                    {getMonthLabel(blogs[hoverInfo.index].published_at)} {new Date(blogs[hoverInfo.index].published_at).getDate()}, {new Date(blogs[hoverInfo.index].published_at).getFullYear()}
                                </span>
                                <span
                                    className="text-xs tabular-nums"
                                    style={{ color: '#d1d5db' }}
                                >
                                    #{blogs.length - hoverInfo.index}
                                </span>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Position indicator at bottom - refined typography */}
            <div
                className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-xs font-medium whitespace-nowrap tabular-nums"
                style={{
                    color: '#9ca3af',
                    letterSpacing: '0.01em',
                }}
            >
                {blogs.length - currentIndex}/{blogs.length}
            </div>
        </div>
    );
};
