import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '../../utils/classnames';

interface PhotoPlayerProps {
    src: string;
    /**
     * Single source of truth for how this photo is displayed.
     *  - `bubble`     — inline thumbnail in a chat bubble or similar.
     *                   Click opens the fullscreen viewer.
     *  - `fullscreen` — large image inside MediaViewerModal. Accepts
     *                   a `zoom` factor and a `pan` offset for the
     *                   viewer's zoom and pan.
     *
     * Gallery grids use the media pipeline's `MediaTile` (core/media/grid) instead.
     */
    variant: 'bubble' | 'fullscreen';
    /** Click handler — typically opens the fullscreen viewer */
    onClick?: () => void;
    /** Alt text for accessibility */
    alt?: string;
    /** Lazy-load hint. Default `eager` (the user is looking at it right now). */
    loading?: 'lazy' | 'eager';
    /** Fullscreen-only zoom factor (1 = 100%). */
    zoom?: number;
    /** Fullscreen-only pan offset in px, applied before the zoom (0, 0 = centred). */
    pan?: { x: number; y: number };
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
    /**
     * Bubble only: called once the shown image has loaded (or was already complete from the
     * cache on mount). Given it, the image starts transparent and fades in at that moment (the
     * caller shows the pending state meanwhile); without it the image paints as it arrives.
     */
    onLoad?: () => void;
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
 * Unified photo display. Picks one of two visual treatments based on
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
    className,
    onError,
    fallbackSrc,
    onLoad,
}) => {
    const [hasError, setHasError] = useState(false);
    // The `src` that failed while a `fallbackSrc` was given: the image then shows the fallback.
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    // Fullscreen instances are reused across navigation (arrow keys change `src`
    // on the same component). Without this reset, one broken/missing photo latches
    // hasError=true and every later photo in the session renders as broken.
    useEffect(() => { setHasError(false); }, [src]);
    const effectiveLoading = loading ?? 'eager';
    const shownSrc = fallbackSrc && failedSrc === src ? fallbackSrc : src;
    // Bubble fade-in: the src that has loaded. A new src (or the switch to the fallback) starts transparent again.
    const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const onLoadRef = useRef(onLoad);
    useLayoutEffect(() => { onLoadRef.current = onLoad; });
    // Reported once per src: a cached image seen complete on mount may still fire its load event.
    const reportedSrcRef = useRef<string | null>(null);
    const markLoaded = (loaded: string) => {
        setLoadedSrc(loaded);
        if (reportedSrcRef.current === loaded) return;
        reportedSrcRef.current = loaded;
        onLoadRef.current?.();
    };
    // An image already in the cache is complete before React can attach onLoad: show it at once
    // (before paint, so it never flashes transparent). naturalWidth 0 means complete but broken.
    useLayoutEffect(() => {
        if (variant !== 'bubble') return;
        const img = imgRef.current;
        if (img?.complete && img.naturalWidth > 0) markLoaded(shownSrc);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- markLoaded only touches state and refs
    }, [variant, shownSrc]);

    const fallback = (extraClasses?: string) => <PhotoFallback className={extraClasses} />;
    const fail = () => {
        if (fallbackSrc && shownSrc !== fallbackSrc) {
            setFailedSrc(src);
            return;
        }
        setHasError(true);
        onError?.();
    };

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
            ref={imgRef}
            src={shownSrc}
            alt={alt}
            loading={effectiveLoading}
            onClick={onClick}
            onError={fail}
            onLoad={() => markLoaded(shownSrc)}
            className={cn(
                'w-full h-full object-contain',
                onLoad && 'transition-opacity duration-base ease-standard motion-reduce:transition-none',
                onLoad && (loadedSrc === shownSrc ? 'opacity-100' : 'opacity-0'),
                onClick && 'cursor-pointer',
                className,
            )}
        />
    );
};
