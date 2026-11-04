import React from 'react';
import { useTranslation } from '../../i18n';
import { cn } from '../../utils/classnames';
import { formatDatePillLabel, toLocalDateStr } from '../../utils/dateFormatters';

export interface DatePillProps {
    date: Date;
    /** Stick to the top of the scrolling timeline. */
    sticky?: boolean;
    className?: string;
}

/** Level 3 — floating date label for timelines. */
export const DatePill: React.FC<DatePillProps> = ({ date, sticky = false, className }) => {
    const { t, i18n } = useTranslation();
    const label = formatDatePillLabel(date, new Date(), i18n.language, (key) => t(key));
    return (
        <div className={cn('pointer-events-none flex justify-center py-2', sticky && 'sticky top-0 z-10', className)}>
            <time
                dateTime={toLocalDateStr(date)}
                className="pointer-events-auto rounded-pill bg-pill px-3 py-1 text-caption text-secondary shadow-pill"
            >
                {label}
            </time>
        </div>
    );
};
