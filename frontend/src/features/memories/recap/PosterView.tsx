import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Download, Mail, RotateCcw, Share2, Star, X } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Atmosphere, Button, IconButton } from '../../../design/primitives';
import { logRecapPoster } from '../memoriesLog';
import type { RecapMessage, RecapPayload, RecapStub, S03ClockData } from './api';
import { formatMessageDate } from '../shared/jst';
import { NARRATION_CLASS } from '../shared/typeRoles';
import { formatCount, formatSecondsOfDay, s03Copy, s09StubCopy, withNickname } from './recapCopy';
import { posterFilename, posterNumbers, posterSince, posterYears, safeMemberId } from './posterCopy';
import { canvasToPng, NOWRAP_ATTR, renderToCanvas, SaveError, savePng } from './posterImage';
import { ShareDialog } from './share/ShareDialog';
import { StarDial } from './slides/StarDial';
import { MemoryThumb } from '../shared/MemoryThumb';

export interface PosterViewProps {
    recap: RecapPayload;
    /** The fan's nickname, already resolved (never empty). */
    nickname: string;
    /** Where the poster was opened from (for the `open` breadcrumb); defaults to `end`. */
    surface?: PosterSurface;
    /** Play the recap again from the first slide. */
    onReplay: () => void;
    onClose: () => void;
}

/** `end`: shown after the last slide; `list`: opened from the recap list's poster button. */
export type PosterSurface = 'end' | 'list';

/** `handed_off`: the save dialog was asked to open (whether the user saves is not observable). */
type SaveState = 'idle' | 'saving' | 'handed_off' | 'failed';

/** The polaroid: her best photo of the year and its caption (her words near it, else the day it came). */
const Polaroid: React.FC<{ photo: RecapMessage; nickname: string }> = ({ photo, nickname }) => {
    const { i18n } = useTranslation();
    const words = photo.caption ?? photo.text;
    const date = words ? null : formatMessageDate(photo.ts, i18n.language, true);
    return (
        <figure data-testid="poster-polaroid" className="flex w-3/5 shrink-0 -rotate-2 flex-col gap-2 rounded-xs bg-card p-2 pb-3 shadow-card">
            <img src={photo.media_url ?? undefined} alt="" className="aspect-square w-full rounded-xs object-cover" />
            {words && (
                // No handwritten face exists in the stack; the caption takes the serif display face.
                <figcaption lang="ja" data-voice="quote" className="line-clamp-2 px-1 font-display text-small text-primary">
                    {withNickname(words, nickname)}
                </figcaption>
            )}
            {date && <figcaption className={`px-1 tabular-nums text-muted ${NARRATION_CLASS}`}>{date}</figcaption>}
        </figure>
    );
};

/** A special-day stub: its label and, when her message came, its time (seconds after midnight) or day. */
const PosterStub: React.FC<{ stub: RecapStub }> = ({ stub }) => {
    const { t, i18n } = useTranslation();
    const copy = s09StubCopy(stub);
    const message = stub.message;
    const seconds = message && stub.seconds_after_midnight !== null ? formatSecondsOfDay(stub.seconds_after_midnight) : null;
    const date = message && !seconds ? formatMessageDate(message.ts, i18n.language) : null;
    return (
        <li data-testid="poster-stub" {...{ [NOWRAP_ATTR]: '' }} className="flex items-center gap-2 whitespace-nowrap rounded-sm border border-dashed border-subtle bg-card px-2 py-1">
            <span className="font-sans text-caption text-muted">{t(copy.label.key, copy.label.params)}</span>
            {seconds && <span className="font-mono text-caption tabular-nums text-primary">{seconds}</span>}
            {date && <time dateTime={message?.ts} className="text-caption tabular-nums text-primary">{date}</time>}
        </li>
    );
};

const SMR_KEYS = ['recap.poster.start', 'recap.poster.mid', 'recap.poster.recent'] as const;
/**
 * A print's size in the 1080-px export (a third of it, `POSTER_EXPORT_WIDTH`): its picture comes
 * from the thumbnail route at the width covering that (640), the full file on error.
 */
const SMR_TILE_PX = 360;

/**
 * The private year poster (spec §9.4), shown after the last recap slide: the year, her name and
 * "with <nickname>"; the polaroid of her best photo; her one sentence in vertical type; the small
 * star dial of slide 3; up to three relationship numbers; the special-day stubs; three photos
 * from the start, middle and end of the year; her avatar change (only in a year it happened);
 * and the fan's own ★ and letters as a footer signature with "Dedicated to … · Subscribed
 * since …" (the fan's subscription, never something she knew). It can be saved as a PNG, and
 * "シェア用に書き出す" opens the share export (`share/ShareDialog`: frosted photos, opt-in identity).
 * Renders nothing without a poster (tier none).
 */
