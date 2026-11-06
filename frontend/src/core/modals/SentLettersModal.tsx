import React, { useMemo } from 'react';
import { Mail } from 'lucide-react';
import { Card, Modal } from '../../design/primitives';
import { useTranslation } from '../../i18n';
import type { Letter } from '../../features/messages/letters';
import type { LettersStatus } from '../../features/messages/hooks/useRoomExtras';
import { toValidDate } from '../../utils/dateFormatters';

export interface SentLettersModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** The open room's letters: the same list the chat timeline shows (local archive). */
    letters: readonly Letter[];
    /** Whether the letters are still loading, loaded, or could not be loaded (failed or timed out). */
    status: LettersStatus;
    /** Called with a letter id after the dialog closed itself; the caller jumps the chat there. */
    onSelectLetter: (id: number) => void;
}

/**
 * Overview of the letters sent to this member: a grid of letter thumbnails, newest first,
 * with their dates. Choosing one (click or keyboard) closes the dialog and jumps to the letter
 * in the chat. Each card is named by its send date and time. Letters whose created_at cannot
 * be parsed are not listed (the timeline does not show them either). While the letters load,
 * or when they are unavailable, the dialog says so instead of "no letters".
 */
export const SentLettersModal: React.FC<SentLettersModalProps> = ({ isOpen, onClose, letters, status, onSelectLetter }) => {
    const { t, i18n } = useTranslation();
    const newestFirst = useMemo(
        () => letters
            .map((letter) => ({ letter, date: toValidDate(letter.created_at) }))
            .filter((entry): entry is { letter: Letter; date: Date } => entry.date !== null)
            .sort((a, b) => b.date.getTime() - a.date.getTime()),
        [letters],
    );
    const dateFormat = useMemo(
        () => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }),
        [i18n.language],
    );
    const dateTimeFormat = useMemo(
        () => new Intl.DateTimeFormat(i18n.language, {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        }),
        [i18n.language],
    );

    let body: React.ReactNode;
    if (status === 'loading') {
        body = <p className="py-10 text-center text-small text-muted" role="status">{t('sentLetters.loading')}</p>;
    } else if (status === 'unavailable' && newestFirst.length === 0) {
        body = <p className="py-10 text-center text-small text-muted">{t('sentLetters.unavailable')}</p>;
    } else if (newestFirst.length === 0) {
        body = <p className="py-10 text-center text-small text-muted">{t('sentLetters.noLetters')}</p>;
    } else {
        body = (
            <div className="grid grid-cols-3 gap-3">
                {newestFirst.map(({ letter, date }) => (
                    <button
                        key={letter.id}
                        type="button"
                        aria-label={t('sentLetters.letterSent', { date: dateTimeFormat.format(date) })}
                        onClick={() => {
                            onClose();
                            onSelectLetter(letter.id);
                        }}
                        className="group flex flex-col gap-2 rounded-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <Card className="aspect-[3/4] overflow-hidden ring-1 ring-transparent transition-shadow duration-fast ease-standard group-hover:ring-accent-border group-hover:shadow-accent-glow-hover">
                            {letter.image_url ? (
                                <img src={letter.image_url} alt="" draggable={false} className="h-full w-full object-cover" />
                            ) : letter.text ? (
                                <p lang="ja" className="line-clamp-6 whitespace-pre-wrap p-3 text-small text-secondary">{letter.text}</p>
                            ) : (
                                <p className="line-clamp-6 whitespace-pre-wrap p-3 text-small text-secondary">{t('sentLetters.noContent')}</p>
                            )}
                        </Card>
                        <time dateTime={letter.created_at} className="text-caption text-secondary transition-colors duration-fast ease-standard group-hover:text-accent-strong">
                            {dateFormat.format(date)}
                        </time>
                    </button>
                ))}
            </div>
        );
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('sentLetters.title')} icon={<Mail />} closeLabel={t('common.close')} logId="sent_letters" className="max-w-2xl">
            {body}
        </Modal>
    );
};
