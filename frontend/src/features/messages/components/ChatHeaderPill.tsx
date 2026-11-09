import React from 'react';
import { cn } from '../../../utils/classnames';

export interface ChatHeaderPillProps {
    /** Light-style (white) header, e.g. Sakurazaka. */
    light: boolean;
    /** `count` (unread) or `status` (sync); as before D2 they differ slightly. */
    tone?: 'count' | 'status';
    className?: string;
    children: React.ReactNode;
}

const TONE = {
    count: { gradient: 'bg-header-glass text-inverse', light: 'bg-group-title-tint text-group-title' },
    status: { gradient: 'bg-header-shade text-inverse', light: 'bg-group-title-wash text-group-title' },
} as const;

/**
 * A status pill in the chat header (the pre-D2 look through tokens): white glass or a dark shade
 * on the title gradient, the official title-text colour tinted on a light header.
 */
export const ChatHeaderPill: React.FC<ChatHeaderPillProps> = ({ light, tone = 'count', className, children }) => (
    <span className={cn('flex items-center gap-2 rounded-pill px-3 py-1 text-caption', TONE[tone][light ? 'light' : 'gradient'], className)}>
        {children}
    </span>
);
