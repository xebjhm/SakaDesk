import { create } from 'zustand';

/**
 * Memories' one voice at a time. A voice player mounts only while its key is `playing`
 * ({@link LazyVoice}), so `play(key)` unmounts the voice that was playing (its audio is released
 * on unmount, `useMediaSource`) and `stop()` silences every Memories voice. Keys are codes built
 * from room and id (`<surface>|<room>|<id>`); never log them.
 */
interface VoicePlaybackState {
    playing: string | null;
    /** Start `key`, stopping any other voice. */
    play: (key: string) => void;
    /** Stop `key` (only if it is the one playing), or every voice without a key. */
    stop: (key?: string) => void;
}

export const useVoicePlayback = create<VoicePlaybackState>((set, get) => ({
    playing: null,
    play: (key) => set({ playing: key }),
    stop: (key) => {
        if (key === undefined || get().playing === key) set({ playing: null });
    },
}));

/** Stop every Memories voice (opening a dialog over a board, leaving a page). */
export const stopMemoriesVoices = (): void => useVoicePlayback.getState().stop();
