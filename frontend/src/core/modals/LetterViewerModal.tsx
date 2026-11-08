import React, { useCallback, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Mail } from 'lucide-react';
import { IconButton, Modal } from '../../design/primitives';
import { useTranslation } from '../../i18n';
import type { Letter } from '../../features/messages/letters';
import { PhotoFallback, PhotoPlayer } from '../media/PhotoPlayer';
import { clientLog } from '../../utils/clientLog';
import { formatDateTime } from '../../utils/classnames';
import { toValidDate } from '../../utils/dateFormatters';

/** Where the viewer was opened from (breadcrumb `surface`). */
export type LetterViewerSource = 'sent_letters' | 'timeline';

export interface LetterViewerModalProps {
    /** The letters in the order of the list the viewer was opened from; ← / → walk this list. */
    letters: readonly Letter[];
    /** Id of the open letter; null (or an id not in `letters`) renders nothing. */
    letterId: number | null;
    /** The list's order, so the "n / total" counter counts the oldest letter as 1 either way. */
    order: 'newest_first' | 'oldest_first';
    /** Breadcrumb surface of the `letter_viewer` / `letter_jump` events. */
    source: LetterViewerSource;
    /** Called with the id of the previous / next letter in `letters`. */
    onNavigate: (id: number) => void;
    onClose: () => void;
    /** Called with the letter id after the viewer closed itself; the caller jumps the chat there. */
    onJump: (id: number) => void;
}

/**
 * A sent letter on a sheet dialog: the letter image (fit, on a neutral stage; the shared
 * missing-photo fallback when the file is missing or broken) beside the letter's full text,
 * which the image does not always show in full. Below ~900 px the image sits above the text.
 * The footer is the photo viewer's: the send date and time as a link that closes the viewer
 * and jumps to the letter in the chat, the "n / total" counter (oldest = 1), and previous /
 * next buttons; ← / → move too, in the order of the list the viewer was opened from.
 * Breadcrumbs: `letter_viewer` (`open`; `fallback` with `no_image` / `image_error`) and
 * `letter_jump`, each with the `source` as `surface`.
 */
export const LetterViewerModal: React.FC<LetterViewerModalProps> = (props) => {
    const index = props.letterId === null ? -1 : props.letters.findIndex((l) => l.id === props.letterId);
    if (index === -1) return null;
    return <OpenLetterViewer {...props} index={index} />;
};

const OpenLetterViewer: React.FC<LetterViewerModalProps & { index: number }> = ({
    letters, index, order, source, onNavigate, onClose, onJump,
}) => {
    const { t } = useTranslation();
    const letter = letters[index];
    const total = letters.length;
    const hasPrev = index > 0;
    const hasNext = index < total - 1;
    const ordinal = order === 'newest_first' ? total - index : index + 1;
    const sent = toValidDate(letter.created_at);
    const sentLabel = sent ? formatDateTime(sent) : '';
    const stageRef = useRef<HTMLDivElement>(null);

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
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            go(index - 1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            go(index + 1);
        }
    }, [go, index]);

    const jump = () => {
        clientLog('letter_jump', { surface: source });
        onClose();
        onJump(letter.id);
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
            {total > 1 && (
                <div className="flex shrink-0 items-center gap-1">
                    <IconButton size="sm" aria-label={t('letterViewer.previous')} icon={<ChevronLeft />} disabled={!hasPrev} onClick={() => go(index - 1)} />
                    <IconButton size="sm" aria-label={t('letterViewer.next')} icon={<ChevronRight />} disabled={!hasNext} onClick={() => go(index + 1)} />
                </div>
            )}
        </div>
    );

    return (
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
            <div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-card bg-sunken p-4 min-[900px]:basis-3/5">
                {letter.image_url ? (
                    <PhotoPlayer
                        key={letter.id}
                        variant="bubble"
                        src={letter.image_url}
                        alt={t('letterViewer.title')}
                        onError={() => clientLog('letter_viewer', { phase: 'fallback', surface: source, reason: 'image_error' })}
                        fallbackLabel={t('letterViewer.imageMissing')}
                    />
                ) : (
                    <PhotoFallback className="h-full w-full" label={t('letterViewer.imageMissing')} />
                )}
            </div>
            <div
                role="region"
                aria-label={t('letterViewer.fullText')}
                tabIndex={0}
                lang={letter.text ? 'ja' : undefined}
                className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-card text-body text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent min-[900px]:basis-2/5"
            >
                {letter.text || t('sentLetters.noTextContent')}
            </div>
        </Modal>
    );
};
