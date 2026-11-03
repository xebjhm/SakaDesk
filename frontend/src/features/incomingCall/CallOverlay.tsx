import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import { CallAudio } from './CallAudio';
import { CallScreen } from './CallScreen';
import type { IncomingCall } from './useIncomingCall';

/** Covers the chat area while a call is active; hosts the call audio and handles Esc/Enter. */
export const CallOverlay: React.FC<{ call: IncomingCall }> = ({ call }) => {
    const { t } = useTranslation();
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const { phase, answer, decline, hangUp } = call;

    // Tick the talk timer while connected.
    useEffect(() => {
        if (phase !== 'connected') return;
        setNow(Date.now());
        const id = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(id);
    }, [phase]);

    // Take keyboard focus when the call starts ringing so Enter/Esc work wherever focus was
    // (a clicked sidebar button, the timeline). Never steal it from text entry or another modal.
    const hasOverlay = phase !== 'idle' && !!call.message;
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
    const liveRegion = (
        <div role="status" aria-live="polite" className="sr-only">{liveText}</div>
    );

    if (phase === 'idle' || !call.message) return liveRegion;

    const talkSeconds = call.talkStartedAt ? (now - call.talkStartedAt) / 1000 : 0;

    return (
        <>
        {liveRegion}
        <div
            ref={overlayRef}
            role="dialog"
            aria-label={call.name}
            tabIndex={-1}
            className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden outline-none"
            data-testid="call-overlay"
        >
            <div
                aria-hidden
                className="absolute inset-0 scale-110 bg-cover bg-center blur-2xl"
                style={{ backgroundImage: `url("${call.photoUrl}")` }}
            />
            <div aria-hidden className="absolute inset-0 bg-black/40" />
            <div className="relative flex h-full w-full items-center justify-center">
                <CallScreen
                    phase={phase}
                    name={call.name}
                    groupLabel=""
                    photoUrl={call.photoUrl}
                    talkSeconds={talkSeconds}
                    answerStyle="solid"
                    onAnswer={answer}
                    onDecline={decline}
                    onHangUp={hangUp}
                />
            </div>
            <CallAudio
                key={call.message.id}
                phase={phase}
                audioUrl={call.audioUrl}
                onPlaybackEnded={call.onPlaybackEnded}
                onPlaybackError={call.onPlaybackError}
            />
        </div>
        </>
    );
};
