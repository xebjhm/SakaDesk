import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Mail } from 'lucide-react';
import { Button, IconButton, Modal } from '../../design/primitives';
import { useTranslation } from '../../i18n';
import type { Letter } from '../../features/messages/letters';
import { useAppStore } from '../../store/appStore';
import { PhotoFallback, PhotoPlayer } from '../media/PhotoPlayer';
import { MediaViewerModal } from '../media/PhotoDetailModal';
import { clientLog } from '../../utils/clientLog';
import { downloadMedia } from '../../utils/download';
import { formatDateTime, formatDownloadFilename } from '../../utils/classnames';
import { toValidDate } from '../../utils/dateFormatters';

/** Where the viewer was opened from (breadcrumb `surface`). */
export type LetterViewerSource = 'sent_letters' | 'timeline';

export interface LetterViewerModalProps {
    /** The letters in the order of the list the viewer was opened from; ← / → walk this list. */
    letters: readonly Letter[];
    /**
     * Id of the open letter; null renders nothing. An id not in `letters` (gone after a refetch)
     * renders nothing too, logs `letter_viewer` `skip` / `not_found` once and calls `onClose`.
     */
    letterId: number | null;
    /** The list's order, so the counter counts the oldest letter as 1 and the arrows keep time order either way. */
    order: 'newest_first' | 'oldest_first';
    /** Breadcrumb surface of the `letter_viewer` / `letter_jump` events. */
    source: LetterViewerSource;
    /** Called with the id of the older (‹ / ←) or newer (› / →) letter, whichever way `letters` is sorted. */
    onNavigate: (id: number) => void;
    onClose: () => void;
    /** Called with the letter id after the viewer closed itself; the caller jumps the chat there. */
    onJump: (id: number) => void;
}

/**
 * A sent letter on a sheet dialog: the letter image (fit, on a neutral stage; the shared
 * missing-photo fallback when the file is missing or broken) beside the letter's full text,
 * which the image does not always show in full. Below ~900 px the image sits above the text
 * (at most 45% of the dialog body; the text scrolls).
 * Clicking the image opens it in the dark media viewer on top (↑ / ↓ zoom, and with golden
 * finger Ctrl+C copy and Download, as before); Escape returns to the letter. With golden finger
 * the footer offers Download too. Ctrl+C on the letter itself copies the selected text as usual.
 * The footer is the photo viewer's: the send date and time as a link that closes the viewer
 * and jumps to the letter in the chat, the "n / total" counter (oldest = 1), and previous /
 * next buttons; ← / → move too. › / → always show the newer letter and ‹ / ← the older one,
 * for the chat and the newest-first Sent letters list alike (not while focus is in the letter
 * text, where they move the caret / selection).
 * Breadcrumbs: `letter_viewer` (`open`; `fallback` with `no_image` / `image_error`; `skip` with
 * `not_found`) and `letter_jump`, each with the `source` as `surface`.
 */
export const LetterViewerModal: React.FC<LetterViewerModalProps> = (props) => {
    const { letterId, letters, source, onClose } = props;
    const index = letterId === null ? -1 : letters.findIndex((l) => l.id === letterId);
    const missing = letterId !== null && index === -1;
    useEffect(() => {
        if (!missing) return;
        clientLog('letter_viewer', { phase: 'skip', surface: source, reason: 'not_found' });
        onClose();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once per missing id
    }, [missing, letterId]);
    if (index === -1) return null;
    return <OpenLetterViewer {...props} index={index} />;
};

