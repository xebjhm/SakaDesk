import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Film, Image as ImageIcon, Share2, Sparkles } from 'lucide-react';
import { useTranslation } from '../../../../i18n';
import { Button, Modal, Pill, Switch } from '../../../../design/primitives';
import { cn } from '../../../../utils/classnames';
import { logRecapShare } from '../../memoriesLog';
import type { RecapPayload } from '../api';
import { canvasToPng, SaveError } from '../posterImage';
import { safeMemberId } from '../posterCopy';
import { NARRATION_CLASS } from '../../shared/typeRoles';
import {
    buildShareModel, defaultShareOptions, displaySentence, MAX_SENTENCES, sentenceCandidates, yearsAvailable,
    type ShareOptions, type ShareStyle,
} from './shareModel';
import { readShareFonts, readSharePalette, SHARE_HEIGHT, SHARE_WIDTH, ShareRenderer } from './ShareRenderer';
import { loadShareAssets, type ShareAssets } from './sharePhotos';
import {
    ensureShareFonts, GIF_FPS, postShareGif, recordVideo, renderGifFrames, saveShareBlob, shareFilename, ShareSaveError,
    throwIfCancelled, videoSupport, type FontFallback,
} from './shareExport';

export interface ShareDialogProps {
    isOpen: boolean;
    recap: RecapPayload;
    /** The fan's resolved nickname; it reaches the export only when the fan turns it on. */
    nickname: string;
    onClose: () => void;
}

type ExportChoice = 'gif' | 'video' | 'png';
type Phase = 'idle' | 'frames' | 'assemble' | 'record' | 'handed_off' | 'failed' | 'cancelled';
type FailReason = 'render_failed' | 'encode_failed' | 'record_failed' | 'write_failed' | 'cancelled';
/** Why the fan's chosen avatar file was refused (a log code and a message key). */
export type AvatarError = 'not_image' | 'too_large' | 'load_failed';

/** Largest avatar file the dialog reads (it is decoded in full). */
export const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

/** The PNG is drawn at 2× (1080 × 1920); the video at 1.5× (810 × 1440) to keep real-time recording smooth. */
const PNG_SCALE = 2;
const VIDEO_SCALE = 1.5;
/** The preview draws the poster at half the logical size. */
const PREVIEW_SCALE = 0.5;
const NO_ASSETS: ShareAssets = { photos: [], months: [], skipped: 0 };
const STYLES: ShareStyle[] = ['collage', 'colour'];

function makeCanvas(width: number, height: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.round(width);
    c.height = Math.round(height);
    return c;
}

class AvatarFileError extends Error {
    constructor(readonly code: AvatarError) {
        super(code);
        this.name = 'AvatarFileError';
    }
}

/**
 * Reads the fan's chosen image file (their own avatar). Rejects a file whose MIME type is not an
 * image (`not_image`) or that is over {@link MAX_AVATAR_BYTES} (`too_large`) before decoding it,
 * and one that does not decode (`load_failed`).
 */
async function readImageFile(file: File): Promise<CanvasImageSource> {
    if (!file.type.startsWith('image/')) throw new AvatarFileError('not_image');
    if (file.size > MAX_AVATAR_BYTES) throw new AvatarFileError('too_large');
    try {
        if (typeof createImageBitmap === 'function') return await createImageBitmap(file);
        const url = URL.createObjectURL(file);
        try {
            return await new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('image_load_failed'));
                img.src = url;
            });
        } finally {
            URL.revokeObjectURL(url);
        }
    } catch {
        throw new AvatarFileError('load_failed');
    }
}

/** A labelled switch row (the label is visible text; the switch carries the same name). */
const ToggleRow: React.FC<{ label: string; checked: boolean; onChange: (next: boolean) => void; children?: React.ReactNode }> = ({ label, checked, onChange, children }) => (
    <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
            <span aria-hidden="true" className="text-small text-primary">{label}</span>
            <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
        </div>
        {children}
    </div>
);

