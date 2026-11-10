import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { Button, FIELD_CLASS, Modal } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { deleteCapsule, MemoriesFetchError, MemoriesTimeoutError, postCapsule, putCapsule } from '../api';
import { logMemoriesCapsule, logMemoriesSkip, MEMORIES_CAPSULE_ERROR_CODES, type MemoriesCapsuleErrorCode } from '../memoriesLog';
import type { CapsuleAnchorInput, CapsuleNote } from '../types';

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

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

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
 * - A failed write keeps the draft and shows 「メモを保存できませんでした」. A write that timed
 *   out may already be stored, so it is never retried here: the anchor's notes are refetched.
 * - Logs `memories_capsule` `save` (`created` / `updated`), `delete` and `failed` (`error_code`)
 *   with the anchor kind. The body is never logged.
 * - The request in flight is aborted on unmount.
 */
export const CapsuleEditor: React.FC<CapsuleEditorProps> = ({ service, anchor, note, onClose, onRefetch }) => {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(note?.body ?? '');
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const [invalid, setInvalid] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const fieldRef = useRef<HTMLTextAreaElement>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const localId = useId();
    const kind = anchor.kind;

    useEffect(() => () => controllerRef.current?.abort(), []);

    const length = chars(draft).length;
    const left = CAPSULE_MAX_CHARS - length;

    const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const next = chars(e.target.value);
        setDraft(next.length > CAPSULE_MAX_CHARS ? next.slice(0, CAPSULE_MAX_CHARS).join('') : e.target.value);
        setInvalid(false);
    };

    /** Run one write; true when it went through (the caller then refetches and closes). */
    const run = async (write: (signal: AbortSignal) => Promise<unknown>): Promise<boolean> => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        setBusy(true);
        setFailed(false);
        try {
            await write(controller.signal);
            return !controller.signal.aborted;
        } catch (err) {
            if (controller.signal.aborted || isAbort(err)) return false;
            const code = errorCode(err);
            logMemoriesCapsule('failed', { kind, error_code: code });
            setFailed(true);
            if (code === 'timeout') onRefetch();
            return false;
        } finally {
            if (!controller.signal.aborted) setBusy(false);
        }
    };

    const save = async () => {
        if (busy) return;
        const body = draft.trim();
        if (!body) {
            setInvalid(true);
            logMemoriesSkip('capsule', 'note_empty');
            fieldRef.current?.focus();
            return;
        }
        const ok = await run((signal) => (note
            ? putCapsule(service, note.id, draft, signal)
            : postCapsule(service, { anchor, body: draft }, signal)));
        if (!ok) return;
        logMemoriesCapsule('save', { kind, outcome: note ? 'updated' : 'created' });
        onRefetch();
        onClose();
    };

    const remove = async () => {
        if (!note || busy) return;
        const ok = await run((signal) => deleteCapsule(service, note.id, signal));
        if (!ok) return;
        logMemoriesCapsule('delete', { kind });
        onRefetch();
        onClose();
    };

    let footer: React.ReactNode;
    if (confirming) {
        footer = (
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
                <span className="mr-auto text-small text-primary">{t('memories.capsule.deleteConfirm')}</span>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>{t('memories.capsule.cancel')}</Button>
                <Button variant="danger" size="sm" loading={busy} onClick={() => { void remove(); }}>{t('memories.capsule.delete')}</Button>
            </div>
        );
    } else {
        footer = (
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
                {note && (
                    <Button variant="ghost" size="sm" className="mr-auto" onClick={() => setConfirming(true)}>{t('memories.capsule.delete')}</Button>
                )}
                <Button variant="ghost" size="sm" onClick={onClose}>{t('memories.capsule.cancel')}</Button>
                <Button variant="primary" size="sm" loading={busy} onClick={() => { void save(); }}>{t('memories.capsule.save')}</Button>
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
                {failed && <p role="alert" className="text-small text-semantic-danger">{t('memories.capsule.failed')}</p>}
            </div>
        </Modal>
    );
};
