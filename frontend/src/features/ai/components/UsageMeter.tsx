// frontend/src/features/ai/components/UsageMeter.tsx
import React, { useEffect, useState } from 'react';
import { useTranslation } from '../../../i18n';

/** `GET /api/ai/usage`'s shape (`backend/services/llm_usage.py`'s
 * `usage_snapshot`). Fields are optional so a caller-provided snapshot
 * (e.g. `AiFeature`'s own fetch) can be passed straight through. */
export interface UsageSnapshot {
    model?: string;
    requestsToday?: number;
    dailyLimit?: number | null;
    estQuestionsLeft?: number | null;
}

/** Below this many estimated questions left, the meter switches to its amber
 * "running low" styling -- purely cosmetic, a lower bar than the actual
 * pre-empt gate. `AiFeature`'s quota pre-empt (P-5 review, item 2) only
 * blocks submission at exactly `estQuestionsLeft === 0`; this component
 * never decides whether an ask may be attempted. */
const LOW_THRESHOLD = 3;

export interface UsageMeterProps {
    /** Caller-owned usage snapshot. When this prop is PROVIDED (even as
     * `null`, meaning "still loading"), the meter never fetches on its own --
     * `AiFeature` already fetches `/api/ai/usage` for its quota pre-empt
     * gate, and duplicating that request per settle was pure waste (expert
     * review WIN 9i). When the prop is absent (`undefined` -- e.g.
     * `KbBackendSelector` in Settings), the meter self-fetches as before. */
    usage?: UsageSnapshot | null;
    /** Bumped by the caller after an ask resolves (success OR a quota
     * error) to force a refetch -- only meaningful in self-fetch mode
     * (no `usage` prop). */
    refreshKey?: number;
    className?: string;
}

/**
 * `UsageMeter` — "~N questions left today", rendered in BOTH the chat
 * composer area (`ChatWindow`) and Settings (`KbBackendSelector`), per
 * Product-wave Task 5, item 3. Renders nothing at all when the configured
 * model has no daily limit (`dailyLimit: null` — the local backend, or an
 * unrecognized cloud model) -- an unlimited meter has nothing useful to show.
 */
export const UsageMeter: React.FC<UsageMeterProps> = ({ usage: usageProp, refreshKey, className }) => {
    const { t } = useTranslation();
    const [fetched, setFetched] = useState<UsageSnapshot | null>(null);
    const selfManaged = usageProp === undefined;

    useEffect(() => {
        if (!selfManaged) return;
        // `refreshKey` isn't read in the body -- it's a deliberate refetch
        // trigger the caller bumps after an ask settles (see `AiFeature`).
        fetch('/api/ai/usage')
            .then((res) => (res.ok ? res.json() : null))
            .then((data: UsageSnapshot | null) => setFetched(data))
            .catch((err: unknown) => {
                console.error('[UsageMeter] Failed to fetch usage:', err);
            });
    }, [refreshKey, selfManaged]);

    const usage = selfManaged ? fetched : usageProp;

    if (
        !usage ||
        usage.dailyLimit === null ||
        usage.dailyLimit === undefined ||
        usage.estQuestionsLeft === null ||
        usage.estQuestionsLeft === undefined
    ) {
        return null;
    }

    const low = usage.estQuestionsLeft <= LOW_THRESHOLD;
    const empty = usage.estQuestionsLeft <= 0;

    return (
        <div
            data-testid="usage-meter"
            className={`text-xs ${empty ? 'text-red-600' : low ? 'text-amber-600' : 'text-gray-400'} ${className ?? ''}`}
        >
            {empty
                ? t('ai.quota.none')
                : t('ai.quota.left', { count: usage.estQuestionsLeft })}
        </div>
    );
};
