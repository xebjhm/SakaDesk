import React, { useLayoutEffect, useRef } from 'react';
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
    /**
     * While `busy`, make the kept content `inert` and `pointer-events-none` at once (no click,
     * focus or navigation on content that is about to be replaced). `inert` also hides the kept
     * content from screen readers (it leaves the accessibility tree) until the step lands; the
     * wrapper's `aria-busy` and the top bar still say it is loading. Default false: the content
     * stays interactive and readable, as before.
     */
    inertWhileBusy?: boolean;
}

/**
 * Keep-previous visual: the previous content stays, `aria-busy` while `busy`. After the reveal
 * delay (fast steps never flash) the content dims to `opacity-60` and a thin indeterminate
 * `ProgressBar` sits on the top edge (under reduced motion with its label on a sheet pill below it);
 * once shown, both stay at least `minVisible`. The bar never takes clicks. With `inertWhileBusy`
 * the kept content is `inert` (no focus, no clicks, hidden from screen readers) and takes no
 * pointer events while `busy` (from the first render).
 */
export const BusyContent: React.FC<BusyContentProps> = ({ busy, label, children, className, contentClassName, inertWhileBusy = false }) => {
    const { t } = useTranslation();
    const shown = useDelayedLoading(busy);
    const blocked = inertWhileBusy && busy;
    const content = useRef<HTMLDivElement>(null);
    // `inert` is set on the element directly: React 18 does not pass it through as a boolean prop.
    useLayoutEffect(() => {
        content.current?.toggleAttribute('inert', blocked);
    }, [blocked]);
    return (
        <div className={cn('relative', className)} aria-busy={busy || undefined}>
            {shown && (
                <ProgressBar
                    label={label ?? t('loading.label')}
                    size="thin"
                    // Under reduced motion the label shows (the segment is static); it sits on a small
                    // sheet pill at the top-left so it stays readable over the kept content.
                    labelClassName="order-last mx-2 mt-1 self-start rounded-pill bg-sheet px-2 shadow-pill"
                    className="pointer-events-none absolute inset-x-0 top-0 z-10"
                />
            )}
            <div
                ref={content}
                className={cn('transition-opacity duration-base ease-standard motion-reduce:transition-none', shown && 'opacity-60', blocked && 'pointer-events-none', contentClassName)}
            >
                {children}
            </div>
        </div>
    );
};
