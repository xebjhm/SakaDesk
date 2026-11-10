/** The two slides of the multi-member opening (spec §9.6); `Opening.tsx` plays them. */
import React from 'react';
import { Heart, Sparkle } from 'lucide-react';
import { useTranslation } from '../../../../i18n';
import { cn } from '../../../../utils/classnames';
import type { RecapOverview } from '../api';
import { STAR_LABEL_SHARE, STAR_SHARE, starGrid, starMembers, titledMembers } from '../openingMembers';
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
    const { cols, rows } = starGrid(stars.length);
    // The list is a size container: every cell is 1/cols x 1/rows of it, and the star and
    // captions are sized in container units, so all stars fit the stage for any roster.
    const gridVars = {
        '--star-cols': String(cols),
        '--star-rows': String(rows),
        '--star-size': `min(${(STAR_SHARE * 100) / rows}cqh, ${55 / cols}cqw, 1.5rem)`,
        '--star-label': `min(0.75rem, ${(STAR_LABEL_SHARE * 100) / rows}cqh)`,
    } as React.CSSProperties;
    return (
        <div className="flex h-full flex-col items-center justify-center gap-6 px-6 pb-8 pt-16 text-center">
            <Headline>{t('recap.opening.starsTitle', { year: recap.year })}</Headline>
            <ul
                aria-label={t('recap.opening.starsLabel')}
                data-cols={cols}
                data-rows={rows}
                style={gridVars}
                className={cn(
                    // Takes the free height (capped so a few stars stay compact); size containment
                    // means the content never stretches it past the stage.
                    'grid min-h-0 w-full flex-1 gap-x-2 [container-type:size] max-h-[calc(var(--star-rows)*5.5rem)]',
                    '[grid-template-columns:repeat(var(--star-cols),minmax(0,1fr))]',
                    '[grid-template-rows:repeat(var(--star-rows),minmax(0,1fr))]',
                )}
            >
                {stars.map((m, i) => {
                    const r = heldReveal(reducedMotion, paused, Math.min(i, STAGGER_CAP) * STAGGER_MS);
                    return (
                        <li
                            key={m.member_id}
                            data-testid="opening-star"
                            data-member={m.member_id}
                            className={cn('flex min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden', r.className)}
                            style={r.style}
                        >
                            {/* Equal size for everyone: a star never grows with message volume. */}
                            <Sparkle aria-hidden="true" className="h-[var(--star-size)] w-[var(--star-size)] shrink-0 fill-current text-primary" />
                            <span className="flex max-w-full items-center gap-1 [font-size:var(--star-label)] [line-height:1.2]">
                                <span lang="ja" className="truncate text-secondary">{m.name}</span>
                                {m.oshi && (
                                    <Heart role="img" aria-label={t('recap.entry.oshi')} className="h-[1em] w-[1em] shrink-0 fill-semantic-oshi text-semantic-oshi-solid" />
                                )}
                            </span>
                            {firstId === m.member_id && (
                                <span className="max-w-full truncate text-muted [font-size:var(--star-label)] [line-height:1.2]">{t('recap.opening.firstChip')}</span>
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
            <ul className="flex min-h-0 w-full flex-col items-center gap-3 overflow-y-auto">
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
