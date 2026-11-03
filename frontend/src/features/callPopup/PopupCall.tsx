import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import { getServiceTheme } from '../../config/serviceThemes';
import { getServiceDisplayName } from '../../data/services';
import { formatName } from '../../utils';
import type { MemberInfo, Message } from '../../types';
import { CallAudio } from '../incomingCall/CallAudio';
import { CallScreen } from '../incomingCall/CallScreen';
import { preloadAudio } from '../incomingCall/preloadAudio';
import { getRingtone } from '../incomingCall/ringtone';
import { useIncomingCall, type CallOutcome } from '../incomingCall/useIncomingCall';
import type { AppSettings } from '../messages/MessagesFeature';
import { parseReadStatePath } from '../messages/readStatePath';
import { isUnreadIn, type ReadState } from '../messages/readStateStore';
import type { CallEventExtra, CallPopupEvent, CallPopupInfo } from './callPopupApi';

interface PopupCallProps {
    info: CallPopupInfo;
    settings: AppSettings;
    messages: Message[];
    member: MemberInfo | undefined;
    readState: ReadState;
    post: (event: CallPopupEvent, extra?: CallEventExtra) => void;
    preload?: (url: string, signal?: AbortSignal) => Promise<void>;
}

/** One popup call: B's call state machine on the shared CallScreen, reporting outcomes through `post`. */
export const PopupCall: React.FC<PopupCallProps> = ({
    info, settings, messages, member, readState, post, preload = preloadAudio,
}) => {
    const { t } = useTranslation();
    const isUnread = useMemo(() => isUnreadIn(readState), [readState]);
    const freshFetch = useMemo(() => ({ seq: 1, dir: info.path }), [info.path]);
    const logContext = useMemo(() => parseReadStatePath(info.path), [info.path]);
    const revealMessage = useCallback((id: number) => post('answered', { message_id: id }), [post]);
    const scrollToMessage = useCallback(() => {}, []);
    const onOutcome = useCallback((o: CallOutcome) => {
        if (o.kind === 'skipped') post('skipped', { reason: o.reason });
        else post(o.kind);
    }, [post]);

    const call = useIncomingCall({
        service: info.service,
        chatDir: info.path,
        isGroupChat: info.is_group_chat,
        messages,
        member,
        name: formatName(member?.name ?? ''),
        // The popup's own switch (Task 11 adds the field to AppSettings and drops the cast).
        enabled: (settings as { call_popup_enabled?: boolean }).call_popup_enabled ?? true,
        isUnread,
        freshFetch,
        revealMessage,
        scrollToMessage,
        logContext,
        surface: 'popup',
        onOutcome,
    }, preload);

    // Ringtone: silent today; getRingtone() is the one swap point.
    useEffect(() => {
        if (call.phase !== 'ringing') return;
        const ringtone = getRingtone();
        ringtone.start();
        return () => ringtone.stop();
    }, [call.phase]);

    // Talk timer: the same 250 ms tick as CallOverlay.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (call.phase !== 'connected') return;
        setNow(Date.now());
        const id = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(id);
    }, [call.phase]);

    const theme = getServiceTheme(info.service);
    const light = theme.messages.headerStyle === 'light';
    const accent = light ? theme.messages.bubbleBorder : theme.modals.accentColor;

    // One always-mounted live region, as in CallOverlay. No Esc/Enter handler:
    // the window never receives keyboard focus.
    const liveText = call.phase === 'ringing' ? `${call.name} ${t('call.incoming')}`
        : call.phase === 'ended' ? t('call.ended')
        : '';
    const liveRegion = <div role="status" aria-live="polite" className="sr-only">{liveText}</div>;

    if (call.phase === 'idle' || !call.message) return liveRegion;

    const talkSeconds = call.talkStartedAt ? (now - call.talkStartedAt) / 1000 : 0;
    return (
        <>
            {liveRegion}
            <div className="sd-call-popup" style={{ '--sd-accent': accent, '--sd-rad': '0px' } as React.CSSProperties}>
                <CallScreen
                    phase={call.phase}
                    name={call.name}
                    groupLabel={getServiceDisplayName(info.service)}
                    photoUrl={call.photoUrl}
                    talkSeconds={talkSeconds}
                    answerStyle={light ? 'light' : 'solid'}
                    onAnswer={call.answer}
                    onDecline={call.decline}
                    onHangUp={call.hangUp}
                />
                <div aria-hidden className="sd-call-halo sd-call-halo--inset" data-phase={call.phase} />
                <CallAudio
                    key={call.message.id}
                    phase={call.phase}
                    audioUrl={call.audioUrl}
                    onPlaybackEnded={call.onPlaybackEnded}
                    onPlaybackError={call.onPlaybackError}
                />
            </div>
        </>
    );
};
