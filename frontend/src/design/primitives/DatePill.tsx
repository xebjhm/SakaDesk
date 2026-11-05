import React from 'react';
import { useTranslation } from '../../i18n';
import { cn } from '../../utils/classnames';
import { formatDatePillLabel, toLocalDateStr } from '../../utils/dateFormatters';

export interface DatePillProps {
    date: Date;
    /** Stick to the top of the scrolling timeline. */
    sticky?: boolean;
    /** Makes the pill a button (e.g. open the calendar). */
    onClick?: () => void;
    /** Already translated tooltip for the button. */
    actionLabel?: string;
    className?: string;
}

const PILL = 'pointer-events-auto rounded-pill bg-pill px-3 py-1 text-caption text-secondary shadow-pill';

/** Level 3 — floating date label for timelines; optionally a button. */
export const DatePill: React.FC<DatePillProps> = ({ date, sticky = false, onClick, actionLabel, className }) => {
    const { t, i18n } = useTranslation();
    const label = formatDatePillLabel(date, new Date(), i18n.language, (key) => t(key));
    const time = <time dateTime={toLocalDateStr(date)} className={onClick ? undefined : PILL}>{label}</time>;
    return (
        <div className={cn('pointer-events-none flex justify-center py-2', sticky && 'sticky top-0 z-10', className)}>
            {onClick ? (
                <button
                    type="button"
                    onClick={onClick}
                    title={actionLabel}
                    className={cn(
                        PILL,
                        'transition-colors duration-fast ease-standard hover:text-accent-strong',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    )}
                >
                    {time}
                </button>
            ) : time}
        </div>
    );
};
