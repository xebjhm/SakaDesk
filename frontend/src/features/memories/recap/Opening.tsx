import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from '../../../i18n';
import { logRecapOpening } from '../memoriesLog';
import type { RecapOverview } from './api';
import { OPENING_REGISTRY, openingPayload, openingSlides } from './openingSlides';
import { RecapPlayer } from './RecapPlayer';
import { starMembers } from './openingMembers';

export type OpeningDone = 'end' | 'close';

interface OpeningProps {
    overview: RecapOverview;
    /** Played through (`end`) or closed with Esc / ✕ (`close`); the entry shows the member list next. */
    onDone: (how: OpeningDone) => void;
}

/**
 * The multi-member opening 「わたしの{year}」 (spec §9.6), played through the recap's own
 * story player, so it has the same progress bar, ← / → / click stepping, Space and the
 * pause button (which hold its reveals too), Esc to close and reduced motion.
 */
export const Opening: React.FC<OpeningProps> = ({ overview, onDone }) => {
    const { t } = useTranslation();
    const slides = useMemo(() => openingSlides(overview), [overview]);
    const payload = useMemo(() => openingPayload(overview), [overview]);
    const done = useRef(false);

    useEffect(() => {
        logRecapOpening('show', { count: starMembers(overview).length });
    }, [overview]);

    const finish = (how: OpeningDone, extra: { count?: number }) => {
        if (done.current) return;
        done.current = true;
        logRecapOpening(how, extra);
        onDone(how);
    };

    return (
        <RecapPlayer
            recap={payload}
            slides={slides}
            registry={OPENING_REGISTRY}
            label={t('recap.opening.label')}
            nickname={t('recap.youFallback')}
            onEnd={() => finish('end', { count: slides.length })}
            onClose={() => finish('close', {})}
        />
    );
};
