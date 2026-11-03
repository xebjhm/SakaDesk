import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MemberInfo, Message } from '../../types';
import { memberImageUrl } from '../messages/profileImages';
import { buildMediaUrl } from '../messages/mediaUrl';
import { clientLog, type ClientLogEvent, type ClientLogFields } from '../../utils/clientLog';
import { decideCall, type CallDecision, type CallSkipReason } from './callDecision';
import { preloadAudio } from './preloadAudio';

export type CallPhase = 'idle' | 'ringing' | 'connected' | 'ended';

export const RING_TIMEOUT_MS = 30_000;
export const ENDED_HOLD_MS = 800;

/** Same shape as readStatePath.ts ReadStatePath. */
export interface CallLogContext {
    service: string;
    groupId: number;
    memberId: number;
}

/**
 * What happened to a call, reported through the optional `onOutcome` hook (the popup uses it
 * to tell the backend). `skipped` fires on every skip, including repeats whose `call_skip`
 * breadcrumb is deduped.
 */
export type CallOutcome =
    | { kind: 'skipped'; reason: CallSkipReason | 'superseded' | 'media_unavailable' }
    | { kind: 'ringing' } | { kind: 'declined' } | { kind: 'timeout' }
    | { kind: 'ended' }         // when the ended hold finishes (where scrollToMessage is called)
    | { kind: 'cancelled' };    // visit cleanup or setting off while ringing/connected

export interface UseIncomingCallArgs {
    /** Service used to build media URLs (MessagesFeature's messagesService). */
    service: string | null;
    /** Selected chat dir; a change starts a new visit. */
    chatDir: string | undefined;
    isGroupChat: boolean;
    messages: Message[];
    member: MemberInfo | undefined;
    /** Display name for the call screen. */
    name: string;
    /** The incoming_call_enabled setting; undefined while settings load (treated as off). */
    enabled: boolean | undefined;
    isUnread: (id: number) => boolean;
    /** Bumped by MessagesFeature when a fresh fetch completes for `dir`. */
    freshFetch: { seq: number; dir: string } | null;
    revealMessage: (id: number) => void;
    scrollToMessage: (id: number) => void;
    logContext: CallLogContext | null;
    /** Set by the popup: adds `surface` to every breadcrumb this hook logs. */
    surface?: 'popup';
    /** Called on every call outcome (additive; the in-app call does not use it). */
    onOutcome?: (o: CallOutcome) => void;
    /**
     * Asked once, after the preload and the unread check, before ringing: true when another
     * surface (the popup) already owns this voice, so the call is skipped as `popup_active`.
     * A rejection counts as false.
     */
    isCallElsewhere?: (messageId: number) => Promise<boolean>;
}

export interface IncomingCall {
    phase: CallPhase;
    message: Message | null;
    name: string;
    photoUrl: string;
    audioUrl: string;
    /** Date.now() when the call was answered; null unless connected/ended. */
    talkStartedAt: number | null;
    answer: () => void;
    decline: () => void;
    hangUp: () => void;
    onPlaybackEnded: () => void;
    onPlaybackError: () => void;
}

interface ActiveCall {
    message: Message;
    name: string;
    photoUrl: string;
    audioUrl: string;
}

/**
 * Incoming-call state machine for the selected chat (spec §2.4).
 * Every decision, skip and failure is logged through clientLog. Skips decided
 * before the preload are deduped per chat within a visit (reset when the chat is
 * selected again); skips after the preload settles (`superseded`, which also covers a
 * failed preload whose evaluation was replaced, plus `call_active` and `already_read`)
 * are always logged, with the chat context captured when the evaluation started.
 */
