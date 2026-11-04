import React from 'react';
import { cn } from '../../utils/classnames';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/** Level 0 — the group gradient background. No corners, no shadow. */
export const Canvas = React.forwardRef<HTMLDivElement, DivProps>(({ className, ...rest }, ref) => (
    <div ref={ref} className={cn('bg-group-canvas', className)} {...rest} />
));
Canvas.displayName = 'Canvas';

/** Level 1 — the one content sheet (chat, blog, modal bodies). */
export const Sheet = React.forwardRef<HTMLDivElement, DivProps>(({ className, ...rest }, ref) => (
    <div ref={ref} className={cn('bg-sheet rounded-sheet shadow-sheet', className)} {...rest} />
));
Sheet.displayName = 'Sheet';

/** Level 2 — cards on a sheet (photos, info cards; D2 builds bubbles from it). */
export const Card = React.forwardRef<HTMLDivElement, DivProps>(({ className, ...rest }, ref) => (
    <div ref={ref} className={cn('bg-card rounded-card shadow-card', className)} {...rest} />
));
Card.displayName = 'Card';
