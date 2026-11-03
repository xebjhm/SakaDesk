import React, { useEffect, useRef, useState } from 'react';
import { CallAudio } from './CallAudio';
import { CallScreen } from './CallScreen';
import type { IncomingCall } from './useIncomingCall';

/** Covers the chat area while a call is active; hosts the call audio and handles Esc/Enter. */
export const CallOverlay: React.FC<{ call: IncomingCall }> = ({ call }) => {
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

    if (phase === 'idle' || !call.message) return null;

    const talkSeconds = call.talkStartedAt ? (now - call.talkStartedAt) / 1000 : 0;

    return (
        <div
            ref={overlayRef}
            role="dialog"
            aria-label={call.name}
            className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden"
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
                    photoUrl={call.photoUrl}
                    talkSeconds={talkSeconds}
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
    );
};
