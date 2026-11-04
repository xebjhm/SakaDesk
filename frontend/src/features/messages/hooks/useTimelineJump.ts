import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { Message } from '../../../types';
import { clientLog } from '../../../utils/clientLog';
import { bezierEasing, motion } from '../../../design/tokens/motion';
import { glideScroll, waitUntilStill } from '../timeline/glide';
import { jumpTargetCode, resolveJump, type JumpAlign, type JumpTarget } from '../timeline/jumpTarget';
import { LANDING_TOLERANCE_PX, measureLanding } from '../timeline/landing';

export type JumpOutcome = 'landed' | 'not_found' | 'gave_up' | 'cancelled';

/** Extra scrollToIndex calls after the first one when the row lands off target. */
export const MAX_CORRECTIONS = 2;
/** Frames to wait for the target row to render, per wait cycle (~1 s at 60 fps). */
export const MAX_WAIT_FRAMES = 60;
/** Frames to let heights settle after the row renders, before measuring. */
export const SETTLE_FRAMES = 2;
/** A far jump first lands this fraction of the viewport height short of the target, then glides in. */
export const GLIDE_LEAD = 0.8;
/**
 * react-virtuoso (4.18) re-issues a scrollToIndex each time row heights change, until
 * they have been still for this long; a glide started inside that window is snapped
 * back to the lead-in point. Its value mirrors the library's internal window.
 */
export const VIRTUOSO_RETRY_MS = 150;
/** Targets estimated within this many viewport heights glide from where the list is, without a lead-in. */
export const CLOSE_VIEWPORTS = 2;
/**
 * A close glide is planned this many times as far as estimated. Planning long is safe (the
 * glide homes in on the row as soon as it renders and stops there); planning short leaves
 * the row off screen and ends in an instant snap.
 */
export const CLOSE_PLAN_FACTOR = 2;

/**
 * Rough signed distance (px) to scroll so that row `index`, outside the visible `range`,
 * sits at `align`; 0 when it is inside the range. Rows off screen are assumed to be as
 * tall as the visible ones on average. Only used to choose and start a glide; the glide
 * homes in on the measured row once it renders.
 */
export function estimateTravel(
    index: number,
    align: JumpAlign,
    range: { startIndex: number; endIndex: number },
    viewport: number,
): number {
    if (index >= range.startIndex && index <= range.endIndex) return 0;
    const row = viewport / Math.max(1, range.endIndex - range.startIndex + 1);
    // Where the row ends up: 0 at the top of the viewport, 1 at the bottom.
    const at = align === 'start' ? 0 : align === 'center' ? 0.5 : 1;
    if (index > range.endIndex) return (index - range.endIndex - 1) * row + (1 - at) * (viewport - row) + row;
    return -((range.startIndex - index) * row + at * (viewport - row));
}

export interface JumpDeps {
    nextFrame: () => Promise<void>;
    measure: (messageId: number, align: JumpAlign) => number | null;
    now: () => number;
    reducedMotion: () => boolean;
}

const defaultDeps: JumpDeps = {
    nextFrame: () => new Promise(resolve => requestAnimationFrame(() => resolve())),
    measure: measureLanding,
    now: () => performance.now(),
    reducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
};

const glideEase = bezierEasing(motion.easing.standard);

export interface UseTimelineJumpArgs {
    virtuosoRef: React.RefObject<VirtuosoHandle | null>;
    messages: readonly Message[];
    isUnread: (id: number) => boolean;
    /** Called with the landed message id for highlighted jumps (message, date). */
    onLanded?: (messageId: number) => void;
    /** Changing this value cancels any in-flight jump (e.g. the selected room). */
    resetKey?: unknown;
    /** The list's scroll element; without it (or with reduced motion) jumps are instant. */
    getScroller?: () => HTMLElement | null;
    /** The rendered row range, to tell on-screen targets from far ones and the direction of travel. */
    visibleRange?: () => { startIndex: number; endIndex: number };
    /** Test seam: frame scheduler, DOM measurement, clock and reduced-motion preference. */
    deps?: Partial<JumpDeps>;
}

