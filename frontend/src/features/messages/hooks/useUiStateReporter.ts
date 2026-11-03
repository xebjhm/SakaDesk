import { useEffect } from 'react';
import { parseReadStatePath } from '../readStatePath';

export const UI_STATE_DEBOUNCE_MS = 300;

/**
 * Tell the backend which chat is open and whether the window is focused
 * (POST /api/ui-state), so notifications skip the chat being viewed.
 * Reports on chat change and on focus / blur / visibility changes, debounced.
 * Only ids go over the wire (member_id "0" for a room); failures are swallowed.
 */
export function useUiStateReporter(chatDir: string | undefined): void {
    useEffect(() => {
        const parsed = chatDir ? parseReadStatePath(chatDir) : null;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const send = () => {
            timer = undefined;
            const body = {
                service: parsed ? parsed.service : null,
                group_id: parsed ? String(parsed.groupId) : null,
                member_id: parsed ? String(parsed.memberId) : null,
                focused: document.hasFocus() && document.visibilityState === 'visible',
            };
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
        };

        const schedule = () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(send, UI_STATE_DEBOUNCE_MS);
        };

        schedule();
        window.addEventListener('focus', schedule);
        window.addEventListener('blur', schedule);
        document.addEventListener('visibilitychange', schedule);
        return () => {
            if (timer !== undefined) clearTimeout(timer);
            window.removeEventListener('focus', schedule);
            window.removeEventListener('blur', schedule);
            document.removeEventListener('visibilitychange', schedule);
        };
    }, [chatDir]);
}