export function useIncomingCall(
    args: UseIncomingCallArgs,
    preload: (url: string, signal?: AbortSignal) => Promise<void> = preloadAudio,
): IncomingCall {
    const [phase, setPhase] = useState<CallPhase>('idle');
    const [call, setCall] = useState<ActiveCall | null>(null);
    const [talkStartedAt, setTalkStartedAt] = useState<number | null>(null);

    // Latest props for timers/promises that outlive the render they started in. Synced in a
    // layout effect (not during render); layout effects run before every passive effect below.
    const argsRef = useRef(args);
    const preloadRef = useRef(preload);
    useLayoutEffect(() => {
        argsRef.current = args;
        preloadRef.current = preload;
    });

    const phaseRef = useRef<CallPhase>('idle');
    const callRef = useRef<ActiveCall | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ringStartedAtRef = useRef(0);
    const talkStartedAtRef = useRef(0);
    // Bumped by every evaluation and visit change; a preload may only ring if
    // its evaluation is still the latest.
    const evalIdRef = useRef(0);
    // Aborts the in-flight preload when its evaluation is superseded (or on unmount).
    const preloadAbortRef = useRef<AbortController | null>(null);
    const dismissedRef = useRef(new Set<number>());
    const mediaErrorLoggedRef = useRef(new Set<number>());
    const lastSkipRef = useRef(new Map<string, string>());

    // Every breadcrumb of this hook goes through `log`, so `surface` is added uniformly.
    const log = useCallback((event: ClientLogEvent, fields: ClientLogFields) => {
        const surface = argsRef.current.surface;
        clientLog(event, surface ? { ...fields, surface } : fields);
    }, []);
    const outcome = useCallback((o: CallOutcome) => { argsRef.current.onOutcome?.(o); }, []);

    const ctxFields = useCallback((): ClientLogFields => {
        const c = argsRef.current.logContext;
        return c ? { service: c.service, group_id: c.groupId, member_id: c.memberId } : {};
    }, []);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const cancelPreload = useCallback(() => {
        preloadAbortRef.current?.abort();
        preloadAbortRef.current = null;
    }, []);

    const enter = useCallback((next: CallPhase) => {
        phaseRef.current = next;
        setPhase(next);
    }, []);

    const toIdle = useCallback(() => {
        clearTimer();
        callRef.current = null;
        setCall(null);
        setTalkStartedAt(null);
        enter('idle');
    }, [clearTimer, enter]);

    const toEnded = useCallback(() => {
        clearTimer();
        enter('ended');
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            const id = callRef.current?.message.id;
            toIdle();
            if (id !== undefined) argsRef.current.scrollToMessage(id);
            outcome({ kind: 'ended' });
        }, ENDED_HOLD_MS);
    }, [clearTimer, enter, toIdle, outcome]);

    const startRinging = useCallback((active: ActiveCall) => {
        clearTimer();
        callRef.current = active;
        setCall(active);
        ringStartedAtRef.current = Date.now();
        enter('ringing');
        log('call_ring', { ...ctxFields(), message_id: active.message.id });
        outcome({ kind: 'ringing' });
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            dismissedRef.current.add(active.message.id);
            log('call_timeout', { message_id: active.message.id });
            toIdle();
            outcome({ kind: 'timeout' });
        }, RING_TIMEOUT_MS);
    }, [clearTimer, ctxFields, enter, toIdle, log, outcome]);

    const logSkip = useCallback((chatDir: string, d: Extract<CallDecision, { ring: false }>) => {
        outcome({ kind: 'skipped', reason: d.reason });
        const key = `${d.messageId ?? ''}:${d.reason}`;
        if (lastSkipRef.current.get(chatDir) === key) return;
        lastSkipRef.current.set(chatDir, key);
        log('call_skip', {
            ...ctxFields(),
            ...(d.messageId !== undefined ? { message_id: d.messageId } : {}),
            reason: d.reason,
        });
    }, [ctxFields, log, outcome]);

    // A new visit starts whenever the selected chat changes; leaving cancels any call.
    useEffect(() => {
        evalIdRef.current += 1;
        dismissedRef.current = new Set();
        mediaErrorLoggedRef.current = new Set();
        // Skip dedupe is per visit: a repeat skip on a later visit is logged again.
        if (args.chatDir) lastSkipRef.current.delete(args.chatDir);
        return () => {
            evalIdRef.current += 1;
            cancelPreload();
            const active = callRef.current;
            if (phaseRef.current !== 'idle' && active) {
                log('call_cancel', { message_id: active.message.id, phase: phaseRef.current });
                outcome({ kind: 'cancelled' });
            }
            toIdle();
        };
    }, [args.chatDir, toIdle, cancelPreload, log, outcome]);

    // Turning the setting off ends any call immediately (no ended screen, no scroll) and drops
    // a preload that has not rung yet.
    useEffect(() => {
        if (args.enabled !== false) return;
        evalIdRef.current += 1;
        cancelPreload();
        const active = callRef.current;
        if ((phaseRef.current === 'ringing' || phaseRef.current === 'connected') && active) {
            log('call_cancel', { message_id: active.message.id, phase: phaseRef.current, reason: 'disabled' });
            toIdle();
            outcome({ kind: 'cancelled' });
        }
    }, [args.enabled, toIdle, cancelPreload, log, outcome]);

    // Evaluate after each fresh fetch of the selected chat (never on the cached render).
    const freshSeq = args.freshFetch?.seq;
    useEffect(() => {
        const a = argsRef.current;
        if (freshSeq === undefined || !a.chatDir || a.freshFetch?.dir !== a.chatDir) return;
        const chatDir = a.chatDir;
        const evalId = ++evalIdRef.current;
        cancelPreload();
        // Chat context as of this evaluation; a chat switch must not relabel its logs.
        const ctx = ctxFields();
        const photoUrl = memberImageUrl(a.member, 'phone_image') || memberImageUrl(a.member, 'thumbnail');
        const decision = decideCall({
            enabled: a.enabled === true,
            isGroupChat: a.isGroupChat,
            messages: a.messages,
            isUnread: a.isUnread,
            photoUrl,
            dismissedIds: dismissedRef.current,
            callActive: phaseRef.current !== 'idle',
        });
        if (!decision.ring) {
            logSkip(chatDir, decision);
            return;
        }
        const message = decision.message;
        const fail = () => {
            if (evalId !== evalIdRef.current) {
                log('call_skip', { ...ctx, message_id: message.id, reason: 'superseded' });
                outcome({ kind: 'skipped', reason: 'superseded' });
                return;
            }
            outcome({ kind: 'skipped', reason: 'media_unavailable' });
            if (mediaErrorLoggedRef.current.has(message.id)) return;
            mediaErrorLoggedRef.current.add(message.id);
            log('call_error', {
                ...ctx, message_id: message.id, error_type: 'media_unavailable', phase: 'idle',
            });
        };
        const audioUrl = a.service && message.media_file ? buildMediaUrl(a.service, message.media_file) : '';
        if (!audioUrl) {
            fail();
            return;
        }
        const controller = new AbortController();
        preloadAbortRef.current = controller;
        const settled = () => {
            if (preloadAbortRef.current === controller) preloadAbortRef.current = null;
        };
        preloadRef.current(audioUrl, controller.signal).then(
            async () => {
                settled();
                const skip = (reason: 'superseded' | 'call_active' | 'already_read' | 'popup_active') => {
                    log('call_skip', { ...ctx, message_id: message.id, reason });
                    outcome({ kind: 'skipped', reason });
                };
                const stale = () => evalId !== evalIdRef.current || argsRef.current.chatDir !== chatDir;
                if (stale()) return skip('superseded');
                // Defensive and effectively unreachable: ringing starts only from this branch, and
                // every newer evaluation or visit change bumps evalId first (so an older preload
                // takes the `superseded` exit above). Kept, with its breadcrumb, in case another
                // ring path is ever added.
                if (phaseRef.current !== 'idle') return skip('call_active');
                if (!argsRef.current.isUnread(message.id)) return skip('already_read');
                const elsewhere = argsRef.current.isCallElsewhere;
                if (elsewhere) {
                    // The popup owns this voice (main window visible but unfocused): don't ring it twice.
                    const active = await elsewhere(message.id).catch(() => false);
                    if (stale()) return skip('superseded');
                    if (phaseRef.current !== 'idle') return skip('call_active');
                    if (active) return skip('popup_active');
                }
                startRinging({ message, name: a.name, photoUrl: photoUrl as string, audioUrl });
            },
            () => {
                settled();
                fail();
            },
        );
    }, [freshSeq, ctxFields, logSkip, startRinging, cancelPreload, log, outcome]);

    const answer = useCallback(() => {
        const active = callRef.current;
        if (phaseRef.current !== 'ringing' || !active) return;
        clearTimer();
        argsRef.current.revealMessage(active.message.id);
        const now = Date.now();
        log('call_answer', { message_id: active.message.id, ring_ms: now - ringStartedAtRef.current });
        talkStartedAtRef.current = now;
        setTalkStartedAt(now);
        enter('connected');
    }, [clearTimer, enter, log]);

    const decline = useCallback(() => {
        const active = callRef.current;
        if (phaseRef.current !== 'ringing' || !active) return;
        dismissedRef.current.add(active.message.id);
        log('call_decline', { message_id: active.message.id, ring_ms: Date.now() - ringStartedAtRef.current });
        toIdle();
        outcome({ kind: 'declined' });
    }, [toIdle, log, outcome]);

    const finish = useCallback((reason: 'played' | 'hung_up') => {
        const active = callRef.current;
        if (phaseRef.current !== 'connected' || !active) return;
        log('call_end', { message_id: active.message.id, reason, talk_ms: Date.now() - talkStartedAtRef.current });
        toEnded();
    }, [toEnded, log]);

    const hangUp = useCallback(() => finish('hung_up'), [finish]);
    const onPlaybackEnded = useCallback(() => finish('played'), [finish]);

    const onPlaybackError = useCallback(() => {
        const active = callRef.current;
        if (phaseRef.current !== 'connected' || !active) return;
        log('call_error', {
            ...ctxFields(), message_id: active.message.id, error_type: 'playback_failed', phase: 'connected',
        });
        toEnded();
    }, [ctxFields, toEnded, log]);

    return {
        phase,
        message: call?.message ?? null,
        name: call?.name ?? '',
        photoUrl: call?.photoUrl ?? '',
        audioUrl: call?.audioUrl ?? '',
        talkStartedAt,
        answer,
        decline,
        hangUp,
        onPlaybackEnded,
        onPlaybackError,
    };
}
