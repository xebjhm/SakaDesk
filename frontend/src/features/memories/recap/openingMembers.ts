/** Who the multi-member opening shows, and in which order. */
import type { RecapOverview, RecapOverviewMember } from './api';

/** The members in `star_order` (oshi → the fan's ★ → subscription age; never message volume). */
export function starMembers(overview: RecapOverview): RecapOverviewMember[] {
    const byId = new Map(overview.members.map((m) => [m.member_id, m]));
    return overview.opening.star_order.flatMap((id) => {
        const m = byId.get(id);
        return m ? [m] : [];
    });
}

export function titledMembers(overview: RecapOverview): RecapOverviewMember[] {
    return starMembers(overview).filter((m) => m.tier !== 'none' && m.title_key);
}
