import React, { useState, useRef, useEffect } from 'react';
import { Film } from 'lucide-react';
import { cn } from '../../utils/classnames';
import { useMediaSource } from './mediaElement';

interface LazyVideoProps {
    src: string;
    className?: string;
    children?: React.ReactNode;  // Overlay content (mute icon, duration badge)
    onClick?: () => void;
}

/**
 * LazyVideo component that loads video only when visible in viewport.
 * Shows a placeholder with film icon until the video enters viewport,
 * then fades in smoothly once the video metadata is loaded. The video is
 * released (pause, drop src, load) on unmount so a thumbnail scrolled away or
 * a closed gallery never keeps a media connection open.
 */
export const LazyVideo: React.FC<LazyVideoProps> = ({
    src,
    className,
    children,
    onClick,
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);
    const containerRef = useRef<HTMLButtonElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    // Bound once the <video> is mounted (it renders only when visible).
    useMediaSource(videoRef, isVisible ? src : undefined);

    // Intersection Observer to detect when component enters viewport
    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setIsVisible(true);
                        // Once visible, we don't need to observe anymore
                        observer.unobserve(element);
                    }
                });
            },
            {
                // Start loading slightly before element enters viewport
                rootMargin: '100px',
                threshold: 0,
            }
        );

        observer.observe(element);

        return () => {
            observer.disconnect();
        };
    }, []);

    // Handle video loaded event
    const handleLoadedData = () => {
        setIsLoaded(true);
    };

    return (
        <button
            ref={containerRef}
            onClick={onClick}
            className={cn("relative overflow-hidden bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent", className)}
        >
            {/* Placeholder - visible until video loads */}
            <div
                className={cn(
                    "absolute inset-0 flex items-center justify-center bg-sunken transition-opacity duration-base ease-standard",
                    isLoaded ? "opacity-0" : "opacity-100"
                )}
            >
                <Film className="h-8 w-8 text-secondary" />
            </div>

            {/* Video - only render when visible, fade in when loaded */}
            {isVisible && (
                <video
                    ref={videoRef}
                    className={cn(
                        "h-full w-full object-cover transition-opacity duration-base ease-standard",
                        isLoaded ? "opacity-100" : "opacity-0"
                    )}
                    preload="metadata"
                    onLoadedData={handleLoadedData}
                />
            )}

            {/* Overlay children (mute icon, duration badge) - always visible */}
            {children}
        </button>
    );
};
