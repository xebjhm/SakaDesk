import { useEffect, useState, type RefObject } from 'react';
import type { LoadPriority } from './loadScheduler';

type Callback = (visible: boolean) => void;

interface SharedObserver {
    observer: IntersectionObserver;
    callbacks: Map<Element, Callback>;
}

/** One observer per root element (`null`: the viewport), shared by every tile in it. */
const observers = new Map<Element | null, SharedObserver>();

function observe(el: Element, root: Element | null, cb: Callback): () => void {
    let shared = observers.get(root);
    if (!shared) {
        const callbacks = new Map<Element, Callback>();
        const observer = new IntersectionObserver(
            (entries) => entries.forEach((entry) => callbacks.get(entry.target)?.(entry.isIntersecting)),
            { root, rootMargin: '0px' },
        );
        shared = { observer, callbacks };
        observers.set(root, shared);
    }
    shared.callbacks.set(el, cb);
    shared.observer.observe(el);
    const owner = shared;
    return () => {
        owner.observer.unobserve(el);
        owner.callbacks.delete(el);
        if (owner.callbacks.size === 0) {
            owner.observer.disconnect();
            observers.delete(root);
        }
    };
}

export interface TileVisibility {
    priority: LoadPriority;
    /**
     * The observer has reported this tile at least once (always true without
     * `IntersectionObserver`). Until then `priority` is a guess (`'near'`), so a tile should not
     * take a load slot yet: the first mounted tiles would otherwise fill the slots in mount order,
     * overscan rows above the screen included, before the visible ones.
     */
    known: boolean;
}

/**
 * Whether the tile in `ref` is on screen (`'visible'`) or only mounted (`'near'`: a mounted tile
 * is within the grid's overscan by definition), and whether that is known yet. One
 * `IntersectionObserver` per `root` (the scroll parent; `null` for the viewport) serves every
 * tile; it reports each new tile on its next frame. Without `IntersectionObserver` (jsdom, old
 * engines) every tile is `'visible'` and known at once.
 */
export function useTileVisibilityState(ref: RefObject<Element | null>, root: Element | null = null): TileVisibility {
    const supported = typeof IntersectionObserver === 'function';
    const [state, setState] = useState<{ visible: boolean; known: boolean }>(
        () => (supported ? { visible: false, known: false } : { visible: true, known: true }),
    );
    useEffect(() => {
        const el = ref.current;
        if (!supported || !el) return undefined;
        return observe(el, root, (visible) => setState({ visible, known: true }));
    }, [ref, root, supported]);
    return { priority: state.visible ? 'visible' : 'near', known: state.known };
}
