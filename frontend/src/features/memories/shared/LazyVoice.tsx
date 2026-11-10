import React, { useEffect } from 'react';
import { Play } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { cn, formatDuration } from '../../../utils/classnames';
import { VoicePlayer } from '../../../core/media/VoicePlayer';
import { useVoicePlayback } from './voicePlayback';

interface LazyVoiceProps {
    /** The voice's playback key (`<surface>|<room>|<id>`), unique among mounted voices. */
    playKey: string;
    src: string;
    /** Seconds; shown beside ▶ unless 0 or unknown. */
    durationS: number | null;
    /** The message's ISO time (the player's download name). */
    ts: string;
    className?: string;
}

/**
 * A Memories voice: a light ▶ button (with the duration) until it is played; only then does the
 * compact `VoicePlayer` (and its audio) mount, autoplaying. One voice plays at a time
 * (`useVoicePlayback`): playing another unmounts this one, and so does unmounting this component
 * while it plays (scrolled away, dialog closed).
 */
export const LazyVoice: React.FC<LazyVoiceProps> = ({ playKey, src, durationS, ts, className }) => {
    const { t } = useTranslation();
    const playing = useVoicePlayback((s) => s.playing === playKey);
    const play = useVoicePlayback((s) => s.play);
    const stop = useVoicePlayback((s) => s.stop);
    useEffect(() => () => stop(playKey), [playKey, stop]);
    const duration = durationS ? formatDuration(durationS) : null;
    if (playing) {
        return (
            <div data-memories-voice className={className}>
                <VoicePlayer src={src} variant="compact" autoPlay messageTimestamp={ts} />
            </div>
        );
    }
    return (
        <button
            type="button"
            aria-label={t('memories.favorites.play')}
            onClick={() => play(playKey)}
            className={cn(
                'flex w-full items-center gap-2 rounded-pill bg-sunken px-3 py-2 text-small text-primary',
                'transition-colors duration-fast ease-standard hover:bg-sheet motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                className,
            )}
        >
            <Play aria-hidden="true" className="h-4 w-4 fill-current" />
            {duration && <span className="tabular-nums text-secondary">{duration}</span>}
        </button>
    );
};
