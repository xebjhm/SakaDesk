/**
 * Motion: every animation is 150-200 ms with one easing curve, except two
 * special cases: `glide` (400 ms, scroll glides only) and `landing`
 * (1400 ms, the landed-row highlight only).
 */
export const motion = {
    /** Milliseconds. framer-motion wants seconds: `motion.duration.base / 1000`. */
    duration: { fast: 150, base: 200, glide: 400, landing: 1400 },
    /** Cubic-bezier control points; pass directly to framer-motion `ease`. */
    easing: { standard: [0.2, 0, 0, 1] },
} as const;

export type DurationStep = keyof typeof motion.duration;

export function easingCss(points: readonly [number, number, number, number]): string {
    return `cubic-bezier(${points.join(', ')})`;
}

/**
 * Pure cubic-bezier evaluator (same curve as CSS `cubic-bezier(x1, y1, x2, y2)`):
 * returns y for a given x in 0..1, solving the x(t) polynomial by bisection.
 */
export function bezierEasing(points: readonly [number, number, number, number]): (x: number) => number {
    const [x1, y1, x2, y2] = points;
    const coord = (a: number, b: number, t: number) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
    return (x: number) => {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2;
            if (coord(x1, x2, mid) < x) lo = mid;
            else hi = mid;
        }
        return coord(y1, y2, (lo + hi) / 2);
    };
}
