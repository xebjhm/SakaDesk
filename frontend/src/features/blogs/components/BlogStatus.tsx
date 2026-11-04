import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';

export interface BlogStatusProps {
    kind: 'loading' | 'empty' | 'error';
    /** Already translated. */
    title: string;
    /** Already translated. */
    hint?: string;
    /** Empty / error icon (loading shows a spinner). */
    icon?: React.ReactNode;
    onRetry?: () => void;
    /** Already translated; the retry button shows only with both onRetry and retryLabel. */
    retryLabel?: string;
    /** Fill the scroll area (first sync) instead of a fixed-height block. */
    fill?: boolean;
}

/** Loading, empty and error block of the blog screens (neutral; errors are alerts). */
export const BlogStatus: React.FC<BlogStatusProps> = ({ kind, title, hint, icon, onRetry, retryLabel, fill = false }) => (
    <div
        role={kind === 'error' ? 'alert' : 'status'}
        className={cn('flex flex-col items-center justify-center gap-4 px-6 text-center', fill ? 'h-full min-h-96' : 'h-72')}
    >
        {kind === 'loading' ? (
            <Loader2 aria-hidden="true" className={cn('animate-spin text-muted motion-reduce:animate-none', fill ? 'h-10 w-10' : 'h-8 w-8')} />
        ) : icon ? (
            <div aria-hidden="true" className="rounded-card bg-sunken p-5 text-muted">{icon}</div>
        ) : null}
        <div className="flex flex-col gap-1">
            <p className="text-body text-secondary">{title}</p>
            {hint && <p className="text-small text-muted">{hint}</p>}
        </div>
        {onRetry && retryLabel && (
            <Button variant="secondary" size="sm" onClick={onRetry}>{retryLabel}</Button>
        )}
    </div>
);
