import React, { useRef, useState } from 'react';
import { StickyNote } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Button } from '../../../design/primitives';
import { fetchCapsule } from '../api';
import { logMemoriesCapsule } from '../memoriesLog';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { CapsuleAnchorInput, CapsuleNote, CapsuleQuery } from '../types';
import { CapsuleEditor } from './CapsuleEditor';
import { CapsuleNoteCard } from './CapsuleNoteCard';

/** Where the strip's notes are stuck: a JST day, or one of her binder cards (on its JST date). */
export type CapsuleStripAnchor =
    | { kind: 'day'; date: string }
    | { kind: 'card'; memberPath: string; cardKey: string; date: string };

interface CapsuleStripProps {
    service: string;
    anchor: CapsuleStripAnchor;
}

/** The editor's state: closed, a new note, or a stored one being rewritten. */
type Editing = { note: CapsuleNote | null } | null;

const queryOf = (a: CapsuleStripAnchor): CapsuleQuery =>
    (a.kind === 'day' ? { date: a.date } : { member: a.memberPath, card: a.cardKey });

const inputOf = (a: CapsuleStripAnchor): CapsuleAnchorInput =>
    (a.kind === 'day' ? { kind: 'day', date: a.date } : { kind: 'card', member: a.memberPath, card_key: a.cardKey, date: a.date });

const keyOf = (a: CapsuleStripAnchor) => (a.kind === 'day' ? `day|${a.date}` : `card|${a.memberPath}|${a.cardKey}|${a.date}`);

/**
 * The fan's 時光膠囊 notes on one day or card (spec 14.4), with 「メモを貼る」. A note opens the
 * editor to rewrite or peel it off; after a save or delete the notes are refetched (`fetchCapsule`,
 * view `capsule`), and the list on screen stays while they reload. Opening the editor logs
 * `memories_capsule` `open` with the anchor kind and its note count.
 */
export const CapsuleStrip: React.FC<CapsuleStripProps> = ({ service, anchor }) => {
    const { t } = useTranslation();
    const [editing, setEditing] = useState<Editing>(null);
    const key = keyOf(anchor);
    const query = useMemoriesQuery(
        'capsule',
        (signal) => fetchCapsule(service, queryOf(anchor), signal),
        [service, key],
        { count: (d) => d.notes.length },
    );
    // The last list of this anchor, kept on screen while a refetch runs.
    const last = useRef<{ key: string; notes: CapsuleNote[] } | null>(null);
    if (query.status === 'ready' && query.data) last.current = { key: `${service}|${key}`, notes: query.data.notes };
    const notes = last.current?.key === `${service}|${key}` ? last.current.notes : null;

    const open = (note: CapsuleNote | null) => {
        logMemoriesCapsule('open', { kind: anchor.kind, count: notes?.length ?? 0 });
        setEditing({ note });
    };

    let list: React.ReactNode = null;
    if (query.status === 'error' && notes === null) {
        list = (
            <span className="flex items-center gap-2 text-small text-secondary">
                {t('memories.common.loadError')}
                <Button variant="ghost" size="sm" onClick={query.retry}>{t('memories.common.retry')}</Button>
            </span>
        );
    } else if (notes && notes.length > 0) {
        list = notes.map((n) => <CapsuleNoteCard key={n.id} note={n} onOpen={open} className="w-48 shrink-0" />);
    }

    return (
        <section data-testid="capsule-strip" className="flex flex-wrap items-start gap-4">
            {list}
            {notes !== null && (
                <Button variant="ghost" size="sm" className="self-center" onClick={() => open(null)}>
                    <StickyNote aria-hidden="true" className="h-4 w-4" />
                    {t('memories.capsule.add')}
                </Button>
            )}
            {editing && (
                <CapsuleEditor
                    service={service}
                    anchor={inputOf(anchor)}
                    note={editing.note}
                    onClose={() => setEditing(null)}
                    onRefetch={query.retry}
                />
            )}
        </section>
    );
};
