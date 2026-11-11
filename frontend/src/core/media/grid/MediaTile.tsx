import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Film, ImageOff, RotateCw } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { useDevicePixelRatio } from '../../../hooks/useDevicePixelRatio';
import { thumbnailUrl, thumbWidthFor, type ThumbWidth } from '../../../features/messages/mediaUrl';
import { IconButton } from '../../../design/primitives/Button';
import { Skeleton, SKELETON_PULSE } from '../../../design/primitives/Skeleton';
import { Spinner } from '../../../design/primitives/Spinner';
import { useDelayedLoading } from '../../../design/loading';
import { motion } from '../../../design/tokens';
import { invalidateMediaMeta, isMediaRouteUrl, readMediaMeta, useMediaMeta, type MediaMeta } from './mediaMeta';
import { forgetImage, isImageReady, scheduleImage, type LoadPriority, type LoadTicket } from './loadScheduler';
import { useTileVisibilityState } from './useTileVisibility';
import { posterCapture } from './posterCapture';
import { MediaGridContext } from './gridContext';

export interface MediaTileProps {
    /** The media-route URL (`/api/content/media/...`); other URLs load as they are. */
    url: string | null | undefined;
    kind: 'picture' | 'video';
    /** The tile's drawn edge in CSS px: picks the thumbnail width (`thumbWidthFor`). */
    cssPx: number;
    /** ★ items and album covers: allow the 640 px thumbnail (others stop at the pre-generated 480). */
    large?: boolean;
    /** Size, radius and position (the tile fills it). */
    className?: string;
    /** A plain `<img loading="eager">` at once: no scheduler, no meta wait (the recap poster export). */
    eager?: boolean;
    /** Capture a missing video poster in the browser while the tile is visible (default true). */
    capturePoster?: boolean;
    /**
     * The picture could not load at all (thumbnail and full file failed). It receives `retry`,
     * which starts the fallback chain again: a gallery that wraps tiles in its own button keeps
     * it and calls it when a failed tile is clicked (instead of opening the viewer). Called once
     * per failure; `retry` stays valid for the tile's life.
     */
    onFail?: (retry: () => void) => void;
    /**
     * Show a Retry button on a failed tile. Off by default: galleries wrap each tile in their own
     * button, and a button inside a button is invalid. A failed tile always retries by itself
     * when it scrolls back into view (at most `AUTO_RETRY_MAX` times per mount).
     */
    retryButton?: boolean;
    /**
     * Called with the tile's state (`loading | ready | failed | film`, the same as its
     * `data-state`) whenever it changes, including an automatic retry. A gallery button uses it to
     * name a failed tile by what its click does (retry).
     */
    onStateChange?: (state: MediaTileState) => void;
    testId?: string;
}

/** A tile's state, as on its `data-state`. */
export type MediaTileState = 'loading' | 'ready' | 'failed' | 'film';

/** A video must stay visible this long before its poster is captured (skips fast scrolling). */
export const CAPTURE_DWELL_MS = 300;
/** Automatic retries of a failed tile when it scrolls back into view, per mount. */
export const AUTO_RETRY_MAX = 2;
/**
 * On a first open a tile whose meta is not known yet waits at most this long for the batch
 * (16 ms flush + one local round trip), so its first request already carries `v` and lands in the
 * year-long immutable cache. The placeholder shows meanwhile; a late or failed batch falls back
 * to the plain thumbnail.
 */
export const META_WAIT_MS = 150;

type Phase = MediaTileState;

/** Report each state change to `onStateChange`. */
function useReportState(phase: Phase, onStateChange: ((state: MediaTileState) => void) | undefined): void {
    useEffect(() => { onStateChange?.(phase); }, [phase, onStateChange]);
}

function nextFrame(cb: () => void): () => void {
    if (typeof requestAnimationFrame === 'function') {
        const id = requestAnimationFrame(cb);
        return () => cancelAnimationFrame(id);
    }
    const id = setTimeout(cb, 16);
    return () => clearTimeout(id);
}

/**
 * The sources to try, best first: `?v` → no `v` → (pictures) the full file. A video is only ever
 * loaded through the thumbnail route (its poster), never as a file in an image.
 */
