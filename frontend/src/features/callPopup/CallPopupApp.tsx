import React, { useCallback, useEffect, useRef, useState } from 'react';
import { persisted } from '../../core/persistence/persisted';
import { clientLog } from '../../utils/clientLog';
import type { MemberInfo, Message } from '../../types';
import { applyStartupLanguage } from '../../shell/language';
import type { AppSettings } from '../messages/MessagesFeature';
import { parseReadState, readStateKey, type ReadState } from '../messages/readStateStore';
import {
    fetchCallInfo, postCallEvent,
    type CallEventExtra, type CallPopupEvent, type CallPopupInfo,
} from './callPopupApi';
import { PopupCall } from './PopupCall';
import './callPopup.css';

declare global {
    interface Window {
        /** Called by the desktop host: ring the reserved call / cancel it. */
        __sakadeskCallPopup?: { start(callId: number): void; cancel(callId: number): void };
    }
}

interface CallPopupAppProps {
    /** Test seam: replaces the audio preload. */
    preload?: (url: string, signal?: AbortSignal) => Promise<void>;
}

interface LoadedCall {
    callId: number;
    info: CallPopupInfo;
    settings: AppSettings;
    messages: Message[];
    member: MemberInfo | undefined;
    readState: ReadState;
}

interface ActiveRecord { callId: number; cancelled: boolean }

async function getJson<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json() as T;
}

/**
 * The bottom-right call popup page. Read-only: it reads prefs, the conversation row and the
 * messages, and reports outcomes to the backend controller; it never writes prefs, conversation
 * rows or read state (only the main window does).
 */
export const CallPopupApp: React.FC<CallPopupAppProps> = ({ preload }) => {
    const [call, setCall] = useState<LoadedCall | null>(null);
    const activeRef = useRef<ActiveRecord | null>(null);

    const post = useCallback((callId: number, event: CallPopupEvent, extra?: CallEventExtra) => {
        const active = activeRef.current;
        if (active && active.callId === callId && !active.cancelled) postCallEvent(callId, event, extra);
    }, []);

    useEffect(() => {
        document.documentElement.classList.add('sd-call-popup-doc');

        const fail = (callId: number, errorType: string) => {
            clientLog('call_popup_error', { call_id: callId, error_type: errorType });
            post(callId, 'error', { error_type: errorType });
        };

        const start = (callId: number) => {
            if (activeRef.current) activeRef.current.cancelled = true;
            const record: ActiveRecord = { callId, cancelled: false };
            activeRef.current = record;
            setCall(null);
            clientLog('call_popup_start', { call_id: callId });

            void (async () => {
                let info: CallPopupInfo | null;
                try {
                    info = await fetchCallInfo(callId);
                } catch {
                    fail(callId, 'info_failed');
                    return;
                }
                if (record.cancelled) return;
                if (!info) {
                    clientLog('call_popup_error', { call_id: callId, error_type: 'info_not_found' });
                    return;
                }
                try {
                    await persisted.hydratePrefs();
                    await applyStartupLanguage();
                } catch {
                    fail(callId, 'start_failed');
                    return;
                }
                if (record.cancelled) return;

                const [settings, messagesRes, readRow] = await Promise.allSettled([
                    getJson<AppSettings>('/api/settings'),
                    getJson<{ messages: Message[]; member?: MemberInfo | null }>(
                        `/api/content/messages_by_path?path=${encodeURIComponent(info.path)}&limit=0`,
                    ),
                    persisted.getConversation(readStateKey(info.path)),
                ]);
                if (record.cancelled) return;
                if (settings.status === 'rejected') { fail(callId, 'settings_failed'); return; }
                if (messagesRes.status === 'rejected') { fail(callId, 'messages_failed'); return; }
                if (readRow.status === 'rejected') { fail(callId, 'read_state_failed'); return; }
                setCall({
                    callId,
                    info,
                    settings: settings.value,
                    messages: messagesRes.value.messages ?? [],
                    member: messagesRes.value.member ?? undefined,
                    readState: parseReadState(readRow.value),
                });
            })();
        };

        const cancel = (callId: number) => {
            const active = activeRef.current;
            if (!active || active.callId !== callId) return;
            active.cancelled = true;
            setCall(null);
        };

        window.__sakadeskCallPopup = { start, cancel };
        return () => {
            delete window.__sakadeskCallPopup;
            document.documentElement.classList.remove('sd-call-popup-doc');
            if (activeRef.current) activeRef.current.cancelled = true;
        };
    }, [post]);

    if (!call) return null;
    return (
        <PopupCall
            key={call.callId}
            info={call.info}
            settings={call.settings}
            messages={call.messages}
            member={call.member}
            readState={call.readState}
            post={(event, extra) => post(call.callId, event, extra)}
            preload={preload}
        />
    );
};
