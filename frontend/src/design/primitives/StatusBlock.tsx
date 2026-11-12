import React, { useId, useRef } from 'react';
import { AlertCircle, Clock, Inbox, Loader2 } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { cn } from '../../utils/classnames';
import { logWait, useLoadingStages, type LoadingStage } from '../loading';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { ProgressBar } from './ProgressBar';
import { SPIN } from './Spinner';
import { SPINNER_LABEL_VISIBILITY, SPINNER_SIZE, type SpinnerLabelVisibility } from './spinnerClasses';

export type StatusBlockVariant = 'pane' | 'dialog' | 'block' | 'fill' | 'inline';

type Common = {
    /** `ui_wait` surface code, `^[a-z0-9_]{1,40}$`. */
    surface: string;
    /**
     * pane: fills a flex pane (Memories, chat); dialog (default): inside a dialog body;
     * block: a fixed `h-72` block; fill: the whole scroll area (`h-full min-h-96`);
     * inline: one row (a small spinner plus `text-small text-secondary`), for band and hub lines.
     */
    variant?: StatusBlockVariant;
    /** Translated. */
    title?: string;
    /** Translated. */
    hint?: string;
    icon?: React.ReactNode;
    className?: string;
};

export type StatusBlockLoadingProps = {
    kind: 'loading';
    /** Translated name of the wait; defaults to `loading.label`. */
    label?: string;
    /**
     * auto (default): the label is screen-reader only and shows under reduced motion; always: the label is
     * visible beside the glyph (use it when the label is a real title such as "Loading posts…").
     * The same applies with a `skeleton`: under reduced motion its label shows from `reveal`.
     */
    labelVisibility?: SpinnerLabelVisibility;
    /** A layout-shaped `Skeleton` group drawn instead of the spinner. */
    skeleton?: React.ReactNode;
    /** Translated; default `loading.slow`. Shown from `slow`. */
    slowHint?: string;
    /** Translated; default `loading.verySlow`. Replaces the slow hint from `verySlow`. */
    verySlowHint?: string;
    /** Shown as a ghost Cancel button from `verySlow`. */
    onCancel?: () => void;
    /** Translated; default `loading.cancel`. */
    cancelLabel?: string;
    /** Shown from `verySlow`: 0..1 determinate bar, null = indeterminate bar. */
    progress?: number | null;
    /**
     * Fixed stage (no clock, no breadcrumb): previews, tests, or a line whose content is already on
     * screen (e.g. the hub's "still gathering" line, `shown` at once).
     */
    stage?: LoadingStage;
};

/** `title` is required: an empty state always names what is missing. */
export type StatusBlockEmptyProps = { kind: 'empty'; title: string; action?: React.ReactNode };

type RetryStyle = {
    /** Translated; default `loading.retry`. */
    retryLabel?: string;
    retryVariant?: 'secondary' | 'primary';
};

/**
 * A timeout always offers Retry (L1: never a dead end). An error offers it whenever the failed
 * load can run again; omit `onRetry` only when the host has nothing to retry (the error then
 * shows without a button, never an empty state).
 */
export type StatusBlockProblemProps =
    | ({ kind: 'timeout'; onRetry: () => void } & RetryStyle)
    | ({ kind: 'error'; onRetry?: () => void } & RetryStyle);

export type StatusBlockProps =
    | (Common & StatusBlockLoadingProps)
    | (Common & StatusBlockEmptyProps)
    | (Common & StatusBlockProblemProps);

const CENTRED = 'flex flex-col items-center justify-center text-center';
const VARIANT: Record<StatusBlockVariant, string> = {
    pane: cn(CENTRED, 'flex-1 gap-3 p-6'),
    dialog: cn(CENTRED, 'gap-3 px-6 py-12'),
    block: cn(CENTRED, 'h-72 gap-4 px-6'),
    fill: cn(CENTRED, 'h-full min-h-96 gap-4 px-6'),
    inline: 'flex min-h-5 flex-row flex-wrap items-center gap-2 text-small text-secondary',
};

const glyphSize = (variant: StatusBlockVariant) => (variant === 'fill' ? 'lg' : variant === 'inline' ? 'sm' : 'md');

