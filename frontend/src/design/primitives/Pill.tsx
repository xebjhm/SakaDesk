import React from 'react';
import { cn } from '../../utils/classnames';

export interface PillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Selected tab/filter: the accent roles (spec section 8), or the oshi roles with tone="oshi". */
    selected?: boolean;
    /** Selected colour roles. `oshi` is for the 推 (Favorite) filter, which never follows the group accent. */
    tone?: 'accent' | 'oshi';
}

/** Level 3 — a fully rounded tab or filter button. */
export const Pill = React.forwardRef<HTMLButtonElement, PillProps>(
    ({ selected = false, tone = 'accent', className, type = 'button', ...rest }, ref) => (
        <button
            ref={ref}
            type={type}
            aria-pressed={selected}
            className={cn(
                'inline-flex items-center gap-1 rounded-pill px-3 py-1 text-small shadow-pill',
                'transition-colors duration-fast ease-standard',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                selected
                    ? tone === 'oshi'
                        ? 'bg-semantic-oshi-subtle font-semibold text-semantic-oshi ring-1 ring-inset ring-semantic-oshi'
                        : 'bg-accent-subtle font-semibold text-accent-strong ring-1 ring-inset ring-accent-border'
                    : 'bg-pill text-secondary hover:text-primary',
                className,
            )}
            {...rest}
        />
    ),
);
Pill.displayName = 'Pill';
