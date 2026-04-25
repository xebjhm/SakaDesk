import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '../../utils/classnames';

interface PhotoPlayerProps {
    src: string;
    /**
     * Single source of truth for how this photo is displayed.
     *  - `bubble`        — inline thumbnail in a chat bubble or similar.
     *                      Click opens the fullscreen viewer.
     *  - `gallery-thumb` — square thumbnail in a grid (media gallery,
     *                      blog photo gallery). Click opens the viewer.
     *  - `fullscreen`    — large image inside MediaViewerModal. Accepts
     *                      a `zoom` factor for the in-modal zoom controls.
     */
    variant: 'bubble' | 'gallery-thumb' | 'fullscreen';
    /** Click handler — typically opens the fullscreen viewer */
    onClick?: () => void;
    /** Alt text for accessibility */
    alt?: string;
    /**
     * Lazy-load hint. Defaults: `lazy` for `gallery-thumb`, `eager` for
     * the others (the user is looking at them right now).
     */
    loading?: 'lazy' | 'eager';
    /** Fullscreen-only zoom factor (1 = 100%). */
    zoom?: number;
    /**
     * Ref callback applied to the outer `<button>` for `gallery-thumb`.
     * Used by the gallery list to anchor jump-to-date scrolling.
     */
    anchorRef?: (el: HTMLButtonElement | null) => void;
    /**
     * Override the outer container className. Most callers don't need
     * this — the variants ship with sensible defaults.
     */
    className?: string;
}

/**
 * Unified photo display. Picks one of three visual treatments based on
 * `variant` and shares a single error-fallback path so missing/broken
 * images degrade the same way everywhere.
 */
export const PhotoPlayer: React.FC<PhotoPlayerProps> = ({
    src,
    variant,
    onClick,
    alt = '',
    loading,
    zoom = 1,
    anchorRef,
    className,
}) => {
    const [hasError, setHasError] = useState(false);

    const fallback = (extraClasses?: string) => (
        <div className={cn('flex items-center justify-center bg-gray-200', extraClasses)}>
            <ImageOff className="w-8 h-8 text-gray-400" />
        </div>
    );

    if (variant === 'gallery-thumb') {
        const effectiveLoading = loading ?? 'lazy';
        return (
            <button
                ref={anchorRef}
                type="button"
                onClick={onClick}
                className={cn('aspect-square relative bg-gray-100 cursor-pointer', className)}
            >
                {hasError ? (
                    fallback('w-full h-full')
                ) : (
                    <img
                        src={src}
                        alt={alt}
                        loading={effectiveLoading}
                        className="w-full h-full object-cover"
                        onError={() => setHasError(true)}
                    />
                )}
            </button>
        );
    }

    if (variant === 'fullscreen') {
        const effectiveLoading = loading ?? 'eager';
        if (hasError) return fallback('max-w-[90vw] max-h-[90vh] aspect-video');
        return (
            <img
                src={src}
                alt={alt}
                loading={effectiveLoading}
                draggable={false}
                onError={() => setHasError(true)}
                className={cn('max-w-[90vw] max-h-[90vh] object-contain transition-transform duration-150', className)}
                style={{ transform: `scale(${zoom})` }}
            />
        );
    }

    // bubble (default for in-chat thumbnails)
    const effectiveLoading = loading ?? 'eager';
    if (hasError) return fallback(cn('w-full h-full', className));
    return (
        <img
            src={src}
            alt={alt}
            loading={effectiveLoading}
            onClick={onClick}
            onError={() => setHasError(true)}
            className={cn('w-full h-full object-contain', onClick && 'cursor-pointer', className)}
        />
    );
};
