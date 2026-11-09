import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { Letter } from '../letters';

export interface TimelineLetterViewer {
    /** Id of the letter open in the viewer, or null. */
    letterId: number | null;
    /** Opens the viewer on a letter of the timeline (`LetterRow`'s `onOpenImage`). */
    open: (letter: Letter) => void;
    /** Shows another letter (the viewer's previous / next). */
    navigate: (id: number) => void;
    close: () => void;
    /**
     * Jumps the chat to a letter and then focuses the timeline, so its keys (↑ / ↓, Page Up /
     * Down, Home / End) work at once. Used by the viewer's date link and the Sent letters dialog.
     */
    jump: (id: number) => void;
}

/**
 * MessagesFeature's letter viewer state for the open room. The feature is not remounted when
 * the room changes, so the open letter is cleared when `roomKey` changes: a room switch
 * underneath the viewer (a notification) closes it, and coming back does not reopen it.
 * Focus moves to `timelineRef` in an effect after the jump's commit, once the closing dialogs
 * have left the dialog layer (which would otherwise pull focus back into them).
 */
export function useTimelineLetterViewer(
    roomKey: string | undefined,
    jumpToLetter: (id: number) => void,
    timelineRef: RefObject<HTMLElement>,
): TimelineLetterViewer {
    const [letterId, setLetterId] = useState<number | null>(null);
    const [room, setRoom] = useState(roomKey);
    if (room !== roomKey) {
        setRoom(roomKey);
        setLetterId(null);
    }

    const [focusRequest, setFocusRequest] = useState(0);
    useEffect(() => {
        if (focusRequest > 0) timelineRef.current?.focus({ preventScroll: true });
    }, [focusRequest, timelineRef]);

    const open = useCallback((letter: Letter) => setLetterId(letter.id), []);
    const close = useCallback(() => setLetterId(null), []);
    const jump = useCallback((id: number) => {
        jumpToLetter(id);
        setFocusRequest((n) => n + 1);
    }, [jumpToLetter]);

    return { letterId, open, navigate: setLetterId, close, jump };
}