function candidates(url: string, kind: MediaTileProps['kind'], width: ThumbWidth, meta: MediaMeta | null | undefined): string[] {
    const plain = thumbnailUrl(url, width) as string;
    const list: string[] = [];
    if (kind === 'video') {
        if (!isMediaRouteUrl(url)) return list;
        if (meta === undefined || meta === null) list.push(plain);
        else if (meta.poster) list.push(thumbnailUrl(url, width, meta.v) as string, plain);
    } else {
        if (meta) list.push(thumbnailUrl(url, width, meta.v) as string);
        list.push(plain, url);
    }
    return [...new Set(list)];
}

const FILL = 'absolute inset-0 h-full w-full';

const FilmTile: React.FC = () => (
    <span aria-hidden="true" data-testid="media-tile-film" className={cn(FILL, 'flex items-center justify-center bg-sunken text-muted')}>
        <Film className="h-6 w-6" />
    </span>
);

const FailedTile: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => {
    const { t } = useTranslation();
    return (
        <span className={cn(FILL, 'flex flex-col items-center justify-center gap-1 bg-sunken p-2 text-center text-muted')}>
            <ImageOff aria-hidden="true" className="h-5 w-5" />
            <span className="text-caption">{t('loading.error')}</span>
            {onRetry && (
                <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={t('loading.retry')}
                    icon={<RotateCw className="h-4 w-4" />}
                    onClick={(e) => { e.stopPropagation(); onRetry(); }}
                />
            )}
        </span>
    );
};

/** The placeholder: the mean colour (data-driven `style`) or the sunken tone, pulsing, with the blur preview on top. */
const Placeholder: React.FC<{ meta: MediaMeta | null | undefined }> = ({ meta }) => {
    const color = meta?.color ?? undefined;
    return (
        <>
            <Skeleton
                shape="tile"
                tone={color ? 'data' : 'sunken'}
                style={color ? { backgroundColor: color } : undefined}
                className={cn(FILL, 'rounded-none')}
            />
            {meta?.blur && (
                <img
                    aria-hidden="true"
                    alt=""
                    src={meta.blur}
                    draggable={false}
                    className={cn(FILL, 'blur-placeholder scale-110 object-cover', SKELETON_PULSE)}
                />
            )}
        </>
    );
};

/** Under reduced motion the pulse stops, so a tile still waiting after `reveal` shows a compact spinner. */
const ReducedMotionSpinner: React.FC<{ waiting: boolean }> = ({ waiting }) => {
    const shown = useDelayedLoading(waiting);
    if (!shown) return null;
    return (
        <span className={cn(FILL, 'pointer-events-none flex items-center justify-center')}>
            <span className="hidden motion-reduce:inline-flex">
                <Spinner size="sm" tone="muted" labelVisibility="compact" />
            </span>
        </span>
    );
};

interface InnerProps extends Omit<MediaTileProps, 'cssPx' | 'large'> {
    width: ThumbWidth;
}

/**
 * The eager variant: a plain `<img>` at once with the same fallbacks (no scheduler, no meta wait).
 * Meta the store already holds supplies `v` (the year-long cached variant); nothing is fetched for
 * it. A failed eager tile is a plain sunken box with no caption: eager tiles are decorative stills
 * (a recap slide's wall) or baked into an exported image, where an error line would be read as content.
 */
const EagerTile: React.FC<InnerProps> = ({ url, kind, width, className, onFail, onStateChange, testId }) => {
    const [meta] = useState(() => (url ? readMediaMeta(url) : undefined));
    const [tried, setTried] = useState<readonly string[]>([]);
    const failCalled = useRef(false);
    const retry = useCallback(() => {
        failCalled.current = false;
        setTried([]);
    }, []);
    const list = url ? candidates(url, kind, width, meta ?? null) : [];
    const src = list.find((c) => !tried.includes(c));
    const phase: Phase = src ? 'ready' : kind === 'video' ? 'film' : 'failed';
    useReportState(phase, onStateChange);
    useEffect(() => {
        if (phase !== 'failed' || failCalled.current) return;
        failCalled.current = true;
        onFail?.(retry);
    }, [phase, onFail, retry]);
    return (
        <div data-testid={testId} data-state={phase} className={cn('relative overflow-hidden', className)}>
            {phase === 'film' && <FilmTile />}
            {phase === 'failed' && <span aria-hidden="true" data-media-tile-failed="" className={cn(FILL, 'bg-sunken')} />}
            {src && (
                <img
                    data-media-tile-image=""
                    src={src}
                    alt=""
                    draggable={false}
                    loading="eager"
                    decoding="async"
                    onError={() => setTried((t) => [...t, src])}
                    className={cn(FILL, 'object-cover')}
                />
            )}
        </div>
    );
};

