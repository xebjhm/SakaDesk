import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { subscribeDialogStack, topDialog } from '../dialog/dialogStack';

/**
 * The one announcer (UI health A-D2). Transient messages that are not alerts (a clipboard toast,
 * the incoming call's text) are announced through a single, always-mounted, visually hidden polite
 * region, `LiveRegionHost`, mounted once beside the app. Components call `announce(message)`, or
 * render `<LiveRegion message>`, a thin client that announces whenever its message changes to a
 * non-empty text.
 *
 * Where the region lives follows the dialog stack: while a dialog is open `#root` and the lower
 * dialogs are inert and an `aria-modal` dialog hides everything outside it from assistive tech, so
 * the region is portaled into the top dialog's frame (it moves when that changes); with none open
 * it is in <body>.
 *
 * Re-announcing: the text is cleared, then set again a moment later, so an identical message
 * announces again. A message stays announceable for `LIVE_MS`: when the region moves inside that
 * window the text is set again in its new place (a dialog that opens with the toast), after it
 * the message is stale and is not replayed.
 */
const SET_DELAY_MS = 50;
const LIVE_MS = 3000;

interface Announcement { message: string; seq: number; at: number }
let current: Announcement = { message: '', seq: 0, at: 0 };
const listeners = new Set<() => void>();

/** Announces `message` politely (an empty message does nothing). */
export function announce(message: string): void {
    if (!message) return;
    current = { message, seq: current.seq + 1, at: Date.now() };
    for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
const getAnnouncement = () => current;

/** The element that holds the region: the top dialog's frame, else <body>. */
const getTarget = (): HTMLElement => topDialog()?.node() ?? document.body;

/** Mount once, beside the app. */
export const LiveRegionHost: React.FC = () => {
    const { message, seq, at } = useSyncExternalStore(subscribe, getAnnouncement, getAnnouncement);
    const target = useSyncExternalStore(subscribeDialogStack, getTarget, () => null);
    const [text, setText] = useState('');
    useEffect(() => {
        setText('');
        const remaining = LIVE_MS - (Date.now() - at);
        if (!message || remaining <= 0) return;
        const set = setTimeout(() => setText(message), SET_DELAY_MS);
        const clear = setTimeout(() => setText(''), remaining);
        return () => { clearTimeout(set); clearTimeout(clear); };
    }, [seq, message, at, target]);
    return createPortal(
        <div role="status" aria-live="polite" className="sr-only">{text}</div>,
        target ?? document.body,
    );
};

/** Announces `message` through the host whenever it changes to a non-empty text; renders nothing. */
export const LiveRegion: React.FC<{ message: string }> = ({ message }) => {
    useEffect(() => { announce(message); }, [message]);
    return null;
};
