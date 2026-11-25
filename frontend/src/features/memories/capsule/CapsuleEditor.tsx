import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { Button, FIELD_CLASS, Modal } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { deleteCapsule, fetchCapsule, MemoriesFetchError, MemoriesTimeoutError, postCapsule, putCapsule } from '../api';
import { logMemoriesCapsule, logMemoriesSkip, MEMORIES_CAPSULE_ERROR_CODES, type MemoriesCapsuleErrorCode } from '../memoriesLog';
import type { CapsuleAnchorInput, CapsuleNote, CapsuleQuery } from '../types';

/** The longest note the backend keeps (`capsule.MAX_CHARS`), in characters (code points, as Python counts). */
const CAPSULE_MAX_CHARS = 2000;
/** The remaining count shows only once a note is longer than this. */
const CAPSULE_COUNT_FROM = 1800;

const chars = (text: string) => Array.from(text);

/** The logged reason of a failed write: the server's code when it is a known one, else a class. */
function errorCode(err: unknown): MemoriesCapsuleErrorCode {
    if (err instanceof MemoriesTimeoutError) return 'timeout';
    if (err instanceof MemoriesFetchError) {
        if (err.httpStatus === 404) return 'not_found';
        const known = MEMORIES_CAPSULE_ERROR_CODES.find((c) => c === err.code);
        if (known) return known;
    }
    return 'request_failed';
}

/** A timed-out write counts as committed when its note shows up written within this. */
const COMMITTED_WINDOW_MS = 2 * 60 * 1000;

type WriteOp = 'create' | 'update' | 'delete';

interface CapsuleEditorProps {
    service: string;
    /** Where a new note is stuck (its `kind` is also the logged anchor kind). */
    anchor: CapsuleAnchorInput;
    /** The note being rewritten, or null for a new one. */
    note: CapsuleNote | null;
    onClose: () => void;
    /** Reload the anchor's notes: after a save or delete, and after a write that timed out (it may be committed). */
    onRefetch: () => void;
}

/**
 * The capsule note editor (spec 14.4), in a `Modal`: a textarea (the field look), a live limit of
 * {@link CAPSULE_MAX_CHARS} characters whose remaining count appears only past
 * {@link CAPSULE_COUNT_FROM} (at the limit a line without a number: never "0"), 「しまう」,
 * 「はがす」 for a stored note (asks first) and 「やめる」.
 *
 * - An empty body (after trimming) is not sent: the field is marked and `memories_skip`
 *   `note_empty` is logged (the save button stays enabled; forms validate on click).
 * - A failed write keeps the draft and shows 「メモを保存できませんでした」 (a delete:
 *   「メモをはがせませんでした」). A write that timed out may already be stored, so it is never
 *   retried: the notes are read back and, when the write is there (a new note on this anchor with
 *   this body written in the last two minutes, this note with this body and a new `updated_at`,
 *   or this note gone), it counts as done; either way the anchor's notes are refetched. A delete
 *   answered 404 counts as done (the note is already gone).
 * - Logs `memories_capsule` `save` (`created` / `updated`), `delete` and `failed` (`error_code`;
 *   a timeout found committed logs `failed` then `save` / `delete`) with the anchor kind. The body
 *   is never logged.
 * - Writes are never aborted. Closing the dialog mid-write (やめる, Escape, the backdrop) lets
 *   the write settle, then the anchor's notes are refetched.
 */
