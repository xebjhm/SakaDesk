import React, { useRef } from 'react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { fetchRadioCassettes } from '../api';
import { logMemoriesToggle } from '../memoriesLog';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import { formatVoiceLength } from './radioFormat';

interface CassetteShelfProps {
    service: string;
    member?: string;
    /** The year あの頃から順番に plays (the pressed tape), or null for none yet. */
    selectedYear: number | null;
    onLoad: (year: number) => void;
}

/**
 * The cassette year picker for あの頃から順番に (spec 11 B): one tape per JST year with voices,
 * oldest on the left. The tape shell takes that year's probe colour through `style` (runtime data,
 * the album ribbon's documented data-driven exception); a year without one gets the neutral
 * `bg-sunken` tape. Each label names the year and its length (no voice count). The row is one Tab
 * stop: ← / → move to the older / newer tape, Enter (or a click) loads that year, and the loaded
 * tape is pressed. Logs `memories_toggle` `cassette`. Scrolls sideways inside itself; draws
 * nothing without tapes.
 */
export const CassetteShelf: React.FC<CassetteShelfProps> = ({ service, member, selectedYear, onLoad }) => {
    const { t } = useTranslation();
    const query = useMemoriesQuery('radio_cassettes', (signal) => fetchRadioCassettes(service, member, signal), [service, member], {
        count: (d) => d.cassettes.length,
    });
    const refs = useRef<Array<HTMLButtonElement | null>>([]);
    const cassettes = query.data?.cassettes ?? [];
    if (cassettes.length === 0) return null;

    const selectedIndex = cassettes.findIndex((c) => c.year === selectedYear);
    const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

    const onKeyDown = (e: React.KeyboardEvent, i: number) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next = e.key === 'ArrowLeft' ? Math.max(0, i - 1) : Math.min(cassettes.length - 1, i + 1);
        refs.current[next]?.focus();
    };
    const load = (year: number) => {
        logMemoriesToggle('cassette', true);
        onLoad(year);
    };

    return (
        <div role="group" aria-label={t('memories.radio.cassettes')} className="flex shrink-0 gap-3 overflow-x-auto px-4 py-2">
            {cassettes.map((c, i) => {
                const pressed = c.year === selectedYear;
                const length = formatVoiceLength(t, c.seconds);
                return (
                    <button
                        key={c.year}
                        ref={(el) => { refs.current[i] = el; }}
                        type="button"
                        data-testid="cassette"
                        aria-pressed={pressed}
                        tabIndex={i === tabStop ? 0 : -1}
                        onKeyDown={(e) => onKeyDown(e, i)}
                        onClick={() => load(c.year)}
                        className={cn(
                            'shrink-0 rounded-md text-left transition-transform duration-fast ease-standard',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                            pressed ? 'ring-2 ring-accent' : 'hover:-translate-y-px motion-reduce:hover:translate-y-0',
                        )}
                    >
                        <span
                            data-testid="cassette-shell"
                            data-tone={c.color ? 'year' : 'neutral'}
                            style={c.color ? { backgroundColor: c.color } : undefined}
                            className={cn('flex w-36 flex-col gap-2 rounded-md p-2 shadow-pill', !c.color && 'bg-sunken')}
                        >
                            <span className="flex flex-col rounded-sm bg-memories-paper px-2 py-1 text-small text-primary">
                                <span className="font-semibold tabular-nums">{t('memories.radio.cassette', { year: c.year })}</span>
                                {length && (
                                    <span className="text-caption text-secondary tabular-nums">
                                        {t('memories.radio.cassetteLength', { length })}
                                    </span>
                                )}
                            </span>
                            <span aria-hidden="true" className="flex justify-between px-4 pb-1">
                                <span className="h-5 w-5 rounded-full border-4 border-strong bg-sheet" />
                                <span className="h-5 w-5 rounded-full border-4 border-strong bg-sheet" />
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
};
