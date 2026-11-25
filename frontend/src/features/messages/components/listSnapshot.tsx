import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { clientLog } from '../../../utils/clientLog';
import { getListSnapshot, rememberListSnapshot } from '../listSnapshotStore';

/** The cover never outlives this, even if the live list never reports that it is positioned. */
export const LIST_SNAPSHOT_COVER_MAX_MS = 1000;

const SCROLLER = '[data-virtuoso-scroller]';
const ITEM_LIST = '[data-testid="virtuoso-item-list"]';

/**
 * Virtuoso keeps its item list `visibility: hidden` from mount until the list has measured and
 * scrolled to `initialTopMostItemIndex` (the saved position, or the newest message), so it never
 * shows the room at a wrong position and then jumps. True once that list is shown (or when there
 * is no such list, as in the jsdom stand-in).
 */
function positioned(root: HTMLElement): boolean {
    const list = root.querySelector<HTMLElement>(ITEM_LIST);
    return !list || list.style.visibility !== 'hidden';
}

function remember(key: string, root: HTMLElement): void {
    // A list left before it was positioned is blank: keep the room's earlier snapshot instead.
    if (!positioned(root)) return;
    rememberListSnapshot(key, root, root.querySelector<HTMLElement>(SCROLLER)?.scrollTop ?? 0);
}

interface RoomListProps {
    roomKey: string;
    /** Cover with the room's last painted list (false for a jump to a message: it lands elsewhere). */
    restore: boolean;
    children: React.ReactNode;
}

const RoomList: React.FC<RoomListProps> = ({ roomKey, restore, children }) => {
    const [snapshot] = useState(() => (restore ? getListSnapshot(roomKey) : null));
    const [covering, setCovering] = useState(snapshot !== null);
    const live = useRef<HTMLDivElement | null>(null);
    const cover = useRef<HTMLDivElement | null>(null);
    // Called with null while the old list is still in the document (React detaches refs of a
    // deleted subtree before removing its nodes), so its scroll position can still be read.
    const liveRef = useCallback((el: HTMLDivElement | null) => {
        if (el) live.current = el;
        else if (live.current) remember(roomKey, live.current);
    }, [roomKey]);

    // Before the first paint: the room's last painted list, at its scroll position, over the live
    // list until Virtuoso shows it. Removed in the same task as the reveal (no blank frame).
    useLayoutEffect(() => {
        const host = cover.current;
        const root = live.current;
        if (!snapshot || !host || !root) return undefined;
        if (positioned(root)) {
            setCovering(false);
            return undefined;
        }
        // `inert` set directly: React 18 does not pass it through as a boolean prop.
        host.setAttribute('inert', '');
        host.appendChild(snapshot.node);
        const scroller = snapshot.node.querySelector<HTMLElement>(SCROLLER);
        if (scroller) scroller.scrollTop = snapshot.scrollTop;
        let observer: MutationObserver | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const done = () => {
            observer?.disconnect();
            if (timer !== null) clearTimeout(timer);
            host.style.display = 'none'; // at once, before the next paint; unmounted below
            setCovering(false);
        };
        observer = new MutationObserver(() => { if (positioned(root)) done(); });
        observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
        timer = setTimeout(() => {
            clientLog('chat_load', { outcome: 'snapshot_timeout' });
            done();
        }, LIST_SNAPSHOT_COVER_MAX_MS);
        return () => {
            observer?.disconnect();
            if (timer !== null) clearTimeout(timer);
        };
    }, [snapshot]);

    return (
        <div className="relative h-full">
            <div ref={liveRef} className="h-full">{children}</div>
            {covering && (
                <div
                    ref={cover}
                    data-testid="chat-list-snapshot"
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 overflow-hidden"
                />
            )}
        </div>
    );
};

/**
 * Keeps a room's message list painted from the first frame of a revisit. Virtuoso hides a freshly
 * mounted list (`visibility: hidden`) for its first measure and scroll to the saved position,
 * about 200 ms of blank timeline on every room switch. When the room's list was painted before,
 * a clone of it as it was left (a detached, sanitised DOM copy at its scroll position, inert and
 * hidden from assistive tech; `listSnapshotStore.ts`) covers the live list until Virtuoso shows it, then goes in the same task. The
 * live list keeps its guard: it is still never shown at a wrong position. A room never seen, a
 * list left before it was positioned, or a jump to a message (`restore` false) shows no cover. At
 * most `LIST_SNAPSHOT_COVER_MAX_MS`; past that the cover goes and logs `chat_load`
 * `outcome=snapshot_timeout` (codes only).
 */
export const KeepListPainted: React.FC<RoomListProps> = ({ roomKey, restore, children }) => (
    <RoomList key={roomKey} roomKey={roomKey} restore={restore}>{children}</RoomList>
);
