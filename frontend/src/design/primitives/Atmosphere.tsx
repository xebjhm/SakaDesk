import React from 'react';
import { cn } from '../../utils/classnames';

// Square boxes (a width plus `aspect-square`, never a separate height): the orb gradient is a
// circle that ends just inside a square box, so `rounded-full` never cuts it into a straight edge.
const ORBS = [
    'bg-expressive-orb-1 -left-1/4 -top-1/3 w-1/2 aspect-square animate-orb-drift-1',
    'bg-expressive-orb-2 -right-1/4 top-1/4 w-2/5 aspect-square animate-orb-drift-2',
    'bg-expressive-orb-3 -bottom-1/3 left-1/4 w-1/3 aspect-square animate-orb-breathe',
] as const;

interface AtmosphereProps {
    children: React.ReactNode;
    className?: string;
    /**
     * Fade the orb layer out at the top and bottom edges (`mask-fade-y`), for a short box
     * whose edges would otherwise cut the orbs flat. The children are never masked.
     */
    fade?: boolean;
}

/** L2 atmosphere (spec §5): drifting context orbs behind the content. Low-density screens only. */
export const Atmosphere: React.FC<AtmosphereProps> = ({ children, className, fade = false }) => {
    const orbs = ORBS.map((orb) => (
        <div key={orb} data-testid="atmosphere-orb" aria-hidden="true" className={cn('pointer-events-none absolute rounded-full motion-reduce:animate-none', orb)} />
    ));
    return (
        <div className={cn('relative overflow-hidden', className)}>
            {fade ? (
                <div data-testid="atmosphere-fade" aria-hidden="true" className="pointer-events-none absolute inset-0 mask-fade-y">
                    {orbs}
                </div>
            ) : (
                orbs
            )}
            <div className="relative h-full">{children}</div>
        </div>
    );
};
