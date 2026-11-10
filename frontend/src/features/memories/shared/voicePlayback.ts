import { create } from 'zustand';

/** How the coordinator silences a player: at once, or with a fade (the radio's sleep timer). */
export interface PlayerHandle {
    stop(): void;
    fadeOut(ms: number): Promise<void>;
}

/**
 * The only place that decides which Memories voice plays: one voice at a time, across every
 * Memories player (`LazyVoice`, the recap's voice slide, the radio). A player calls
 * `play(key, handle)` before it sounds; that stops the previous player's handle. A player that
 * mounts its audio only while its key is `playing` ({@link LazyVoice}) is also unmounted by the
 * key change. `stop()` silences every Memories voice. Keys are codes built from room and id
 * (`<surface>|<room>|<id>`) or a surface code (`recap|s06`); never log them.
 */
interface VoicePlaybackState {
    playing: string | null;
    /** The playing player's handle, or null for a key-only player. */
    handle: PlayerHandle | null;
    /** Start `key` (with its handle), stopping any other voice. */
    play: (key: string, handle?: PlayerHandle) => void;
    /** Stop `key` (only if it is the one playing), or every voice without a key. */
    stop: (key?: string) => void;
}

export const useVoicePlayback = create<VoicePlaybackState>((set, get) => ({
    playing: null,
    handle: null,
    play: (key, handle) => {
        const previous = get().handle;
        const next = handle ?? null;
        // State first: a handle whose stop() calls back into stop(key) finds nothing to stop.
        set({ playing: key, handle: next });
        if (previous && previous !== next) previous.stop();
    },
    stop: (key) => {
        const { playing, handle } = get();
        if (key !== undefined && playing !== key) return;
        if (playing === null && handle === null) return;
        set({ playing: null, handle: null });
        handle?.stop();
    },
}));

/** Stop every Memories voice (opening a dialog over a board, leaving a page). */
export const stopMemoriesVoices = (): void => useVoicePlayback.getState().stop();

/**
 * Fade the playing Memories voice out over `ms` (the radio's sleep timer), or stop at once a
 * player that cannot fade. A voice started during the fade keeps playing.
 */
export const fadeOutMemoriesVoices = async (ms: number): Promise<void> => {
    const { playing, handle, stop } = useVoicePlayback.getState();
    if (playing === null && handle === null) return;
    if (!handle || typeof handle.fadeOut !== 'function') {
        stop(playing ?? undefined);
        return;
    }
    await handle.fadeOut(ms);
    if (useVoicePlayback.getState().handle === handle) useVoicePlayback.setState({ playing: null, handle: null });
};
