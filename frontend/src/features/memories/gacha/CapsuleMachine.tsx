import React, { useRef, useState } from 'react';
import { motion as fm } from 'framer-motion';
import { useTranslation } from '../../../i18n';
import { motion } from '../../../design/tokens/motion';
import { cn } from '../../../utils/classnames';
import type { GachaRarity } from '../types';
import { RARITY_FILL } from './rarityCopy';

/** A drag turns the knob this far (either way) to pull. */
export const PULL_DEGREES = 270;
/** A pointer that turned the knob more than this was a drag, not a click. */
const DRAG_SLOP_DEGREES = 10;

/** A capsule: the top half in its rarity fill, the bottom half paper. */
export const Capsule: React.FC<{ rarity: GachaRarity; className?: string }> = ({ rarity, className }) => (
    <span aria-hidden="true" className={cn('flex flex-col overflow-hidden rounded-full border border-subtle', className)}>
        <span className={cn('flex-1', RARITY_FILL[rarity])} />
        <span className="flex-1 bg-memories-paper" />
    </span>
);

/** The capsules resting in the dome: fixed literal positions, no runtime class names. */
const DOME: { rarity: GachaRarity; className: string }[] = [
    { rarity: 'n', className: 'left-3 bottom-2' },
    { rarity: 'r', className: 'left-12 bottom-1' },
    { rarity: 'n', className: 'left-20 bottom-3' },
    { rarity: 'n', className: 'right-12 bottom-1' },
    { rarity: 'sr', className: 'right-3 bottom-2' },
    { rarity: 'n', className: 'left-8 bottom-10' },
    { rarity: 'r', className: 'left-16 bottom-11' },
    { rarity: 'n', className: 'right-8 bottom-10' },
    { rarity: 'n', className: 'left-24 bottom-16' },
];

export interface CapsuleMachineProps {
    /** Pulls left today (JST). 0 shows 「また明日」, never the number. */
    pullsLeft: number;
    /** A pull is in flight: the knob does nothing. */
    busy: boolean;
    onPull: () => void;
    /** The capsule that just rolled out (`key` changes per pull), or null. */
    dropped: { key: string; rarity: GachaRarity } | null;
    reducedMotion: boolean;
}

/** Angle in degrees of a pointer around an element's centre. */
function angleAround(el: HTMLElement, e: React.PointerEvent): number {
    const r = el.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
}

/**
 * The capsule machine (spec 12): a glass dome of capsules over the base with the knob and the
 * slot, all CSS shapes from tokens. The knob (`role="button"`) pulls on a click, Enter or Space,
 * or a pointer drag that turns it past {@link PULL_DEGREES} (either way; the angle is unwrapped
 * across the ±180° seam); a shorter drag springs back without pulling, and the click that ends
 * any drag is not a pull. It does nothing while `busy` or with no pulls left (`aria-disabled`).
 * Under the knob: 「今日はあと {{count}} 回」, or 「また明日」 at 0. The capsule that rolled out
 * drops from the slot in its rarity colour; under reduced motion it fades in.
 */
export const CapsuleMachine: React.FC<CapsuleMachineProps> = ({ pullsLeft, busy, onPull, dropped, reducedMotion }) => {
    const { t } = useTranslation();
    const disabled = busy || pullsLeft <= 0;
    const drag = useRef<{ last: number; total: number; pulled: boolean } | null>(null);
    const wasDrag = useRef(false);
    // The knob's resting angle (a full turn per click pull) and the live drag angle on top.
    const [rest, setRest] = useState(0);
    const [turn, setTurn] = useState<number | null>(null);

    const pull = () => {
        if (disabled) return;
        setRest((a) => a + 360);
        onPull();
    };

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (disabled) return;
        drag.current = { last: angleAround(e.currentTarget, e), total: 0, pulled: false };
        wasDrag.current = false;
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (!d) return;
        const a = angleAround(e.currentTarget, e);
        let delta = a - d.last;
        if (delta > 180) delta -= 360;
        else if (delta <= -180) delta += 360;
        d.last = a;
        d.total += delta;
        if (Math.abs(d.total) > DRAG_SLOP_DEGREES) wasDrag.current = true;
        setTurn(d.total);
        if (!d.pulled && Math.abs(d.total) >= PULL_DEGREES) {
            d.pulled = true;
            if (!disabled) onPull();
        }
    };
    const endDrag = () => {
        drag.current = null;
        setTurn(null);
    };
    const onClick = () => {
        if (wasDrag.current) {
            wasDrag.current = false;
            return;
        }
        pull();
    };
    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (!e.repeat) pull();
    };

    const angle = rest + (turn ?? 0);
    const transition = { duration: motion.duration.base / 1000, ease: motion.easing.standard };

    return (
        <div data-testid="capsule-machine" className="flex flex-col items-center gap-3">
            <div className="relative h-40 w-48 overflow-hidden rounded-t-full rounded-b-lg border border-frost bg-frost shadow-card backdrop-blur-frost">
                {DOME.map((c, i) => <Capsule key={i} rarity={c.rarity} className={cn('absolute h-8 w-8', c.className)} />)}
            </div>
            <div className="relative -mt-4 flex h-28 w-56 items-center justify-between rounded-lg border border-subtle bg-card px-5 shadow-card">
                <div
                    role="button"
                    tabIndex={0}
                    aria-label={t('memories.gacha.turn')}
                    aria-disabled={disabled}
                    data-testid="gacha-knob"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onClick={onClick}
                    onKeyDown={onKeyDown}
                    style={{ transform: `rotate(${angle}deg)` }}
                    className={cn(
                        'relative h-16 w-16 touch-none select-none rounded-full border border-subtle bg-memories-paper shadow-pill',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        turn === null && 'transition-transform duration-base ease-standard motion-reduce:transition-none',
                        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing',
                    )}
                >
                    <span aria-hidden="true" className="absolute inset-x-6 inset-y-1 rounded-full bg-sunken" />
                </div>
                <div className="relative flex h-10 w-16 items-end justify-center rounded-md bg-sunken pb-1">
                    {dropped && (
                        <fm.span
                            key={dropped.key}
                            data-testid="gacha-capsule"
                            data-motion={reducedMotion ? 'fade' : 'roll'}
                            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -16, rotate: -180 }}
                            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, rotate: 0 }}
                            transition={transition}
                            className="block"
                        >
                            <Capsule rarity={dropped.rarity} className="h-8 w-8" />
                        </fm.span>
                    )}
                </div>
            </div>
            <p className="text-small tabular-nums text-secondary" aria-live="polite">
                {pullsLeft > 0 ? t('memories.gacha.left', { count: pullsLeft }) : t('memories.gacha.tomorrow')}
            </p>
        </div>
    );
};
