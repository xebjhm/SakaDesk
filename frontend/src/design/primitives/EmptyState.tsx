import React from 'react';

export interface EmptyStateProps {
    icon: React.ReactNode;
    title: string;
    description?: string;
    action?: React.ReactNode;
}

/** Brand moment (spec §9): soft circle + line icon + display-face title + one line + one action. */
export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <div data-testid="empty-state-circle" className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-expressive-soft text-accent-strong">
            <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center">{icon}</span>
        </div>
        <h3 className="font-display text-heading font-semibold text-primary">{title}</h3>
        {description && <p className="max-w-sm text-small text-secondary">{description}</p>}
        {action && <div className="mt-2">{action}</div>}
    </div>
);
