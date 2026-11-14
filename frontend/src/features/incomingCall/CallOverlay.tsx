import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../../i18n';
import {
    interleavedZIndex, nextDialogOrder, openDialogCount, subscribeDialogStack, topDialog,
} from '../../design/dialog/dialogStack';
import { clientLog } from '../../utils/clientLog';
import { ACCENT } from '../../design/colorMix';
import { CallAudio } from './CallAudio';
import { CallScreen } from './CallScreen';
import type { AnswerStyle } from './CallScreen';
import type { IncomingCall } from './useIncomingCall';
import { useAnchorRect } from './useAnchorRect';
import { LiveRegion } from '../../design/primitives';

interface CallOverlayProps {
    call: IncomingCall;
    /** Overrides the call accent (halo, eyebrow dot, answer button); defaults to the context's `--ds-accent`. */
    accentColor?: string;
    answerStyle: AnswerStyle;
    /** Service display name shown above the member's name. */
    groupLabel: string;
}

/** Where a call is drawn, decided once per call when it first shows (spec D2d decision 20). */
interface CallLayer {
    messageId: number | null;
    lifted: boolean;
    /** Opening order taken when lifted: the call sits above the dialogs opened before it. */
    order: number;
    /** Dialogs open when it first showed. */
    below: number;
}

const NO_LAYER: CallLayer = { messageId: null, lifted: false, order: 0, below: 0 };

function decideLayer(messageId: number): CallLayer {
    const below = openDialogCount();
    return below > 0
        ? { messageId, lifted: true, order: nextDialogOrder(), below }
        : { messageId, lifted: false, order: 0, below };
}

/**
 * Covers the chat area while a call is active; hosts the call audio and handles Esc/Enter.
 * A call that starts while a dialog is open is lifted: portaled over the chat area's rectangle,
 * above the dialogs that were open (interleavedZIndex) and below any opened later.
 */
