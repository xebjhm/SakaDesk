import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChevronRight, ChevronDown, RefreshCw } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { type TranscriptionSegment, findActiveSegmentIndex } from '../../hooks/useTranscription';
import { useCollapseOnOutOfView } from '../../features/messages/hooks/useMessageVisibility';
import { ACCENT, withAlpha } from '../../design/colorMix';
import { cn } from '../../utils/classnames';

interface TranscriptPanelProps {
    segments: TranscriptionSegment[];
    /** Current playback time in seconds (for highlighting active segment) */
    currentTime?: number;
    /** Called when user clicks a segment timestamp to seek */
    onSeek?: (time: number) => void;
    /** Called when user clicks the rerun button to re-transcribe */
    onRerun?: () => void;
    /** Accent color for active segment highlight */
    accentColor?: string;
    /** 'light' for dark backgrounds, 'dark' for light backgrounds */
    variant?: 'light' | 'dark';
    /** Start expanded or collapsed */
    defaultExpanded?: boolean;
    /**
     * The media has no audible speech (e.g. a silent video with no audio
     * track). Renders a short "no speech" note instead of an empty, expandable
     * segment list — no transcript was fabricated.
     */
    noSpeech?: boolean;
    /**
     * Message ID for auto-collapse when scrolled out of the visible range.
     * Omit for non-virtualized usages (modals).
     */
    messageId?: number;
    /**
     * When true, render the segment list with a translucent backdrop + padding.
     * Intended for the media gallery's premium voice player where the panel
     * sits over a gradient-blur bar and raw text would be hard to read.
     * Off by default so chat bubbles and other contexts keep their flat look.
     */
    withBackdrop?: boolean;
}

/**
 * Collapsible transcript panel showing timeline-synced segments.
 * Active segment highlights during playback. Click timestamps to seek.
 */
