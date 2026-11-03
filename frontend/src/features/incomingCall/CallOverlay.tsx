import React, { useEffect, useRef, useState } from 'react';
import { useAmplifiedVolume } from '../../core/media/useAmplifiedVolume';
import { VOLUME_STORAGE_KEY as VOICE_VOLUME_KEY } from '../../core/media/VoicePlayer';
import { CallScreen } from './CallScreen';
import type { IncomingCall } from './useIncomingCall';

/** Covers the chat area while a call is active; owns the audio element and Esc/Enter keys. */
export const CallOverlay: React.FC<{ call: IncomingCall }> = ({ call }) => {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    // Same persisted volume as the voice player, so call volume matches.
    const { connectElement } = useAmplifiedVolume(VOICE_VOLUME_KEY);
    const [now, setNow] = useState(() => Date.now());
    const { phase, answer, decline, hangUp, onPlaybackError } = call;

    // Play from the start on connect; stop otherwise.
    useEffect(() => {
        const el = audioRef.current;
        if (!el) return;
        if (phase === 'connected') {
            el.currentTime = 0;
            el.play().catch(() => onPlaybackError());
        } else {
            el.pause();
        }
    }, [phase, onPlaybackError]);

    // Tick the talk timer while connected.
    useEffect(() => {
        if (phase !== 'connected') return;
        setNow(Date.now());
        const id = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(id);
    }, [phase]);

    // Capture-phase keys so the chat's own key handlers don't also react.
    useEffect(() => {
        if (phase === 'idle') return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (phase === 'ringing') decline();
                else if (phase === 'connected') hangUp();
                else return;
            } else if (e.key === 'Enter' && phase === 'ringing') {
                answer();
            } else {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [phase, answer, decline, hangUp]);

    if (phase === 'idle' || !call.message) return null;

    const talkSeconds = call.talkStartedAt ? (now - call.talkStartedAt) / 1000 : 0;

    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden" data-testid="call-overlay">
            <div
                aria-hidden
                className="absolute inset-0 scale-110 bg-cover bg-center blur-2xl"
                style={{ backgroundImage: `url("${call.photoUrl}")` }}
            />
            <div aria-hidden className="absolute inset-0 bg-black/40" />
            <div className="relative">
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
            <audio
                data-testid="call-audio"
                ref={el => {
                    audioRef.current = el;
                    connectElement(el);
                }}
                src={call.audioUrl}
                preload="auto"
                onEnded={call.onPlaybackEnded}
                onError={call.onPlaybackError}
                className="hidden"
            />
        </div>
    );
};
