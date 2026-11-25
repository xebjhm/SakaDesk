import React from 'react';
import { useTranslation } from '../../i18n';
import { cn } from '../../utils/classnames';

export interface BadgeProps {
    count: number;
    className?: string;
}

/** Level 3 — unread count in the accent colour with the unread glow. Hidden at 0, capped at 99+. */
export const Badge: React.FC<BadgeProps> = ({ count, className }) => {
    const { t } = useTranslation();
    if (count <= 0) return null;
    return (
        <span
            className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-accent px-1.5',
                'text-caption font-semibold tabular-nums text-inverse shadow-accent-unread',
                className,
            )}
        >
            {/* A plain span cannot carry a name: the count is read from visually hidden text (UI health A-S2). */}
            <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
            <span className="sr-only">{t('common.unreadCount', { count })}</span>
        </span>
    );
};
