import { useEffect, useRef } from 'react';
import { parseReadStatePath } from '../readStatePath';

export const UI_STATE_DEBOUNCE_MS = 300;

type UiStateBody = {
    service: string | null;
    group_id: string | null;
    member_id: string | null;
    focused: boolean;
};

const isFocused = () => document.hasFocus() && document.visibilityState === 'visible';

function postUiState(body: UiStateBody): void {
    try {
        fetch('/api/ui-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
            .then(res => {
                if (!res.ok) console.debug('[uiState] rejected', res.status);
            })
            .catch(err => console.debug('[uiState] failed', err));
    } catch (err) {
        console.debug('[uiState] failed', err);
    }
}

/**
 * Tell the backend which chat is open and whether the window is focused
 * (POST /api/ui-state), so notifications skip the chat being viewed.
 * Reports on chat change and on focus / blur / visibility changes, debounced.
 * On a real unmount (the messages feature closing) an immediate cleared report
 * (all ids null) is sent so the backend stops treating the chat as viewed.
 * Only ids go over the wire (member_id "0" for a room); failures are swallowed.
 */
export function useUiStateReporter(chatDir: string | undefined): void {
    // Pending debounced report; shared so the unmount cleanup can cancel it.
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        const parsed = chatDir ? parseReadStatePath(chatDir) : null;

        const send = () => {
            timerRef.current = undefined;
            postUiState({
                service: parsed ? parsed.service : null,
                group_id: parsed ? String(parsed.groupId) : null,
                member_id: parsed ? String(parsed.memberId) : null,
                focused: isFocused(),
            });
        };

        const schedule = () => {
            if (timerRef.current !== undefined) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(send, UI_STATE_DEBOUNCE_MS);
        };

        schedule();
        window.addEventListener('focus', schedule);
        window.addEventListener('blur', schedule);
        document.addEventListener('visibilitychange', schedule);
        return () => {
            if (timerRef.current !== undefined) clearTimeout(timerRef.current);
            timerRef.current = undefined;
            window.removeEventListener('focus', schedule);
            window.removeEventListener('blur', schedule);
            document.removeEventListener('visibilitychange', schedule);
        };
    }, [chatDir]);

    // Real unmount only (empty deps): the feature closed, so no chat is being
    // viewed. Report that immediately; the chatDir effect's cleanup has already
    // cancelled any pending debounced report, so none can land after this one.
    useEffect(() => {
        return () => {
            if (timerRef.current !== undefined) clearTimeout(timerRef.current);
            timerRef.current = undefined;
            postUiState({ service: null, group_id: null, member_id: null, focused: isFocused() });
        };
    }, []);
}
