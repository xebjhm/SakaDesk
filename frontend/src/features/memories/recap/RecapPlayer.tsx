import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, X } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Atmosphere, IconButton } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { logRecapPlay } from '../memoriesLog';
import type { RecapPayload, RecapSlide } from './api';
import { SLIDE_REGISTRY, type SlideRegistry } from './slideRegistry';

/** Each slide shows this long before the player moves on. */
export const AUTO_ADVANCE_MS = 7000;

type StepReason = 'auto' | 'key' | 'click' | 'media';

function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false);
}

function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState(prefersReducedMotion);
    useEffect(() => {
        const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        if (!mq?.addEventListener) return;
        const onChange = () => setReduced(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    return reduced;
}

/** Keys belong to the player only when nothing else wants them (a field, a dialog, an IME). */
function keyIsOurs(e: KeyboardEvent): boolean {
    if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return false;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return false;
    return document.querySelector('[aria-modal="true"]') === null;
}

interface SegmentProps {
    state: 'done' | 'todo' | 'current';
    /** Fraction already shown of the current slide (0..1). */
    from: number;
    /** Remaining time of the current slide, or null when it is not counting down. */
    remainingMs: number | null;
    reducedMotion: boolean;
}

/** One IG-style progress segment; the current one fills linearly over the remaining time. */
const Segment: React.FC<SegmentProps> = ({ state, from, remainingMs, reducedMotion }) => {
    const [armed, setArmed] = useState(false);
    const counting = state === 'current' && remainingMs !== null && !reducedMotion;
    useEffect(() => {
        setArmed(false);
        if (!counting) return;
        const id = requestAnimationFrame(() => setArmed(true));
        return () => cancelAnimationFrame(id);
    }, [counting, from, remainingMs]);
    let width = 0;
    if (state === 'done') width = 1;
    else if (state === 'current') width = reducedMotion ? 1 : counting && armed ? 1 : from;
    return (
        <div data-testid="recap-progress-segment" data-state={state} className="h-1 flex-1 overflow-hidden rounded-full bg-sheet">
            <div
                className="h-full bg-accent"
                style={{
                    width: `${width * 100}%`,
                    transitionProperty: counting && armed ? 'width' : 'none',
                    transitionDuration: counting && armed ? `${remainingMs}ms` : undefined,
                    transitionTimingFunction: 'linear',
                }}
            />
        </div>
    );
};

export interface RecapPlayerProps {
    recap: RecapPayload;
    /** The fan's nickname, already resolved (never empty). */
    nickname: string;
    onClose: () => void;
    /** The last slide finished (the poster follows in a later task). */
    onEnd?: () => void;
    /** Test seam / later tasks: the slide renderers. */
    registry?: SlideRegistry;
}

/**
 * The year recap story player: a 9:16 stage centred in the pane on the context's
 * orbs, IG-style progress segments, → / click right for the next slide, ← / click
 * left for the previous one, Space to pause, Esc to close. Slides advance after
 * {@link AUTO_ADVANCE_MS}; a slide that waits for media advances when its
 * playback ends. With prefers-reduced-motion nothing animates.
 */
export const RecapPlayer: React.FC<RecapPlayerProps> = ({ recap, nickname, onClose, onEnd, registry = SLIDE_REGISTRY }) => {
    const { t } = useTranslation();
    const reducedMotion = useReducedMotion();
    const memberId = /^[a-z0-9_]{1,40}$/.test(recap.member.id) ? recap.member.id : undefined;

    const slides = useMemo(() => recap.slides.filter((s) => registry[s.key]), [recap.slides, registry]);
    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const [ended, setEnded] = useState(false);
    // Time already shown of the slide at `index` (kept across pauses).
    const elapsed = useRef<{ index: number; ms: number }>({ index: 0, ms: 0 });
    const [pausedAt, setPausedAt] = useState(0);
    const [restart, setRestart] = useState(0);
    const endedRef = useRef(false);

    useEffect(() => {
        for (const s of recap.slides) {
            if (!registry[s.key]) logRecapPlay('skip', { key: s.key, reason: 'not_built', member_id: memberId });
        }
        logRecapPlay('open', { count: slides.length, member_id: memberId });
        // Once per opened recap.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recap]);

    const slide: RecapSlide | undefined = slides[index];
    const entry = slide ? registry[slide.key] : undefined;
    const waits = !!entry?.waitsForMedia;

    const finish = useCallback(() => {
        if (endedRef.current) return;
        endedRef.current = true;
        setEnded(true);
        logRecapPlay('end', { count: slides.length, member_id: memberId });
        onEnd?.();
    }, [slides.length, memberId, onEnd]);

    const go = useCallback((delta: 1 | -1, reason: StepReason) => {
        const next = index + delta;
        if (next >= slides.length) {
            finish();
            return;
        }
        const target = Math.max(0, next);
        elapsed.current = { index: target, ms: 0 };
        setPausedAt(0);
        if (target === index) {
            setRestart((n) => n + 1);
            return;
        }
        endedRef.current = false;
        setEnded(false);
        setIndex(target);
        logRecapPlay('step', { index: target, key: slides[target].key, reason, member_id: memberId });
    }, [index, slides, finish, memberId]);

    const togglePause = useCallback(() => {
        setPaused((p) => {
            logRecapPlay(p ? 'resume' : 'pause', { index, member_id: memberId });
            return !p;
        });
    }, [index, memberId]);

    const close = useCallback(() => {
        logRecapPlay('close', { index, member_id: memberId });
        onClose();
    }, [index, memberId, onClose]);

    const goRef = useRef(go);
    goRef.current = go;

    // Auto-advance: count down what is left of this slide; a pause banks the time shown.
    useEffect(() => {
        if (paused || ended || waits || !slide) return;
        const at = index;
        const shown = elapsed.current.index === at ? elapsed.current.ms : 0;
        const started = Date.now();
        const timer = setTimeout(() => goRef.current(1, 'auto'), Math.max(0, AUTO_ADVANCE_MS - shown));
        return () => {
            clearTimeout(timer);
            if (elapsed.current.index === at) {
                elapsed.current = { index: at, ms: shown + (Date.now() - started) };
                setPausedAt(Math.min(1, elapsed.current.ms / AUTO_ADVANCE_MS));
            }
        };
    }, [index, paused, ended, waits, slide, restart]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!keyIsOurs(e)) return;
            if (e.key === 'ArrowRight') { e.preventDefault(); go(1, 'key'); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1, 'key'); }
            else if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); togglePause(); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [go, togglePause, close]);

    const onMediaEnd = useCallback(() => {
        if (slides[index] === slide) go(1, 'media');
    }, [slides, index, slide, go]);

    if (!slide || !entry) return null;
    const Slide = entry.component;
    const counting = !paused && !ended && !waits;
    const remaining = counting ? Math.max(0, AUTO_ADVANCE_MS - (elapsed.current.index === index ? elapsed.current.ms : 0)) : null;
    const enter = reducedMotion ? '' : 'animate-reveal motion-reduce:animate-none';

    return (
        <Atmosphere className="flex h-full min-h-0 flex-1">
            <div className="flex h-full items-center justify-center p-6">
                <section
                    data-testid="recap-stage"
                    data-slide={slide.key}
                    data-paused={paused ? 'true' : 'false'}
                    data-reduced-motion={reducedMotion ? 'true' : 'false'}
                    aria-label={t('recap.player.label')}
                    aria-roledescription="carousel"
                    className="relative aspect-[9/16] h-full max-w-full overflow-hidden rounded-xl bg-aurora shadow-sheet"
                >
                    <div key={`${index}:${restart}`} data-testid={`slide-${slide.key}`} className={cn('absolute inset-0', enter)} aria-live="polite">
                        <Slide
                            data={slide.data}
                            fallback={slide.fallback}
                            recap={recap}
                            nickname={nickname}
                            reducedMotion={reducedMotion}
                            onMediaEnd={onMediaEnd}
                        />
                    </div>
                    <button
                        type="button"
                        aria-label={t('recap.player.prev')}
                        onClick={() => go(-1, 'click')}
                        className="absolute bottom-0 left-0 top-12 z-10 w-1/3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    />
                    <button
                        type="button"
                        aria-label={t('recap.player.next')}
                        onClick={() => go(1, 'click')}
                        className="absolute bottom-0 right-0 top-12 z-10 w-2/3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    />
                    <div className="absolute inset-x-0 top-0 z-20 flex flex-col gap-2 px-4 pt-4">
                        <div
                            role="progressbar"
                            aria-label={t('recap.player.progress', { current: index + 1, total: slides.length })}
                            aria-valuemin={1}
                            aria-valuemax={slides.length}
                            aria-valuenow={index + 1}
                            className="flex gap-1"
                        >
                            {slides.map((s, i) => (
                                <Segment
                                    key={`${s.key}:${i}`}
                                    state={i < index || (ended && i === index) ? 'done' : i > index ? 'todo' : 'current'}
                                    from={i === index ? pausedAt : 0}
                                    remainingMs={i === index ? remaining : null}
                                    reducedMotion={reducedMotion}
                                />
                            ))}
                        </div>
                        <div className="flex justify-end gap-1">
                            <IconButton
                                size="sm"
                                aria-label={paused ? t('recap.player.play') : t('recap.player.pause')}
                                icon={paused ? <Play /> : <Pause />}
                                onClick={togglePause}
                            />
                            <IconButton size="sm" aria-label={t('common.close')} icon={<X />} onClick={close} />
                        </div>
                    </div>
                </section>
            </div>
        </Atmosphere>
    );
};
