import React from 'react';
import { Avatar } from '../../../design/primitives';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import { formatJstClock, formatJstDate } from '../shared/jst';
import type { RadioTrack } from '../types';
import { formatTrackLength } from './radioFormat';
import { Waveform } from './Waveform';

interface NowPlayingProps {
    track: RadioTrack;
    /** Her name for the avatar's fallback initial (null for 全員: the avatar is decorative). */
    name: string | null;
    analyser: AnalyserNode | null;
    playing: boolean;
}

const AVATAR_PX = 56;

/**
 * The track on air: her avatar at the time of the voice, the voice's real JST date and time
 * (metadata, never presented as chosen for the fan) and its length, over the waveform.
 */
export const NowPlaying: React.FC<NowPlayingProps> = ({ track, name, analyser, playing }) => {
    const width = useAvatarWidth(AVATAR_PX);
    const { ts } = track.message;
    const length = formatTrackLength(track);
    return (
        <div data-testid="now-playing" className="mx-4 flex shrink-0 items-center gap-4 rounded-card bg-viewer-control p-3">
            <Avatar src={resizedAvatarUrl(track.message.avatar_url, width)} name={name ?? ''} size="lg" decorative />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-small tabular-nums">
                    <time dateTime={ts}>{`${formatJstDate(ts)} ${formatJstClock(ts)}`}</time>
                    {length && <span className="ml-2">{length}</span>}
                </p>
                <Waveform analyser={analyser} active={playing} />
            </div>
        </div>
    );
};
