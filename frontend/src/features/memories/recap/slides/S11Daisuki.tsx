import React from 'react';
import { useTranslation } from '../../../../i18n';
import { cn } from '../../../../utils/classnames';
import type { S11DaisukiData } from '../api';
import { s11Copy, withNickname } from '../recapCopy';
import { Headline, MessageBody, Quote, type SlideProps } from './common';
import { heldReveal, playState } from './style';

/** The petals start falling over this time, one after another. */
const FALL_SPREAD_MS = 2400;
/** The final message settles in after the petals. */
const FINAL_DELAY_MS = 2800;
const GOLDEN = 0.618034;

/**
 * A stable scattered spot and tilt for petal `i` (same every render, no randomness): even petals
 * settle in the band above the title, odd ones in the band below the message, so no petal ever
 * lies over the title or the message. `top` is within its band (room left for the petal's height).
 */
function petalSpot(i: number): { band: 'top' | 'bottom'; left: string; top: string; rotate: number } {
    const x = (i * GOLDEN) % 1;
    const y = (i * GOLDEN * GOLDEN + 0.17) % 1;
    return {
        band: i % 2 === 0 ? 'top' : 'bottom',
        left: `${Math.round(4 + x * 56)}%`,
        top: `${Math.round(8 + y * 52)}%`,
        rotate: Math.round(((i * 7) % 25) - 12),
    };
}

/**
 * Slide 11, 大好き と ありがとう: petals of her 大好き / ありがとう phrases drift down and
 * settle in the bands above the title and below the message (never over the words), then one
 * full message settles in. The joy variant gathers her warm words. The
 * fall and the final reveal hold while the player is paused; with reduced motion the petals lie
 * still where they would settle and the message is there at once.
 */
export const S11Daisuki: React.FC<SlideProps<S11DaisukiData>> = ({ data, nickname, reducedMotion, paused }) => {
    const { t } = useTranslation();
    const copy = s11Copy(data);
    const step = data.petals.length > 1 ? FALL_SPREAD_MS / (data.petals.length - 1) : 0;
    const final = heldReveal(reducedMotion, paused, FINAL_DELAY_MS);
    const petal = (band: 'top' | 'bottom') => data.petals.map((p, i) => {
        const spot = petalSpot(i);
        if (spot.band !== band) return null;
        const style: React.CSSProperties = {
            left: spot.left,
            top: spot.top,
            transform: `rotate(${spot.rotate}deg)`,
            ...(reducedMotion ? {} : { animationDelay: `${Math.round(i * step)}ms`, ...playState(paused) }),
        };
        return (
            <li
                key={`${p.date}:${i}`}
                data-testid="s11-petal"
                data-band={band}
                className={cn(
                    'absolute flex max-w-[40%] items-center gap-1 rounded-full bg-card px-3 py-1 opacity-80 shadow-pill',
                    !reducedMotion && 'animate-petal-fall motion-reduce:animate-none',
                )}
                style={style}
            >
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-expressive-orb-2" />
                <Quote className="truncate text-caption">{withNickname(p.text, nickname)}</Quote>
            </li>
        );
    });
    return (
        <div className="relative flex h-full flex-col items-center gap-6 overflow-hidden px-8 py-12 text-center">
            {/* The petals live in their own bands above and below the words, never over them. */}
            <ul data-testid="s11-band-top" aria-label={t('recap.s11.petalsLabel')} className="relative min-h-0 w-full flex-1">{petal('top')}</ul>
            <Headline className="relative shrink-0">{t(copy.title.key, copy.title.params)}</Headline>
            {data.final && (
                <div
                    data-testid="s11-final"
                    className={cn('relative w-full shrink-0 rounded-md bg-card px-5 py-4 shadow-sheet', final.className)}
                    style={final.style}
                >
                    <MessageBody message={data.final} nickname={nickname} />
                </div>
            )}
            <ul data-testid="s11-band-bottom" aria-label={t('recap.s11.petalsLabel')} className="relative min-h-0 w-full flex-1">{petal('bottom')}</ul>
        </div>
    );
};
