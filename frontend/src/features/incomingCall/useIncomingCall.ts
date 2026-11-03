import { useCallback, useEffect, useRef, useState } from 'react';
import type { MemberInfo, Message } from '../../types';
import { memberImageUrl } from '../messages/profileImages';
import { buildMediaUrl } from '../messages/mediaUrl';
import { clientLog, type ClientLogFields } from '../../utils/clientLog';
import { decideCall, type CallDecision } from './callDecision';
import { preloadAudio } from './preloadAudio';

export type CallPhase = 'idle' | 'ringing' | 'connected' | 'ended';

export const RING_TIMEOUT_MS = 30_000;
export const ENDED_HOLD_MS = 800;

/** Same shape as MessagesFeature's parseReadStatePath result. */
export interface CallLogContext {
    service: string;
    groupId: number;
    memberId: number;
}

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
 * selected again); skips after a successful preload (`superseded`, `call_active`,
 * `already_read`) are always logged, with the chat context captured when the
 * evaluation started.
 */
export function useIncomingCall(
    args: UseIncomingCallArgs,
    preload: (url: string) => Promise<void> = preloadAudio,
): IncomingCall {
    const [phase, setPhase] = useState<CallPhase>('idle');
    const [call, setCall] = useState<ActiveCall | null>(null);
    const [talkStartedAt, setTalkStartedAt] = useState<number | null>(null);

    // Latest props for timers/promises that outlive the render they started in.
    const argsRef = useRef(args);
    argsRef.current = args;
    const preloadRef = useRef(preload);
    preloadRef.current = preload;

    const phaseRef = useRef<CallPhase>('idle');
    const callRef = useRef<ActiveCall | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ringStartedAtRef = useRef(0);
    const talkStartedAtRef = useRef(0);
    // Bumped by every evaluation and visit change; a preload may only ring if
    // its evaluation is still the latest.
    const evalIdRef = useRef(0);
    const dismissedRef = useRef(new Set<number>());
    const mediaErrorLoggedRef = useRef(new Set<number>());
    const lastSkipRef = useRef(new Map<string, string>());

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
        }, ENDED_HOLD_MS);
    }, [clearTimer, enter, toIdle]);

    const startRinging = useCallback((active: ActiveCall) => {
        clearTimer();
        callRef.current = active;
        setCall(active);
        ringStartedAtRef.current = Date.now();
        enter('ringing');
        clientLog('call_ring', { ...ctxFields(), message_id: active.message.id });
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            dismissedRef.current.add(active.message.id);
            clientLog('call_timeout', { message_id: active.message.id });
            toIdle();
        }, RING_TIMEOUT_MS);
    }, [clearTimer, ctxFields, enter, toIdle]);

    const logSkip = useCallback((chatDir: string, d: Extract<CallDecision, { ring: false }>) => {
        const key = `${d.messageId ?? ''}:${d.reason}`;
        if (lastSkipRef.current.get(chatDir) === key) return;
        lastSkipRef.current.set(chatDir, key);
        clientLog('call_skip', {
            ...ctxFields(),
            ...(d.messageId !== undefined ? { message_id: d.messageId } : {}),
            reason: d.reason,
        });
    }, [ctxFields]);

    // A new visit starts whenever the selected chat changes; leaving cancels any call.
    useEffect(() => {
        evalIdRef.current += 1;
        dismissedRef.current = new Set();
        mediaErrorLoggedRef.current = new Set();
        // Skip dedupe is per visit: a repeat skip on a later visit is logged again.
        if (args.chatDir) lastSkipRef.current.delete(args.chatDir);
        return () => {
            evalIdRef.current += 1;
            const active = callRef.current;
            if (phaseRef.current !== 'idle' && active) {
                clientLog('call_cancel', { message_id: active.message.id, phase: phaseRef.current });
            }
            toIdle();
        };
    }, [args.chatDir, toIdle]);

    // Evaluate after each fresh fetch of the selected chat (never on the cached render).
    const freshSeq = args.freshFetch?.seq;
    useEffect(() => {
        const a = argsRef.current;
        if (freshSeq === undefined || !a.chatDir || a.freshFetch?.dir !== a.chatDir) return;
        const chatDir = a.chatDir;
        const evalId = ++evalIdRef.current;
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
            if (evalId !== evalIdRef.current || mediaErrorLoggedRef.current.has(message.id)) return;
            mediaErrorLoggedRef.current.add(message.id);
            clientLog('call_error', {
                ...ctx, message_id: message.id, error_type: 'media_unavailable', phase: 'idle',
            });
        };
        const audioUrl = a.service && message.media_file ? buildMediaUrl(a.service, message.media_file) : '';
        if (!audioUrl) {
            fail();
            return;
        }
        preloadRef.current(audioUrl).then(
            () => {
                const latest = argsRef.current;
                const skip = (reason: 'superseded' | 'call_active' | 'already_read') =>
                    clientLog('call_skip', { ...ctx, message_id: message.id, reason });
                if (evalId !== evalIdRef.current || latest.chatDir !== chatDir) return skip('superseded');
                if (phaseRef.current !== 'idle') return skip('call_active');
                if (!latest.isUnread(message.id)) return skip('already_read');
                startRinging({ message, name: a.name, photoUrl: photoUrl as string, audioUrl });
            },
            fail,
        );
    }, [freshSeq, ctxFields, logSkip, startRinging]);

    const answer = useCallback(() => {
        const active = callRef.current;
        if (phaseRef.current !== 'ringing' || !active) return;
        clearTimer();
        argsRef.current.revealMessage(active.message.id);
        const now = Date.now();
        clientLog('call_answer', { message_id: active.message.id, ring_ms: now - ringStartedAtRef.current });
        talkStartedAtRef.current = now;
        setTalkStartedAt(now);
        enter('connected');
    }, [clearTimer, enter]);

    const decline = useCallback(() => {
        const active = callRef.current;
        if (phaseRef.current !== 'ringing' || !active) return;
        dismissedRef.current.add(active.message.id);
        clientLog('call_decline', { message_id: active.message.id, ring_ms: Date.now() - ringStartedAtRef.current });
        toIdle();
    }, [toIdle]);

    const finish = useCallback((reason: 'played' | 'hung_up') => {
        const active = callRef.current;
        if (phaseRef.current !== 'connected' || !active) return;
        clientLog('call_end', { message_id: active.message.id, reason, talk_ms: Date.now() - talkStartedAtRef.current });
        toEnded();
    }, [toEnded]);

    const hangUp = useCallback(() => finish('hung_up'), [finish]);
    const onPlaybackEnded = useCallback(() => finish('played'), [finish]);

    const onPlaybackError = useCallback(() => {
        const active = callRef.current;
        if (phaseRef.current !== 'connected' || !active) return;
        clientLog('call_error', {
            ...ctxFields(), message_id: active.message.id, error_type: 'playback_failed', phase: 'connected',
        });
        toEnded();
    }, [ctxFields, toEnded]);

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
