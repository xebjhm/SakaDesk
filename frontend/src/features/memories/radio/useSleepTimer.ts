import { useCallback, useEffect, useRef, useState } from 'react';
import { logMemoriesRadio, logMemoriesToggle } from '../memoriesLog';
import { fadeOutMemoriesVoices } from '../shared/voicePlayback';

/** The sleep timer's choices, in minutes. */
export const SLEEP_MINUTES = [15, 30, 60] as const;
/** How long the timer's fade-out lasts. */
export const SLEEP_FADE_MS = 10_000;

const MINUTE_MS = 60_000;
/** How often the remaining minutes are re-read while armed. */
const TICK_MS = 1_000;

export interface SleepTimerState {
    /** The minutes picked, or null when off. */
    chosen: number | null;
    /** Whole minutes left, rounded up (never 0), or null when off. */
    left: number | null;
    /** Arm for `minutes`, or turn off with null. */
    choose: (minutes: number | null) => void;
}

/**
 * The おやすみタイマー's state: armed for 15 / 30 / 60 minutes or off. At expiry it fades every
 * Memories voice out over 10 s through the coordinator (`fadeOutMemoriesVoices`), which turns the
 * radio's lamp off, and disarms. Logs `sleep_set` (`count` minutes), `sleep_fade` and the
 * `sleep_timer` toggle (`off` when cancelled, or when its owner unmounts while armed). The radio
 * page owns it, so neither a program switch nor a member switch drops it.
 */
export function useSleepTimer(): SleepTimerState {
    const [deadline, setDeadline] = useState<number | null>(null);
    const [chosen, setChosen] = useState<number | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const armed = useRef(false);
    armed.current = deadline !== null;

    useEffect(() => {
        if (deadline === null) return;
        const tick = setInterval(() => setNow(Date.now()), TICK_MS);
        const fire = setTimeout(() => {
            logMemoriesRadio('sleep_fade');
            void fadeOutMemoriesVoices(SLEEP_FADE_MS);
            setDeadline(null);
            setChosen(null);
        }, Math.max(0, deadline - Date.now()));
        return () => {
            clearInterval(tick);
            clearTimeout(fire);
        };
    }, [deadline]);

    // Leaving with the timer armed drops it: say so.
    useEffect(() => () => {
        if (armed.current) logMemoriesToggle('sleep_timer', false);
    }, []);

    const choose = useCallback((minutes: number | null) => {
        if (minutes === null) {
            if (armed.current) logMemoriesToggle('sleep_timer', false);
            setDeadline(null);
            setChosen(null);
            return;
        }
        const at = Date.now();
        setNow(at);
        setDeadline(at + minutes * MINUTE_MS);
        setChosen(minutes);
        logMemoriesToggle('sleep_timer', true);
        logMemoriesRadio('sleep_set', { count: minutes });
    }, []);

    const left = deadline === null ? null : Math.max(1, Math.ceil((deadline - now) / MINUTE_MS));
    return { chosen, left, choose };
}
