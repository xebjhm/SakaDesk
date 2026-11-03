import React from 'react';
import { motion } from 'framer-motion';
import { Phone, PhoneOff } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { formatTalkTime } from './formatTalkTime';
import type { CallPhase } from './useIncomingCall';

interface CallScreenProps {
    phase: Exclude<CallPhase, 'idle'>;
    name: string;
    photoUrl: string;
    talkSeconds: number;
    onAnswer: () => void;
    onDecline: () => void;
    onHangUp: () => void;
}

/** The upright "phone". Presentational only; reused by the bottom-right popup (sub-project C). */
export const CallScreen: React.FC<CallScreenProps> = ({
    phase, name, photoUrl, talkSeconds, onAnswer, onDecline, onHangUp,
}) => {
    const { t } = useTranslation();
    return (
        <div className="relative shrink-0 w-auto aspect-[1/2] h-[min(560px,calc(100%-32px))] rounded-[44px] bg-black p-2.5 shadow-2xl">
            <div className="relative w-full h-full rounded-[36px] overflow-hidden bg-gray-900">
                {phase === 'ringing' && (
                    <div className="flex flex-col h-full">
                        <div className="relative flex-1 overflow-hidden">
                            <motion.img
                                src={photoUrl}
                                alt=""
                                className="absolute inset-0 w-full h-full object-cover"
                                animate={{ scale: [1, 1.04, 1] }}
                                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                            />
                            <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/70 to-transparent text-white">
                                <p className="text-xl font-semibold">{name}</p>
                                <p aria-live="polite" className="text-sm opacity-90">{t('call.incoming')}</p>
                            </div>
                        </div>
                        <div className="flex items-center justify-around bg-white py-6">
                            <motion.button
                                type="button"
                                aria-label={t('call.decline')}
                                onClick={onDecline}
                                className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg"
                                animate={{ rotate: [0, -6, 6, 0] }}
                                transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 0.6 }}
                            >
                                <PhoneOff className="w-7 h-7" />
                            </motion.button>
                            <motion.button
                                type="button"
                                aria-label={t('call.answer')}
                                onClick={onAnswer}
                                className="w-16 h-16 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-lg"
                                animate={{ rotate: [0, 6, -6, 0] }}
                                transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 0.6 }}
                            >
                                <Phone className="w-7 h-7" />
                            </motion.button>
                        </div>
                    </div>
                )}

                {phase === 'connected' && (
                    <>
                        <img src={photoUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        <div className="absolute inset-x-0 top-0 pt-10 pb-8 text-center text-white bg-gradient-to-b from-black/60 to-transparent">
                            <p className="text-xl font-semibold">{name}</p>
                            <p className="text-sm tabular-nums opacity-90">{formatTalkTime(talkSeconds)}</p>
                        </div>
                        <div className="absolute inset-x-0 bottom-10 flex justify-center">
                            <button
                                type="button"
                                aria-label={t('call.hangUp')}
                                onClick={onHangUp}
                                className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg"
                            >
                                <PhoneOff className="w-7 h-7" />
                            </button>
                        </div>
                    </>
                )}

                {phase === 'ended' && (
                    <>
                        <img src={photoUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40 grayscale" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <p aria-live="polite" className="text-lg font-semibold text-white">{t('call.ended')}</p>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
