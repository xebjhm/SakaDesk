import { useEffect, useRef, type RefObject } from 'react';
import { useVoicePlayback, type PlayerHandle } from './voicePlayback';

/**
 * Brings the chat `MessageBubble` voices inside `ref` under the Memories voice coordinator
 * (`useVoicePlayback`), so they obey the one-voice rule with every other Memories player.
 *
 * The chat's `VoicePlayer` is left unchanged: a capture-phase `play` listener on the container
 * (media events do not bubble, but they do pass the capture phase) joins each `<audio>` that
 * starts with the key `<surface>|bubble|<n>` and a handle that pauses it; its `pause` / `ended`
 * leaves the coordinator. Another Memories voice starting pauses the bubble, and a bubble starting
 * silences any other Memories voice. Unmounting the container stops its voice. Keys are never
 * logged.
 */
export function useBubbleVoices(ref: RefObject<HTMLElement | null>, surface: string): void {
    const keys = useRef(new WeakMap<HTMLMediaElement, string>());
    const next = useRef(0);
    useEffect(() => {
        const root = ref.current;
        if (!root) return undefined;
        const { play, stop } = useVoicePlayback.getState();
        const owned = new Set<string>();
        const keyOf = (audio: HTMLMediaElement): string => {
            let key = keys.current.get(audio);
            if (!key) {
                next.current += 1;
                key = `${surface}|bubble|${next.current}`;
                keys.current.set(audio, key);
            }
            return key;
        };
        const onPlay = (event: Event) => {
            const audio = event.target;
            if (!(audio instanceof HTMLAudioElement)) return;
            const key = keyOf(audio);
            owned.add(key);
            const handle: PlayerHandle = {
                stop: () => audio.pause(),
                fadeOut: () => {
                    audio.pause();
                    return Promise.resolve();
                },
            };
            play(key, handle);
        };
        const onStop = (event: Event) => {
            const audio = event.target;
            if (!(audio instanceof HTMLAudioElement)) return;
            const key = keys.current.get(audio);
            if (key) stop(key);
        };
        root.addEventListener('play', onPlay, true);
        root.addEventListener('pause', onStop, true);
        root.addEventListener('ended', onStop, true);
        return () => {
            root.removeEventListener('play', onPlay, true);
            root.removeEventListener('pause', onStop, true);
            root.removeEventListener('ended', onStop, true);
            for (const key of owned) stop(key);
        };
    }, [ref, surface]);
}