/**
 * The recap's share export (spec §9.5): a GIF (≈8 s), a WebM/MP4 (≈12 s, only where the webview
 * can record a canvas) and a share-version poster PNG. Every photo is frosted, her words are at
 * most two sentences the fan chooses, and the fan's identity (nickname, own avatar, "N年目") is
 * opt-in, off by default; the nickname is masked 『＊＊＊』 while off. The "SakaDesk" footer is on
 * by default. Files go through the local export handoff (the webview's save dialog); the copy
 * says the export started, never that it was saved. No voice and no music are exported.
 *
 * An export is cancellable: Cancel, closing the dialog (or the poster, which unmounts it) and
 * reopening it abort the running export's `AbortController`. That stops drawing and recording,
 * stops the stream tracks and aborts the upload; an aborted export never opens a download.
 */
export const ShareDialog: React.FC<ShareDialogProps> = ({ isOpen, recap, nickname, onClose }) => {
    const { t, i18n } = useTranslation();
    const memberId = safeMemberId(recap.member.id);
    const candidates = useMemo(() => sentenceCandidates(recap), [recap]);
    const [options, setOptions] = useState<ShareOptions>(() => defaultShareOptions(recap));
    const [assets, setAssets] = useState<ShareAssets | null>(null);
    const [avatar, setAvatar] = useState<CanvasImageSource | null>(null);
    const [busy, setBusy] = useState<ExportChoice | null>(null);
    const [phase, setPhase] = useState<Phase>('idle');
    const [progress, setProgress] = useState(0);
    const [avatarError, setAvatarError] = useState<AvatarError | null>(null);
    /** The running export's controller; null when none runs. */
    const exportRef = useRef<AbortController | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const previewRef = useRef<HTMLCanvasElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const fontLoggedRef = useRef(false);
    const support = useMemo(() => videoSupport(), []);
    const showYears = yearsAvailable(recap);

    /** Aborts the running export, if any (its own catch logs `export_failed` / `cancelled`). */
    const abortExport = useCallback(() => {
        const running = exportRef.current;
        exportRef.current = null;
        running?.abort();
    }, []);

    // Open: breadcrumbs, the frosted photos and the fonts (each once per opening). Closing or
    // unmounting aborts a running export; opening starts from a clean, idle state.
    useEffect(() => {
        if (!isOpen) return;
        abortExport();
        setOptions(defaultShareOptions(recap));
        setAvatar(null);
        setAvatarError(null);
        setBusy(null);
        setProgress(0);
        setPhase('idle');
        fontLoggedRef.current = false;
        logRecapShare('open', { count: candidates.length, member_id: memberId });
        if (!support.supported) logRecapShare('video_unsupported', { reason: support.reason, member_id: memberId });
        let cancelled = false;
        void loadShareAssets(recap).then((loaded) => {
            if (cancelled) return;
            if (loaded.skipped > 0) logRecapShare('photo_skip', { reason: 'load_failed', count: loaded.skipped, member_id: memberId });
            if (loaded.blurFallback) logRecapShare('share_blur_fallback', { reason: 'filter_unsupported', count: loaded.photos.length, member_id: memberId });
            setAssets(loaded);
        }).catch(() => {
            if (cancelled) return;
            logRecapShare('photo_skip', { reason: 'load_failed', member_id: memberId });
            setAssets(NO_ASSETS);
        });
        return () => {
            cancelled = true;
            abortExport();
        };
        // Once per opening of this recap.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, recap]);

    const model = useMemo(
        () => buildShareModel(recap, options, nickname, t, i18n.language),
        [recap, options, nickname, t, i18n.language],
    );

    /**
     * Loads the fonts for the text about to be drawn (new text can need new `unicode-range`
     * slices, so this runs before every draw; loaded faces resolve at once). A fallback leaves one
     * breadcrumb per opening.
     */
    const fontsReady = useCallback(async (): Promise<FontFallback | null> => {
        const text = [model.title.member, model.title.tagline, model.poster.withLine ?? '', ...model.poster.sentences].join('');
        const fallback = await ensureShareFonts(readShareFonts(rootRef.current ?? undefined), text);
        if (fallback && !fontLoggedRef.current) {
            fontLoggedRef.current = true;
            logRecapShare('font_fallback', { fallback, member_id: memberId });
        }
        return fallback;
    }, [model, memberId]);

    // The preview: the share poster as it will be exported.
    useEffect(() => {
        if (!isOpen || !assets) return;
        let cancelled = false;
        void fontsReady().then(() => {
            const canvas = previewRef.current;
            const ctx = canvas?.getContext('2d');
            if (cancelled || !canvas || !ctx) return;
            const el = rootRef.current ?? undefined;
            const renderer = new ShareRenderer(model, { ...assets, avatar: options.avatar ? avatar : null }, {
                format: 'video', scale: PREVIEW_SCALE, palette: readSharePalette(el), fonts: readShareFonts(el),
            });
            renderer.drawPoster(ctx);
        });
        return () => { cancelled = true; };
    }, [isOpen, assets, model, avatar, options.avatar, fontsReady]);

    const setOption = (key: 'nickname' | 'avatar' | 'years' | 'footer', next: boolean) => {
        setOptions((o) => ({ ...o, [key]: next }));
        logRecapShare('option', { key, outcome: next ? 'on' : 'off', member_id: memberId });
    };

    const setStyle = (style: ShareStyle) => {
        if (style === options.style) return;
        setOptions((o) => ({ ...o, style }));
        logRecapShare('style', { style, member_id: memberId });
    };

    const toggleSentence = (id: string) => {
        const chosen = options.sentences.includes(id);
        if (!chosen && options.sentences.length >= MAX_SENTENCES) return;
        const next = chosen ? options.sentences.filter((s) => s !== id) : [...options.sentences, id];
        setOptions((o) => ({ ...o, sentences: next }));
        logRecapShare('sentence', { outcome: chosen ? 'removed' : 'added', count: next.length });
    };

    const pickAvatar = async (file: File | undefined) => {
        if (!file) return;
        try {
            setAvatar(await readImageFile(file));
            setAvatarError(null);
            logRecapShare('option', { key: 'avatar', outcome: 'picked', member_id: memberId });
        } catch (e) {
            const code: AvatarError = e instanceof AvatarFileError ? e.code : 'load_failed';
            setAvatarError(code);
            logRecapShare('option', { key: 'avatar', outcome: 'rejected', reason: code, member_id: memberId });
        }
    };

    const runExport = async (choice: ExportChoice) => {
        if (busy || exportRef.current) return;
        const controller = new AbortController();
        const { signal } = controller;
        exportRef.current = controller;
        setBusy(choice);
        setProgress(0);
        let kind: 'gif' | 'webm' | 'mp4' | 'png' = choice === 'video' ? 'webm' : choice;
        let reason: FailReason = 'render_failed';
        logRecapShare('export_start', { kind, style: options.style, count: model.poster.sentences.length, member_id: memberId });
        try {
            await fontsReady();
            throwIfCancelled(signal);
            const el = rootRef.current ?? undefined;
            const base = { palette: readSharePalette(el), fonts: readShareFonts(el) };
            const renderAssets = { ...(assets ?? NO_ASSETS), avatar: options.avatar ? avatar : null };
            if (choice === 'gif') {
                setPhase('frames');
                const renderer = new ShareRenderer(model, renderAssets, { ...base, format: 'gif', scale: 1 });
                const { frames, durations } = await renderGifFrames(renderer, makeCanvas(SHARE_WIDTH, SHARE_HEIGHT), {
                    onProgress: (p) => setProgress(Math.round(p * 80)), signal,
                });
                throwIfCancelled(signal);
                setPhase('assemble');
                reason = 'write_failed';
                await postShareGif(
                    { frames, durations_ms: durations, fps: GIF_FPS, width: SHARE_WIDTH, height: SHARE_HEIGHT },
                    shareFilename(recap.year, recap.member.id, 'gif'), undefined, signal,
                );
            } else if (choice === 'video') {
                if (!support.supported) throw new Error('video_unsupported');
                setPhase('record');
                reason = 'record_failed';
                const renderer = new ShareRenderer(model, renderAssets, { ...base, format: 'video', scale: VIDEO_SCALE });
                const canvas = makeCanvas(SHARE_WIDTH * VIDEO_SCALE, SHARE_HEIGHT * VIDEO_SCALE);
                const video = await recordVideo(renderer, canvas, {
                    mimeType: support.mimeType, onProgress: (p) => setProgress(Math.round(p * 100)), signal,
                });
                throwIfCancelled(signal);
                kind = video.kind;
                reason = 'write_failed';
                await saveShareBlob(video.blob, video.kind, shareFilename(recap.year, recap.member.id, video.kind), undefined, signal);
            } else {
                setPhase('frames');
                const renderer = new ShareRenderer(model, renderAssets, { ...base, format: 'video', scale: PNG_SCALE });
                const canvas = makeCanvas(SHARE_WIDTH * PNG_SCALE, SHARE_HEIGHT * PNG_SCALE);
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('no_canvas');
                renderer.drawPoster(ctx);
                reason = 'encode_failed';
                const blob = await canvasToPng(canvas);
                throwIfCancelled(signal);
                reason = 'write_failed';
                await saveShareBlob(blob, 'png', shareFilename(recap.year, recap.member.id, 'png'), undefined, signal);
            }
            throwIfCancelled(signal);
            setProgress(100);
            logRecapShare('export', { kind, outcome: 'handed_off', member_id: memberId });
            setPhase('handed_off');
        } catch (e) {
            if (signal.aborted) {
                // Whoever aborted (Cancel, close, reopen, unmount) already reset the dialog.
                logRecapShare('export_failed', { kind, reason: 'cancelled', member_id: memberId });
                return;
            }
            const errorCode = e instanceof ShareSaveError ? e.detail ?? e.code : e instanceof SaveError ? e.code : undefined;
            logRecapShare('export_failed', { kind, reason, member_id: memberId, ...(errorCode ? { error_code: errorCode } : {}) });
            setPhase('failed');
        } finally {
            if (exportRef.current === controller) {
                exportRef.current = null;
                setBusy(null);
            }
        }
    };

    /** The Cancel action: aborts the running export and says so. */
    const cancelExport = () => {
        if (!exportRef.current) return;
        abortExport();
        setBusy(null);
        setProgress(0);
        setPhase('cancelled');
    };

    const close = () => {
        abortExport();
        logRecapShare('close', { member_id: memberId });
        onClose();
    };

    const shownNickname = options.nickname ? nickname : null;
    const full = options.sentences.length >= MAX_SENTENCES;
    const working = phase === 'frames' || phase === 'assemble' || phase === 'record';
    const statusText = {
        idle: '', frames: t('recap.share.progressFrames'), assemble: t('recap.share.progressAssemble'),
        record: t('recap.share.progressRecord'), handed_off: t('recap.share.handedOff'), failed: t('recap.share.failed'),
        cancelled: t('recap.share.cancelled'),
    }[phase];
    /** While one export runs, the other export buttons are visibly blocked (design-system disabled state). */
    const blockedBy = (choice: ExportChoice) => (busy && busy !== choice ? t('recap.share.busy') : undefined);

    return (
        <Modal
            isOpen={isOpen}
            onClose={close}
            title={t('recap.share.title')}
            icon={<Share2 />}
            closeLabel={t('common.close')}
            logId="recap_share"
            className="max-w-3xl"
            bodyClassName="flex flex-col gap-4"
            footer={
                <div className="flex w-full flex-col gap-2">
                    {(working || phase === 'handed_off') && (
                        <div
                            role="progressbar"
                            aria-label={t('recap.share.progressLabel')}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={progress}
                            className="h-2 overflow-hidden rounded-full bg-sunken"
                        >
                            <div
                                className="h-full rounded-full bg-expressive-progress transition-all duration-base ease-standard motion-reduce:transition-none"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p role="status" className={`min-h-5 text-secondary ${NARRATION_CLASS}`}>{statusText}</p>
                        <div className="flex flex-wrap items-center gap-2">
                            {busy && (
                                <Button variant="ghost" size="sm" onClick={cancelExport}>
                                    {t('recap.share.cancelExport')}
                                </Button>
                            )}
                            <Button variant="secondary" size="sm" loading={busy === 'png'} disabledReason={blockedBy('png')} onClick={() => void runExport('png')}>
                                <ImageIcon aria-hidden="true" className="h-4 w-4" />
                                {t('recap.share.exportPng')}
                            </Button>
                            {support.supported && (
                                <Button variant="secondary" size="sm" loading={busy === 'video'} disabledReason={blockedBy('video')} onClick={() => void runExport('video')}>
                                    <Film aria-hidden="true" className="h-4 w-4" />
                                    {t('recap.share.exportVideo')}
                                </Button>
                            )}
                            <Button variant="primary" size="sm" loading={busy === 'gif'} disabledReason={blockedBy('gif')} onClick={() => void runExport('gif')}>
                                <Sparkles aria-hidden="true" className="h-4 w-4" />
                                {t('recap.share.exportGif')}
                            </Button>
                        </div>
                    </div>
                </div>
            }
        >
            <div ref={rootRef} className="flex flex-col gap-4 sm:flex-row">
                <canvas
                    ref={previewRef}
                    width={SHARE_WIDTH * PREVIEW_SCALE}
                    height={SHARE_HEIGHT * PREVIEW_SCALE}
                    role="img"
                    aria-label={t('recap.share.preview')}
                    className="aspect-[9/16] w-48 shrink-0 self-center rounded-lg bg-sunken shadow-card"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                    <p className={`text-secondary ${NARRATION_CLASS}`}>{t('recap.share.intro')}</p>

                    <section className="flex flex-col gap-2">
                        <h3 className="text-small font-semibold text-secondary">{t('recap.share.styleLabel')}</h3>
                        <div className="flex flex-wrap gap-2">
                            {STYLES.map((s) => (
                                <Pill key={s} selected={options.style === s} onClick={() => setStyle(s)}>
                                    {t(`recap.share.style.${s}`)}
                                </Pill>
                            ))}
                        </div>
                    </section>

                    <section className="flex flex-col gap-2">
                        <h3 id="share-sentences" className="text-small font-semibold text-secondary">{t('recap.share.sentencesLabel')}</h3>
                        {candidates.length === 0 ? (
                            <p className={`text-muted ${NARRATION_CLASS}`}>{t('recap.share.sentencesNone')}</p>
                        ) : (
                            <div role="group" aria-labelledby="share-sentences" className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                                {candidates.map((c) => {
                                    const chosen = options.sentences.includes(c.id);
                                    const blocked = !chosen && full;
                                    return (
                                        <button
                                            key={c.id}
                                            type="button"
                                            aria-pressed={chosen}
                                            aria-disabled={blocked || undefined}
                                            title={blocked ? t('recap.share.sentencesLimit') : undefined}
                                            onClick={() => toggleSentence(c.id)}
                                            className={cn(
                                                'flex items-start gap-2 rounded-md px-3 py-2 text-left transition-colors duration-fast ease-standard',
                                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                                                chosen ? 'bg-accent-subtle ring-1 ring-inset ring-accent-border' : 'bg-card hover:bg-sunken',
                                                blocked && 'cursor-not-allowed opacity-40',
                                            )}
                                        >
                                            <Check aria-hidden="true" className={cn('mt-1 h-3 w-3 shrink-0', chosen ? 'text-accent-strong' : 'invisible')} />
                                            <span lang="ja" className="line-clamp-2 font-display text-small text-primary">
                                                {displaySentence(c.raw, shownNickname)}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    <section className="flex flex-col gap-3">
                        <h3 className="text-small font-semibold text-secondary">{t('recap.share.identityLabel')}</h3>
                        <ToggleRow label={t('recap.share.nickname')} checked={options.nickname} onChange={(v) => setOption('nickname', v)} />
                        <ToggleRow label={t('recap.share.avatar')} checked={options.avatar} onChange={(v) => setOption('avatar', v)}>
                            {options.avatar && (
                                <div className="flex items-center gap-2">
                                    <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                                        {avatar ? t('recap.share.changeAvatar') : t('recap.share.pickAvatar')}
                                    </Button>
                                    {!avatar && !avatarError && <span className={`text-muted ${NARRATION_CLASS}`}>{t('recap.share.avatarMissing')}</span>}
                                    {avatarError && (
                                        <span role="alert" className={`text-status-danger ${NARRATION_CLASS}`}>
                                            {t(`recap.share.avatarError.${avatarError}`)}
                                        </span>
                                    )}
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => {
                                            void pickAvatar(e.target.files?.[0]);
                                            e.target.value = '';
                                        }}
                                    />
                                </div>
                            )}
                        </ToggleRow>
                        {showYears && (
                            <ToggleRow
                                label={t('recap.share.years', { count: recap.member.years_together ?? 0 })}
                                checked={options.years}
                                onChange={(v) => setOption('years', v)}
                            />
                        )}
                        <ToggleRow label={t('recap.share.footerToggle')} checked={options.footer} onChange={(v) => setOption('footer', v)} />
                    </section>
                </div>
            </div>
        </Modal>
    );
};
