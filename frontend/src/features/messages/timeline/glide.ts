export interface GlideDeps { nextFrame: () => Promise<void>; now: () => number }
export type Scroller = Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>;

/**
 * Glide `scroller` by `delta` px over `durationMs` along `easing`. The end point is
 * clamped to the scroll range once, up front; once `aim()` can measure the real target
 * (signed px still to go, null while it is not rendered), the glide homes in on that
 * instead. Every frame closes the eased fraction of whatever distance remains, read
 * fresh from the scroller, so a scrollTop change made by someone else mid-glide
 * (Virtuoso compensating for rows that measured taller or shorter than it estimated) is
 * absorbed smoothly over the remaining frames: neither undone in one hop nor kept as a
 * miss. The position is tracked unrounded, so a browser that rounds scrollTop to whole
 * pixels does not lose the sub-pixel steps of the easing tail. Resolves false as soon
 * as `isCancelled()` is true.
 */
export async function glideScroll(
    scroller: Scroller,
    delta: number,
    durationMs: number,
    easing: (t: number) => number,
    isCancelled: () => boolean,
    deps: GlideDeps,
    aim?: () => number | null,
): Promise<boolean> {
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    let end = Math.min(max, Math.max(0, scroller.scrollTop + delta));
    if (end === scroller.scrollTop || durationMs <= 0) {
        scroller.scrollTop = end;
        return !isCancelled();
    }
    const t0 = deps.now();
    let pos = scroller.scrollTop;
    let seen = pos;
    let left = 1; // eased fraction of the distance still to go
    for (;;) {
        await deps.nextFrame();
        if (isCancelled()) return false;
        pos += scroller.scrollTop - seen;
        const measured = aim?.() ?? null;
        if (measured !== null) end = pos + measured;
        const p = Math.min(1, (deps.now() - t0) / durationMs);
        const nextLeft = p >= 1 ? 0 : 1 - easing(p);
        const remaining = end - pos;
        pos += left > 0 ? remaining * (1 - nextLeft / left) : remaining;
        left = nextLeft;
        scroller.scrollTop = pos;
        seen = scroller.scrollTop;
        // A whole pixel off means the browser clamped the write: continue from where it is.
        if (Math.abs(seen - pos) >= 1) pos = seen;
        if (p >= 1) return true;
    }
}

/**
 * Wait, one frame at a time, until `scroller` has kept the same scrollTop and
 * scrollHeight for `quietMs` (and at least `minFrames` frames have passed). Resolves
 * 'still', 'moving' when `maxFrames` pass first, or 'cancelled' as soon as
 * `isCancelled()` is true.
 */
export async function waitUntilStill(
    scroller: Scroller,
    quietMs: number,
    minFrames: number,
    maxFrames: number,
    isCancelled: () => boolean,
    deps: GlideDeps,
): Promise<'still' | 'moving' | 'cancelled'> {
    let top = scroller.scrollTop;
    let height = scroller.scrollHeight;
    let changedAt = deps.now();
    for (let frame = 1; frame <= maxFrames; frame++) {
        await deps.nextFrame();
        if (isCancelled()) return 'cancelled';
        if (scroller.scrollTop !== top || scroller.scrollHeight !== height) {
            top = scroller.scrollTop;
            height = scroller.scrollHeight;
            changedAt = deps.now();
        } else if (frame >= minFrames && deps.now() - changedAt >= quietMs) {
            return 'still';
        }
    }
    return 'moving';
}
