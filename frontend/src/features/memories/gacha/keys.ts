import type { GachaPull } from '../types';

/** A pull's identity: its JST day and index (unique per service). */
export const pullKey = (p: Pick<GachaPull, 'jst_date' | 'pull_index'>): string => `${p.jst_date}|${p.pull_index}`;
