import React from 'react';
import { cn } from '../../utils/classnames';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'overlay';
export type IconButtonVariant = 'secondary' | 'ghost' | 'overlay' | 'accent';
export type ButtonSize = 'sm' | 'md';

const BASE = cn(
    'inline-flex items-center justify-center gap-2 rounded-pill font-semibold',
    'transition duration-fast ease-standard',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group',
    'disabled:pointer-events-none disabled:opacity-50',
);

const VARIANT: Record<ButtonVariant, string> = {
    /** Group accent. At most ONE primary or danger per screen (docs/design/DESIGN_SYSTEM.md). */
    primary: 'bg-group-accent text-inverse shadow-pill hover:brightness-105',
    secondary: 'bg-pill text-primary shadow-pill hover:bg-sunken',
    ghost: 'bg-transparent text-secondary hover:bg-sunken hover:text-primary',
    /** Destructive confirm. Counts as the screen's one primary. */
    danger: 'bg-status-danger text-inverse shadow-pill hover:brightness-105',
    /** Controls on the dark photo/video viewer. */
    overlay: 'bg-viewer-control text-viewer hover:bg-viewer-control-hover',
};

const ICON_VARIANT: Record<IconButtonVariant, string> = {
    secondary: VARIANT.secondary,
    ghost: VARIANT.ghost,
    overlay: VARIANT.overlay,
    /** Group action colour on a floating button (the chat's unread arrows). */
    accent: 'bg-group-accent text-inverse shadow-card hover:brightness-105',
};

const SIZE: Record<ButtonSize, string> = {
    sm: 'h-8 px-3 text-small',
    md: 'h-10 px-4 text-body',
};

const ICON_SIZE: Record<ButtonSize, string> = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ variant = 'secondary', size = 'md', type = 'button', className, ...rest }, ref) => (
        <button ref={ref} type={type} className={cn(BASE, VARIANT[variant], SIZE[size], className)} {...rest} />
    ),
);
Button.displayName = 'Button';

export interface IconButtonProps
    extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
    /** Required: an icon-only button has no other accessible name. */
    'aria-label': string;
    icon: React.ReactNode;
    variant?: IconButtonVariant;
    size?: ButtonSize;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    ({ icon, variant = 'ghost', size = 'md', type = 'button', className, ...rest }, ref) => (
        <button ref={ref} type={type} className={cn(BASE, ICON_VARIANT[variant], ICON_SIZE[size], className)} {...rest}>
            <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center">{icon}</span>
        </button>
    ),
);
IconButton.displayName = 'IconButton';
