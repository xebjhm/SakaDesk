import React from 'react';
import { Phone } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { formatTalkTime } from './formatTalkTime';
import type { CallPhase } from './useIncomingCall';
import './callScreen.css';

/** How the answer button carries the group colour: a filled gradient, or white with an accent ring. */
export type AnswerStyle = 'solid' | 'light';

interface CallScreenProps {
    phase: Exclude<CallPhase, 'idle'>;
    name: string;
    /** Service display name (e.g. 日向坂46); not translated. */
    groupLabel: string;
    photoUrl: string;
    /** Connected: the live talk time. Ended: the final talk time. */
    talkSeconds: number;
    answerStyle: AnswerStyle;
    onAnswer: () => void;
    onDecline: () => void;
    onHangUp: () => void;
}

const PhoneIcon = () => <Phone aria-hidden fill="currentColor" strokeWidth={1.5} />;

/**
 * The call card. Fills its parent; the host sets the size and the CSS variables
 * --sd-accent and --sd-rad. Presentational only; reused by the bottom-right popup (sub-project C).
 */
export const CallScreen: React.FC<CallScreenProps> = ({
    phase, name, groupLabel, photoUrl, talkSeconds, answerStyle, onAnswer, onDecline, onHangUp,
}) => {
    const { t } = useTranslation();
    return (
        <div className="sd-call-screen" data-phase={phase} data-answer-style={answerStyle}>
            <img className="sd-call-photo" src={photoUrl} alt="" />

            {phase === 'ringing' && (
                <>
                    <div className="sd-call-band sd-call-band--bottom" aria-hidden>
                        <div className="sd-call-band-blur" />
                        <div className="sd-call-band-tint" />
                    </div>
                    <div className="sd-call-ring">
                        <div className="sd-call-who">
                            <div className="sd-call-eyebrow"><span className="sd-call-dot" aria-hidden />{groupLabel}</div>
                            <div className="sd-call-name">{name}</div>
                            <div className="sd-call-status">{t('call.incoming')}</div>
                        </div>
                        <div className="sd-call-actions">
                            <div className="sd-call-act">
                                <button type="button" className="sd-call-btn sd-call-btn--decline" aria-label={t('call.decline')} onClick={onDecline}>
                                    <PhoneIcon />
                                </button>
                                <span className="sd-call-act-label" aria-hidden>{t('call.decline')}</span>
                            </div>
                            <div className="sd-call-act">
                                <button type="button" className="sd-call-btn sd-call-btn--answer" aria-label={t('call.answer')} onClick={onAnswer}>
                                    <span className="sd-call-ripple" aria-hidden />
                                    <span className="sd-call-ripple sd-call-ripple--late" aria-hidden />
                                    <PhoneIcon />
                                </button>
                                <span className="sd-call-act-label" aria-hidden>{t('call.answer')}</span>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {phase === 'connected' && (
                <>
                    <div className="sd-call-band sd-call-band--top" aria-hidden>
                        <div className="sd-call-band-blur" />
                        <div className="sd-call-band-tint" />
                    </div>
                    <div className="sd-call-shade-bottom" aria-hidden />
                    <div className="sd-call-talk">
                        <div className="sd-call-name">{name}</div>
                        <div className="sd-call-timer"><span className="sd-call-live" aria-hidden />{formatTalkTime(talkSeconds)}</div>
                    </div>
                    <div className="sd-call-dock">
                        <div className="sd-call-act">
                            <button type="button" className="sd-call-btn sd-call-btn--decline" aria-label={t('call.hangUp')} onClick={onHangUp}>
                                <PhoneIcon />
                            </button>
                            <span className="sd-call-act-label" aria-hidden>{t('call.hangUp')}</span>
                        </div>
                    </div>
                </>
            )}

            {phase === 'ended' && (
                <div className="sd-call-endcard">
                    <div className="sd-call-endcard-title">{t('call.ended')}</div>
                    <div className="sd-call-endcard-time">{formatTalkTime(talkSeconds)}</div>
                </div>
            )}
        </div>
    );
};
