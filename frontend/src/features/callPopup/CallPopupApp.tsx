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
import { pickCandidate } from '../incomingCall/callDecision';
import { attachCallPopupHandler, installCallPopupBridge, requeueCallPopupStart } from './callPopupBridge';
import { CallPopupBoundary } from './CallPopupBoundary';
import { PopupCall } from './PopupCall';
import './callPopup.css';

// Published at module load so a host `start` that races the first mount is queued, not lost.
installCallPopupBridge();

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

interface ActiveRecord { callId: number; cancelled: boolean; loaded: boolean }

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
            const record: ActiveRecord = { callId, cancelled: false, loaded: false };
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
                const all = messagesRes.value.messages ?? [];
                // The popup rings exactly the voice the backend reserved: an `answered` for any other
                // message id is rejected as stale, so the heard mark would never be delivered. A newer
                // voice that arrived since gets its own call.
                if (pickCandidate(all)?.id !== info.message_id) {
                    clientLog('call_popup_error', { call_id: callId, error_type: 'message_mismatch' });
                }
                record.loaded = true;
                setCall({
                    callId,
                    info,
                    settings: settings.value,
                    messages: all.filter(m => m.type !== 'voice' || m.id === info.message_id),
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

        installCallPopupBridge();
        const detach = attachCallPopupHandler({ start, cancel });
        return () => {
            detach();
            document.documentElement.classList.remove('sd-call-popup-doc');
            const active = activeRef.current;
            if (!active) return;
            active.cancelled = true;
            // A start that never got as far as ringing survives a remount (StrictMode, hot reload).
            if (!active.loaded) requeueCallPopupStart(active.callId);
        };
    }, [post]);

    if (!call) return null;

    const onRenderCrash = () => {
        clientLog('call_popup_error', { call_id: call.callId, error_type: 'render_failed' });
        post(call.callId, 'error', { error_type: 'render_failed' });
        // The unmount that follows runs the hook's cleanup; its `cancelled` must not follow the error.
        if (activeRef.current?.callId === call.callId) activeRef.current.cancelled = true;
    };

    return (
        <CallPopupBoundary key={call.callId} onError={onRenderCrash}>
            <PopupCall
                info={call.info}
                settings={call.settings}
                messages={call.messages}
                member={call.member}
                readState={call.readState}
                post={(event, extra) => post(call.callId, event, extra)}
                preload={preload}
            />
        </CallPopupBoundary>
    );
};
