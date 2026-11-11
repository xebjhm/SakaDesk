import React from 'react';
import { StatusBlock } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';
import type { MemoriesView } from '../memoriesLog';
import type { MemoriesQuery } from './useMemoriesQuery';

export interface MemoriesStatusProps {
    /** Only `status`, `failure` and `retry` are read. */
    query: Pick<MemoriesQuery<unknown>, 'status' | 'failure' | 'retry'>;
    /** The view's `memories_load` code; the `ui_wait` surface is `memories_<view>`. */
    view: MemoriesView;
    /** A layout-shaped `Skeleton` group drawn instead of the spinner. */
    skeleton?: React.ReactNode;
    /** pane (default): fills the Memories pane; inline: one row (band and hub lines). */
    variant?: 'pane' | 'inline';
    /** Translated; default `memories.common.slow`. */
    slowHint?: string;
    /** Translated; default `memories.common.verySlow`. */
    verySlowHint?: string;
}

/**
 * A Memories view's load state on `StatusBlock` (a thin mapping, never a status component of its
 * own): `loading` is the staged wait (`surface` `memories_<view>`, the Memories slow and very-slow
 * copy); `error` with `failure: 'timeout'` is the timeout state (`memories.common.timeout` /
 * `timeoutHint`), any other error the gentle `memories.common.loadError`; both retry with
 * `query.retry` (`memories.common.retry`). A ready query renders nothing.
 */
export function MemoriesStatus({ query, view, skeleton, variant = 'pane', slowHint, verySlowHint }: MemoriesStatusProps): JSX.Element | null {
    const { t } = useTranslation();
    const surface = `memories_${view}`;
    if (query.status === 'loading') {
        return (
            <StatusBlock
                kind="loading"
                surface={surface}
                variant={variant}
                skeleton={skeleton}
                slowHint={slowHint ?? t('memories.common.slow')}
                verySlowHint={verySlowHint ?? t('memories.common.verySlow')}
            />
        );
    }
    if (query.status !== 'error') return null;
    const retryLabel = t('memories.common.retry');
    if (query.failure === 'timeout') {
        return (
            <StatusBlock
                kind="timeout"
                surface={surface}
                variant={variant}
                title={t('memories.common.timeout')}
                hint={t('memories.common.timeoutHint')}
                onRetry={query.retry}
                retryLabel={retryLabel}
            />
        );
    }
    return (
        <StatusBlock
            kind="error"
            surface={surface}
            variant={variant}
            title={t('memories.common.loadError')}
            onRetry={query.retry}
            retryLabel={retryLabel}
        />
    );
}
