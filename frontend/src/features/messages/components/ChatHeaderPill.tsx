import React from 'react';
import { cn } from '../../../utils/classnames';

export interface ChatHeaderPillProps {
    /** Light-style (white) header, e.g. Sakurazaka: a sunken, bordered pill so it does not vanish into the white. */
    light: boolean;
    className?: string;
    children: React.ReactNode;
}

/** A status pill in the chat header (unread count, sync progress). Neutral surfaces only. */
export const ChatHeaderPill: React.FC<ChatHeaderPillProps> = ({ light, className, children }) => (
    <span
        className={cn(
            'flex items-center gap-2 rounded-pill px-3 py-1 text-caption text-secondary',
            light ? 'border border-subtle bg-sunken' : 'bg-pill shadow-pill',
            className,
        )}
    >
        {children}
    </span>
);
