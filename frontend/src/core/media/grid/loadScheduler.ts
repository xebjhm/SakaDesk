/**
 * The priority load scheduler of the media pipeline (0.5.0): every grid thumbnail (and every
 * client poster capture) waits here for one of `MAX_IMAGE_INFLIGHT` slots.
 *
 * - **Bounded.** WebView2 allows six connections per host; keeping at most four thumbnail loads in
 *   flight leaves room for voices, video and API polls.
 * - **Visible first.** Two FIFO queues, `visible` then `near` (mounted within the grid's overscan
 *   but off screen). `setPriority` moves a waiting job between them; `cancel` drops a waiting job,
 *   or aborts a running one (`img.src = ''`) and frees its slot at once.
 * - **Decoded off the main thread.** An image job is `new Image()`, `decoding = 'async'`, `src`,
 *   then `decode()`; a rejected `decode()` falls back to the `load` / `error` result.
 * - **Instant second open.** A src decoded once this session is remembered (an LRU of
 *   `READY_CACHE_MAX`); scheduling it again calls `onReady` synchronously, without a slot.
 */

export type LoadPriority = 'visible' | 'near';

/** Thumbnail loads in flight at once (WebView2 has 6 connections per host). */
export const MAX_IMAGE_INFLIGHT = 4;
/** Srcs remembered as decoded this session (they skip the queue). */
export const READY_CACHE_MAX = 3_000;

export interface LoadTicket {
    /** Move a waiting job to the other queue (no effect once it runs). */
    setPriority(p: LoadPriority): void;
    /** Drop a waiting job, or abort a running one; its callbacks never fire afterwards. */
    cancel(): void;
}

interface Job {
    priority: LoadPriority;
    state: 'queued' | 'running' | 'done';
    /** Start the work; call `done` exactly once when it settles. Returns the abort action. */
    start(done: () => void): () => void;
    abort: (() => void) | null;
}

const queues: Record<LoadPriority, Job[]> = { visible: [], near: [] };
let running = 0;
const ready = new Map<string, true>();
let readyMax = READY_CACHE_MAX;

const NOOP_TICKET: LoadTicket = { setPriority: () => {}, cancel: () => {} };

/** Whether `src` was decoded earlier this session (a tile can then show it without a fade). */
export function isImageReady(src: string): boolean {
    return ready.has(src);
}

/** Forget `src` (its rendered `<img>` failed after all): the next schedule loads it again. */
export function forgetImage(src: string): void {
    ready.delete(src);
}

function remember(src: string): void {
    ready.delete(src);
    ready.set(src, true);
    while (ready.size > readyMax) {
        const oldest = ready.keys().next().value as string;
        ready.delete(oldest);
    }
}

function remove(job: Job): void {
    const queue = queues[job.priority];
    const at = queue.indexOf(job);
    if (at >= 0) queue.splice(at, 1);
}

function pump(): void {
    while (running < MAX_IMAGE_INFLIGHT) {
        const job = queues.visible.shift() ?? queues.near.shift();
        if (!job) return;
        run(job);
    }
}

function run(job: Job): void {
    job.state = 'running';
    running += 1;
    job.abort = job.start(() => {
        if (job.state !== 'running') return;
        job.state = 'done';
        running -= 1;
        pump();
    });
}

function enqueue(job: Job): LoadTicket {
    queues[job.priority].push(job);
    pump();
    return {
        setPriority(p) {
            if (job.state !== 'queued' || job.priority === p) return;
            remove(job);
            job.priority = p;
            queues[p].push(job);
        },
        cancel() {
            if (job.state === 'queued') {
                remove(job);
                job.state = 'done';
                return;
            }
            if (job.state !== 'running') return;
            job.state = 'done';
            running -= 1;
            job.abort?.();
            pump();
        },
    };
}

/**
 * Load and decode `src` in a slot; `onReady` / `onError` fire once (never after `cancel`). A src
 * decoded earlier this session calls `onReady` synchronously and takes no slot.
 */
export function scheduleImage(src: string, priority: LoadPriority, onReady: () => void, onError: () => void): LoadTicket {
    if (ready.has(src)) {
        remember(src);
        onReady();
        return NOOP_TICKET;
    }
    let cancelled = false;
    const job: Job = {
        priority,
        state: 'queued',
        abort: null,
        start(done) {
            const img = new Image();
            img.decoding = 'async';
            let settled = false;
            let decodeFailed = false;
            let loadResult: boolean | null = null;
            const finish = (ok: boolean) => {
                if (settled) return;
                settled = true;
                done();
                if (cancelled) return;
                if (ok) {
                    remember(src);
                    onReady();
                } else {
                    onError();
                }
            };
            img.onload = () => {
                loadResult = true;
                if (decodeFailed || typeof img.decode !== 'function') finish(true);
            };
            img.onerror = () => {
                loadResult = false;
                if (decodeFailed || typeof img.decode !== 'function') finish(false);
            };
            img.src = src;
            if (typeof img.decode === 'function') {
                img.decode().then(
                    () => finish(true),
                    () => {
                        decodeFailed = true;
                        if (loadResult !== null) finish(loadResult);
                    },
                );
            }
            return () => {
                cancelled = true;
                settled = true;
                img.onload = null;
                img.onerror = null;
                img.src = '';
            };
        },
    };
    return enqueue(job);
}

/**
 * Run `task` in a slot (the client poster capture shares the thumbnails' connection budget). The
 * slot frees when its promise settles; `cancel` drops a waiting task (a running one keeps its slot
 * until it settles, then is ignored).
 */
export function scheduleTask(priority: LoadPriority, task: () => Promise<unknown>): LoadTicket {
    const job: Job = {
        priority,
        state: 'queued',
        abort: null,
        start(done) {
            let promise: Promise<unknown>;
            try {
                promise = task();
            } catch (err) {
                promise = Promise.reject(err);
            }
            promise.then(done, done);
            return () => {};
        },
    };
    const ticket = enqueue(job);
    return {
        setPriority: ticket.setPriority,
        cancel() {
            if (job.state === 'queued') ticket.cancel();
        },
    };
}

/** Test hook: empty the queues, the slots and the ready memory. */
export function resetLoadSchedulerForTests(): void {
    queues.visible.length = 0;
    queues.near.length = 0;
    running = 0;
    ready.clear();
    readyMax = READY_CACHE_MAX;
}

/** Test hook: a small ready memory. */
export function setReadyCacheMaxForTests(max: number): void {
    readyMax = max;
}
