// frontend/src/features/ai/components/UsageMeter.tsx
import React, { useEffect, useState } from 'react';
import { useTranslation } from '../../../i18n';

/** `GET /api/ai/usage`'s shape (`backend/services/llm_usage.py`'s `usage_snapshot`). */
interface UsageResponse {
    model: string;
    requestsToday: number;
    dailyLimit: number | null;
    estQuestionsLeft: number | null;
}

/** Below this many estimated questions left, the meter switches to its amber
 * "running low" styling -- same threshold `ChatWindow`'s pre-empt check
 * (Product-wave Task 5, item 3) uses to decide whether to even attempt an
 * ask.  */
const LOW_THRESHOLD = 3;

export interface UsageMeterProps {
    /** Bumped by the caller after an ask resolves (success OR a quota
     * error) to force a refetch -- the meter otherwise only reflects
     * whatever `GET /api/ai/usage` returned on mount. */
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
export const UsageMeter: React.FC<UsageMeterProps> = ({ refreshKey, className }) => {
    const { t } = useTranslation();
    const [usage, setUsage] = useState<UsageResponse | null>(null);

    useEffect(() => {
        // `refreshKey` isn't read in the body -- it's a deliberate refetch
        // trigger the caller bumps after an ask settles (see `AiFeature`).
        fetch('/api/ai/usage')
            .then((res) => (res.ok ? res.json() : null))
            .then((data: UsageResponse | null) => setUsage(data))
            .catch((err: unknown) => {
                console.error('[UsageMeter] Failed to fetch usage:', err);
            });
    }, [refreshKey]);

    if (!usage || usage.dailyLimit === null || usage.estQuestionsLeft === null) {
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
