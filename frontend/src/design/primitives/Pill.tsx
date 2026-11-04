import React from 'react';
import { cn } from '../../utils/classnames';

export interface PillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Selected tab/filter. Neutral emphasis — never the group colour. */
    selected?: boolean;
}

/** Level 3 — a fully rounded tab or filter button. */
export const Pill = React.forwardRef<HTMLButtonElement, PillProps>(
    ({ selected = false, className, type = 'button', ...rest }, ref) => (
        <button
            ref={ref}
            type={type}
            aria-pressed={selected}
            className={cn(
                'inline-flex items-center gap-1 rounded-pill px-3 py-1 text-small shadow-pill',
                'transition-colors duration-fast ease-standard',
                selected ? 'bg-sunken font-semibold text-primary' : 'bg-pill text-secondary hover:text-primary',
                className,
            )}
            {...rest}
        />
    ),
);
Pill.displayName = 'Pill';
