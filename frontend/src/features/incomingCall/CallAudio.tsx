import React, { useEffect, useRef } from 'react';
import { useAmplifiedVolume } from '../../core/media/useAmplifiedVolume';
import { VOLUME_STORAGE_KEY as VOICE_VOLUME_KEY } from '../../core/media/VoicePlayer';
import type { IncomingCall } from './useIncomingCall';

type CallAudioProps = Pick<IncomingCall, 'phase' | 'audioUrl' | 'onPlaybackEnded' | 'onPlaybackError'>;

/**
 * The call's audio element. Mounted per call (keyed by message id) so each call reads
 * the voice player's current persisted volume and closes its AudioContext when the call ends.
 */
export const CallAudio: React.FC<CallAudioProps> = ({ phase, audioUrl, onPlaybackEnded, onPlaybackError }) => {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const { connectElement } = useAmplifiedVolume(VOICE_VOLUME_KEY);

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

    return (
        <audio
            data-testid="call-audio"
            ref={el => {
                audioRef.current = el;
                connectElement(el);
            }}
            src={audioUrl}
            preload="auto"
            onEnded={onPlaybackEnded}
            onError={onPlaybackError}
            className="hidden"
        />
    );
};
