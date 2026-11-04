// frontend/src/features/blogs/components/TimelineRail.tsx
// Pointer shortcut through a member's posts: top = newest, bottom = oldest, with a fisheye
// zoom after a dwell. Keyboard users have ← / → and the older/newer pills.
import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import type { BlogMeta } from '../../../types';
import { Card } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { formatBlogDate } from '../../../utils/dateFormatters';
import { useTranslation } from '../../../i18n';

interface TimelineRailProps {
    blogs: BlogMeta[];
    currentIndex: number;
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
    dwellTime: 800,
    dwellTolerance: 10,
    magnifiedWindow: 50,
    magnification: 5,
};

/** Space above the newest and below the oldest post, in px. */
const RAIL_PADDING = 30;

export const TimelineRail: React.FC<TimelineRailProps> = ({
    blogs,
    currentIndex,
    onSelect,
}) => {
    const { i18n } = useTranslation();
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

    // Fisheye mapping: index → normalized position (0-1)
    const indexToNormalizedPosition = useCallback((index: number): number => {
        if (blogs.length <= 1) return 0;
        const normalizedIndex = index / (blogs.length - 1);

        if (!isZoomed || zoomCenter === null) {
            return normalizedIndex;
        }

        const center = zoomCenter / (blogs.length - 1);
        // Clamp windowSize so magnified region doesn't exceed available space
        const rawWindowSize = ZOOM_CONFIG.magnifiedWindow / (blogs.length - 1);
        const mag = ZOOM_CONFIG.magnification;
        const windowSize = Math.min(rawWindowSize, 0.45 / mag);

        const dist = normalizedIndex - center;
        const absDist = Math.abs(dist);

        if (absDist <= windowSize) {
            const t = absDist / windowSize;
            const eased = t * t * (3 - 2 * t);
            const expandedDist = dist * (1 + (mag - 1) * (1 - eased));
            return Math.max(0, Math.min(1, center + expandedDist));
        } else {
            const magnifiedSpace = windowSize * mag;
            const remainingSpace = Math.max((1 - magnifiedSpace * 2) / 2, 0.01);
            const normalRemaining = Math.max(0.5 - windowSize, 0.001);

            if (dist > 0) {
                const outsideDist = absDist - windowSize;
                const compressedDist = outsideDist * (remainingSpace / normalRemaining);
                return Math.max(0, Math.min(1, center + magnifiedSpace + compressedDist));
            } else {
                const outsideDist = absDist - windowSize;
                const compressedDist = outsideDist * (remainingSpace / normalRemaining);
                return Math.max(0, Math.min(1, center - magnifiedSpace - compressedDist));
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
        const rawWindowSize = ZOOM_CONFIG.magnifiedWindow / (blogs.length - 1);
        const mag = ZOOM_CONFIG.magnification;
        const windowSize = Math.min(rawWindowSize, 0.45 / mag);
        const magnifiedSpace = windowSize * mag;

        const dist = pos - center;
        const absDist = Math.abs(dist);

        let normalizedIndex: number;

        if (absDist <= magnifiedSpace) {
            const sign = dist >= 0 ? 1 : -1;
            const originalDist = (absDist / mag);
            normalizedIndex = center + sign * originalDist;
        } else {
            const remainingSpace = Math.max((1 - magnifiedSpace * 2) / 2, 0.01);
            const normalRemaining = Math.max(0.5 - windowSize, 0.001);

            if (dist > 0) {
                const compressedDist = absDist - magnifiedSpace;
                const originalDist = compressedDist * (normalRemaining / remainingSpace);
                normalizedIndex = center + windowSize + originalDist;
            } else {
                const compressedDist = absDist - magnifiedSpace;
                const originalDist = compressedDist * (normalRemaining / remainingSpace);
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
        const usableHeight = rect.height - RAIL_PADDING * 2;

        const normalizedY = Math.max(0, Math.min(1, (y - RAIL_PADDING) / usableHeight));
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

    const getYFromIndex = (index: number, ref: HTMLDivElement | null) => {
        if (!ref) return RAIL_PADDING;
        const usableHeight = ref.clientHeight - RAIL_PADDING * 2;
        const normalizedPos = indexToNormalizedPosition(index);
        return RAIL_PADDING + normalizedPos * usableHeight;
    };

    const hovered = hoverInfo ? blogs[hoverInfo.index] : undefined;

    return (
        <div
            ref={railRef}
            data-testid="timeline-rail"
            aria-hidden="true"
            className="absolute inset-x-0 top-1/2 flex h-[70%] min-h-[300px] -translate-y-1/2 cursor-pointer select-none flex-col items-center"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
        >
            {/* Track */}
            <div
                className="absolute left-1/2 -translate-x-1/2 border-l-2 border-subtle"
                style={{ top: RAIL_PADDING, bottom: RAIL_PADDING }}
            />

            {/* Year markers (a label is skipped when it would overlap the previous one) */}
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
                        className="absolute right-full mr-2 flex -translate-y-1/2 items-center transition-[top] duration-base ease-standard motion-reduce:transition-none"
                        style={{ top: position }}
                    >
                        <span className="whitespace-nowrap text-caption font-medium text-muted">{group.year}</span>
                        <div className="ml-2 w-1.5 border-t border-strong" />
                    </div>
                );
            })}

            {/* Current post */}
            <div
                className="absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-group-accent shadow-group-glow transition-[top] duration-base ease-standard motion-reduce:transition-none"
                style={{ top: getYFromIndex(currentIndex, railRef.current) }}
            />

            {/* Hover ring and card */}
            {hoverInfo && hovered && (
                <>
                    <div
                        className={cn(
                            'pointer-events-none absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 border-strong',
                            'transition-opacity duration-base ease-standard motion-reduce:transition-none',
                            isZoomed ? 'opacity-90' : 'opacity-60',
                        )}
                        style={{ top: hoverInfo.y }}
                    />

                    <Card
                        className="pointer-events-none absolute right-full z-50 mr-4 min-w-[180px] max-w-[240px] -translate-y-1/2 overflow-hidden"
                        style={{
                            top: Math.min(
                                Math.max(hoverInfo.y, 180),
                                (railRef.current?.clientHeight || 400) - 180
                            ),
                        }}
                    >
                        {hovered.thumbnail && (
                            <div
                                className="aspect-[3/4] w-full bg-sunken bg-cover bg-center"
                                style={{ backgroundImage: `url(${hovered.thumbnail})` }}
                            />
                        )}
                        <div className="flex flex-col gap-1 p-3">
                            <div className="line-clamp-2 font-reading text-small font-semibold text-primary">{hovered.title}</div>
                            <div className="flex items-center justify-between gap-2 text-caption tabular-nums text-muted">
                                <span>{formatBlogDate(new Date(hovered.published_at), i18n.language, 'medium')}</span>
                                <span>#{blogs.length - hoverInfo.index}</span>
                            </div>
                        </div>
                    </Card>
                </>
            )}

            {/* Position, counted from the oldest post */}
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-caption font-medium tabular-nums text-muted">
                {blogs.length - currentIndex}/{blogs.length}
            </div>
        </div>
    );
};
