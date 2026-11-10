import React, { useEffect, useRef, useState } from 'react';
import { Moon } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Menu, MenuItem, Pill } from '../../../design/primitives';
import { logMemoriesRadio, logMemoriesToggle } from '../memoriesLog';
import { fadeOutMemoriesVoices } from '../shared/voicePlayback';

/** The sleep timer's choices, in minutes. */
export const SLEEP_MINUTES = [15, 30, 60] as const;
/** How long the timer's fade-out lasts. */
export const SLEEP_FADE_MS = 10_000;

const MINUTE_MS = 60_000;
/** How often the remaining minutes are re-read while armed. */
const TICK_MS = 1_000;

/**
 * The radio's おやすみタイマー: a `Pill` that opens a menu of off / 15 / 30 / 60 minutes. While
 * armed the pill reads 「あと {{count}} 分」 (rounded up, so never 0). At expiry it fades every
 * Memories voice out over 10 s through the coordinator (`fadeOutMemoriesVoices`), which turns the
 * radio's lamp off, and disarms. The timer belongs to the station, not to a program: switching
 * programs keeps it running. Logs `sleep_set` (`count` minutes), `sleep_fade` and the
 * `sleep_timer` toggle.
 */
export const SleepTimer: React.FC = () => {
    const { t } = useTranslation();
    const [deadline, setDeadline] = useState<number | null>(null);
    const [chosen, setChosen] = useState<number | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);

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

    const choose = (minutes: number | null) => {
        setOpen(false);
        if (minutes === null) {
            if (deadline !== null) logMemoriesToggle('sleep_timer', false);
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
    };

    const left = deadline === null ? null : Math.max(1, Math.ceil((deadline - now) / MINUTE_MS));
    return (
        <div className="relative">
            <Pill
                ref={trigger}
                selected={deadline !== null}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
            >
                <Moon aria-hidden="true" className="h-3.5 w-3.5" />
                <span className="tabular-nums">
                    {left === null ? t('memories.radio.sleep') : t('memories.radio.sleepLeft', { count: left })}
                </span>
            </Pill>
            {open && (
                <Menu
                    aria-label={t('memories.radio.sleep')}
                    onClose={() => setOpen(false)}
                    returnFocusRef={trigger}
                    ignoreRefs={[trigger]}
                    className="absolute bottom-full right-0 mb-2"
                >
                    <MenuItem radio selected={deadline === null} onClick={() => choose(null)}>
                        {t('memories.radio.sleepOff')}
                    </MenuItem>
                    {SLEEP_MINUTES.map((m) => (
                        <MenuItem key={m} radio selected={chosen === m} onClick={() => choose(m)}>
                            {t('memories.radio.sleepMinutes', { count: m })}
                        </MenuItem>
                    ))}
                </Menu>
            )}
        </div>
    );
};
