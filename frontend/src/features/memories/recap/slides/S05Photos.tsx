import React from 'react';
import { useTranslation } from '../../../../i18n';
import { cn } from '../../../../utils/classnames';
import type { RecapMessage, S05PhotosData } from '../api';
import { s05Copy, withNickname } from '../recapCopy';
import { Headline, Narration, Quote, type SlideProps } from './common';
import { heldReveal, playState } from './style';

/** The burst fans out over this time; the real gaps between the photos are compressed into it. */
export const FAN_MS = 2400;
/** Smallest gap between two photos of the fan, so bursts sent in one second still unfold. */
const MIN_GAP_MS = 120;
/** At most this many photos of the burst are fanned on the 9:16 stage. */
const FAN_MAX = 6;
/** At most this many tiles in the background wall. */
const WALL_MAX = 24;
/** Widest rotation and offset of the fan's outer photos. */
const FAN_DEG = 14;
const FAN_PX = 56;

/** At most `max` items spread evenly over the whole list (the wall runs through the year in order). */
function sampleEvenly<T>(items: readonly T[], max: number): T[] {
    if (items.length <= max) return [...items];
    return Array.from({ length: max }, (_, i) => items[Math.floor((i * items.length) / max)]);
}

/**
 * When each photo appears: the real offsets from the first photo scaled into
 * {@link FAN_MS}, plus a fixed minimum gap per step. The order of the gaps is
 * kept, so a pause in her sending stays a pause.
 */
function fanDelays(items: readonly RecapMessage[]): number[] {
    if (items.length <= 1) return items.map(() => 0);
    const times = items.map((m) => new Date(m.ts).getTime());
    const t0 = times[0];
    const span = times[times.length - 1] - t0;
    const budget = FAN_MS - (items.length - 1) * MIN_GAP_MS;
    return times.map((t, i) => {
        const scaled = span > 0 && Number.isFinite(t) ? ((t - t0) / span) * budget : (i / (items.length - 1)) * budget;
        return Math.round(Math.max(0, scaled) + i * MIN_GAP_MS);
    });
}

const Media: React.FC<{ message: RecapMessage; className?: string }> = ({ message, className }) => {
    if (!message.media_url) return null;
    if (message.type === 'video') {
        return <video src={message.media_url} muted playsInline preload="metadata" className={cn('h-full w-full object-cover', className)} />;
    }
    return <img src={message.media_url} alt="" className={cn('h-full w-full object-cover', className)} />;
};

/**
 * Slide 5, 見せたかった景色: the year's photos as a soft wall, then her biggest
 * burst fanned out at compressed real timing with its caption. Without a burst:
 * one treasured photo. With reduced motion the burst is a still row.
 */
export const S05Photos: React.FC<SlideProps<S05PhotosData>> = ({ data, nickname, reducedMotion, paused }) => {
    const { t } = useTranslation();
    const copy = s05Copy(data);
    const wall = sampleEvenly((data.wall ?? []).filter((u): u is string => !!u), WALL_MAX);
    const burst = data.burst.filter((m) => m.media_url).slice(0, FAN_MAX);
    const best = burst.length === 0 && data.best_photo?.media_url ? data.best_photo : null;
    const delays = fanDelays(burst);
    const after = heldReveal(reducedMotion, paused, (delays[delays.length - 1] ?? 0) + 500);
    const bestWords = best ? (best.text ?? best.caption) : null;
    return (
        <div className="relative flex h-full flex-col items-center justify-center gap-6 overflow-hidden px-8 text-center">
            {wall.length > 0 && (
                <div data-testid="s05-wall" aria-hidden="true" className="absolute inset-0 grid grid-cols-4 content-center gap-1 opacity-30 blur-sm">
                    {wall.map((url, i) => <img key={`${url}:${i}`} src={url} alt="" className="aspect-square w-full rounded-xs object-cover" />)}
                </div>
            )}
            <Headline className="relative">{t(copy.title.key, copy.title.params)}</Headline>
            {burst.length > 0 && (
                <div
                    role="group"
                    aria-label={t('recap.s05.burstLabel')}
                    className={cn('relative w-full', reducedMotion ? 'flex flex-wrap justify-center gap-2' : 'h-48')}
                >
                    {burst.map((m, i) => {
                        const k = burst.length > 1 ? i / (burst.length - 1) - 0.5 : 0;
                        const style: React.CSSProperties = reducedMotion
                            ? {}
                            : {
                                transform: `translateX(-50%) translateX(${Math.round(k * 2 * FAN_PX)}px) rotate(${(k * 2 * FAN_DEG).toFixed(1)}deg)`,
                                animationDelay: `${delays[i]}ms`,
                                zIndex: i,
                                ...playState(paused),
                            };
                        return (
                            <div
                                key={`${m.member_path ?? ''}:${m.id}`}
                                data-testid="s05-burst-item"
                                className={cn(
                                    'overflow-hidden rounded-md bg-card p-1 shadow-card',
                                    reducedMotion ? 'h-16 w-16' : 'absolute left-1/2 top-0 h-44 w-32 origin-bottom animate-fan-in motion-reduce:animate-none',
                                )}
                                style={style}
                            >
                                <Media message={m} className="rounded-sm" />
                            </div>
                        );
                    })}
                </div>
            )}
            {best && (
                <div data-testid="s05-best" className="relative flex w-3/4 flex-col gap-3 rounded-md bg-card p-2 pb-4 shadow-card">
                    <div className="aspect-square w-full overflow-hidden rounded-sm"><Media message={best} /></div>
                    {bestWords && <Quote className="line-clamp-3 text-title">{withNickname(bestWords, nickname)}</Quote>}
                </div>
            )}
            {(data.burst_caption || copy.line) && (
                <div className={cn('relative flex flex-col gap-2', after.className)} style={after.style}>
                    {burst.length > 0 && data.burst_caption && <Quote className="line-clamp-3">{withNickname(data.burst_caption, nickname)}</Quote>}
                    {copy.line && <Narration>{t(copy.line.key, copy.line.params)}</Narration>}
                </div>
            )}
        </div>
    );
};
