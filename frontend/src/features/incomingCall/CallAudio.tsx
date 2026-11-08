import React, { useEffect, useRef } from 'react';
import { useAmplifiedVolume } from '../../core/media/useAmplifiedVolume';
import { useMediaSource } from '../../core/media/mediaElement';
import { VOLUME_STORAGE_KEY as VOICE_VOLUME_KEY } from '../../core/media/VoicePlayer';
import type { IncomingCall } from './useIncomingCall';

type CallAudioProps = Pick<IncomingCall, 'phase' | 'audioUrl' | 'onPlaybackEnded' | 'onPlaybackError'>;

/**
 * The call's audio element. Mounted per call (keyed by message id) so each call reads
 * the voice player's current persisted volume and closes its AudioContext when the call ends.
 * The AudioContext is created when the call connects (right before `play()`), and the
 * element is released (pause, drop src, load) only on unmount, when the call is over.
 */
export const CallAudio: React.FC<CallAudioProps> = ({ phase, audioUrl, onPlaybackEnded, onPlaybackError }) => {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const { connectElement, prepareForPlayback } = useAmplifiedVolume(VOICE_VOLUME_KEY);

    // Bound imperatively (before the play effect below) so the element is released
    // when this unmounts — the call is over — and never keeps its media connection.
    useMediaSource(audioRef, audioUrl);

    // Play from the start on connect; stop otherwise.
    useEffect(() => {
        const el = audioRef.current;
        if (!el) return;
        if (phase === 'connected') {
            el.currentTime = 0;
            prepareForPlayback();
            el.play().catch(() => onPlaybackError());
        } else {
            el.pause();
        }
    }, [phase, onPlaybackError, prepareForPlayback]);

    return (
        <audio
            data-testid="call-audio"
            ref={el => {
                audioRef.current = el;
                connectElement(el);
            }}
            preload="auto"
            onEnded={onPlaybackEnded}
            onError={onPlaybackError}
            className="hidden"
        />
    );
};
