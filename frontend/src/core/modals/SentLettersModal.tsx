import React, { useMemo } from 'react';
import { Card, Modal } from '../../design/primitives';
import { useTranslation } from '../../i18n';
import type { Letter } from '../../features/messages/letters';

export interface SentLettersModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** The open room's letters: the same list the chat timeline shows (local archive). */
    letters: readonly Letter[];
    /** Called with a letter id after the dialog closed itself; the caller jumps the chat there. */
    onSelectLetter: (id: number) => void;
}

/**
 * Overview of the letters sent to this member: a grid of letter thumbnails, newest first,
 * with their dates. Choosing one closes the dialog and jumps to the letter in the chat.
 */
export const SentLettersModal: React.FC<SentLettersModalProps> = ({ isOpen, onClose, letters, onSelectLetter }) => {
    const { t, i18n } = useTranslation();
    const newestFirst = useMemo(
        () => [...letters].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
        [letters],
    );
    const dateFormat = useMemo(
        () => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }),
        [i18n.language],
    );

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('sentLetters.title')} className="max-w-2xl">
            {newestFirst.length === 0 ? (
                <p className="py-10 text-center text-small text-muted">{t('sentLetters.noLetters')}</p>
            ) : (
                <div className="grid grid-cols-3 gap-3">
                    {newestFirst.map((letter) => (
                        <button
                            key={letter.id}
                            type="button"
                            onClick={() => {
                                onClose();
                                onSelectLetter(letter.id);
                            }}
                            className="group flex flex-col gap-2 rounded-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group"
                        >
                            <Card className="aspect-[3/4] overflow-hidden transition-shadow duration-fast ease-standard group-hover:shadow-sheet">
                                {letter.image_url ? (
                                    <img src={letter.image_url} alt="" draggable={false} className="h-full w-full object-cover" />
                                ) : (
                                    <p className="line-clamp-6 whitespace-pre-wrap p-3 text-small text-secondary">
                                        {letter.text || t('sentLetters.noContent')}
                                    </p>
                                )}
                            </Card>
                            <time dateTime={letter.created_at} className="text-caption text-secondary">
                                {dateFormat.format(new Date(letter.created_at))}
                            </time>
                        </button>
                    ))}
                </div>
            )}
        </Modal>
    );
};