/**
 * One way to jump the chat timeline. With a scroller and motion allowed, the list
 * glides (motion.duration.glide, homing in on the target row once it renders):
 * - a target already on screen glides straight into place;
 * - a close one (estimateTravel within CLOSE_VIEWPORTS) glides from where the list is;
 * - a far one is first reached with an instant scrollToIndex that lands GLIDE_LEAD
 *   viewports short of it in the direction of travel; once Virtuoso has stopped
 *   re-scrolling that lead-in (VIRTUOSO_RETRY_MS still, at most MAX_WAIT_FRAMES) it
 *   glides the rest of the way, or scrolls instantly if heights never settle.
 * Without a scroller, or with prefers-reduced-motion, one instant scrollToIndex.
 * Then wait for the target row to render, measure it and correct up to
 * MAX_CORRECTIONS times with instant scrolls (Virtuoso estimates heights it has not
 * measured, so a far jump can land a little off). Each correction re-resolves the
 * target's current index by message id, so a refetch that shifts rows is followed.
 *
 * A jump ends 'cancelled' (also mid-glide) when a newer jump starts, the hook
 * unmounts, `resetKey` changes (the caller switches room), or the target message is
 * no longer in `messages` while its row cannot be measured or before a correction.
 *
 * Worst case, after the move (a lead-in wait of at most MAX_WAIT_FRAMES plus one
 * glide), a jump runs (2 * MAX_CORRECTIONS + 1) wait cycles of up to
 * MAX_WAIT_FRAMES + SETTLE_FRAMES frames each: corrections and cycles whose row
 * vanished after settling (while still in `messages`) are counted separately, each
 * at most MAX_CORRECTIONS, plus the final cycle. It then ends 'gave_up'. Every jump
 * logs exactly one `timeline_jump` breadcrumb with no message text or names.
 */
