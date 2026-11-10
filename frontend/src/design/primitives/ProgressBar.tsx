import React from 'react';
import { cn } from '../../utils/classnames';

export type ProgressBarSize = 'thin' | 'sm' | 'md';

export interface ProgressBarProps {
    /** 0..1 determinate (clamped); null / undefined = indeterminate. */
    value?: number | null;
    /** Translated; the bar's accessible name. */
    label: string;
    /** Translated `aria-valuetext`, e.g. "4 / 10". */
    valueText?: string;
    /** h-0.5 / h-2 / h-4. */
    size?: ProgressBarSize;
    /** Shows the label above the bar. An indeterminate bar shows it under reduced motion regardless. */
    showLabel?: boolean;
    className?: string;
}

const SIZE: Record<ProgressBarSize, string> = { thin: 'h-0.5', sm: 'h-2', md: 'h-4' };

/**
 * Determinate or indeterminate progress (`role="progressbar"`). The fill is
 * `bg-expressive-progress`; the indeterminate 1/3 segment sweeps (`animate-progress-indeterminate`)
 * and stands still under reduced motion, where the label becomes visible so the static segment is
 * never shown alone.
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({ value, label, valueText, size = 'sm', showLabel = false, className }) => {
    const determinate = typeof value === 'number' && Number.isFinite(value);
    const pct = determinate ? Math.round(Math.min(1, Math.max(0, value)) * 100) : 0;
    return (
        <div className={cn('flex w-full flex-col gap-1', className)}>
            {(showLabel || !determinate) && (
                <span aria-hidden="true" className={cn('text-small text-secondary', !showLabel && 'sr-only motion-reduce:not-sr-only')}>
                    {label}
                </span>
            )}
            <div
                role="progressbar"
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={determinate ? pct : undefined}
                aria-valuetext={valueText}
                className={cn('relative w-full overflow-hidden rounded-full bg-sunken', SIZE[size])}
            >
                {determinate ? (
                    <div
                        data-progress-fill
                        className="h-full rounded-full bg-expressive-progress transition-all duration-base ease-standard motion-reduce:transition-none"
                        style={{ width: `${pct}%` }}
                    />
                ) : (
                    <div data-progress-fill className="h-full w-1/3 rounded-full bg-expressive-progress animate-progress-indeterminate motion-reduce:animate-none" />
                )}
            </div>
        </div>
    );
};
