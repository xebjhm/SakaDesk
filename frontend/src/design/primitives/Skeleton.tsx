import React from 'react';
import { cn } from '../../utils/classnames';

/** The placeholder pulse; static under reduced motion. */
export const SKELETON_PULSE = 'animate-pulse motion-reduce:animate-none';

export type SkeletonShape = 'line' | 'block' | 'circle' | 'tile';
export type SkeletonTone = 'sunken' | 'paper' | 'data';

export interface SkeletonProps {
    /** line: a text line; block: a card-shaped box; circle: an avatar; tile: a square media tile. */
    shape: SkeletonShape;
    /**
     * sunken (default: `bg-skeleton-veil`, a translucent ink veil that shows on sheets, cards, the
     * sunken band and tinted bands) / paper (`bg-skeleton`, on paper and cork) / data (no colour:
     * the caller paints it via `style`).
     */
    tone?: SkeletonTone;
    className?: string;
    /** Data-driven colour only (DESIGN_SYSTEM "data-driven exception"), e.g. a photo's mean colour with `tone="data"`. */
    style?: React.CSSProperties;
}

const SHAPE: Record<SkeletonShape, string> = {
    line: 'h-3 rounded-pill',
    block: 'rounded-card',
    circle: 'rounded-pill aspect-square',
    tile: 'aspect-square rounded-sm',
};
const TONE: Record<SkeletonTone, string> = { sunken: 'bg-skeleton-veil', paper: 'bg-skeleton', data: '' };

/**
 * A layout-shaped placeholder. Always `aria-hidden`: the parent region carries `role="status"` and
 * a label (`StatusBlock` does this). Size it with width / height classes.
 */
export const Skeleton: React.FC<SkeletonProps> = ({ shape, tone = 'sunken', className, style }) => (
    <div aria-hidden="true" data-skeleton className={cn(SKELETON_PULSE, SHAPE[shape], TONE[tone], className)} style={style} />
);
