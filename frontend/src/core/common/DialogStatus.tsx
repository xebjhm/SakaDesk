import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button, EmptyState } from '../../design/primitives';
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

/**
 * Loading, empty and error states inside a dialog (one component for every dialog's states).
 * Empty is the brand-moment pattern (`EmptyState`, spec §9): soft circle, muted line icon,
 * serif title, the hint as its one sentence, the retry as its one action.
 */
export const DialogStatus: React.FC<DialogStatusProps> = ({ kind, title, hint, icon, onRetry, retryLabel, retryVariant = 'secondary', className }) => {
    const retry = onRetry && retryLabel ? <Button variant={retryVariant} size="sm" onClick={onRetry}>{retryLabel}</Button> : undefined;
    if (kind === 'empty') {
        return (
            <div role="status" className={cn('flex flex-col items-center justify-center', className)}>
                <EmptyState icon={icon} title={title ?? ''} description={hint} action={retry} />
            </div>
        );
    }
    return (
        <div
            role={kind === 'error' ? 'alert' : 'status'}
            className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}
        >
            {kind === 'loading' && <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-accent motion-reduce:animate-none" />}
            {kind === 'error' && icon && (
                <span aria-hidden="true" className="flex rounded-card bg-semantic-danger-icon p-4 text-semantic-danger [&_svg]:h-8 [&_svg]:w-8">
                    {icon}
                </span>
            )}
            {title && <p className={cn('text-body', kind === 'error' ? 'text-status-danger' : 'text-secondary')}>{title}</p>}
            {hint && <p className="text-small text-muted">{hint}</p>}
            {retry}
        </div>
    );
};
