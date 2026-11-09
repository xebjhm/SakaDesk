import { useSyncExternalStore } from 'react';
import { clientLog } from '../utils/clientLog';

/**
 * The window's device pixel ratio (1 when unknown), kept current when it
 * changes: the window moves to a monitor with another display scale, or the
 * page zoom changes.
 *
 * All users share one `matchMedia('(resolution: <ratio>dppx)')` watcher, made
 * for the current ratio and replaced after each change (it only fires on
 * leaving that ratio). Each change logs one `display_density_change`
 * breadcrumb with the new ratio in percent (`dppx_pct`). Without `matchMedia`
 * the ratio is read once per render and never watched.
 */
export function useDevicePixelRatio(): number {
    return useSyncExternalStore(subscribe, readRatio, readRatio);
}

function readRatio(): number {
    const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

const listeners = new Set<() => void>();
let watched: MediaQueryList | null = null;

function onRatioChange() {
    unwatch();
    clientLog('display_density_change', { dppx_pct: Math.round(readRatio() * 100) });
    watch();
    listeners.forEach(fn => fn());
}

function watch() {
    if (typeof window.matchMedia !== 'function') return;
    watched = window.matchMedia(`(resolution: ${readRatio()}dppx)`);
    watched.addEventListener('change', onRatioChange);
}

function unwatch() {
    watched?.removeEventListener('change', onRatioChange);
    watched = null;
}

function subscribe(fn: () => void): () => void {
    listeners.add(fn);
    if (listeners.size === 1) watch();
    return () => {
        listeners.delete(fn);
        if (listeners.size === 0) unwatch();
    };
}
