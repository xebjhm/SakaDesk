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

/**
 * Whether the tile in `ref` is on screen (`'visible'`) or only mounted (`'near'`: a mounted tile
 * is within the grid's overscan by definition). One `IntersectionObserver` per `root` (the
 * scroll parent; `null` for the viewport) serves every tile. Without `IntersectionObserver`
 * (jsdom, old engines) every tile is `'visible'`.
 */
export function useTileVisibility(ref: RefObject<Element | null>, root: Element | null = null): LoadPriority {
    const supported = typeof IntersectionObserver === 'function';
    const [visible, setVisible] = useState(!supported);
    useEffect(() => {
        const el = ref.current;
        if (!supported || !el) return undefined;
        return observe(el, root, setVisible);
    }, [ref, root, supported]);
    return visible ? 'visible' : 'near';
}
