import React, { useEffect, useRef, useState } from 'react';
import { fetchCachedTranscription, findActiveSegmentIndex } from '../../../hooks/useTranscription';
import { cn } from '../../../utils/classnames';
import { logMemoriesSkip } from '../memoriesLog';
import { MemoryText } from '../shared/MemoryText';
import type { RadioTrack, TranscriptSegment } from '../types';

interface LyricsProps {
    service: string;
    track: RadioTrack;
    /** The playhead, seconds into the media. */
    currentTime: number;
}

type Loaded = { key: string; segments: TranscriptSegment[] | null };

const trackKey = (track: RadioTrack) => `${track.message.room}|${track.message.id}`;

/**
 * Her words under the now-playing card, like lyrics: one line per transcript segment, the one
 * under the playhead highlighted (`aria-current`) and kept in view inside its own scrolling box
 * (only the box scrolls, never the page). A 精選 clip carries its segments; a whole voice with a
 * transcript loads it on demand through the chat's cached-transcript request
 * (`fetchCachedTranscription`). No transcript, a 404 or a failure: nothing is drawn and
 * `memories_skip` `transcript_missing` is logged with the message id. Her words go through
 * `MemoryText` (`%%%` becomes the nickname).
 */
export const Lyrics: React.FC<LyricsProps> = ({ service, track, currentTime }) => {
    const key = trackKey(track);
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const box = useRef<HTMLDivElement>(null);
    const own = track.segments;
    const { id, member_path: memberPath } = track.message;

    useEffect(() => {
        if (own) return;
        if (!track.has_transcript) {
            logMemoriesSkip('radio', 'transcript_missing', { message_id: id });
            return;
        }
        const controller = new AbortController();
        const missing = () => {
            if (controller.signal.aborted) return;
            logMemoriesSkip('radio', 'transcript_missing', { message_id: id });
            setLoaded({ key, segments: null });
        };
        fetchCachedTranscription(service, id, memberPath, controller.signal).then(
            (found) => {
                if (controller.signal.aborted) return;
                if (!found || found.segments.length === 0) {
                    missing();
                    return;
                }
                setLoaded({ key, segments: found.segments.map(({ start, end, text }) => ({ start, end, text })) });
            },
            missing,
        );
        return () => controller.abort();
    }, [service, key, id, memberPath, own, track.has_transcript]);

    const segments = own ?? (loaded?.key === key ? loaded.segments : null);
    const active = segments
        ? findActiveSegmentIndex(segments.map((s) => ({ ...s, confidence: 1 })), currentTime)
        : -1;
    // A clip's segments are padded around: the line is current only while the playhead is inside it.
    const current = active >= 0 && segments && currentTime < segments[active].end + 0.5 ? active : -1;

    useEffect(() => {
        const el = box.current;
        if (!el || current < 0) return;
        const line = el.children[current] as HTMLElement | undefined;
        if (!line) return;
        el.scrollTop = Math.max(0, line.offsetTop - el.clientHeight / 2 + line.offsetHeight / 2);
    }, [current]);

    if (!segments || segments.length === 0) return null;
    return (
        <div ref={box} data-testid="lyrics" className="relative min-h-0 flex-1 overflow-y-auto px-4 py-2">
            {segments.map((seg, i) => (
                <div
                    key={`${seg.start}:${i}`}
                    data-testid="lyrics-line"
                    aria-current={i === current ? 'true' : undefined}
                    className={cn(
                        'py-1 transition-opacity duration-fast ease-standard',
                        i === current ? 'font-display text-title' : 'text-body opacity-60',
                    )}
                >
                    <MemoryText as="span" text={seg.text} />
                </div>
            ))}
        </div>
    );
};
