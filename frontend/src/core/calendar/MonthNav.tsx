import React from 'react';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { IconButton } from '../../design/primitives';
import { cn } from '../../utils/classnames';
import { useTranslation } from '../../i18n';
import { DAY_TONE_CLASS, WEEKDAY_KEYS, weekdayTone } from './monthGrid';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

interface MonthTitleButtonProps {
    /** The month on screen (`calendar.monthYear`). */
    title: string;
    /** The screen-reader hint after the title ("choose year and month"). */
    pickLabel: string;
    expanded: boolean;
    onClick: () => void;
    disabled?: boolean;
    className?: string;
}

/** The month title that opens / closes the year-month picker (`aria-expanded`, chevron, sr-only hint). */
export const MonthTitleButton = React.forwardRef<HTMLButtonElement, MonthTitleButtonProps>(
    ({ title, pickLabel, expanded, onClick, disabled, className }, ref) => (
        <button
            ref={ref}
            type="button"
            aria-expanded={expanded}
            disabled={disabled}
            onClick={onClick}
            className={cn(
                'flex items-center gap-1 rounded-lg px-2 py-1 text-title font-semibold text-primary',
                'transition-colors duration-fast ease-standard hover:bg-sunken',
                FOCUS_RING,
                className,
            )}
        >
            <span>{title}</span>
            <span className="sr-only">, {pickLabel}</span>
            <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center text-secondary">
                {expanded ? <ChevronUp /> : <ChevronDown />}
            </span>
        </button>
    ),
);
MonthTitleButton.displayName = 'MonthTitleButton';

interface MonthStepButtonProps {
    /** In the picker view the older button turns into back-to-days and the newer one into a spacer. */
    picking: boolean;
    label: string;
    onClick: () => void;
    disabled?: boolean;
}

/** ‹ (older month), or ← back to the days while the picker is shown. */
export const OlderMonthButton: React.FC<MonthStepButtonProps & { onBack: () => void }> = ({ picking, label, onClick, onBack, disabled }) => {
    const { t } = useTranslation();
    return picking
        ? <IconButton size="sm" aria-label={t('calendar.backToDays')} icon={<ArrowLeft />} onClick={onBack} />
        : <IconButton size="sm" aria-label={label} icon={<ChevronLeft />} disabled={disabled} onClick={onClick} />;
};

/** › (newer month), or a spacer of the same size while the picker is shown. */
export const NewerMonthButton: React.FC<MonthStepButtonProps> = ({ picking, label, onClick, disabled }) => (picking
    ? <span aria-hidden="true" className="h-8 w-8" />
    : <IconButton size="sm" aria-label={label} icon={<ChevronRight />} disabled={disabled} onClick={onClick} />);

/** The Sunday-first weekday header: Sunday red, Saturday blue, the others muted. */
export const WeekdayHeader: React.FC<{ className?: string; cellClassName?: string }> = ({ className, cellClassName = 'py-2' }) => {
    const { t } = useTranslation();
    return (
        <div className={cn('grid grid-cols-7', className)}>
            {WEEKDAY_KEYS.map((key, i) => {
                const tone = weekdayTone(i);
                return (
                    <div
                        key={key}
                        data-testid="calendar-weekday"
                        className={cn(cellClassName, 'text-center text-caption font-semibold', tone ? DAY_TONE_CLASS[tone] : 'text-muted')}
                    >
                        {t(`calendar.weekdays.${key}`)}
                    </div>
                );
            })}
        </div>
    );
};
