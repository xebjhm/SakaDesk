import React, { useState, useCallback } from 'react';
import { Loader2, LogIn, CheckCircle2, SkipForward, RotateCcw } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { getServiceById, getServiceColor } from '../../data/services';
import { cn } from '../../utils/classnames';

interface OnboardingLoginFlowProps {
    selectedServices: string[];
    onComplete: (connectedServices: string[]) => void;
}

type StepStatus = 'pending' | 'logging_in' | 'success' | 'failed';

export const OnboardingLoginFlow: React.FC<OnboardingLoginFlowProps> = ({
    selectedServices,
    onComplete,
}) => {
    const { t } = useTranslation();
    const [currentIndex, setCurrentIndex] = useState(0);
    const [status, setStatus] = useState<StepStatus>('pending');
    const [connectedServices, setConnectedServices] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    const currentServiceId = selectedServices[currentIndex];
    const currentService = getServiceById(currentServiceId);
    const serviceColor = getServiceColor(currentServiceId);
    const total = selectedServices.length;

    const advance = useCallback((connected: string[]) => {
        const nextIndex = currentIndex + 1;
        if (nextIndex >= total) {
            // All services processed
            if (connected.length === 0) {
                // None connected — reset to let user try again
                setCurrentIndex(0);
                setStatus('pending');
                setError(t('login.noServicesConnected'));
            } else {
                onComplete(connected);
            }
        } else {
            setCurrentIndex(nextIndex);
            setStatus('pending');
            setError(null);
        }
    }, [currentIndex, total, onComplete, t]);

    const handleLogin = async () => {
        setStatus('logging_in');
        setError(null);
        try {
            const res = await fetch(
                `/api/auth/login?service=${encodeURIComponent(currentServiceId)}`,
                { method: 'POST' }
            );
            if (!res.ok) throw new Error(t('login.loginFailed'));

            // Initialize service settings
            await fetch(
                `/api/settings/service/${encodeURIComponent(currentServiceId)}/init`,
                { method: 'POST' }
            );

            setStatus('success');
            const updated = [...connectedServices, currentServiceId];
            setConnectedServices(updated);

            // Brief success indicator then auto-advance
            setTimeout(() => advance(updated), 800);
        } catch (err: unknown) {
            setStatus('failed');
            setError(err instanceof Error ? err.message : t('login.loginFailed'));
        }
    };

    const handleSkip = () => {
        advance(connectedServices);
    };

    const handleRetry = () => {
        setStatus('pending');
        setError(null);
    };

    return (
        <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
                {/* Header */}
                <div className={cn('bg-gradient-to-r px-6 py-4', serviceColor)}>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                            {status === 'success'
                                ? <CheckCircle2 className="w-5 h-5 text-white" />
                                : <LogIn className="w-5 h-5 text-white" />
                            }
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">
                                {t('onboarding.connectingService', {
                                    current: currentIndex + 1,
                                    total,
                                })}
                            </h3>
                            <p className="text-sm text-white/80">
                                {currentService?.displayName ?? currentServiceId}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Progress dots */}
                <div className="flex justify-center gap-2 pt-4 px-6">
                    {selectedServices.map((svcId, i) => {
                        const isComplete = connectedServices.includes(svcId);
                        const isCurrent = i === currentIndex;
                        const isSkipped = i < currentIndex && !connectedServices.includes(svcId);
                        return (
                            <div
                                key={svcId}
                                className={cn(
                                    'w-2.5 h-2.5 rounded-full transition-all',
                                    isComplete ? 'bg-green-500' :
                                    isCurrent ? 'bg-blue-500 ring-4 ring-blue-100' :
                                    isSkipped ? 'bg-gray-300' :
                                    'bg-gray-200'
                                )}
                            />
                        );
                    })}
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    {status === 'success' ? (
                        <div className="flex items-center justify-center gap-2 text-green-600 py-2">
                            <CheckCircle2 className="w-5 h-5" />
                            <span className="font-medium">{t('onboarding.connected')}</span>
                        </div>
                    ) : (
                        <>
                            <p className="text-gray-600 text-sm">
                                {status === 'failed'
                                    ? t('onboarding.loginFailedDesc', { service: currentService?.displayName ?? currentServiceId })
                                    : t('onboarding.loginDesc', { service: currentService?.displayName ?? currentServiceId })
                                }
                            </p>

                            {error && (
                                <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm">
                                    {error}
                                </div>
                            )}

                            <div className="flex gap-3">
                                {status === 'failed' ? (
                                    <>
                                        <button
                                            onClick={handleSkip}
                                            className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                                        >
                                            <SkipForward className="w-4 h-4" />
                                            {t('onboarding.skipForNow')}
                                        </button>
                                        <button
                                            onClick={handleRetry}
                                            className={cn(
                                                'flex-1 py-3 px-4 rounded-xl text-white font-medium transition-colors bg-gradient-to-r flex items-center justify-center gap-2',
                                                serviceColor
                                            )}
                                        >
                                            <RotateCcw className="w-4 h-4" />
                                            {t('onboarding.retry')}
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        onClick={handleLogin}
                                        disabled={status === 'logging_in'}
                                        className={cn(
                                            'w-full py-3 px-4 rounded-xl text-white font-medium transition-colors disabled:opacity-50 bg-gradient-to-r',
                                            serviceColor
                                        )}
                                    >
                                        {status === 'logging_in' ? (
                                            <span className="flex items-center justify-center gap-2">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                {t('login.connecting')}
                                            </span>
                                        ) : (
                                            t('common.login')
                                        )}
                                    </button>
                                )}
                            </div>
                        </>
                    )}

                    <p className="text-xs text-gray-400 text-center">
                        {t('login.credentialsSaved')}
                    </p>
                </div>
            </div>
        </div>
    );
};
