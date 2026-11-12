/** Pure helpers of 初見と今 (kept out of the component file for fast refresh). */
import type { TFunction } from 'i18next';
import type { FirstMeetRow } from '../types';

/** The time between the two sides: 「1 年 8 天」, 「1 年」 or 「8 天」 (never 0: the sides are on different days). */
export function formatElapsed(t: TFunction, elapsed: FirstMeetRow['elapsed']): string {
    const { years, days } = elapsed;
    if (years > 0 && days > 0) {
        return t('memories.thenNow.elapsedJoin', {
            years: t('memories.thenNow.elapsedYears', { count: years }),
            days: t('memories.thenNow.elapsedDays', { count: days }),
        });
    }
    if (years > 0) return t('memories.thenNow.elapsedYears', { count: years });
    return t('memories.thenNow.elapsedDays', { count: days });
}
