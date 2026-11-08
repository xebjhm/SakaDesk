import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '../../utils/classnames';

interface SafeImageProps {
    /** Image source URL */
    src: string;
    /** Alt text for accessibility */
    alt?: string;
    /** Additional CSS classes */
    className?: string;
    /** Lazy loading behavior */
    loading?: 'lazy' | 'eager';
    /** Optional fallback content to display on error (defaults to ImageOff icon) */
    fallbackContent?: React.ReactNode;
    /** Optional fallback text shown inside the fallback container */
    fallbackText?: string;
    /**
     * Size/shape classes for a neutral pulsing placeholder (e.g. `h-48 w-64 rounded-card`).
     * When set, the placeholder is shown until the image has loaded. The image
     * stays laid out but invisible meanwhile (never `display:none`, which would
     * stop a lazy image from ever loading); a failed image still shows the fallback.
     */
    skeletonClassName?: string;
}

/**
 * SafeImage component that gracefully handles image loading errors.
 * Displays a fallback UI when the image fails to load.
 */
export const SafeImage: React.FC<SafeImageProps> = (props) => (
    // Keyed on src so loaded/failed state never leaks to a different image.
    <SafeImageInner key={props.src} {...props} />
);

const SafeImageInner: React.FC<SafeImageProps> = ({
    src,
    alt = '',
    className,
    loading,
    fallbackContent,
    fallbackText,
    skeletonClassName,
}) => {
    const [hasError, setHasError] = useState(false);
    const [loaded, setLoaded] = useState(false);

    if (hasError) {
        return (
            <div className={cn("flex items-center justify-center bg-gray-200", className)}>
                {fallbackContent ?? (
                    fallbackText ? (
                        <div className="p-2 text-xs text-gray-600 line-clamp-4 text-center">
                            {fallbackText}
                        </div>
                    ) : (
                        <ImageOff className="w-8 h-8 text-gray-400" />
                    )
                )}
            </div>
        );
    }

    const showSkeleton = Boolean(skeletonClassName) && !loaded;

    return (
        <>
            {showSkeleton && (
                <div
                    data-testid="image-skeleton"
                    aria-hidden="true"
                    className={cn('animate-pulse bg-sunken motion-reduce:animate-none', skeletonClassName)}
                />
            )}
            <img
                src={src}
                alt={alt}
                className={cn(className, showSkeleton && 'pointer-events-none absolute opacity-0')}
                loading={loading}
                onLoad={() => setLoaded(true)}
                onError={() => setHasError(true)}
            />
        </>
    );
};
