import { persisted } from '../core/persistence/persisted';
import { clientLog } from '../utils/clientLog';
import type { SequentialSyncOutcome } from './hooks/useSync';

/** Set once the first-sync toast has been shown (spec §9: "once ever"). */
export const FIRST_SYNC_PREF = 'first_sync_celebrated_at';

export type FirstSyncDecision = 'show' | 'already_celebrated' | 'sync_cancelled' | 'sync_failed';

/** Whether the first-launch sync earns the tier-B toast (decision D11): every service finished, not cancelled, never shown before. */
export function decideFirstSync(outcome: SequentialSyncOutcome, celebratedAt: string | null): FirstSyncDecision {
    if (celebratedAt) return 'already_celebrated';
    if (outcome.cancelled) return 'sync_cancelled';
    if (outcome.failed > 0 || outcome.completed === 0) return 'sync_failed';
    return 'show';
}

/** Decides, records and logs (`celebration`, target `first_sync`); true when the toast should show. */
export function celebrateFirstSync(outcome: SequentialSyncOutcome): boolean {
    const decision = decideFirstSync(outcome, persisted.getPref<string | null>(FIRST_SYNC_PREF, null));
    if (decision !== 'show') {
        clientLog('celebration', { target: 'first_sync', outcome: 'skipped', reason: decision });
        return false;
    }
    persisted.setPref(FIRST_SYNC_PREF, new Date().toISOString());
    clientLog('celebration', { target: 'first_sync', outcome: 'shown' });
    return true;
}
