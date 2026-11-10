/**
 * A recording stand-in for a 2D canvas context (jsdom has none): every method call and
 * property write is appended to `log`, so a test can hash a frame or inspect what was drawn.
 */
export type LogEntry = [string, ...unknown[]];

export interface RecordingCanvas {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    log: LogEntry[];
}

/** What a gradient fill logs as. */
export const GRADIENT = '<gradient>';

let nextId = 1;
const ids = new WeakMap<object, string>();

/** A stable printable id for an object argument (an image or a canvas). */
export function objectId(o: object): string {
    let id = ids.get(o);
    if (!id) {
        id = `obj${nextId++}`;
        ids.set(o, id);
    }
    return id;
}

export interface RecordingOptions {
    /** False: the context ignores `filter` writes (reads stay `none`), like a webview without it. */
    filter?: boolean;
}

export function recordingCanvas(width = 540, height = 960, opts: RecordingOptions = {}): RecordingCanvas {
    const log: LogEntry[] = [];
    const state: Record<string, unknown> = { font: '10px sans-serif', globalAlpha: 1, filter: 'none' };
    const canvas = { width, height } as unknown as HTMLCanvasElement;
    const gradient = (kind: string) => (...args: unknown[]) => {
        log.push([kind, ...args]);
        return { __gradient: kind, addColorStop: (...a: unknown[]) => log.push(['addColorStop', ...a]) };
    };
    const target: Record<string, unknown> = {
        canvas,
        measureText: (text: string) => {
            const size = Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10);
            return { width: Array.from(text).length * size };
        },
        createLinearGradient: gradient('createLinearGradient'),
        createRadialGradient: gradient('createRadialGradient'),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    };
    const ctx = new Proxy(target, {
        get(t, prop: string) {
            if (prop in t) return t[prop];
            if (prop in state) return state[prop];
            return (...args: unknown[]) => {
                if (prop === 'drawImage') {
                    // The source logs as a marker (a new layer per renderer must hash the same) and is
                    // kept raw at the end for inspection.
                    log.push([prop, '<image>', ...args.slice(1), { source: args[0] }]);
                    return;
                }
                log.push([prop, ...args.map((a) => (typeof a === 'object' && a !== null && !Array.isArray(a) ? objectId(a) : a))]);
            };
        },
        set(_t, prop: string, value: unknown) {
            if (!(prop === 'filter' && opts.filter === false)) state[prop] = value;
            // Gradients log as a marker (their stops are logged by addColorStop), so frames compare equal.
            const shown = typeof value === 'object' && value !== null
                ? ('__gradient' in value ? GRADIENT : objectId(value))
                : value;
            log.push([`set:${prop}`, shown]);
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;
    (canvas as unknown as { getContext: () => CanvasRenderingContext2D }).getContext = () => ctx;
    return { canvas, ctx, log };
}

/** A canvas factory whose canvases record; `made` keeps each one. */
export function recordingEnv(opts: RecordingOptions = {}) {
    const made: RecordingCanvas[] = [];
    return {
        made,
        env: {
            createCanvas(width: number, height: number) {
                const rc = recordingCanvas(width, height, opts);
                made.push(rc);
                return rc.canvas;
            },
        },
    };
}

/** A deterministic digest of a log (drawImage sources reduced to their ids). */
export function hashLog(log: LogEntry[]): string {
    const text = JSON.stringify(log.map((e) => e.map((a) => (typeof a === 'object' && a !== null && 'source' in a ? 'src' : a))));
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return `${(h >>> 0).toString(16)}:${text.length}`;
}

/** The raw sources of every drawImage call in a log. */
export function drawnSources(log: LogEntry[]): unknown[] {
    return log.filter((e) => e[0] === 'drawImage').map((e) => (e[e.length - 1] as { source: unknown }).source);
}

/** The `filter` in effect at each entry of a log (replaying its `set:filter` writes). */
export function filterAt(log: LogEntry[], index: number): string {
    let f = 'none';
    for (let i = 0; i < index; i++) if (log[i][0] === 'set:filter') f = String(log[i][1]);
    return f;
}

/** Every string written to the canvas with fillText / strokeText. */
export function drawnText(log: LogEntry[]): string[] {
    return log.filter((e) => e[0] === 'fillText' || e[0] === 'strokeText').map((e) => String(e[1]));
}
