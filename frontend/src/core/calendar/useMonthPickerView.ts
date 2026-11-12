import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { monthYearPickerLog } from './pickerLog';

export interface MonthPickerView {
    /** The year / month picker is shown instead of the day grid. */
    picking: boolean;
    /** The month title button (focus returns here when the picker closes, and moves in from here). */
    titleRef: React.RefObject<HTMLButtonElement>;
    /** Show the picker; logs `calendar_picker` `open` with the years offered. */
    openPicker: (yearCount: number) => void;
    /** Back to the days from the host's own control or an Escape outside the picker; logs `back`. */
    closePicker: (reason: 'escape' | 'button') => void;
    /** Back to the days without a breadcrumb (a pick, which the picker logs, or the host closing). */
    dismiss: () => void;
    /** The host's key handler: Escape in the picker view returns to the days (claimed, so a dialog stays open). */
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}

/**
 * The host side of a calendar's day grid / year-month picker swap, shared by `CalendarModal` and
 * the Memories calendar album: the view state, the `open` / `back` breadcrumbs, Escape and the
 * focus return to the month title when the picker closes (only while `active`: a closing dialog
 * restores focus itself).
 */
export function useMonthPickerView(active = true): MonthPickerView {
    const [picking, setPicking] = useState(false);
    const titleRef = useRef<HTMLButtonElement>(null);
    const wasPicking = useRef(picking);

    useEffect(() => {
        const closed = wasPicking.current && !picking;
        wasPicking.current = picking;
        if (active && closed) titleRef.current?.focus();
    }, [picking, active]);

    const openPicker = useCallback((yearCount: number) => {
        setPicking(true);
        monthYearPickerLog.open(yearCount);
    }, []);
    const closePicker = useCallback((reason: 'escape' | 'button') => {
        setPicking(false);
        monthYearPickerLog.back(reason);
    }, []);
    const dismiss = useCallback(() => setPicking(false), []);
    const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
        if (!picking || e.key !== 'Escape' || e.defaultPrevented || e.nativeEvent.isComposing) return;
        e.preventDefault();
        closePicker('escape');
    }, [picking, closePicker]);

    return { picking, titleRef, openPicker, closePicker, dismiss, onKeyDown };
}
