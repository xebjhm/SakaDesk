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
/** Frames to wait for the target row to render (~1 s at 60 fps). */
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
    /** Test seam: frame scheduler, DOM measurement and clock. */
    deps?: Partial<JumpDeps>;
}

/**
 * One way to jump the chat timeline: an instant scrollToIndex, then wait for the
 * target row to render, measure it and correct up to MAX_CORRECTIONS times
 * (Virtuoso estimates heights it has not measured, so a far jump can land a little
 * off). A newer jump cancels an older one that is still settling. Every jump logs a
 * `timeline_jump` breadcrumb with no message text or names.
 */
export function useTimelineJump({ virtuosoRef, messages, isUnread, onLanded, deps }: UseTimelineJumpArgs) {
    const latest = useRef({ messages, isUnread, onLanded });
    latest.current = { messages, isUnread, onLanded };
    const depsRef = useRef<JumpDeps>({ ...defaultDeps, ...deps });
    depsRef.current = { ...defaultDeps, ...deps };
    const tokenRef = useRef(0);

    useEffect(() => () => { tokenRef.current += 1; }, []);

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
        const scroll = () => virtuosoRef.current?.scrollToIndex({ index: resolved.index, align: resolved.align, behavior: 'auto' });
        if (!virtuosoRef.current) return finish('gave_up', resolved.index, 0);
        scroll();
        if (!resolved.verify) return finish('landed', resolved.index, 0);

        let corrections = 0;
        for (;;) {
            let error: number | null = null;
            for (let frame = 0; frame < MAX_WAIT_FRAMES && error === null; frame++) {
                await nextFrame();
                if (token !== tokenRef.current) return finish('cancelled', resolved.index, corrections);
                error = measure(resolved.messageId, resolved.align);
            }
            if (error === null) return finish('gave_up', resolved.index, corrections);
            for (let frame = 0; frame < SETTLE_FRAMES; frame++) {
                await nextFrame();
                if (token !== tokenRef.current) return finish('cancelled', resolved.index, corrections);
            }
            error = measure(resolved.messageId, resolved.align) ?? error;
            if (Math.abs(error) <= LANDING_TOLERANCE_PX) {
                if (resolved.highlight) latest.current.onLanded?.(resolved.messageId);
                return finish('landed', resolved.index, corrections);
            }
            if (corrections >= MAX_CORRECTIONS) return finish('gave_up', resolved.index, corrections);
            corrections += 1;
            scroll();
        }
    }, [virtuosoRef]);
}
