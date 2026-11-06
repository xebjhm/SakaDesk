import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../design/primitives';
import { cn } from '../../utils/classnames';

export interface DialogStatusProps {
    kind: 'loading' | 'empty' | 'error';
    title?: string;        // translated
    hint?: string;         // translated
    icon?: React.ReactNode;
    onRetry?: () => void;
    retryLabel?: string;   // translated
    retryVariant?: 'secondary' | 'primary'; // default secondary
    className?: string;
}

/** Loading, empty and error states inside a dialog (one component for every dialog's states). */
export const DialogStatus: React.FC<DialogStatusProps> = ({ kind, title, hint, icon, onRetry, retryLabel, retryVariant = 'secondary', className }) => (
    <div
        role={kind === 'error' ? 'alert' : 'status'}
        className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}
    >
        {kind === 'loading' && <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-accent motion-reduce:animate-none" />}
        {kind !== 'loading' && icon && (
            <span
                aria-hidden="true"
                className={cn('flex rounded-card p-4 [&_svg]:h-8 [&_svg]:w-8', kind === 'error' ? 'bg-semantic-danger-icon text-semantic-danger' : 'bg-expressive-soft text-accent-strong')}
            >
                {icon}
            </span>
        )}
        {title && <p className={cn('text-body', kind === 'error' ? 'text-status-danger' : 'text-secondary')}>{title}</p>}
        {hint && <p className="text-small text-muted">{hint}</p>}
        {onRetry && retryLabel && <Button variant={retryVariant} size="sm" onClick={onRetry}>{retryLabel}</Button>}
    </div>
);
