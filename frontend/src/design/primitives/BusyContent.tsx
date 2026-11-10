import React from 'react';
import { useTranslation } from '../../i18n';
import { cn } from '../../utils/classnames';
import { useDelayedLoading } from '../loading';
import { ProgressBar } from './ProgressBar';

export interface BusyContentProps {
    /** The next step is loading; the children are the previous (kept) content. */
    busy: boolean;
    /** Translated name of the top bar; defaults to `loading.label`. */
    label?: string;
    children: React.ReactNode;
    /** On the `relative` wrapper. */
    className?: string;
    /** On the inner element that dims (e.g. `flex flex-col h-full` when the content is a flex layout). */
    contentClassName?: string;
}

/**
 * Keep-previous visual: the previous content stays, `aria-busy` while `busy`. After the reveal
 * delay (fast steps never flash) the content dims to `opacity-60` and a thin indeterminate
 * `ProgressBar` sits on the top edge; once shown, both stay at least `minVisible`.
 */
export const BusyContent: React.FC<BusyContentProps> = ({ busy, label, children, className, contentClassName }) => {
    const { t } = useTranslation();
    const shown = useDelayedLoading(busy);
    return (
        <div className={cn('relative', className)} aria-busy={busy || undefined}>
            {shown && <ProgressBar label={label ?? t('loading.label')} size="thin" className="absolute inset-x-0 top-0 z-10" />}
            <div className={cn('transition-opacity duration-base ease-standard motion-reduce:transition-none', shown && 'opacity-60', contentClassName)}>
                {children}
            </div>
        </div>
    );
};