export const CallOverlay: React.FC<CallOverlayProps> = ({ call, accentColor = ACCENT, answerStyle, groupLabel }) => {
    const { t } = useTranslation();
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const anchorRef = useRef<HTMLDivElement | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const { phase, answer, decline, hangUp } = call;
    const hasOverlay = phase !== 'idle' && !!call.message;
    const messageId = call.message?.id ?? null;

    // The layer is fixed for the call's life, so the audio never remounts; it is forgotten when
    // the call goes away, so the same message ringing again (after leaving the chat) decides afresh.
    const [layer, setLayer] = useState<CallLayer>(NO_LAYER);
    if (hasOverlay && messageId !== null && layer.messageId !== messageId) setLayer(decideLayer(messageId));
    else if (!hasOverlay && layer.messageId !== null) setLayer(NO_LAYER);
    const lifted = hasOverlay && layer.lifted;

    const rect = useAnchorRect(anchorRef, lifted);
    const [zIndex, setZIndex] = useState(0);
    useLayoutEffect(() => {
        if (!lifted) return;
        const sync = () => setZIndex(interleavedZIndex(layer.order));
        sync();
        return subscribeDialogStack(sync);
    }, [lifted, layer.order]);

    // A lifted call that goes away with focus inside it hands focus to the top-most dialog (the
    // layer does not track the call, so nothing else would). Its node is already removed when the
    // call ends; still connected (the chat view unmounting, a StrictMode re-run), only focus inside it counts.
    // The latest render's `lifted`: false in the cleanup below only when the call went away (not on
    // a StrictMode re-run or an unmount), so `kept` is logged once per lifted call.
    const liftedRef = useRef(lifted);
    liftedRef.current = lifted;
    useLayoutEffect(() => {
        if (!lifted) return;
        const overlay = overlayRef.current;
        return () => {
            const active = document.activeElement;
            const lost = overlay?.isConnected
                ? active !== null && overlay.contains(active)
                : active === null || active === document.body || !active.isConnected;
            if (!lost) {
                if (!liftedRef.current) clientLog('call_layer', { phase: 'focus', outcome: 'kept' });
                return;
            }
            const node = topDialog()?.node();
            node?.focus({ preventScroll: true });
            // `dropped`: focus was in the call but no dialog is left to take it.
            clientLog('call_layer', { phase: 'focus', outcome: node ? 'restored' : 'dropped' });
        };
    }, [lifted]);

    useEffect(() => {
        if (layer.messageId === null) return;
        clientLog('call_layer', { phase: layer.lifted ? 'lifted' : 'in_frame', count: layer.below });
    }, [layer]);

    // Tick the talk timer while connected.
    useEffect(() => {
        if (phase !== 'connected') return;
        setNow(Date.now());
        const id = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(id);
    }, [phase]);

    // Take keyboard focus when the call starts ringing so Enter/Esc work wherever focus was
    // (a clicked sidebar button, the timeline). Never steal it from text entry or another modal.
    useEffect(() => {
        if (phase !== 'ringing' || !hasOverlay) return;
        const overlay = overlayRef.current;
        if (!overlay) return;
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== overlay) {
            if (active.isContentEditable) return;
            if (active.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
            const modal = active.closest('[role="dialog"], [aria-modal="true"]');
            if (modal && modal !== overlay) return;
        }
        overlay.focus({ preventScroll: true });
    }, [phase, hasOverlay]);

    // Bubble-phase window keys: modals and other handlers get the key first, and we only act
    // when nothing else has claimed it (default not prevented, focus on the call or the page).
    useEffect(() => {
        if (phase === 'idle') return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' && e.key !== 'Enter') return;
            if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
            if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
            const target = e.target instanceof Element ? e.target : null;
            if (target) {
                if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
                const inOverlay = overlayRef.current?.contains(target) ?? false;
                if (!inOverlay && target !== document.body && target !== document.documentElement) return;
                // Let a focused button activate natively (e.g. Enter on Decline).
                if (e.key === 'Enter' && target.closest('button')) return;
            }
            if (e.key === 'Escape') {
                if (phase === 'ringing') decline();
                else if (phase === 'connected') hangUp();
                else return;
            } else if (phase === 'ringing') {
                answer();
            } else {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [phase, answer, decline, hangUp]);

    // One visually-hidden live region that outlives the call screens: a region that mounts
    // together with its text is often not announced, so this one is always in the DOM and
    // only its text changes.
    const liveText = phase === 'ringing' ? `${call.name} ${t('call.incoming')}`
        : phase === 'ended' ? t('call.ended')
        : '';
    const liveRegion = <LiveRegion message={liveText} />;

    if (phase === 'idle' || !call.message) return liveRegion;

    const talkSeconds = call.talkStartedAt ? (now - call.talkStartedAt) / 1000 : 0;
    const placement: React.CSSProperties = lifted
        ? { zIndex, left: rect?.left ?? 0, top: rect?.top ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0 }
        : {};

    const overlay = (
        <div
            ref={overlayRef}
            role="dialog"
            aria-label={call.name}
            tabIndex={-1}
            className={lifted
                ? 'sd-call-overlay fixed overflow-hidden rounded-b-sheet outline-none'
                : 'sd-call-overlay absolute inset-0 z-30 overflow-hidden outline-none'}
            style={{ '--sd-accent': accentColor, ...placement } as React.CSSProperties}
            data-testid="call-overlay"
            data-layer={lifted ? 'lifted' : 'frame'}
        >
            <div aria-hidden className="sd-call-ambient" style={{ backgroundImage: `url("${call.photoUrl}")` }} />
            <div aria-hidden className="sd-call-vignette" />
            <div className="sd-call-stage">
                <div className="sd-call-frame">
                    <div aria-hidden className="sd-call-halo" data-phase={phase} />
                    <CallScreen
                        phase={phase}
                        name={call.name}
                        groupLabel={groupLabel}
                        photoUrl={call.photoUrl}
                        talkSeconds={talkSeconds}
                        answerStyle={answerStyle}
                        onAnswer={answer}
                        onDecline={decline}
                        onHangUp={hangUp}
                    />
                </div>
            </div>
            <CallAudio
                key={call.message.id}
                phase={phase}
                audioUrl={call.audioUrl}
                onPlaybackEnded={call.onPlaybackEnded}
                onPlaybackError={call.onPlaybackError}
            />
        </div>
    );

    return (
        <>
            {liveRegion}
            {lifted ? (
                <>
                    <div ref={anchorRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />
                    {createPortal(overlay, document.body)}
                </>
            ) : overlay}
        </>
    );
};
