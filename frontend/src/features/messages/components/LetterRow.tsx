import React, { useMemo, useState } from 'react';
import { Avatar, Card } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';
import { LETTER_WIDTH, letterImageHeight, type Letter } from '../letters';
import { toValidDate } from '../../../utils/dateFormatters';

export interface LetterRowProps {
    letter: Letter;
    /** The user's avatar when the letter was sent (pickLetterAvatar); null shows the initial. */
    avatarUrl: string | null;
    /** The user's nickname. */
    userName: string;
    onOpenImage: (letter: Letter) => void;
}

/** Local "HH:mm" of a send time; '' when it cannot be parsed. */
const timeOf = (date: Date | null): string =>
    date ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '';

/**
 * A sent letter in the chat timeline, right-aligned like the official app: the full letter
 * image (LETTER_WIDTH wide, height reserved from its size), or the letter text when the image
 * is missing; the user's avatar and name and the send time. No "sent letter" tag. The open
 * button is named by the send date and time, so same-day letters differ.
 */
export const LetterRow: React.FC<LetterRowProps> = ({ letter, avatarUrl, userName, onOpenImage }) => {
    const { t, i18n } = useTranslation();
    const [imageFailed, setImageFailed] = useState(false);
    const sent = useMemo(() => toValidDate(letter.created_at), [letter.created_at]);
    const sentLabel = useMemo(() => (sent
        ? new Intl.DateTimeFormat(i18n.language, {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        }).format(sent)
        : ''), [sent, i18n.language]);
    const imageUrl = imageFailed ? null : letter.image_url;
    return (
        <div className="flex justify-end gap-3 pt-3">
            <div className="flex min-w-0 flex-col items-end">
                <div className="mb-1 flex items-center gap-2">
                    <time className="text-caption text-muted" dateTime={letter.created_at}>{timeOf(sent)}</time>
                    <span className="text-small font-semibold text-primary">{userName}</span>
                </div>
                {imageUrl ? (
                    <button
                        type="button"
                        onClick={() => onOpenImage(letter)}
                        aria-label={t('letters.openImageAt', { date: sentLabel })}
                        title={t('letters.openImage')}
                        className="cursor-zoom-in overflow-hidden rounded-card bg-card shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        style={{ width: LETTER_WIDTH, height: letterImageHeight(letter) }}
                    >
                        <img src={imageUrl} alt="" draggable={false} className="h-full w-full object-cover" onError={() => setImageFailed(true)} />
                    </button>
                ) : (
                    <Card lang={letter.text ? 'ja' : undefined} className="max-w-xs whitespace-pre-wrap p-3 text-body text-primary">
                        {letter.text || t('sentLetters.noTextContent')}
                    </Card>
                )}
            </div>
            <Avatar src={avatarUrl ?? undefined} name={userName} size="md" />
        </div>
    );
};
