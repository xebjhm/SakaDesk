import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { useTranslation } from '../../../../i18n';
import { IconButton } from '../../../../design/primitives';
import { cn } from '../../../../utils/classnames';
import { logRecapPlay } from '../../memoriesLog';
import type { S06VoiceData } from '../api';
import { s06Copy, withNickname } from '../recapCopy';
import { ClipSequencer, createAudioElement, type SequencerClip } from '../../shared/clipSequencer';
import { useVoicePlayback } from '../../shared/voicePlayback';
import { Headline, Quote, type SlideProps } from './common';
import { Narration } from '../../shared/typeRoles';
import { heldReveal } from './style';

const KEY = 's06_voice';
/** The slide's key in the Memories voice coordinator. */
const VOICE_KEY = 'recap|s06';

type Phase = 'idle' | 'playing' | 'done';

/**
 * Slide 6, 声: the openings of up to three of her voices (first of the year,
 * longest mid-year, latest), or video audio as the fallback. Nothing plays
 * until the fan presses ▶; then the clips play in sequence with a 300 ms
 * crossfade, transcript subtitles show when present, and the player moves on
 * when the last clip has faded out (`waitsForMedia`). The player's pause holds
 * the voices (a crossfade included) until it resumes; ▶ is disabled while the
 * player is paused, so nothing starts behind a paused story.
 *
 * The slide joins the Memories voice coordinator as `recap|s06`: ▶ stops any other Memories
 * voice, and another voice starting stops the sequence. That external stop is not an end:
 * `onMediaEnd` is not called, `voice_end` is logged with `reason=preempted`, and ▶ comes back.
 */
export const S06Voice: React.FC<SlideProps<S06VoiceData>> = ({ data, fallback, nickname, reducedMotion, paused, onMediaEnd }) => {
    const { t } = useTranslation();
    const copy = s06Copy(data, fallback);
    const clips = useMemo<SequencerClip[]>(
        () => data.clips.flatMap((c) => {
            const url = c.message.media_url;
            return url ? [{ url, start: c.start, end: c.end, segments: c.transcript_segments }] : [];
        }),
        [data.clips],
    );
    const [phase, setPhase] = useState<Phase>('idle');
    const [current, setCurrent] = useState(-1);
    const [subtitle, setSubtitle] = useState<string | null>(null);
    const seq = useRef<ClipSequencer | null>(null);
    const endRef = useRef(onMediaEnd);
    endRef.current = onMediaEnd;
    const skipped = useRef(false);

    // Nothing to play: skip on rather than hold the player on a silent slide.
    useEffect(() => {
        if (clips.length > 0 || skipped.current) return;
        skipped.current = true;
        logRecapPlay('skip', { key: KEY, reason: 'no_media' });
        endRef.current();
    }, [clips.length]);

    const claimVoice = useVoicePlayback((st) => st.play);
    const releaseVoice = useVoicePlayback((st) => st.stop);

    // Leaving the slide: silence the sequence first so the coordinator's stop finds it gone
    // (not a preemption), then release the key.
    useEffect(() => () => {
        seq.current?.stop();
        seq.current = null;
        releaseVoice(VOICE_KEY);
    }, [releaseVoice]);

    // Follow the player's pause, mid-clip or mid-crossfade.
    useEffect(() => {
        if (paused) seq.current?.pause();
        else seq.current?.resume();
    }, [paused]);

    const play = useCallback(() => {
        if (seq.current || clips.length === 0 || paused) return;
        logRecapPlay('voice_start', { key: KEY, count: clips.length, fallback: fallback ?? undefined });
        setPhase('playing');
        /** The sequence ended, or was preempted: later coordinator calls are no-ops. */
        let done = false;
        const s = new ClipSequencer(clips, {
            onClip: (index) => {
                setCurrent(index);
                logRecapPlay('voice_clip', { key: KEY, index });
            },
            onSubtitle: setSubtitle,
            onClipError: (index, code) => logRecapPlay('voice_error', { key: KEY, index, reason: code }),
            onEnd: () => {
                logRecapPlay('voice_end', { key: KEY, count: clips.length });
                setPhase('done');
                setSubtitle(null);
                done = true;
                releaseVoice(VOICE_KEY);
                endRef.current();
            },
        }, createAudioElement);
        // Another Memories voice took over: stop without ending the slide, and offer ▶ again.
        const preempted = () => {
            if (done || seq.current !== s) return false;
            done = true;
            seq.current = null;
            logRecapPlay('voice_end', { key: KEY, count: clips.length, reason: 'preempted' });
            setPhase('idle');
            setCurrent(-1);
            setSubtitle(null);
            return true;
        };
        claimVoice(VOICE_KEY, {
            stop: () => {
                if (preempted()) s.stop();
            },
            fadeOut: async (ms) => {
                if (done || seq.current !== s) return;
                await s.fadeOut(ms);
                preempted();
            },
        });
        seq.current = s;
        s.start();
    }, [clips, fallback, paused, claimVoice, releaseVoice]);

    const lines = heldReveal(reducedMotion, paused, 400);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
            <Headline>{t(copy.title.key, copy.title.params)}</Headline>
            {copy.sub && <Narration className="tabular-nums">{t(copy.sub.key, copy.sub.params)}</Narration>}
            {phase === 'idle' && clips.length > 0 && (
                <div className={cn('flex flex-col items-center gap-3', lines.className)} style={lines.style}>
                    <IconButton
                        variant="accent"
                        aria-label={t('recap.s06.play')}
                        icon={<Play />}
                        onClick={play}
                        disabled={paused}
                        className="pointer-events-auto"
                    />
                    <Narration>{t('recap.s06.hint')}</Narration>
                </div>
            )}
            {phase !== 'idle' && (
                <div className="flex flex-col items-center gap-4">
                    <div aria-hidden="true" className="flex gap-2">
                        {clips.map((c, i) => (
                            <span
                                key={`${c.url}:${i}`}
                                className={cn('h-2 w-2 rounded-full', i === current && phase === 'playing' ? 'bg-accent' : 'bg-sheet')}
                            />
                        ))}
                    </div>
                    {phase === 'playing' && <p role="status" className="sr-only">{t('recap.s06.playing')}</p>}
                    <div className="flex min-h-20 items-center">
                        {subtitle && <Quote className="line-clamp-3">{withNickname(subtitle, nickname)}</Quote>}
                    </div>
                </div>
            )}
        </div>
    );
};
