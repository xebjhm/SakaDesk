import React, { useState, useEffect } from 'react';
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
     *                      a `zoom` factor and a `pan` offset for the
     *                      viewer's zoom and pan.
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
    /** Fullscreen-only pan offset in px, applied before the zoom (0, 0 = centred). */
    pan?: { x: number; y: number };
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
    /** Called once when the image fails to load and the fallback is shown (breadcrumbs). */
    onError?: () => void;
    /**
     * Loaded instead when `src` fails (a thumbnail's full file). Only once `fallbackSrc` fails
     * too is the broken-photo look shown and `onError` called.
     */
    fallbackSrc?: string;
}

/**
 * The shared missing / broken photo look: a neutral `bg-sunken` box with the image-off icon.
 * Given a `label`, it is announced as an image with that name; otherwise it is decorative.
 */
export const PhotoFallback: React.FC<{ className?: string; label?: string }> = ({ className, label }) => (
    <div
        className={cn('flex items-center justify-center bg-sunken', className)}
        role={label ? 'img' : undefined}
        aria-label={label}
    >
        <ImageOff className="h-8 w-8 text-muted" aria-hidden="true" />
    </div>
);

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
    pan,
    anchorRef,
    className,
    onError,
    fallbackSrc,
}) => {
    const [hasError, setHasError] = useState(false);
    // The `src` that failed while a `fallbackSrc` was given: the image then shows the fallback.
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    // Fullscreen instances are reused across navigation (arrow keys change `src`
    // on the same component). Without this reset, one broken/missing photo latches
    // hasError=true and every later photo in the session renders as broken.
    useEffect(() => { setHasError(false); }, [src]);
    const effectiveLoading = loading ?? (variant === 'gallery-thumb' ? 'lazy' : 'eager');
    const shownSrc = fallbackSrc && failedSrc === src ? fallbackSrc : src;

    const fallback = (extraClasses?: string) => <PhotoFallback className={extraClasses} />;
    const fail = () => {
        if (fallbackSrc && shownSrc !== fallbackSrc) {
            setFailedSrc(src);
            return;
        }
        setHasError(true);
        onError?.();
    };

    if (variant === 'gallery-thumb') {
        return (
            <button
                ref={anchorRef}
                type="button"
                onClick={onClick}
                className={cn('relative aspect-square cursor-pointer bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', className)}
            >
                {hasError ? (
                    fallback('w-full h-full')
                ) : (
                    <img
                        src={shownSrc}
                        alt={alt}
                        loading={effectiveLoading}
                        className="w-full h-full object-cover"
                        onError={fail}
                    />
                )}
            </button>
        );
    }

    if (variant === 'fullscreen') {
        if (hasError) return fallback('max-w-[90vw] max-h-[90vh] aspect-video');
        return (
            <img
                src={shownSrc}
                alt={alt}
                loading={effectiveLoading}
                draggable={false}
                onError={fail}
                className={cn('max-w-[90vw] max-h-[90vh] object-contain transition-transform duration-fast ease-standard motion-reduce:transition-none', className)}
                style={{ transform: `translate(${pan?.x ?? 0}px, ${pan?.y ?? 0}px) scale(${zoom})` }}
            />
        );
    }

    // bubble (default for in-chat thumbnails)
    if (hasError) return fallback(cn('w-full h-full', className));
    return (
        <img
            src={shownSrc}
            alt={alt}
            loading={effectiveLoading}
            onClick={onClick}
            onError={fail}
            className={cn('w-full h-full object-contain', onClick && 'cursor-pointer', className)}
        />
    );
};