/** The best source to load now: one already decoded this session wins (no request at all), else the first untried. */
function pick(list: readonly string[], tried: readonly string[], allowNew: boolean): string | undefined {
    const untried = list.filter((c) => !tried.includes(c));
    return untried.find(isImageReady) ?? (allowNew ? untried[0] : undefined);
}

const ScheduledTile: React.FC<InnerProps> = ({ url, kind, width, className, capturePoster = true, onFail, retryButton = false, onStateChange, testId }) => {
    const meta = useMediaMeta(url);
    const ref = useRef<HTMLDivElement>(null);
    const reporter = useContext(MediaGridContext);
    const { priority: visibility, known: visibilityKnown } = useTileVisibilityState(ref, reporter?.root ?? null);
    const priorityRef = useRef<LoadPriority>(visibility);
    priorityRef.current = visibility;
    const ticketRef = useRef<LoadTicket | null>(null);

    const list = url ? candidates(url, kind, width, meta) : [];
    // A source decoded earlier this session (the plain one from a first open, or `?v`) shows at
    // once, without a placeholder or a fade: re-mounts and reopens are instant.
    const [initialReady] = useState(() => list.find(isImageReady) ?? null);
    const [metaWaitOver, setMetaWaitOver] = useState(meta !== undefined);
    const [tried, setTried] = useState<readonly string[]>([]);
    const [loadingSrc, setLoadingSrc] = useState<string | null>(null);
    const [readySrc, setReadySrc] = useState<string | null>(initialReady);
    const [shown, setShown] = useState(initialReady !== null);
    const [placeholderGone, setPlaceholderGone] = useState(initialReady !== null);
    const [capture, setCapture] = useState<'idle' | 'done'>('idle');

    const waitingForMeta = meta === undefined && !metaWaitOver;
    // Nothing new starts before the meta batch (bounded) and the first visibility report; a
    // source already decoded needs neither.
    const next = pick(list, tried, !waitingForMeta && visibilityKnown);
    // Something is left to try (it starts once the gates above open).
    const pending = list.some((c) => !tried.includes(c));
    let phase: Phase;
    if (readySrc) phase = 'ready';
    else if (loadingSrc || pending) phase = 'loading';
    else phase = kind === 'video' ? 'film' : 'failed';

    // Wait a bounded moment for the meta batch, so the first request carries `v`.
    useEffect(() => {
        if (metaWaitOver) return undefined;
        const timer = setTimeout(() => setMetaWaitOver(true), META_WAIT_MS);
        return () => clearTimeout(timer);
    }, [metaWaitOver]);

    // Pick the next source once the previous one settled (a load in flight is never switched).
    useEffect(() => {
        if (!readySrc && !loadingSrc && next) setLoadingSrc(next);
    }, [readySrc, loadingSrc, next]);

    useEffect(() => {
        if (!loadingSrc) return undefined;
        const src = loadingSrc;
        const ticket = scheduleImage(
            src,
            priorityRef.current,
            () => { setReadySrc(src); setLoadingSrc(null); },
            () => { setTried((t) => [...t, src]); setLoadingSrc(null); },
        );
        ticketRef.current = ticket;
        return () => {
            ticket.cancel();
            ticketRef.current = null;
        };
    }, [loadingSrc]);

    useEffect(() => {
        ticketRef.current?.setPriority(visibility);
    }, [visibility]);

    // Fade in: mount at opacity 0, flip to 100 on the next frame; drop the placeholder after the fade.
    useEffect(() => {
        if (!readySrc || shown) return undefined;
        return nextFrame(() => setShown(true));
    }, [readySrc, shown]);
    useEffect(() => {
        if (!shown || placeholderGone) return undefined;
        const timer = setTimeout(() => setPlaceholderGone(true), motion.duration.base);
        return () => clearTimeout(timer);
    }, [shown, placeholderGone]);

    const failCalled = useRef(false);
    const retry = useCallback(() => {
        failCalled.current = false;
        setTried([]);
    }, []);

    useReportState(phase, onStateChange);

    // onFail once per failure, with the retry handle.
    useEffect(() => {
        if (phase !== 'failed' || failCalled.current) return;
        failCalled.current = true;
        onFail?.(retry);
    }, [phase, onFail, retry]);

    // A failed tile retries by itself when it scrolls back into view.
    const prevVisibility = useRef(visibility);
    const autoRetries = useRef(0);
    useEffect(() => {
        const was = prevVisibility.current;
        prevVisibility.current = visibility;
        if (phase === 'failed' && was === 'near' && visibility === 'visible' && autoRetries.current < AUTO_RETRY_MAX) {
            autoRetries.current += 1;
            retry();
        }
    }, [visibility, phase, retry]);

    // Video without a poster: capture one in the browser once the tile has been visible a moment.
    // Leaving the screen or unmounting aborts it at any stage (queued, waiting for a slot, running).
    const canCapture = kind === 'video' && phase === 'film' && capturePoster && isMediaRouteUrl(url) && capture === 'idle' && visibility === 'visible';
    useEffect(() => {
        if (!canCapture || !url) return undefined;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            posterCapture.request(url, controller.signal).then((ok) => {
                if (ok) {
                    setTried([]);
                    invalidateMediaMeta(url);
                } else if (!controller.signal.aborted) {
                    setCapture('done');
                }
            }, () => setCapture('done'));
        }, CAPTURE_DWELL_MS);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [canCapture, url]);

    // The grid's first-paint breadcrumb: visible tiles, and the first visible ready image.
    useEffect(() => {
        if (!reporter || visibility !== 'visible') return undefined;
        reporter.tileVisible(1);
        return () => reporter.tileVisible(-1);
    }, [reporter, visibility]);
    const reported = useRef(false);
    useEffect(() => {
        if (!reporter || reported.current || phase !== 'ready' || visibility !== 'visible') return;
        reported.current = true;
        reporter.tileReady();
    }, [reporter, phase, visibility]);

    return (
        <div ref={ref} data-testid={testId} data-state={phase} className={cn('relative overflow-hidden', className)}>
            {phase === 'film' && <FilmTile />}
            {phase === 'failed' && <FailedTile onRetry={retryButton && url ? retry : undefined} />}
            {(phase === 'loading' || (phase === 'ready' && !placeholderGone)) && <Placeholder meta={meta} />}
            {readySrc && (
                <img
                    data-media-tile-image=""
                    src={readySrc}
                    alt=""
                    draggable={false}
                    decoding="async"
                    onError={() => {
                        forgetImage(readySrc);
                        setTried((t) => [...t, readySrc]);
                        setReadySrc(null);
                        setShown(false);
                        setPlaceholderGone(false);
                    }}
                    className={cn(
                        FILL,
                        'object-cover transition-opacity duration-base ease-standard motion-reduce:transition-none',
                        shown ? 'opacity-100' : 'opacity-0',
                    )}
                />
            )}
            <ReducedMotionSpinner waiting={phase === 'loading'} />
        </div>
    );
};

