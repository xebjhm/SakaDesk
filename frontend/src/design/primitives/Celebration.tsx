import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../utils/classnames';

/** Deterministic burst offsets (golden angle), so renders and tests are stable. */
function burstStyle(i: number, scale: number): React.CSSProperties {
    const angle = (i * 137.5 * Math.PI) / 180;
    const dist = (40 + (i % 5) * 20) * scale;
    return { '--dx': `${Math.round(Math.cos(angle) * dist)}px`, '--dy': `${Math.round(Math.sin(angle) * dist + dist * 0.6)}px` } as React.CSSProperties;
}

const SPARKLE_FILL = ['bg-expressive-orb-1', 'bg-expressive-orb-2', 'bg-expressive-orb-3'] as const;
const CONFETTI_FILL = ['bg-accent', 'bg-accent-subtle', 'bg-accent-border', 'bg-sheet'] as const;

export interface CelebrationToastProps { title: string; description?: string; icon?: React.ReactNode }

/** Tier B celebration (spec §9): glass toast + one aurora shimmer + sparkles. Never blocks input. */
export const CelebrationToast: React.FC<CelebrationToastProps> = ({ title, description, icon }) => (
    <div role="status" aria-live="polite" className="relative flex items-center gap-3 overflow-hidden rounded-lg bg-sheet px-4 py-3 shadow-sheet animate-reveal motion-reduce:animate-none">
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-aurora opacity-60 animate-shimmer motion-reduce:hidden" />
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-aurora text-accent-strong">
            {icon ?? <Check className="h-4 w-4" aria-hidden="true" />}
        </span>
        <span className="relative flex flex-col">
            <span className="text-body font-semibold text-primary">{title}</span>
            {description && <span className="text-small text-secondary">{description}</span>}
        </span>
        {Array.from({ length: 10 }, (_, i) => (
            <span key={i} data-sparkle aria-hidden="true" style={burstStyle(i, 0.8)}
                className={cn('pointer-events-none absolute right-8 top-1/2 h-1.5 w-1.5 rounded-full animate-sparkle motion-reduce:hidden', SPARKLE_FILL[i % 3])} />
        ))}
    </div>
);

export interface MilestoneCardProps { value: string; label: string }

/** Tier C celebration (spec §9): in-timeline card in the context accent + short confetti. */
export const MilestoneCard: React.FC<MilestoneCardProps> = ({ value, label }) => (
    <div className="relative mx-auto flex w-fit flex-col items-center rounded-lg border border-accent-border bg-expressive-soft px-7 py-3 text-center shadow-accent-glow animate-pop motion-reduce:animate-none">
        <span className="font-display text-display font-semibold tabular-nums text-accent-strong">{value}</span>
        <span className="text-small text-secondary">{label}</span>
        {Array.from({ length: 26 }, (_, i) => (
            <span key={i} data-confetti aria-hidden="true" style={burstStyle(i, 1.6)}
                className={cn('pointer-events-none absolute left-1/2 top-1/2 h-2.5 w-1.5 rounded-xs animate-confetti motion-reduce:hidden', CONFETTI_FILL[i % 4])} />
        ))}
    </div>
);