export function useTimelineJump({
    virtuosoRef, messages, isUnread, onLanded, resetKey, getScroller, visibleRange, deps,
}: UseTimelineJumpArgs) {
    const latest = useRef({ messages, isUnread, onLanded, getScroller, visibleRange });
    latest.current = { messages, isUnread, onLanded, getScroller, visibleRange };
    const depsRef = useRef<JumpDeps>({ ...defaultDeps, ...deps });
    depsRef.current = { ...defaultDeps, ...deps };
    const tokenRef = useRef(0);

    // Cleanup runs on unmount and whenever resetKey changes: both cancel in-flight jumps.
    useEffect(() => () => { tokenRef.current += 1; }, [resetKey]);

    return useCallback(async (target: JumpTarget): Promise<JumpOutcome> => {
        const token = ++tokenRef.current;
        const { nextFrame, measure, now, reducedMotion } = depsRef.current;
        const started = now();
        const resolved = resolveJump(latest.current.messages, target, latest.current.isUnread);

        const finish = (outcome: JumpOutcome, index: number, corrections: number): JumpOutcome => {
            clientLog('timeline_jump', {
                target: jumpTargetCode(target),
                index,
                corrections,
                outcome,
                jump_ms: Math.round(now() - started),
            });
            return outcome;
        };

        if (!resolved) return finish('not_found', -1, 0);
        const first = virtuosoRef.current;
        if (!first) return finish('gave_up', resolved.index, 0);

        const scroller = latest.current.getScroller?.() ?? null;
        const range = latest.current.visibleRange?.();
        const isCancelled = () => token !== tokenRef.current;
        // The glide homes in on the target row as soon as it is rendered and measurable.
        const aim = () => measure(resolved.messageId, resolved.align);
        const glide = (el: HTMLElement, delta: number) =>
            glideScroll(el, delta, motion.duration.glide, glideEase, isCancelled, { nextFrame, now }, aim);
        // An exact, instant scroll to the target (the checks below verify it).
        const snap = (): boolean => {
            const handle = virtuosoRef.current;
            handle?.scrollToIndex({ index: resolved.index, align: resolved.align, behavior: 'auto' });
            return !!handle;
        };
        const travel = scroller && range ? estimateTravel(resolved.index, resolved.align, range, scroller.clientHeight) : null;

        if (scroller === null || reducedMotion()) {
            first.scrollToIndex({ index: resolved.index, align: resolved.align, behavior: 'auto' });
        } else if (travel === 0) {
            // Already on screen: glide straight to the aligned position.
            const error = measure(resolved.messageId, resolved.align);
            if (error === null) first.scrollToIndex({ index: resolved.index, align: resolved.align, behavior: 'auto' });
            else if (!(await glide(scroller, error))) return finish('cancelled', resolved.index, 0);
        } else if (travel !== null && Math.abs(travel) <= CLOSE_VIEWPORTS * scroller.clientHeight) {
            // Close: glide from here toward the estimate; a lead-in could land on the wrong side.
            if (!(await glide(scroller, travel * CLOSE_PLAN_FACTOR))) return finish('cancelled', resolved.index, 0);
            if (aim() === null && !snap()) return finish('gave_up', resolved.index, 0);
        } else {
            // Far: land GLIDE_LEAD viewports short of the target in the direction of travel, then glide in.
            const dir = travel !== null ? Math.sign(travel) : 1;
            const lead = Math.round(scroller.clientHeight * GLIDE_LEAD);
            first.scrollToIndex({ index: resolved.index, align: resolved.align, behavior: 'auto', offset: -dir * lead });
            // Virtuoso re-scrolls to the lead-in while row heights change: wait until it is
            // still, or the glide would be snapped back.
            const leadIn = await waitUntilStill(scroller, VIRTUOSO_RETRY_MS, SETTLE_FRAMES, MAX_WAIT_FRAMES, isCancelled, { nextFrame, now });
            if (leadIn === 'cancelled') return finish('cancelled', resolved.index, 0);
            if (leadIn === 'still') {
                if (!(await glide(scroller, dir * lead))) return finish('cancelled', resolved.index, 0);
            } else if (!snap()) {
                // Heights never settled and the list is gone.
                return finish('gave_up', resolved.index, 0);
            }
        }
        if (!resolved.verify) return finish('landed', resolved.index, 0);

        let index = resolved.index;
        let corrections = 0;
        // Wait cycles that ended with the row vanished after settling. Each one consumes a
        // cycle; more than MAX_CORRECTIONS of them ends the jump, so the loop is bounded.
        let vanished = 0;
        const removed = () => !latest.current.messages.some(m => m.id === resolved.messageId);
        for (;;) {
            let error: number | null = null;
            for (let frame = 0; frame < MAX_WAIT_FRAMES && error === null; frame++) {
                await nextFrame();
                if (token !== tokenRef.current) return finish('cancelled', index, corrections);
                error = measure(resolved.messageId, resolved.align);
                if (error === null && removed()) return finish('cancelled', index, corrections);
            }
            if (error === null) return finish('gave_up', index, corrections);
            for (let frame = 0; frame < SETTLE_FRAMES; frame++) {
                await nextFrame();
                if (token !== tokenRef.current) return finish('cancelled', index, corrections);
            }
            const settled = measure(resolved.messageId, resolved.align);
            if (settled === null) {
                if (removed()) return finish('cancelled', index, corrections);
                vanished += 1;
                if (vanished > MAX_CORRECTIONS) return finish('gave_up', index, corrections);
                continue;
            }
            if (Math.abs(settled) <= LANDING_TOLERANCE_PX) {
                if (resolved.highlight) latest.current.onLanded?.(resolved.messageId);
                return finish('landed', index, corrections);
            }
            if (corrections >= MAX_CORRECTIONS) return finish('gave_up', index, corrections);
            // Rows may have shifted since the first scroll: re-resolve by id, never reuse the index.
            const fresh = latest.current.messages.findIndex(m => m.id === resolved.messageId);
            if (fresh < 0) return finish('cancelled', index, corrections);
            index = fresh;
            const handle = virtuosoRef.current;
            if (!handle) return finish('gave_up', index, corrections);
            corrections += 1;
            handle.scrollToIndex({ index, align: resolved.align, behavior: 'auto' });
        }
    }, [virtuosoRef]);
}
