import React from 'react';
import { cn } from '../../utils/classnames';

/** Single-line field look shared by Input and Select (level 3: pill). */
export const FIELD_CLASS = cn(
    'h-10 w-full rounded-pill bg-sunken px-4 text-body text-primary placeholder:text-muted',
    'transition-shadow duration-fast ease-standard',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    'disabled:opacity-50',
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, type = 'text', ...rest }, ref) => <input ref={ref} type={type} className={cn(FIELD_CLASS, className)} {...rest} />,
);
Input.displayName = 'Input';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
    ({ className, ...rest }, ref) => <select ref={ref} className={cn(FIELD_CLASS, 'pr-8', className)} {...rest} />,
);
Select.displayName = 'Select';
