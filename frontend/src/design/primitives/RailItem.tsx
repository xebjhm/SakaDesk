import React from 'react';
import { cn } from '../../utils/classnames';

export interface RailItemProps {
    icon: React.ReactNode;
    /** Already translated by the caller. */
    label: string;
    selected?: boolean;
    onClick?: () => void;
    className?: string;
}

/** Feature-rail entry: icon above a text label. Selected: a white card with the accent icon, label and left bar. */
export const RailItem: React.FC<RailItemProps> = ({ icon, label, selected = false, onClick, className }) => (
    <button
        type="button"
        onClick={onClick}
        aria-current={selected ? 'page' : undefined}
        className={cn(
            'relative flex w-full flex-col items-center gap-1 rounded-lg px-2 py-2 text-caption',
            'transition-colors duration-fast ease-standard',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            selected ? 'bg-sheet font-semibold text-accent-strong shadow-card' : 'text-secondary hover:bg-elevated hover:text-primary',
            className,
        )}
    >
        {selected && (
            <span data-rail-bar aria-hidden="true" className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent" />
        )}
        <span aria-hidden="true" className={cn('flex h-6 w-6 items-center justify-center', selected && 'text-accent')}>{icon}</span>
        <span>{label}</span>
    </button>
);