/**
 * One media grid tile (the media pipeline's shared tile): the placeholder (mean colour and blur,
 * pulsing; a compact spinner under reduced motion), then the thumbnail fading in, or a video's
 * poster. Thumbnails load through the priority scheduler (visible first, at most four in flight)
 * at `thumbWidthFor(cssPx, dpr)` with the content version `v` from the meta store. A source already
 * decoded this session (plain or `?v`) shows at once with no request; otherwise a first open waits
 * at most `META_WAIT_MS` for the meta batch (then loads the plain thumbnail) and for the tile's
 * first visibility report, so visible tiles take the slots first. Fallbacks: picture `?v` → no `v` →
 * full file → `onFail(retry)` and a quiet failed state; video poster `?v` → no `v` → a client capture
 * while visible (even when meta said a poster exists: it may have been evicted) → the film tile. A
 * video never mounts a `<video>` here. Decorative (`alt=""`): callers label their own button.
 * The tile fills its box: give it a size (e.g. `aspect-square w-full`) through `className`.
 */
export const MediaTile: React.FC<MediaTileProps> = ({ cssPx, large = false, eager = false, ...rest }) => {
    const dpr = useDevicePixelRatio();
    const width = thumbWidthFor(cssPx, dpr, { large });
    const key = `${rest.url ?? ''}|${width}|${rest.kind}`;
    return eager ? <EagerTile key={key} width={width} {...rest} /> : <ScheduledTile key={key} width={width} {...rest} />;
};
