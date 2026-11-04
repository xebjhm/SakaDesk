import React from 'react';
import { cn } from '../../utils/classnames';

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'onClick' | 'aria-label' | 'children' | 'role'> {
    checked: boolean;
    onCheckedChange: (next: boolean) => void;
    /** Required: a switch has no visible text of its own. */
    'aria-label': string;
}

/** On / off control. On is the group action colour (DESIGN_SYSTEM.md: form control on state). */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
    ({ checked, onCheckedChange, className, type = 'button', ...rest }, ref) => (
        <button
            {...rest}
            ref={ref}
            type={type}
            role="switch"
            aria-checked={checked}
            onClick={() => onCheckedChange(!checked)}
            className={cn(
                'relative inline-flex h-6 w-11 shrink-0 rounded-pill transition-colors duration-fast ease-standard',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-group focus-visible:ring-offset-surface',
                'disabled:pointer-events-none disabled:opacity-50',
                checked ? 'bg-group-accent' : 'bg-control-off',
                className,
            )}
        >
            <span
                aria-hidden="true"
                className={cn(
                    'absolute left-1 top-1 h-4 w-4 rounded-pill bg-card shadow-pill transition-transform duration-fast ease-standard motion-reduce:transition-none',
                    checked && 'translate-x-5',
                )}
            />
        </button>
    ),
);
Switch.displayName = 'Switch';
