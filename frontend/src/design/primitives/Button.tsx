import React, { useId } from 'react';
import { cn } from '../../utils/classnames';

export type ButtonVariant = 'primary' | 'tonal' | 'secondary' | 'ghost' | 'danger' | 'overlay';
export type IconButtonVariant = 'secondary' | 'ghost' | 'overlay' | 'accent';
export type ButtonSize = 'sm' | 'md';

/** States per spec §8: hover brighten + lift + glow, pressed shrink, focus ring, disabled keeps colour. */
const BASE = cn(
    'relative inline-flex items-center justify-center gap-2 rounded-md font-semibold',
    'transition duration-fast ease-standard',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
    'active:scale-97 active:brightness-94',
    'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none',
    'disabled:hover:translate-y-0 disabled:hover:brightness-100 disabled:hover:shadow-none disabled:active:scale-100 disabled:active:brightness-100 disabled:active:shadow-none',
    'aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:shadow-none',
    'aria-disabled:hover:translate-y-0 aria-disabled:hover:brightness-100 aria-disabled:hover:shadow-none aria-disabled:active:scale-100 aria-disabled:active:brightness-100 aria-disabled:active:shadow-none',
    // Loading looks blocked: no lift/press feedback (clicks are swallowed in the handler).
    'data-[loading=true]:cursor-wait data-[loading=true]:hover:translate-y-0 data-[loading=true]:hover:brightness-100 data-[loading=true]:active:scale-100 data-[loading=true]:active:brightness-100',
);

const LIFT = 'hover:brightness-106 hover:-translate-y-px';
const GLOW = 'shadow-accent-glow hover:shadow-accent-glow-hover active:shadow-pill';

const VARIANT: Record<ButtonVariant, string> = {
    /** L1: logo → accent gradient + glow. At most ONE primary or danger per screen and per dialog. */
    primary: cn('bg-accent-gradient text-inverse', GLOW, LIFT),
    /** Secondary emphasis (e.g. "mark all read"): soft tonal gradient, dark accent text. */
    tonal: cn('bg-accent-tonal text-accent-tonal', LIFT),
    secondary: 'bg-pill text-primary border border-strong hover:bg-sunken disabled:hover:bg-pill aria-disabled:hover:bg-pill',
    ghost: 'bg-transparent text-accent-strong hover:bg-accent-subtle',
    /** Destructive confirm (semantic, never follows context). Counts as the screen's one primary. */
    danger: cn('bg-status-danger text-inverse shadow-pill', LIFT),
    /** Controls on the dark photo/video viewer. */
    overlay: 'bg-viewer-control text-viewer hover:bg-viewer-control-hover',
};

const ICON_VARIANT: Record<IconButtonVariant, string> = {
    secondary: VARIANT.secondary,
    ghost: 'bg-transparent text-secondary hover:bg-sunken hover:text-primary',
    overlay: VARIANT.overlay,
    /** Floating accent button (the chat's unread arrows). */
    accent: cn('bg-accent-gradient text-inverse', GLOW, LIFT),
};

const SIZE: Record<ButtonSize, string> = {
    sm: 'h-8 px-3 text-small',
    md: 'h-10 px-5 text-body',
};

const ICON_SIZE: Record<ButtonSize, string> = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
};

let warnedNoReason = false;
function warnNoReason(): void {
    if (!import.meta.env.DEV || warnedNoReason) return;
    warnedNoReason = true;
    console.warn('[Button] disabled without disabledReason: tell the user why (docs/design/DESIGN_SYSTEM.md, "States")');
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Shows a spinner, keeps the width and swallows clicks. */
    loading?: boolean;
    /** Translated reason the action is unavailable. Alone (without `disabled`) it blocks the button: aria-disabled, focusable, clicks swallowed. */
    disabledReason?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ variant = 'secondary', size = 'md', type = 'button', className, loading = false, disabledReason, disabled, onClick, children, ...rest }, ref) => {
        const reasonId = useId();
        const reason = disabledReason || undefined;
        if (disabled && !reason) warnNoReason();
        const blocked = loading || reason !== undefined;
        return (
            <button
                {...rest}
                ref={ref}
                type={type}
                disabled={disabled && !reason}
                aria-disabled={reason !== undefined ? true : undefined}
                aria-busy={loading || undefined}
                aria-describedby={reason !== undefined ? reasonId : undefined}
                data-loading={loading || undefined}
                title={reason}
                className={cn(BASE, VARIANT[variant], SIZE[size], className)}
                onClick={blocked ? (e) => { e.preventDefault(); e.stopPropagation(); } : onClick}
            >
                {loading && (
                    <span data-spinner aria-hidden="true" className="absolute inset-0 m-auto h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
                )}
                {/* Stays in the a11y tree while loading (opacity, not visibility) so width and name are unchanged. */}
                <span className={cn('inline-flex items-center justify-center gap-2', loading && 'opacity-0')}>{children}</span>
                {reason !== undefined && <span id={reasonId} aria-hidden="true" className="sr-only">{reason}</span>}
            </button>
        );
    },
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
        <button {...rest} ref={ref} type={type} className={cn(BASE, ICON_VARIANT[variant], ICON_SIZE[size], className)}>
            <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center">{icon}</span>
        </button>
    ),
);
IconButton.displayName = 'IconButton';
