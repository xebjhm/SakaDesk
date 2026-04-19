import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useTranslation } from '../../i18n';
import type { TranscriptionSegment } from '../../hooks/useTranscription';

interface TranscriptPanelProps {
    segments: TranscriptionSegment[];
    /** Current playback time in seconds (for highlighting active segment) */
    currentTime?: number;
    /** Called when user clicks a segment timestamp to seek */
    onSeek?: (time: number) => void;
    /** Accent color for active segment highlight */
    accentColor?: string;
    /** 'light' for dark backgrounds, 'dark' for light backgrounds */
    variant?: 'light' | 'dark';
    /** Start expanded or collapsed */
    defaultExpanded?: boolean;
}

/**
 * Collapsible transcript panel showing timeline-synced segments.
 * Active segment highlights during playback. Click timestamps to seek.
 */
export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
    segments,
    currentTime = 0,
    onSeek,
    accentColor = '#6da0d4',
    variant = 'dark',
    defaultExpanded = false,
}) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(defaultExpanded);
    const activeRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const userScrolledRef = useRef(false);

    // Find active segment
    const activeIndex = segments.findIndex(
        (seg, i) =>
            currentTime >= seg.start &&
            (i === segments.length - 1 || currentTime < segments[i + 1].start)
    );

    // Auto-scroll active segment to center (music app dynamic lyrics style)
    useEffect(() => {
        if (expanded && activeRef.current && containerRef.current && !userScrolledRef.current) {
            const container = containerRef.current;
            const element = activeRef.current;
            const containerHeight = container.clientHeight;
            const elementTop = element.offsetTop - container.offsetTop;
            const elementHeight = element.clientHeight;
            // Center the active element in the container
            const scrollTarget = elementTop - (containerHeight / 2) + (elementHeight / 2);
            container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
        }
    }, [activeIndex, expanded]);

    // Reset user scroll flag when active segment changes
    // (user scrolled away, but when a new segment becomes active, resume auto-scroll)
    useEffect(() => {
        userScrolledRef.current = false;
    }, [activeIndex]);

    const isLight = variant === 'light';

    const formatTimestamp = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const Chevron = expanded ? ChevronDown : ChevronRight;

    return (
        <div>
            {/* Toggle header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-xs w-full text-left py-1"
                style={{ color: isLight ? 'rgba(255,255,255,0.5)' : accentColor }}
                type="button"
            >
                <Chevron className="w-3 h-3" />
                {t('transcription.transcript')}
            </button>

            {/* Segments */}
            {expanded && (
                <div
                    ref={containerRef}
                    className="max-h-32 overflow-y-auto text-xs leading-relaxed mt-1"
                    onScroll={() => { userScrolledRef.current = true; }}
                >
                    {segments.map((seg, i) => {
                        const isActive = i === activeIndex;
                        return (
                            <div
                                key={i}
                                ref={isActive ? activeRef : undefined}
                                className="py-0.5 px-1 rounded cursor-pointer transition-colors"
                                style={isActive ? {
                                    background: isLight ? `rgba(255,255,255,0.08)` : `${accentColor}15`,
                                } : undefined}
                                onClick={() => onSeek?.(seg.start)}
                            >
                                <span
                                    className="tabular-nums mr-1.5"
                                    style={{
                                        color: isActive
                                            ? (isLight ? 'rgba(255,255,255,0.7)' : accentColor)
                                            : (isLight ? 'rgba(255,255,255,0.3)' : '#999'),
                                    }}
                                >
                                    {formatTimestamp(seg.start)}
                                </span>
                                <span
                                    style={{
                                        color: isActive
                                            ? (isLight ? 'rgba(255,255,255,0.9)' : '#333')
                                            : (isLight ? 'rgba(255,255,255,0.4)' : '#666'),
                                        fontWeight: isActive ? 500 : 400,
                                        // Low confidence segments get a dashed underline
                                        ...(seg.confidence < 0.4 ? {
                                            textDecoration: 'underline',
                                            textDecorationStyle: 'dotted' as const,
                                            textDecorationColor: isLight ? 'rgba(255,200,100,0.5)' : '#d97706',
                                            textUnderlineOffset: '3px',
                                        } : {}),
                                    }}
                                    title={seg.confidence < 0.4 ? `⚠ Low confidence (${Math.round(seg.confidence * 100)}%)` : undefined}
                                >
                                    {seg.text}
                                </span>
                            </div>
                        );
                    })}
                    <div
                        className="text-right mt-1"
                        style={{ color: isLight ? 'rgba(255,255,255,0.2)' : '#bbb', fontSize: '10px' }}
                    >
                        {t('transcription.clickToJump')}
                    </div>
                </div>
            )}
        </div>
    );
};
