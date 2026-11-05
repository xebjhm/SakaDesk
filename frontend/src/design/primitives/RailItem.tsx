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

/** Feature-rail entry: icon above a text label. */
export const RailItem: React.FC<RailItemProps> = ({ icon, label, selected = false, onClick, className }) => (
    <button
        type="button"
        onClick={onClick}
        aria-current={selected ? 'page' : undefined}
        className={cn(
            'flex w-full flex-col items-center gap-1 rounded-card px-2 py-2 text-caption',
            'transition-colors duration-fast ease-standard',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            selected ? 'bg-sheet font-semibold text-primary shadow-card' : 'text-secondary hover:bg-elevated hover:text-primary',
            className,
        )}
    >
        <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center">{icon}</span>
        <span>{label}</span>
    </button>
);
