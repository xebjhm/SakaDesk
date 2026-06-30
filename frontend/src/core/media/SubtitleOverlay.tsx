import React from 'react';
import { type TranscriptionSegment, findActiveSegmentIndex } from '../../hooks/useTranscription';

interface SubtitleOverlayProps {
    segments: TranscriptionSegment[];
    currentTime: number;
    visible: boolean;
    /** Use larger font for fullscreen mode */
    fullscreen?: boolean;
}

/**
 * Semi-transparent subtitle overlay for video playback.
 * Positioned absolutely at the bottom of the video container.
 */
export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
    segments,
    currentTime,
    visible,
    fullscreen,
}) => {
    if (!visible) return null;

    const activeIndex = findActiveSegmentIndex(segments, currentTime);
    if (activeIndex < 0) return null;
    const activeSegment = segments[activeIndex];

    return (
        <div className={`absolute left-1/2 -translate-x-1/2 z-10 pointer-events-none max-w-[80%] ${fullscreen ? 'bottom-16' : 'bottom-10'}`}>
            <span className={`inline-block text-center leading-relaxed bg-black/75 text-white rounded ${fullscreen ? 'text-xl px-5 py-2' : 'text-sm px-3 py-1'}`}>
                {activeSegment.text}
            </span>
        </div>
    );
};