const TranscriptPanelInner: React.FC<TranscriptPanelProps> = ({
    segments,
    currentTime = 0,
    onSeek,
    onRerun,
    accentColor = ACCENT,
    variant = 'dark',
    defaultExpanded = false,
    messageId,
    withBackdrop = false,
    noSpeech = false,
}) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(defaultExpanded);
    const activeRef = useRef<HTMLButtonElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const userScrolledRef = useRef(false);

    // Auto-collapse when message leaves the virtualized visible range.
    const collapse = useCallback(() => setExpanded(false), []);
    useCollapseOnOutOfView(messageId, expanded, collapse);

    // Find active segment (memoized — recomputes only when time/segments change, not on
    // every parent render).
    const activeIndex = useMemo(
        () => findActiveSegmentIndex(segments, currentTime),
        [segments, currentTime]
    );

    // Auto-scroll active segment to center (music app dynamic lyrics style).
    // Use getBoundingClientRect rather than offsetTop — the latter depends on
    // the offsetParent chain (positioned ancestors), which can differ when
    // the panel is nested inside variants that add positioned wrappers
    // (e.g. the gallery voice card). Rects + the container's current
    // scrollTop give the element's true position within the scrollable
    // content regardless of positioning context.
    useEffect(() => {
        if (expanded && activeRef.current && containerRef.current && !userScrolledRef.current) {
            const container = containerRef.current;
            const element = activeRef.current;
            const containerRect = container.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            const elementTopWithinScroll =
                elementRect.top - containerRect.top + container.scrollTop;
            const scrollTarget =
                elementTopWithinScroll - container.clientHeight / 2 + element.clientHeight / 2;
            container.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' });
        }
    }, [activeIndex, expanded]);

    // Reset user scroll flag when active segment changes
    // (user scrolled away, but when a new segment becomes active, resume auto-scroll)
    useEffect(() => {
        userScrolledRef.current = false;
    }, [activeIndex]);

    const isLight = variant === 'light';

    // Text colours from tokens. On light surfaces (`dark`) every role is text-secondary or darker,
    // which TranscriptPanel.contrast.test.tsx measures at >= 4.5:1 on white, sunken, elevated and the
    // group tints (text-muted falls below that on the tints). The toggle is neutral (a disclosure
    // control); the group colour stays only on the active line: its tint and its time, the latter in
    // the contrast-safe accent-tonal step (the 800 text step). The dark viewer (`light`) uses the viewer text tokens.
    const tone = isLight
        ? { meta: 'text-viewer-muted', line: 'text-viewer-muted', active: 'text-viewer', activeTime: 'text-viewer-muted', activeBg: 'bg-viewer-control' }
        : { meta: 'text-secondary', line: 'text-secondary', active: 'text-primary', activeTime: 'text-accent-tonal', activeBg: '' };

    const formatTimestamp = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const Chevron = expanded ? ChevronDown : ChevronRight;

    // No audible speech: show a short static note (not an empty, expandable
    // list). The rerun button stays so the user can retry if they disagree.
    if (noSpeech) {
        return (
            <div className={cn('flex items-center gap-1.5 py-1 text-caption', tone.meta)}>
                <span>{t('transcription.transcript')}</span>
                <span>· {t('transcription.noSpeech')}</span>
                {onRerun && (
                    <button
                        onClick={onRerun}
                        className={cn('rounded-xs p-0.5 transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ring-offset-0', tone.meta)}
                        type="button"
                        title={t('transcription.rerun')}
                        aria-label={t('transcription.rerun')}
                    >
                        <RefreshCw aria-hidden="true" className="h-3 w-3" />
                    </button>
                )}
            </div>
        );
    }

    return (
        <div>
            {/* Toggle header */}
            <div className="flex items-center gap-1">
                <button
                    onClick={() => setExpanded(!expanded)}
                    aria-expanded={expanded}
                    className={cn(
                        'flex items-center gap-1 rounded-xs py-1 text-left text-caption transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ring-offset-0',
                        isLight ? tone.meta : 'text-secondary hover:text-primary',
                    )}
                    type="button"
                >
                    <Chevron aria-hidden="true" className="h-3 w-3" />
                    {t('transcription.transcript')}
                </button>
                {onRerun && (
                    <button
                        onClick={onRerun}
                        className={cn('rounded-xs p-0.5 transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ring-offset-0', tone.meta)}
                        type="button"
                        title={t('transcription.rerun')}
                        aria-label={t('transcription.rerun')}
                    >
                        <RefreshCw aria-hidden="true" className="h-3 w-3" />
                    </button>
                )}
            </div>

            {/* Segments — optional translucent backdrop (withBackdrop) keeps
                text readable over gradients / backdrop-blur bars. Off by
                default for chat bubbles and other flat surfaces. */}
            {expanded && (
                <div
                    ref={containerRef}
                    className={`max-h-32 overflow-y-auto text-caption leading-relaxed mt-1${
                        withBackdrop
                            ? ` rounded-sm px-2 py-1.5 backdrop-blur-sm ${isLight ? 'bg-black/40' : 'bg-white/85'}`
                            : ''
                    }`}
                    // Mark "user scrolled" only on real input (wheel/touch), not on
                    // the browser scroll events emitted by our own smooth scrollTo —
                    // using onScroll here latched the flag after each auto-scroll and
                    // made centering skip every other active segment.
                    onWheel={() => { userScrolledRef.current = true; }}
                    onTouchMove={() => { userScrolledRef.current = true; }}
                >
                    {segments.map((seg, i) => {
                        const isActive = i === activeIndex;
                        const lowConfidence = seg.confidence < 0.4;
                        return (
                            <button
                                key={i}
                                ref={isActive ? activeRef : undefined}
                                type="button"
                                aria-current={isActive ? 'true' : undefined}
                                className={cn(
                                    'block w-full rounded-xs px-1 py-0.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ring-offset-0',
                                    isActive && tone.activeBg,
                                )}
                                style={isActive && !isLight ? { background: withAlpha(accentColor, 8) } : undefined}
                                onClick={() => onSeek?.(seg.start)}
                            >
                                <span
                                    className={cn('mr-1.5 tabular-nums', isActive ? tone.activeTime : tone.meta)}
                                >
                                    {formatTimestamp(seg.start)}
                                </span>
                                <span
                                    lang="ja"
                                    className={cn(
                                        isActive ? cn(tone.active, 'font-medium') : tone.line,
                                        lowConfidence && 'underline decoration-dotted underline-offset-2',
                                        // The warning text colour is nearly invisible on the dark viewer: its underline token there.
                                        lowConfidence && isLight && 'decoration-viewer',
                                    )}
                                    style={lowConfidence && !isLight ? { textDecorationColor: 'var(--ds-semantic-warning-text)' } : undefined}
                                    title={lowConfidence ? `⚠ ${t('transcription.lowConfidence', { pct: Math.round(seg.confidence * 100) })}` : undefined}
                                >
                                    {seg.text}
                                </span>
                            </button>
                        );
                    })}
                    <div className={cn('mt-1 text-right text-caption', tone.meta)}>
                        {t('transcription.clickToJump')}
                    </div>
                </div>
            )}
        </div>
    );
};

// Memoized: parents (VoicePlayer/VideoPlayer) re-render at playback frame rate; this
// only needs to re-render when its own props (segments/currentTime/...) change.
export const TranscriptPanel = React.memo(TranscriptPanelInner);
