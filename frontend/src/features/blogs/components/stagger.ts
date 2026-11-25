/** The blog cards' reveal stagger: 50 ms per card, at most 8 steps, so a long list never waits seconds. */
export const STAGGER_STEP_MS = 50;
export const STAGGER_MAX_STEPS = 8;
export const staggerDelay = (index: number): number => Math.min(index, STAGGER_MAX_STEPS) * STAGGER_STEP_MS;