const LoadingBlock: React.FC<Common & StatusBlockLoadingProps> = ({
    surface, variant = 'dialog', label, labelVisibility, skeleton, slowHint, verySlowHint, onCancel, cancelLabel, progress, stage: fixedStage, className,
}) => {
    const { t } = useTranslation();
    const labelId = useId();
    const mountedAt = useRef(Date.now());
    const clock = useLoadingStages(fixedStage === undefined, { surface });
    const stage = fixedStage ?? clock.stage;
    const name = label ?? t('loading.label');
    const size = glyphSize(variant);
    const inline = variant === 'inline';

    if (stage === 'hidden') {
        // Same box as the shown state (a spacer the size of the glyph), so the layout never jumps.
        return (
            <div role="status" aria-busy="true" data-stage="hidden" className={cn(VARIANT[variant], className)}>
                {!skeleton && <span aria-hidden="true" className={cn('block', SPINNER_SIZE[size])} />}
            </div>
        );
    }

    const cancel = () => {
        logWait(surface, 'cancelled', Date.now() - mountedAt.current);
        onCancel?.();
    };
    const verySlowNow = stage === 'verySlow';
    const hint = verySlowNow ? (verySlowHint ?? t('loading.verySlow')) : stage === 'slow' ? (slowHint ?? t('loading.slow')) : null;

    return (
        // No aria-busy once revealed: screen readers hold back a busy live region's updates, and this
        // region must announce its label, then the slow line, then the explanation.
        <div role="status" aria-labelledby={labelId} data-stage={stage} className={cn(VARIANT[variant], className)}>
            {skeleton ?? <Loader2 aria-hidden="true" data-spinner className={cn(SPINNER_SIZE[size], inline ? 'text-muted' : 'text-accent', SPIN)} />}
            <span
                id={labelId}
                className={cn(
                    'text-small text-secondary',
                    // A skeleton stops pulsing under reduced motion: its label then shows (auto), as a spinner's does.
                    SPINNER_LABEL_VISIBILITY[labelVisibility ?? (inline && !skeleton ? 'always' : 'auto')],
                )}
            >
                {name}
            </span>
            {hint && <p className="text-small text-secondary">{hint}</p>}
            {verySlowNow && progress !== undefined && (
                <ProgressBar value={progress} label={name} className={inline ? 'w-24' : 'w-48'} />
            )}
            {verySlowNow && progress === undefined && !onCancel && (
                // Its reduced-motion label would repeat the spinner label shown just above.
                <ProgressBar label={name} labelClassName="hidden" className={inline ? 'w-24' : 'w-48'} />
            )}
            {verySlowNow && onCancel && (
                <Button variant="ghost" size="sm" onClick={cancel}>{cancelLabel ?? t('loading.cancel')}</Button>
            )}
        </div>
    );
};

const ProblemBlock: React.FC<Common & StatusBlockProblemProps> = ({
    kind, variant = 'dialog', title, hint, icon, onRetry, retryLabel, retryVariant = 'secondary', className,
}) => {
    const { t } = useTranslation();
    const timeout = kind === 'timeout';
    const inline = variant === 'inline';
    const heading = title ?? t(timeout ? 'loading.timeout' : 'loading.error');
    const sentence = hint ?? (timeout ? t('loading.timeoutHint') : undefined);
    return (
        <div role="alert" data-kind={kind} className={cn(VARIANT[variant], className)}>
            {!inline && (
                <span
                    aria-hidden="true"
                    className={cn(
                        'flex rounded-card p-4 [&_svg]:h-8 [&_svg]:w-8',
                        timeout ? 'bg-sunken text-muted' : 'bg-semantic-danger-icon text-semantic-danger',
                    )}
                >
                    {icon ?? (timeout ? <Clock /> : <AlertCircle />)}
                </span>
            )}
            <p className={cn(inline ? 'text-small' : 'text-body', timeout ? (inline ? 'text-secondary' : 'text-primary') : 'text-status-danger')}>{heading}</p>
            {sentence && <p className="text-small text-muted">{sentence}</p>}
            {onRetry && <Button variant={inline ? 'ghost' : retryVariant} size="sm" onClick={onRetry}>{retryLabel ?? t('loading.retry')}</Button>}
        </div>
    );
};

/**
 * The one loading / empty / error / timeout state (it replaced the older per-feature status
 * components: Memories, dialogs, blogs and the recap).
 *
 * - loading: an empty `role="status"` box (`aria-busy`) until `reveal`, then the `skeleton` or a spinner with its
 *   label (with a skeleton, the label is screen-reader only except under reduced motion); the slow hint from `slow`; from `verySlow` the very-slow hint plus Cancel (`onCancel`)
 *   or a `ProgressBar` (`progress`), and an indeterminate bar when neither is given. Logs `ui_wait`
 *   (`slow`, `very_slow` once per mount, `cancelled` on Cancel).
 * - error: `role="alert"`, danger icon tile, `loading.error` title, Retry (when `onRetry` is given).
 * - timeout: `role="alert"`, neutral `Clock` tile, `loading.timeout` + `loading.timeoutHint`, Retry (always).
 * - empty: `EmptyState` (title, hint as its sentence, `action`).
 */
export const StatusBlock: React.FC<StatusBlockProps> = (props) => {
    if (props.kind === 'loading') return <LoadingBlock {...props} />;
    if (props.kind !== 'empty') return <ProblemBlock {...props} />;
    const { variant = 'dialog', title, hint, icon, action, className } = props;
    return (
        <div role="status" className={cn(VARIANT[variant], className)}>
            <EmptyState icon={icon ?? <Inbox />} title={title} description={hint} action={action} />
        </div>
    );
};
