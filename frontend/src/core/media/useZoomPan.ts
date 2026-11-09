import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Fit: the photo at its displayed size. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** One ↑ / ↓ press or one − / + click. */
export const ZOOM_STEP = 0.25;
/** A scale this close to `MIN_ZOOM` is fit: float residue from stepping in and out must not keep zoom-out enabled. */
const FIT_EPSILON = 1e-6;
/** Where a double-click at fit zooms to. */
export const DOUBLE_CLICK_ZOOM = 2;
/** Wheel sensitivity: a 100 px mouse notch zooms by e^0.15 ≈ 1.16×; trackpad deltas give finer steps. */
const WHEEL_RATE = 0.0015;
const LINE_PX = 16;
const PAGE_PX = 800;

/** Scale and pan (px, from the centre of the photo's box) of the zoomed photo. */
export interface ZoomView {
    scale: number;
    x: number;
    y: number;
}

/** The photo's displayed (untransformed) size. */
export interface ZoomBox {
    width: number;
    height: number;
}

export const FIT: ZoomView = { scale: MIN_ZOOM, x: 0, y: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Clamps a scale to 1–4×, snapping to exactly `MIN_ZOOM` within `FIT_EPSILON` of it. */
const clampScale = (scale: number) => {
    const s = clamp(scale, MIN_ZOOM, MAX_ZOOM);
    return s - MIN_ZOOM < FIT_EPSILON ? MIN_ZOOM : s;
};

/**
 * Clamps the scale to 1–4× and the pan so the zoomed photo always covers its own box: it can
 * never be dragged (or zoomed) off-screen, and at fit it sits centred.
 */
export function clampView(view: ZoomView, box: ZoomBox): ZoomView {
    const scale = clampScale(view.scale);
    const maxX = (box.width * (scale - 1)) / 2;
    const maxY = (box.height * (scale - 1)) / 2;
    // `+ 0` turns a clamped -0 into 0.
    return { scale, x: clamp(view.x, -maxX, maxX) + 0, y: clamp(view.y, -maxY, maxY) + 0 };
}

/**
 * Zooms to `scale` around `point` (px from the centre of the photo's box), keeping the photo
 * point under it in place, then clamps.
 */
export function zoomAt(view: ZoomView, scale: number, point: { x: number; y: number }, box: ZoomBox): ZoomView {
    const next = clampScale(scale);
    const ratio = next / view.scale;
    return clampView({ scale: next, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio }, box);
}

/** The scale after one wheel event (`deltaMode` 0 px, 1 lines, 2 pages); wheel up zooms in. */
export function wheelZoom(scale: number, deltaY: number, deltaMode: number): number {
    const px = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * PAGE_PX : deltaY;
    return clampScale(scale * Math.exp(-px * WHEEL_RATE));
}

interface Drag {
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
}

/**
 * Zoom and pan for a photo in a viewer. Two consumers share it: the dark viewer
 * (`MediaViewerModal` in `PhotoDetailModal.tsx`) and the media gallery's own detail view
 * (`MediaGalleryModal`, photos only).
 *
 * `stageRef` is the box the photo is laid out in (its rect is the photo's untransformed box);
 * the wheel listener goes on the whole viewer frame around it (`[role="dialog"]`), non-passive,
 * and calls `preventDefault` so the wheel never scrolls the page behind. Drag pans only when
 * zoomed and uses pointer capture, so the pan follows the pointer even off the photo; losing
 * the capture (for any reason) ends the drag. The view resets to fit whenever `resetKey`
 * changes (a new item). Disabled (video, voice, or the viewer closed), the wheel listener is
 * removed and the view stays at fit.
 */
export function useZoomPan(stageRef: React.RefObject<HTMLElement | null>, enabled: boolean, resetKey: unknown) {
    const [view, setView] = useState<ZoomView>(FIT);
    const [dragging, setDragging] = useState(false);
    const drag = useRef<Drag | null>(null);

    // A layout effect: the reset lands before paint, so a new item never shows at the old zoom.
    useLayoutEffect(() => {
        setView(FIT);
        setDragging(false);
        drag.current = null;
    }, [resetKey]);

    /** The photo's box and a client point relative to its centre. */
    const measure = useCallback((clientX?: number, clientY?: number) => {
        const r = stageRef.current?.getBoundingClientRect();
        const box: ZoomBox = { width: r?.width ?? 0, height: r?.height ?? 0 };
        const point = r && clientX !== undefined && clientY !== undefined
            ? { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) }
            : { x: 0, y: 0 };
        return { box, point };
    }, [stageRef]);

    useEffect(() => {
        const frame = stageRef.current?.closest<HTMLElement>('[role="dialog"]') ?? stageRef.current;
        if (!enabled || !frame) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const { box, point } = measure(e.clientX, e.clientY);
            setView(v => zoomAt(v, wheelZoom(v.scale, e.deltaY, e.deltaMode), point, box));
        };
        frame.addEventListener('wheel', onWheel, { passive: false });
        return () => frame.removeEventListener('wheel', onWheel);
    }, [enabled, measure, stageRef]);

    /** One step in (+1) or out (−1) around the centre (↑ / ↓, − / +). */
    const step = useCallback((direction: 1 | -1) => {
        const { box, point } = measure();
        setView(v => zoomAt(v, v.scale + direction * ZOOM_STEP, point, box));
    }, [measure]);

    const reset = useCallback(() => setView(FIT), []);

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
        if (!enabled || e.button !== 0 || view.scale <= MIN_ZOOM) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, originX: view.x, originY: view.y };
        setDragging(true);
    }, [enabled, view]);

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId) return;
        const { box } = measure();
        setView(v => clampView({ ...v, x: d.originX + e.clientX - d.startX, y: d.originY + e.clientY - d.startY }, box));
    }, [measure]);

    const endDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId) return;
        drag.current = null;
        setDragging(false);
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    }, []);

    /** Fit → 2× at the click point; zoomed → back to fit. */
    const onDoubleClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
        if (!enabled) return;
        const { box, point } = measure(e.clientX, e.clientY);
        setView(v => (v.scale > MIN_ZOOM ? FIT : zoomAt(v, DOUBLE_CLICK_ZOOM, point, box)));
    }, [enabled, measure]);

    return {
        view,
        dragging,
        step,
        reset,
        stageHandlers: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag, onDoubleClick },
    };
}
