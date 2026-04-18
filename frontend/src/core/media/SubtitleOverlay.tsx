import React from 'react';
import type { TranscriptionSegment } from '../../hooks/useTranscription';

interface SubtitleOverlayProps {
    segments: TranscriptionSegment[];
    currentTime: number;
    visible: boolean;
}

/**
 * Semi-transparent subtitle overlay for video playback.
 * Positioned absolutely at the bottom of the video container.
 */
export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
    segments,
    currentTime,
    visible,
}) => {
    if (!visible) return null;

    const activeSegment = segments.find(
        (seg, i) =>
            currentTime >= seg.start &&
            (i === segments.length - 1 || currentTime < segments[i + 1].start)
    );

    if (!activeSegment) return null;

    return (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 pointer-events-none max-w-[80%]">
            <span className="bg-black/75 text-white text-sm px-3 py-1 rounded">
                {activeSegment.text}
            </span>
        </div>
    );
};
