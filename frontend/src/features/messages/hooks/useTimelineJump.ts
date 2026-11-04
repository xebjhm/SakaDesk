import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { Message } from '../../../types';
import { clientLog } from '../../../utils/clientLog';
import { jumpTargetCode, resolveJump, type JumpAlign, type JumpTarget } from '../timeline/jumpTarget';
import { LANDING_TOLERANCE_PX, measureLanding } from '../timeline/landing';

export type JumpOutcome = 'landed' | 'not_found' | 'gave_up' | 'cancelled';

/** Extra scrollToIndex calls after the first one when the row lands off target. */
export const MAX_CORRECTIONS = 2;
/** Frames to wait for the target row to render, per wait cycle (~1 s at 60 fps). */
export const MAX_WAIT_FRAMES = 60;
/** Frames to let heights settle after the row renders, before measuring. */
export const SETTLE_FRAMES = 2;

export interface JumpDeps {
    nextFrame: () => Promise<void>;
    measure: (messageId: number, align: JumpAlign) => number | null;
    now: () => number;
}

const defaultDeps: JumpDeps = {
    nextFrame: () => new Promise(resolve => requestAnimationFrame(() => resolve())),
    measure: measureLanding,
    now: () => performance.now(),
};

export interface UseTimelineJumpArgs {
    virtuosoRef: React.RefObject<VirtuosoHandle | null>;
    messages: readonly Message[];
    isUnread: (id: number) => boolean;
    /** Called with the landed message id for highlighted jumps (message, date). */
    onLanded?: (messageId: number) => void;
    /** Changing this value cancels any in-flight jump (e.g. the selected room). */
    resetKey?: unknown;
    /** Test seam: frame scheduler, DOM measurement and clock. */
    deps?: Partial<JumpDeps>;
}

/**
 * One way to jump the chat timeline: an instant scrollToIndex, then wait for the
 * target row to render, measure it and correct up to MAX_CORRECTIONS times
 * (Virtuoso estimates heights it has not measured, so a far jump can land a little
 * off). Each correction re-resolves the target's current index by message id, so a
 * refetch that shifts rows is followed.
 *
 * A jump ends 'cancelled' when a newer jump starts, the hook unmounts, `resetKey`
 * changes (the caller switches room), or the target message is no longer in
 * `messages` while its row cannot be measured or before a correction.
 *
 * Worst case a jump runs (2 * MAX_CORRECTIONS + 1) wait cycles of up to
 * MAX_WAIT_FRAMES + SETTLE_FRAMES frames each: corrections and cycles whose row
 * vanished after settling (while still in `messages`) are counted separately, each
 * at most MAX_CORRECTIONS, plus the final cycle. It then ends 'gave_up'. Every jump
 * logs exactly one `timeline_jump` breadcrumb with no message text or names.
 */
export function useTimelineJump({ virtuosoRef, messages, isUnread, onLanded, resetKey, deps }: UseTimelineJumpArgs) {
    const latest = useRef({ messages, isUnread, onLanded });
    latest.current = { messages, isUnread, onLanded };
    const depsRef = useRef<JumpDeps>({ ...defaultDeps, ...deps });
    depsRef.current = { ...defaultDeps, ...deps };
    const tokenRef = useRef(0);

    // Cleanup runs on unmount and whenever resetKey changes: both cancel in-flight jumps.
    useEffect(() => () => { tokenRef.current += 1; }, [resetKey]);

    return useCallback(async (target: JumpTarget): Promise<JumpOutcome> => {
        const token = ++tokenRef.current;
        const { nextFrame, measure, now } = depsRef.current;
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
        if (!virtuosoRef.current) return finish('gave_up', resolved.index, 0);
        virtuosoRef.current.scrollToIndex({ index: resolved.index, align: resolved.align, behavior: 'auto' });
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
