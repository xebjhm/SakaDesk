import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '../../lib/utils';

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
}

/**
 * SafeImage component that gracefully handles image loading errors.
 * Displays a fallback UI when the image fails to load.
 */
export const SafeImage: React.FC<SafeImageProps> = ({
    src,
    alt = '',
    className,
    loading,
    fallbackContent,
    fallbackText,
}) => {
    const [hasError, setHasError] = useState(false);

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

    return (
        <img
            src={src}
            alt={alt}
            className={className}
            loading={loading}
            onError={() => setHasError(true)}
        />
    );
};