export const CapsuleEditor: React.FC<CapsuleEditorProps> = ({ service, anchor, note, onClose, onRefetch }) => {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(note?.body ?? '');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<'save' | 'delete' | null>(null);
    const [invalid, setInvalid] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const fieldRef = useRef<HTMLTextAreaElement>(null);
    const mountedRef = useRef(true);
    const localId = useId();
    const kind = anchor.kind;

    // Writes are never aborted: a write may be committed whatever happens to the dialog, so
    // closing it mid-write lets the write settle and the anchor's notes are refetched then.
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const length = chars(draft).length;
    const left = CAPSULE_MAX_CHARS - length;

    const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const next = chars(e.target.value);
        setDraft(next.length > CAPSULE_MAX_CHARS ? next.slice(0, CAPSULE_MAX_CHARS).join('') : e.target.value);
        setInvalid(false);
    };

    /**
     * After a timeout, whether the write is in the store after all: a new note on this anchor
     * with this body written in the last {@link COMMITTED_WINDOW_MS}, this note with this body
     * and a new `updated_at`, or this note gone. False when the notes cannot be read.
     */
    const committed = async (op: WriteOp, body: string): Promise<boolean> => {
        const query: CapsuleQuery = anchor.kind === 'day'
            ? { date: anchor.date }
            : { member: anchor.member, card: anchor.card_key };
        try {
            const { notes } = await fetchCapsule(service, query, new AbortController().signal);
            const now = Date.now();
            if (op === 'create') {
                return notes.some((n) => n.anchor.date === anchor.date && n.body.trim() === body
                    && now - Date.parse(n.created_at) <= COMMITTED_WINDOW_MS);
            }
            if (!note) return false;
            if (op === 'update') {
                return notes.some((n) => n.id === note.id && n.body.trim() === body && n.updated_at !== note.updated_at);
            }
            return !notes.some((n) => n.id === note.id);
        } catch {
            return false;
        }
    };

    /** Run one write to its end, then close (done) or keep the draft with the error (failed). */
    const write = async (op: WriteOp, send: (signal: AbortSignal) => Promise<unknown>, body: string) => {
        setBusy(true);
        setFailure(null);
        let done = false;
        let timedOut = false;
        try {
            await send(new AbortController().signal);
            done = true;
        } catch (err) {
            const code = errorCode(err);
            // A note that is already gone is what a delete asked for (e.g. an earlier timed-out delete went through).
            if (op === 'delete' && code === 'not_found') {
                done = true;
            } else {
                logMemoriesCapsule('failed', { kind, error_code: code });
                timedOut = code === 'timeout';
                if (timedOut) done = await committed(op, body);
            }
        }
        if (done) {
            if (op === 'delete') logMemoriesCapsule('delete', { kind });
            else logMemoriesCapsule('save', { kind, outcome: op === 'create' ? 'created' : 'updated' });
        }
        if (done || timedOut || !mountedRef.current) onRefetch();
        if (!mountedRef.current) return;
        if (done) {
            onClose();
            return;
        }
        setBusy(false);
        setFailure(op === 'delete' ? 'delete' : 'save');
    };

    const save = () => {
        if (busy) return;
        const body = draft.trim();
        if (!body) {
            setInvalid(true);
            logMemoriesSkip('capsule', 'note_empty');
            fieldRef.current?.focus();
            return;
        }
        if (note) void write('update', (signal) => putCapsule(service, note.id, draft, signal), body);
        else void write('create', (signal) => postCapsule(service, { anchor, body: draft }, signal), body);
    };

    const remove = () => {
        if (!note || busy) return;
        void write('delete', (signal) => deleteCapsule(service, note.id, signal), '');
    };

    let footer: React.ReactNode;
    if (confirming) {
        footer = (
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
                <span className="mr-auto text-small text-primary">{t('memories.capsule.deleteConfirm')}</span>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>{t('memories.capsule.cancel')}</Button>
                <Button variant="danger" size="sm" loading={busy} onClick={remove}>{t('memories.capsule.delete')}</Button>
            </div>
        );
    } else {
        footer = (
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
                {note && (
                    <Button variant="ghost" size="sm" className="mr-auto" onClick={() => setConfirming(true)}>{t('memories.capsule.delete')}</Button>
                )}
                <Button variant="ghost" size="sm" onClick={onClose}>{t('memories.capsule.cancel')}</Button>
                <Button variant="primary" size="sm" loading={busy} onClick={save}>{t('memories.capsule.save')}</Button>
            </div>
        );
    }

    let limit: string | null = null;
    if (left <= 0) limit = t('memories.capsule.full');
    else if (length > CAPSULE_COUNT_FROM) limit = t('memories.capsule.limit', { count: left });

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={note ? t('memories.capsule.edit') : t('memories.capsule.add')}
            header="plain"
            closeLabel={t('common.close')}
            initialFocusRef={fieldRef}
            className="max-w-lg"
            footer={footer}
        >
            <div className="flex flex-col gap-2">
                <textarea
                    ref={fieldRef}
                    value={draft}
                    onChange={onChange}
                    placeholder={t('memories.capsule.placeholder')}
                    aria-label={note ? t('memories.capsule.edit') : t('memories.capsule.add')}
                    aria-invalid={invalid || undefined}
                    aria-describedby={localId}
                    rows={8}
                    className={cn(FIELD_CLASS, 'h-48 resize-none rounded-md py-3', invalid && 'border border-semantic-danger')}
                />
                <div className="flex items-baseline justify-between gap-3 text-caption">
                    <span id={localId} className="text-muted">{t('memories.capsule.local')}</span>
                    {limit && <span data-testid="capsule-limit" className="shrink-0 tabular-nums text-secondary">{limit}</span>}
                </div>
                {failure && (
                    <p role="alert" className="text-small text-semantic-danger">
                        {failure === 'delete' ? t('memories.capsule.deleteFailed') : t('memories.capsule.failed')}
                    </p>
                )}
            </div>
        </Modal>
    );
};
