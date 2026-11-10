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

/** A stable scattered spot and tilt for petal `i` (same every render, no randomness). */
function petalSpot(i: number): { left: string; top: string; rotate: number } {
    const x = (i * GOLDEN) % 1;
    const y = (i * GOLDEN * GOLDEN + 0.17) % 1;
    return { left: `${Math.round(4 + x * 56)}%`, top: `${Math.round(12 + y * 74)}%`, rotate: Math.round(((i * 7) % 25) - 12) };
}

/**
 * Slide 11, 大好き と ありがとう: petals of her 大好き / ありがとう phrases drift down and
 * settle, then one full message settles over them. The joy variant gathers her warm words. The
 * fall and the final reveal hold while the player is paused; with reduced motion the petals lie
 * still where they would settle and the message is there at once.
 */
export const S11Daisuki: React.FC<SlideProps<S11DaisukiData>> = ({ data, nickname, reducedMotion, paused }) => {
    const { t } = useTranslation();
    const copy = s11Copy(data);
    const step = data.petals.length > 1 ? FALL_SPREAD_MS / (data.petals.length - 1) : 0;
    const final = heldReveal(reducedMotion, paused, FINAL_DELAY_MS);
    return (
        <div className="relative flex h-full flex-col items-center justify-center gap-6 overflow-hidden px-8 text-center">
            <ul aria-label={t('recap.s11.petalsLabel')} className="absolute inset-0">
                {data.petals.map((petal, i) => {
                    const spot = petalSpot(i);
                    const style: React.CSSProperties = {
                        left: spot.left,
                        top: spot.top,
                        transform: `rotate(${spot.rotate}deg)`,
                        ...(reducedMotion ? {} : { animationDelay: `${Math.round(i * step)}ms`, ...playState(paused) }),
                    };
                    return (
                        <li
                            key={`${petal.date}:${i}`}
                            data-testid="s11-petal"
                            className={cn(
                                'absolute flex max-w-[40%] items-center gap-1 rounded-full bg-card px-3 py-1 opacity-80 shadow-pill',
                                !reducedMotion && 'animate-petal-fall motion-reduce:animate-none',
                            )}
                            style={style}
                        >
                            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-expressive-orb-2" />
                            <Quote className="truncate text-caption">{withNickname(petal.text, nickname)}</Quote>
                        </li>
                    );
                })}
            </ul>
            <Headline className="relative">{t(copy.title.key, copy.title.params)}</Headline>
            {data.final && (
                <div
                    data-testid="s11-final"
                    className={cn('relative w-full rounded-md bg-card px-5 py-4 shadow-sheet', final.className)}
                    style={final.style}
                >
                    <MessageBody message={data.final} nickname={nickname} />
                </div>
            )}
        </div>
    );
};
