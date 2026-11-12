/** The multi-member opening's slide list, renderers and player payload. */
import type { RecapOverview, RecapPayload } from './api';
import type { OpeningSlide, SlideRegistry } from './slideRegistry';
import { titledMembers } from './openingMembers';
import { OpeningStars, OpeningTitles } from './slides/OpeningSlides';

export const OPENING_REGISTRY: SlideRegistry = {
    o1_stars: { component: OpeningStars },
    o2_titles: { component: OpeningTitles },
};

/** The stars, then the role titles when any member with a recap has one. */
export function openingSlides(overview: RecapOverview): OpeningSlide[] {
    const slides: OpeningSlide[] = [{ key: 'o1_stars', fallback: null, data: overview }];
    if (titledMembers(overview).length) slides.push({ key: 'o2_titles', fallback: null, data: overview });
    return slides;
}

/**
 * The payload the story player is handed for the opening. It names no member (an empty id,
 * so the player's breadcrumbs carry no `member_id`) and has no slides or poster of its own.
 */
export function openingPayload(overview: RecapOverview): RecapPayload {
    return {
        year: overview.year,
        phase: overview.phase,
        tier: 'full',
        member: { id: '', name: '', avatar_url: null, graduated: false, subscription_start: null, years_together: null },
        slides: [],
        poster: null,
    };
}
