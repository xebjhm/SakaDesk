import React, { useRef, useState } from 'react';
import { Moon } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Menu, MenuItem, Pill } from '../../../design/primitives';
import { SLEEP_MINUTES, type SleepTimerState } from './useSleepTimer';

interface SleepTimerProps {
    timer: SleepTimerState;
}

/**
 * The radio's おやすみタイマー control: a `Pill` that opens a menu of off / 15 / 30 / 60 minutes.
 * While armed the pill reads 「あと {{count}} 分」 (rounded up, so never 0).
 */
export const SleepTimer: React.FC<SleepTimerProps> = ({ timer }) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const { chosen, left, choose } = timer;

    const pick = (minutes: number | null) => {
        setOpen(false);
        choose(minutes);
    };

    return (
        <div className="relative">
            <Pill
                ref={trigger}
                selected={left !== null}
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
                    <MenuItem radio selected={chosen === null} onClick={() => pick(null)}>
                        {t('memories.radio.sleepOff')}
                    </MenuItem>
                    {SLEEP_MINUTES.map((m) => (
                        <MenuItem key={m} radio selected={chosen === m} onClick={() => pick(m)}>
                            {t('memories.radio.sleepMinutes', { count: m })}
                        </MenuItem>
                    ))}
                </Menu>
            )}
        </div>
    );
};
