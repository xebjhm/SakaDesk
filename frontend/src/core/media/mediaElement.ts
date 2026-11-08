import { useEffect, type RefObject } from 'react';

/**
 * Stop a media element and drop its network connection: pause, remove `src`
 * (and the `src` of any `<source>` children), then `load()` so the browser
 * aborts the in-flight request. Chromium allows only six low-priority media
 * requests per host, so an element that is merely unmounted or paused can keep
 * a slot busy and stall every later video, voice or picture request.
 */
export function releaseMediaElement(el: HTMLMediaElement | null | undefined): void {
    if (!el) return;
    el.pause();
    el.removeAttribute('src');
    el.querySelectorAll('source').forEach((source) => source.removeAttribute('src'));
    el.load();
}

/**
 * Bind `src` to the media element in `ref` imperatively (render the element
 * without a `src` prop). The element is released with
 * {@link releaseMediaElement} before the source changes and on unmount, so the
 * old request never lingers. An empty or missing `src` leaves the element
 * without a source (no request, no error event); passing `undefined` until the
 * element is mounted (e.g. `inView ? src : undefined`) also re-runs the binding
 * once it exists.
 */
export function useMediaSource(ref: RefObject<HTMLMediaElement | null>, src: string | undefined): void {
    useEffect(() => {
        const el = ref.current;
        if (!el || !src) return;
        el.setAttribute('src', src);
        return () => releaseMediaElement(el);
    }, [ref, src]);
}
