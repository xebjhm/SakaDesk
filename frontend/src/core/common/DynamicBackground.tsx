// frontend/src/core/common/DynamicBackground.tsx
// Ambient orbs behind the blog feed ("living air"). Colours are the group's ambient role and
// size / opacity the per-group orb layout, both through --ds-group-ambient-* variables written
// by applyGroupTokens (docs/design/DESIGN_SYSTEM.md, "Ambient orbs").
import React from 'react';
import { cn } from '../../utils/classnames';

/** Fine film noise for depth (an SVG turbulence filter; no colour). */
const NOISE =
    "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")";

// Full class strings (Tailwind only sees literal class names).
// The `orb-breathe` keyframes read `--orb-opacity`, while the tokens expose
// `--ds-group-ambient-N-opacity`: the third orb maps one onto the other explicitly.
const ORBS = [
    'bg-group-ambient-1 w-[var(--ds-group-ambient-1-size)] h-[var(--ds-group-ambient-1-size)] opacity-[var(--ds-group-ambient-1-opacity)] max-h-[850px] max-w-[850px] -left-[12%] -top-[18%] animate-orb-drift-1',
    'bg-group-ambient-2 w-[var(--ds-group-ambient-2-size)] h-[var(--ds-group-ambient-2-size)] opacity-[var(--ds-group-ambient-2-opacity)] max-h-[750px] max-w-[750px] -right-[15%] top-[18%] animate-orb-drift-2 [animation-delay:-8s]',
    'bg-group-ambient-3 w-[var(--ds-group-ambient-3-size)] h-[var(--ds-group-ambient-3-size)] opacity-[var(--ds-group-ambient-3-opacity)] [--orb-opacity:var(--ds-group-ambient-3-opacity)] max-h-[650px] max-w-[650px] -bottom-[22%] left-[28%] animate-orb-breathe [animation-delay:-15s]',
] as const;

export const DynamicBackground: React.FC<{ className?: string }> = ({ className }) => (
    <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 z-0 overflow-hidden', className)}>
        {ORBS.map((orb) => (
            <div
                key={orb}
                className={cn('absolute rounded-pill blur-[100px] will-change-transform motion-reduce:animate-none', orb)}
            />
        ))}
        <div
            className="absolute inset-0 opacity-[0.018] mix-blend-multiply"
            style={{ backgroundImage: NOISE }}
        />
    </div>
);
