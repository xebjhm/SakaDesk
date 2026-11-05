import React from 'react';
import { useTranslation } from '../../i18n';
import { cn } from '../../utils/classnames';

export interface BadgeProps {
    count: number;
    className?: string;
}

/** Level 3 — unread count in the group badge colour. Hidden at 0, capped at 99+. */
export const Badge: React.FC<BadgeProps> = ({ count, className }) => {
    const { t } = useTranslation();
    if (count <= 0) return null;
    return (
        <span
            aria-label={t('common.unreadCount', { count })}
            className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-accent px-1.5',
                'text-caption font-semibold text-inverse shadow-pill',
                className,
            )}
        >
            {count > 99 ? '99+' : count}
        </span>
    );
};
