import React from 'react';
import { cn } from '../../utils/classnames';

const ORBS = [
    'bg-expressive-orb-1 -left-1/4 -top-1/3 h-3/4 w-3/4 animate-orb-drift-1',
    'bg-expressive-orb-2 -right-1/4 top-1/4 h-2/3 w-2/3 animate-orb-drift-2',
    'bg-expressive-orb-3 -bottom-1/3 left-1/4 h-1/2 w-1/2 animate-orb-breathe',
] as const;

/** L2 atmosphere (spec §5): drifting context orbs behind the content. Low-density screens only. */
export const Atmosphere: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <div className={cn('relative overflow-hidden', className)}>
        {ORBS.map((orb) => (
            <div key={orb} data-testid="atmosphere-orb" aria-hidden="true" className={cn('pointer-events-none absolute rounded-full motion-reduce:animate-none', orb)} />
        ))}
        <div className="relative h-full">{children}</div>
    </div>
);