export const PosterView: React.FC<PosterViewProps> = ({ recap, nickname, surface = 'end', onReplay, onClose }) => {
    const { t, i18n } = useTranslation();
    const poster = recap.poster;
    const memberId = safeMemberId(recap.member.id);
    const posterRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const [save, setSave] = useState<SaveState>('idle');
    const [shareOpen, setShareOpen] = useState(false);
    const numbers = poster ? posterNumbers(poster) : [];

    useEffect(() => {
        if (!poster) return;
        rootRef.current?.focus({ preventScroll: true });
        logRecapPoster('open', { count: numbers.length, member_id: memberId, surface });
        // Once per shown poster.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recap]);

    const close = useCallback(() => {
        logRecapPoster('close', { member_id: memberId });
        onClose();
    }, [memberId, onClose]);

    const replay = () => {
        logRecapPoster('replay', { member_id: memberId });
        onReplay();
    };

    const saveImage = async () => {
        const node = posterRef.current;
        if (!node || save === 'saving') return;
        setSave('saving');
        let stage: 'render_failed' | 'encode_failed' | 'write_failed' = 'render_failed';
        let next: SaveState = 'failed';
        try {
            const { canvas, fontFallbacks, fontTruncation } = await renderToCanvas(node);
            // Every font fallback leaves its own breadcrumb, even when several happened.
            for (const code of fontFallbacks) {
                logRecapPoster('font_fallback', {
                    fallback: code,
                    member_id: memberId,
                    ...(code === 'font_truncated' && fontTruncation ? { count: fontTruncation.needed, dropped: fontTruncation.truncated } : {}),
                });
            }
            stage = 'encode_failed';
            const blob = await canvasToPng(canvas);
            stage = 'write_failed';
            const result = await savePng(blob, posterFilename(recap.year, recap.member.id));
            logRecapPoster('save', { outcome: result.outcome, member_id: memberId });
            next = 'handed_off';
        } catch (e) {
            logRecapPoster('save_failed', {
                reason: stage, member_id: memberId, ...(e instanceof SaveError ? { error_code: e.code } : {}),
            });
        } finally {
            // The button always leaves its loading state.
            setSave(next);
        }
    };

    if (!poster) return null;

    const clock = recap.slides.find((s) => s.key === 's03_clock')?.data as S03ClockData | undefined;
    const sentence = poster.sentence?.sentence;
    const stubs = poster.stubs.filter((s) => !s.sealed);
    const smr = poster.start_mid_recent.length === 3 && poster.start_mid_recent.every((m) => m.media_url) ? poster.start_mid_recent : [];
    const avatarChange = poster.avatar_changed && poster.avatar_old_url && poster.avatar_new_url
        ? { from: poster.avatar_old_url, to: poster.avatar_new_url }
        : null;
    const years = posterYears(poster.years_together);
    const since = posterSince(recap.member.subscription_start, i18n.language);
    const favorites = poster.favorites_count && poster.favorites_count > 0 ? poster.favorites_count : null;
    const letters = poster.letters_count && poster.letters_count > 0 ? poster.letters_count : null;

    return (
        <Atmosphere className="flex h-full min-h-0 flex-1">
            <div
                ref={rootRef}
                tabIndex={-1}
                onKeyDown={(e) => {
                    // A dialog above (the share export) claims its own Escape.
                    if (e.key === 'Escape' && !e.defaultPrevented) {
                        e.preventDefault();
                        close();
                    }
                }}
                className="flex h-full w-full flex-col items-center gap-3 p-6 outline-none"
            >
                <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                    <section
                        ref={posterRef}
                        data-testid="recap-poster"
                        aria-label={t('recap.poster.label', { year: recap.year })}
                        className="relative flex aspect-[9/16] h-full max-w-full flex-col gap-3 overflow-hidden rounded-xl bg-aurora px-6 py-6 shadow-sheet"
                    >
                        <header className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 flex-col">
                                <p data-voice="title" className="font-display text-display font-semibold tabular-nums text-primary">{recap.year}</p>
                                <p lang="ja" className="truncate font-display text-title text-primary">{recap.member.name}</p>
                                <p data-voice="narration" className={`text-secondary ${NARRATION_CLASS}`}>{t('recap.poster.with', { nickname })}</p>
                            </div>
                            {clock && clock.stars.length > 0 && (
                                <StarDial data={clock} glow={s03Copy(clock).glow} reducedMotion paused={false} className="w-20 shrink-0" />
                            )}
                        </header>

                        {(poster.best_photo?.media_url || sentence) && (
                            <div className="flex min-h-0 flex-1 items-start gap-4">
                                {poster.best_photo?.media_url && <Polaroid photo={poster.best_photo} nickname={nickname} />}
                                {sentence && (
                                    <p
                                        lang="ja"
                                        data-voice="quote"
                                        className="max-h-full min-w-0 flex-1 overflow-hidden font-display text-title leading-loose tracking-widest text-primary"
                                        style={{ writingMode: 'vertical-rl' }}
                                    >
                                        {withNickname(sentence, nickname)}
                                    </p>
                                )}
                            </div>
                        )}

                        {numbers.length > 0 && (
                            <ul className="flex flex-col gap-1">
                                {numbers.map((n) => (
                                    <li key={n.key} data-testid="poster-number" data-voice="narration" className={`tabular-nums text-primary ${NARRATION_CLASS}`}>
                                        {t(n.key, n.params)}
                                    </li>
                                ))}
                            </ul>
                        )}

                        {stubs.length > 0 && (
                            <ul className="flex flex-wrap gap-2">
                                {stubs.map((s, i) => <PosterStub key={`${s.kind}:${i}`} stub={s} />)}
                            </ul>
                        )}

                        {smr.length === 3 && (
                            <div className="grid grid-cols-3 gap-2">
                                {smr.map((m, i) => (
                                    <figure key={m.id} data-testid="poster-smr" className="flex flex-col gap-1">
                                        <MemoryThumb
                                            message={{ type: 'picture', media_url: m.media_url }}
                                            px={SMR_TILE_PX}
                                            loading="eager"
                                            large
                                            className="aspect-square w-full rounded-xs shadow-card"
                                        />
                                        <figcaption className="text-center font-sans text-caption text-muted">{t(SMR_KEYS[i])}</figcaption>
                                    </figure>
                                ))}
                            </div>
                        )}

                        {avatarChange && (
                            <div data-testid="poster-avatar-change" className="flex items-center gap-2">
                                <img src={avatarChange.from} alt="" className="h-8 w-8 rounded-full object-cover" />
                                <ArrowRight aria-hidden="true" className="h-3 w-3 text-muted" />
                                <img src={avatarChange.to} alt="" className="h-8 w-8 rounded-full object-cover" />
                                <span className={`text-secondary ${NARRATION_CLASS}`}>{t('recap.poster.avatarChanged')}</span>
                            </div>
                        )}

                        <footer className="mt-auto flex flex-col items-center gap-1 text-center">
                            {(favorites || letters) && (
                                <div className="flex items-center gap-4 font-sans text-caption tabular-nums text-secondary">
                                    {favorites && (
                                        <span data-testid="poster-favorites" className="flex items-center gap-1">
                                            <Star aria-hidden="true" className="h-3 w-3 fill-current text-semantic-star" />
                                            <span className="sr-only">{t('recap.s10.bookLabel')}</span>
                                            {formatCount(favorites, i18n.language)}
                                        </span>
                                    )}
                                    {letters && (
                                        <span data-testid="poster-letters" className="flex items-center gap-1">
                                            <Mail aria-hidden="true" className="h-3 w-3" />
                                            <span className="sr-only">{t('recap.s10.lettersLabel')}</span>
                                            {formatCount(letters, i18n.language)}
                                        </span>
                                    )}
                                </div>
                            )}
                            {years && (
                                <p data-testid="poster-years" className="font-sans text-caption text-secondary">{t(years.key, years.params)}</p>
                            )}
                            <p className="font-display text-small text-primary">{t('recap.poster.dedicated', { nickname })}</p>
                            {since && <p className="font-sans text-caption text-muted">{t(since.key, since.params)}</p>}
                        </footer>
                    </section>
                </div>

                <div className="flex w-full max-w-md items-center justify-center gap-2">
                    <Button variant="ghost" size="sm" onClick={replay}>
                        <RotateCcw aria-hidden="true" className="h-4 w-4" />
                        {t('recap.poster.replay')}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setShareOpen(true)}>
                        <Share2 aria-hidden="true" className="h-4 w-4" />
                        {t('recap.share.open')}
                    </Button>
                    <Button variant="primary" size="sm" loading={save === 'saving'} onClick={() => void saveImage()}>
                        <Download aria-hidden="true" className="h-4 w-4" />
                        {t('recap.poster.save')}
                    </Button>
                    <IconButton size="sm" aria-label={t('common.close')} icon={<X />} onClick={close} />
                </div>
                <p role="status" className={`min-h-5 text-secondary ${NARRATION_CLASS}`}>
                    {save === 'handed_off' && t('recap.poster.handedOff')}
                    {save === 'failed' && t('recap.poster.saveFailed')}
                </p>
            </div>
            {/* Outside the poster root, so keys in the dialog never reach the poster's Escape handler. */}
            <ShareDialog isOpen={shareOpen} recap={recap} nickname={nickname} onClose={() => setShareOpen(false)} />
        </Atmosphere>
    );
};
