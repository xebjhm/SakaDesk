/** The two slides of the multi-member opening (spec §9.6); `Opening.tsx` plays them. */
import React from 'react';
import { Heart, Sparkle } from 'lucide-react';
import { useTranslation } from '../../../../i18n';
import { cn } from '../../../../utils/classnames';
import type { RecapOverview } from '../api';
import { starMembers, titledMembers } from '../openingMembers';
import { Headline, Narration, type SlideProps } from './common';
import { heldReveal } from './style';

/** Stagger between two stars or two title rows; capped so a long list still lands quickly. */
const STAGGER_MS = 120;
const STAGGER_CAP = 12;

/** 「わたしの{year}」: every member as an equal-size star, in star order. No counts, no ranks. */
export const OpeningStars: React.FC<SlideProps<RecapOverview>> = ({ data, recap, reducedMotion, paused }) => {
    const { t } = useTranslation();
    const stars = starMembers(data);
    const firstId = data.opening.first_message?.member_id ?? null;
    return (
        <div className="flex h-full flex-col items-center justify-center gap-6 px-6 pb-8 pt-16 text-center">
            <Headline>{t('recap.opening.starsTitle', { year: recap.year })}</Headline>
            <ul
                aria-label={t('recap.opening.starsLabel')}
                className={cn('grid w-full gap-x-2 gap-y-4', stars.length > 9 ? 'grid-cols-4' : 'grid-cols-3')}
            >
                {stars.map((m, i) => {
                    const r = heldReveal(reducedMotion, paused, Math.min(i, STAGGER_CAP) * STAGGER_MS);
                    return (
                        <li
                            key={m.member_id}
                            data-testid="opening-star"
                            data-member={m.member_id}
                            className={cn('flex min-w-0 flex-col items-center gap-1', r.className)}
                            style={r.style}
                        >
                            {/* Equal size for everyone: a star never grows with message volume. */}
                            <Sparkle aria-hidden="true" className="h-6 w-6 fill-current text-primary" />
                            <span className="flex max-w-full items-center gap-1">
                                <span lang="ja" className="truncate text-caption text-secondary">{m.name}</span>
                                {m.oshi && (
                                    <Heart role="img" aria-label={t('recap.entry.oshi')} className="h-3 w-3 shrink-0 fill-semantic-oshi text-semantic-oshi-solid" />
                                )}
                            </span>
                            {firstId === m.member_id && (
                                <span className="text-caption text-muted">{t('recap.opening.firstChip')}</span>
                            )}
                        </li>
                    );
                })}
            </ul>
            <Narration>{t('recap.opening.starsNarration')}</Narration>
        </div>
    );
};

/** Role titles: one chip per titled member, in star order (never ordered by a score). */
export const OpeningTitles: React.FC<SlideProps<RecapOverview>> = ({ data, reducedMotion, paused }) => {
    const { t } = useTranslation();
    const rows = titledMembers(data);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-6 px-6 pb-8 pt-16 text-center">
            <Headline>{t('recap.opening.titlesTitle')}</Headline>
            <ul className="flex w-full flex-col items-center gap-3">
                {rows.map((m, i) => {
                    const r = heldReveal(reducedMotion, paused, Math.min(i, STAGGER_CAP) * STAGGER_MS);
                    return (
                        <li
                            key={m.member_id}
                            data-testid="opening-title"
                            className={cn('flex max-w-full flex-col items-center gap-1', r.className)}
                            style={r.style}
                        >
                            <span lang="ja" className="max-w-full truncate text-body text-primary">{m.name}</span>
                            <span className="rounded-full bg-expressive-soft px-3 py-1 text-small text-secondary">{t(m.title_key!)}</span>
                        </li>
                    );
                })}
            </ul>
            <Narration>{t('recap.opening.titlesNarration')}</Narration>
        </div>
    );
};
