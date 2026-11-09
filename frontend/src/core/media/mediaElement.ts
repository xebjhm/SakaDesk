import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

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
export function useMediaSource(
    ref: RefObject<HTMLMediaElement | null>,
    src: string | undefined,
    /** Change this when the element behind `ref` is replaced (e.g. a variant that renders a different `<audio>`). */
    elementKey?: unknown,
): void {
    // A layout effect binds the source before the first paint, so no frame shows a src-less element.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || !src) return;
        el.setAttribute('src', src);
        return () => releaseMediaElement(el);
    }, [ref, src, elementKey]);
}

/**
 * The duration (seconds) of the media element in `ref`, 0 until known.
 *
 * Read at once when the element already has its metadata (`readyState >= HAVE_METADATA`: the
 * `loadedmetadata` event can fire before the listener is bound, which left "0:00 / 0:00"), and
 * again on `loadedmetadata` and `durationchange`. Non-finite values (`Infinity` for a stream
 * whose length is not yet known, `NaN` before metadata) are ignored. A new `src` (or
 * `elementKey`) starts again from 0. Call it after `useMediaSource`, whose layout effect has
 * already bound the source.
 */
export function useMediaDuration(
    ref: RefObject<HTMLMediaElement | null>,
    src: string | undefined,
    /** Change this when the element behind `ref` is replaced (e.g. a variant that renders a different `<audio>`). */
    elementKey?: unknown,
): number {
    const [duration, setDuration] = useState(0);
    useEffect(() => {
        setDuration(0);
        const el = ref.current;
        if (!el) return;
        const read = () => {
            if (Number.isFinite(el.duration)) setDuration(el.duration);
        };
        el.addEventListener('loadedmetadata', read);
        el.addEventListener('durationchange', read);
        if (el.readyState >= HTMLMediaElement.HAVE_METADATA) read();
        return () => {
            el.removeEventListener('loadedmetadata', read);
            el.removeEventListener('durationchange', read);
        };
    }, [ref, src, elementKey]);
    return duration;
}
