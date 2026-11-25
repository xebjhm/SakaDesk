import React, { useId } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { cn } from '../../utils/classnames';
import { SPINNER_LABEL_VISIBILITY, SPINNER_SIZE, type SpinnerLabelVisibility, type SpinnerSize } from './spinnerClasses';

export type { SpinnerLabelVisibility, SpinnerSize } from './spinnerClasses';
export type SpinnerTone = 'accent' | 'muted' | 'current' | 'viewer';

export interface SpinnerProps {
    /** h-4 / h-6 / h-8 (and the same width). */
    size?: SpinnerSize;
    /** text-accent / text-muted / currentColor / text-viewer (the dark viewer). */
    tone?: SpinnerTone;
    /** Translated; defaults to `loading.label`. */
    label?: string;
    /**
     * auto: screen-reader only, visible under reduced motion (a static glyph never stands alone);
     * always: visible; compact: screen-reader only always (media tiles and bubbles under 160 px only).
     */
    labelVisibility?: SpinnerLabelVisibility;
    /** aria-hidden, no role, no label: ONLY next to visible text that already describes the wait. */
    decorative?: boolean;
    className?: string;
}

const TONE: Record<SpinnerTone, string> = {
    accent: 'text-accent', muted: 'text-muted', current: 'text-current', viewer: 'text-viewer',
};
/** The spinning glyph's motion: static under reduced motion. */
export const SPIN = 'animate-spin motion-reduce:animate-none';

/**
 * The one loading spinner (wraps lucide `Loader2`). A `role="status"` named by its label; the glyph
 * stops under reduced motion and the label then shows (`auto`), so it is never an icon alone.
 */
export const Spinner: React.FC<SpinnerProps> = ({
    size = 'md', tone = 'accent', label, labelVisibility = 'auto', decorative = false, className,
}) => {
    const { t } = useTranslation();
    const labelId = useId();
    if (decorative) {
        return <Loader2 aria-hidden="true" data-spinner className={cn(SPINNER_SIZE[size], TONE[tone], SPIN, className)} />;
    }
    return (
        <span role="status" aria-labelledby={labelId} data-spinner className={cn('inline-flex items-center gap-2', className)}>
            <Loader2 aria-hidden="true" className={cn(SPINNER_SIZE[size], TONE[tone], SPIN)} />
            <span
                id={labelId}
                className={cn(
                    'text-small',
                    tone === 'viewer' ? 'text-viewer' : tone === 'current' ? undefined : 'text-secondary',
                    SPINNER_LABEL_VISIBILITY[labelVisibility],
                )}
            >
                {label ?? t('loading.label')}
            </span>
        </span>
    );
};
