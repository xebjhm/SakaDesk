import React from 'react';
import { cn } from '../../utils/classnames';
import { Z_INDEX } from '../../constants/zIndex';

export interface RailItemProps {
    icon: React.ReactNode;
    /** Already translated by the caller. Becomes the button's accessible name and the hover tooltip text. */
    label: string;
    selected?: boolean;
    onClick?: () => void;
    className?: string;
}

/**
 * Feature-rail entry: a 40 px icon-only tile. `label` is the accessible name (`aria-label`) and the
 * text of a neutral dark tooltip (`bg-toast text-viewer`, never the group colour) that appears to the right
 * on hover and keyboard focus after a short delay; the tooltip is `aria-hidden` because the name is
 * already on the button. Selected: a white card with the accent icon and left bar.
 */
export const RailItem: React.FC<RailItemProps> = ({ icon, label, selected = false, onClick, className }) => (
    <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={selected ? 'page' : undefined}
        className={cn(
            'group relative flex h-10 w-10 items-center justify-center rounded-lg',
            'transition-colors duration-fast ease-standard',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            selected ? 'bg-sheet shadow-card' : 'text-secondary hover:bg-elevated hover:text-primary',
            className,
        )}
    >
        {selected && (
            <span data-rail-bar aria-hidden="true" className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent" />
        )}
        <span data-rail-icon aria-hidden="true" className={cn('flex h-5 w-5 items-center justify-center', selected && 'text-accent')}>{icon}</span>
        <span
            role="tooltip"
            aria-hidden="true"
            style={{ zIndex: Z_INDEX.DROPDOWN }}
            className={cn(
                'pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1',
                'bg-toast text-caption text-viewer shadow-card',
                'opacity-0 transition-opacity delay-300 duration-fast ease-standard',
                'group-hover:opacity-100 group-focus-visible:opacity-100',
                'motion-reduce:transition-none motion-reduce:delay-0',
            )}
        >
            {label}
        </span>
    </button>
);
