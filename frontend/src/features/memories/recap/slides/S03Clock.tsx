import React from 'react';
import { useTranslation } from '../../../../i18n';
import { cn } from '../../../../utils/classnames';
import type { RecapMessageType, S03ClockData } from '../api';
import { s03Copy } from '../recapCopy';
import { Headline, MessageBody, Narration, type SlideProps } from './common';
import { heldReveal, playState } from './style';

/** All stars have landed by this time (the last one starts falling before it). */
export const STAR_FALL_MS = 2000;
/** Length of one star's fall (`animate-star-fall`). */
const STAR_DURATION_MS = 600;

const SIZE = 200;
const CENTRE = SIZE / 2;
const INNER = 28;
const OUTER = 86;
const CARDINAL_R = 94;

/**
 * Colours come from the design tokens' CSS variables (the canvas rule applies to SVG too). Each is a
 * solid colour: an SVG fill cannot take a gradient variable such as `--ds-expressive-orb-1`. The
 * peak glow is neutral light (the card white fading out), not the group colour: it is a highlight,
 * not identity, state or the primary action.
 */
const INK = {
    star: 'var(--ds-text-secondary)',
    peak: 'var(--ds-text-primary)',
    faint: 'var(--ds-text-muted)',
    glow: 'var(--ds-surface-card)',
} as const;

const GLOW_ID = 's03-glow-gradient';

const STAR_R: Record<RecapMessageType, number> = { text: 1.3, picture: 1.7, video: 1.7, voice: 1.9 };

/** Angle of a JST clock time: 0:00 at the top, clockwise over 24 hours. */
function angleOf(h: number, m: number): number {
    return ((h * 60 + m) / 1440) * 2 * Math.PI - Math.PI / 2;
}

/** A stable spread of radii (golden-ratio sequence), so the same payload draws the same sky. */
function radiusOf(i: number): number {
    return INNER + (OUTER - INNER) * ((i * 0.618034 + 0.31) % 1);
}

/**
 * Slide 3, 彼女の夜は、あなたの夜: a 24-hour star clock, one star per message,
 * no axis numbers, four faint cardinal dots. The stars fall in over 2 s; the
 * peak hour glows above its representative message. A flat day (`band`) has no
 * peak to glow. With reduced motion the clock is drawn still.
 */
export const S03Clock: React.FC<SlideProps<S03ClockData>> = ({ data, nickname, reducedMotion, paused }) => {
    const { t } = useTranslation();
    const copy = s03Copy(data);
    const n = data.stars.length;
    const fallSpan = STAR_FALL_MS - STAR_DURATION_MS;
    const peakAngle = angleOf(data.peak_hour, 30);
    const body = heldReveal(reducedMotion, paused, STAR_FALL_MS - 400);
    const lines = heldReveal(reducedMotion, paused, STAR_FALL_MS);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
            <Headline>{t(copy.title.key, copy.title.params)}</Headline>
            <svg
                role="img"
                aria-label={t('recap.s03.clockLabel')}
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                className="aspect-square w-4/5 max-w-xs"
            >
                <defs>
                    {/* A soft glow: the solid glow colour fading to transparent from the centre. */}
                    <radialGradient id={GLOW_ID}>
                        <stop offset="0%" style={{ stopColor: INK.glow, stopOpacity: 0.95 }} />
                        <stop offset="55%" style={{ stopColor: INK.glow, stopOpacity: 0.5 }} />
                        <stop offset="100%" style={{ stopColor: INK.glow, stopOpacity: 0 }} />
                    </radialGradient>
                </defs>
                {copy.glow && (
                    <circle
                        data-testid="s03-glow"
                        cx={CENTRE + Math.cos(peakAngle) * (INNER + OUTER) / 2}
                        cy={CENTRE + Math.sin(peakAngle) * (INNER + OUTER) / 2}
                        r={34}
                        fill={`url(#${GLOW_ID})`}
                    />
                )}
                {[0, 6, 12, 18].map((h) => {
                    const a = angleOf(h, 0);
                    return (
                        <circle
                            key={h}
                            data-testid="s03-cardinal"
                            cx={CENTRE + Math.cos(a) * CARDINAL_R}
                            cy={CENTRE + Math.sin(a) * CARDINAL_R}
                            r={1.4}
                            style={{ fill: INK.faint, opacity: 0.45 }}
                        />
                    );
                })}
                {data.stars.map((s, i) => {
                    const a = angleOf(s.h, s.m);
                    const r = radiusOf(i);
                    const peak = copy.glow && s.h === data.peak_hour;
                    const style: React.CSSProperties = {
                        fill: peak ? INK.peak : INK.star,
                        opacity: peak ? 1 : 0.6,
                        transformBox: 'fill-box',
                        transformOrigin: 'center',
                    };
                    if (!reducedMotion) {
                        style.animationDelay = `${Math.round(n > 1 ? (i / (n - 1)) * fallSpan : 0)}ms`;
                        Object.assign(style, playState(paused));
                    }
                    return (
                        <circle
                            key={i}
                            data-testid="s03-star"
                            data-peak={peak ? 'true' : 'false'}
                            cx={CENTRE + Math.cos(a) * r}
                            cy={CENTRE + Math.sin(a) * r}
                            r={STAR_R[s.type] ?? STAR_R.text}
                            className={cn(!reducedMotion && 'animate-star-fall motion-reduce:animate-none')}
                            style={style}
                        />
                    );
                })}
            </svg>
            {(copy.lead || data.representative) && (
                <div className={cn('flex flex-col gap-2', body.className)} style={body.style}>
                    {copy.lead && <Narration>{t(copy.lead.key, copy.lead.params)}</Narration>}
                    {data.representative && <MessageBody message={data.representative} nickname={nickname} quoteClassName="line-clamp-4" />}
                </div>
            )}
            {copy.streak && (
                <Narration className={cn('tabular-nums', lines.className)} style={lines.style}>
                    {t(copy.streak.key, copy.streak.params)}
                </Narration>
            )}
        </div>
    );
};
