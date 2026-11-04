/** Motion: every animation is 150-200 ms with one easing curve. */
export const motion = {
    /** Milliseconds. framer-motion wants seconds: `motion.duration.base / 1000`. */
    duration: { fast: 150, base: 200 },
    /** Cubic-bezier control points; pass directly to framer-motion `ease`. */
    easing: { standard: [0.2, 0, 0, 1] },
} as const;

export type DurationStep = keyof typeof motion.duration;

export function easingCss(points: readonly [number, number, number, number]): string {
    return `cubic-bezier(${points.join(', ')})`;
}
