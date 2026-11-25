import React, { useMemo } from 'react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { tiltClass } from '../favorites/board';
import { jstDateFormat } from '../shared/jst';
import type { CapsuleNote } from '../types';

interface CapsuleNoteCardProps {
    note: CapsuleNote;
    /** Opens the note in the editor; without it the note is read-only (a resurfaced note). */
    onOpen?: (note: CapsuleNote) => void;
    className?: string;
}

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

/**
 * One 時光膠囊 sticky note (spec 14.4): a `bg-memories-note` paper under a `bg-memories-washi`
 * strip, leaning by a tilt picked from its id (the cork board's `tiltClass`, static, none under
 * reduced motion), with the body as written (`whitespace-pre-wrap`) and 「{{date}}に書いたメモ」
 * (the JST date it was written). The body is the fan's own words: never `lang="ja"`, never
 * `MemoryText` (no nickname replacement), never logged.
 */
export const CapsuleNoteCard: React.FC<CapsuleNoteCardProps> = ({ note, onOpen, className }) => {
    const { t, i18n } = useTranslation();
    const format = useMemo(() => jstDateFormat(i18n.language), [i18n.language]);
    const written = t('memories.capsule.written', { date: format.format(new Date(note.created_at)) });
    const paper = 'block w-full rounded-md bg-memories-note p-3 text-left shadow-memories-polaroid';
    const content = (
        <>
            <span className="block whitespace-pre-wrap break-words text-body text-primary">{note.body}</span>
            <span className="mt-2 block text-caption text-secondary">{written}</span>
        </>
    );
    return (
        <article
            data-testid={`capsule-note-${note.id}`}
            className={cn('relative pt-2', tiltClass(note.id), 'motion-reduce:rotate-0', className)}
        >
            <span
                data-testid="capsule-washi"
                aria-hidden="true"
                className="absolute left-1/2 top-0 z-10 h-4 w-12 -translate-x-1/2 rotate-2 bg-memories-washi motion-reduce:rotate-0"
            />
            {onOpen ? (
                <button type="button" onClick={() => onOpen(note)} className={cn(paper, FOCUS)}>{content}</button>
            ) : (
                <div className={paper}>{content}</div>
            )}
        </article>
    );
};