const OpenLetterViewer: React.FC<LetterViewerModalProps & { index: number }> = ({
    letters, index, order, source, onNavigate, onClose, onJump,
}) => {
    const { t } = useTranslation();
    const letter = letters[index];
    const total = letters.length;
    // ‹ / ← always step to the older letter and › / → to the newer one, whichever way the list is sorted.
    const step = order === 'newest_first' ? -1 : 1;
    const olderIndex = index - step;
    const newerIndex = index + step;
    const hasPrev = olderIndex >= 0 && olderIndex < total;
    const hasNext = newerIndex >= 0 && newerIndex < total;
    const ordinal = order === 'newest_first' ? total - index : index + 1;
    const sent = toValidDate(letter.created_at);
    const sentLabel = sent ? formatDateTime(sent) : '';
    const stageRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLDivElement>(null);
    const goldenFingerActive = useAppStore((s) => s.goldenFingerActive);
    // Per letter, so moving to another letter neither keeps the media viewer open nor the failure.
    const [zoomedId, setZoomedId] = useState<number | null>(null);
    const [failedId, setFailedId] = useState<number | null>(null);
    const image = letter.image_url && failedId !== letter.id ? letter.image_url : null;

    useEffect(() => {
        clientLog('letter_viewer', { phase: 'open', surface: source });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open
    }, []);

    useEffect(() => {
        if (!letter.image_url) clientLog('letter_viewer', { phase: 'fallback', surface: source, reason: 'no_image' });
    }, [letter.id, letter.image_url, source]);

    // Reaching an end disables the focused arrow button, which drops focus to the body and
    // silences ← / →: put it back on the dialog frame (as the photo viewer does).
    useEffect(() => {
        const frame = stageRef.current?.closest<HTMLElement>('[role="dialog"]');
        if (frame && !frame.contains(document.activeElement)) frame.focus({ preventScroll: true });
    }, [index]);

    const go = useCallback((to: number) => {
        if (to >= 0 && to < total) onNavigate(letters[to].id);
    }, [letters, total, onNavigate]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        // In the letter text ← / → move the caret / selection.
        if (e.target instanceof Node && textRef.current?.contains(e.target)) return;
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            go(olderIndex);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            go(newerIndex);
        }
    }, [go, olderIndex, newerIndex]);

    const jump = () => {
        clientLog('letter_jump', { surface: source });
        onClose();
        onJump(letter.id);
    };

    const download = () => {
        if (image) downloadMedia(image, formatDownloadFilename(image, letter.created_at));
    };

    const footer = (
        <div className="flex w-full items-center justify-between gap-4 text-small text-secondary">
            <div className="flex min-w-0 items-center">
                <button
                    type="button"
                    onClick={jump}
                    aria-label={t('letterViewer.jumpToLetterAt', { date: sentLabel })}
                    title={t('letterViewer.jumpToLetter')}
                    className="rounded-pill tabular-nums text-secondary underline-offset-2 transition-colors duration-fast ease-standard hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {sentLabel}
                </button>
                {total > 1 && (
                    <>
                        <span aria-hidden="true" className="mx-2">•</span>
                        <span className="tabular-nums">{ordinal} / {total}</span>
                    </>
                )}
            </div>
            {(total > 1 || (goldenFingerActive && image)) && (
                <div className="flex shrink-0 items-center gap-1">
                    {goldenFingerActive && image && (
                        <Button variant="ghost" size="sm" onClick={download}>
                            <Download className="h-4 w-4" />
                            {t('common.download')}
                        </Button>
                    )}
                    {total > 1 && (
                        <>
                            <IconButton size="sm" aria-label={t('letterViewer.previous')} icon={<ChevronLeft />} disabled={!hasPrev} onClick={() => go(olderIndex)} />
                            <IconButton size="sm" aria-label={t('letterViewer.next')} icon={<ChevronRight />} disabled={!hasNext} onClick={() => go(newerIndex)} />
                        </>
                    )}
                </div>
            )}
        </div>
    );

    return (
        <>
            <Modal
                isOpen
                onClose={onClose}
                title={t('letterViewer.title')}
                icon={<Mail />}
                closeLabel={t('common.close')}
                logId="letter_viewer"
                onKeyDown={handleKeyDown}
                footer={footer}
                className="h-[85vh] max-w-5xl"
                bodyClassName="flex flex-col gap-4 overflow-hidden min-[900px]:flex-row"
            >
                <div ref={stageRef} data-testid="letter-image-stage" className="flex min-h-0 max-h-[45%] flex-1 items-center justify-center overflow-hidden rounded-card bg-sunken p-4 min-[900px]:max-h-none min-[900px]:basis-3/5">
                    {image ? (
                        <button
                            type="button"
                            aria-label={t('letterViewer.openImage')}
                            onClick={() => setZoomedId(letter.id)}
                            className="flex h-full w-full cursor-zoom-in items-center justify-center rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <PhotoPlayer
                                key={letter.id}
                                variant="bubble"
                                src={image}
                                alt={t('letterViewer.title')}
                                onError={() => {
                                    setFailedId(letter.id);
                                    clientLog('letter_viewer', { phase: 'fallback', surface: source, reason: 'image_error' });
                                }}
                            />
                        </button>
                    ) : (
                        <PhotoFallback className="h-full w-full" label={t('letterViewer.imageMissing')} />
                    )}
                </div>
                <div
                    ref={textRef}
                    role="region"
                    aria-label={t('letterViewer.fullText')}
                    tabIndex={0}
                    lang={letter.text ? 'ja' : undefined}
                    className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-card px-1 pb-4 text-body text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent min-[900px]:basis-2/5"
                >
                    {letter.text || t('sentLetters.noTextContent')}
                </div>
            </Modal>
            {image && zoomedId === letter.id && (
                <MediaViewerModal
                    mediaItems={[{ src: image, type: 'picture', timestamp: letter.created_at }]}
                    currentIndex={0}
                    onClose={() => setZoomedId(null)}
                    onNavigate={() => {}}
                />
            )}
        </>
    );
};
