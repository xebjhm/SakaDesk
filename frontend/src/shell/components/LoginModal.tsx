// frontend/src/shell/components/LoginModal.tsx
import React, { useState, useMemo } from 'react';
import { X, Loader2, LogIn } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { getServiceById } from '../../data/services';
import { getServiceTheme } from '../../config/serviceThemes';
import { FEATURE_DEFINITIONS } from '../../config/features';
import type { FeatureId } from '../../store/appStore';
import { cn } from '../../utils/classnames';
import { useModalClose } from '../../core/common/useModalClose';

interface LoginModalProps {
    serviceId: string;
    featureId: FeatureId;
    onClose: () => void;
    onSuccess: () => void;
    isDisconnected?: boolean;  // true if session expired (vs never connected)
    isFreshPrompt?: boolean;   // true for gentle "connect your account?" prompt after adding service
}

export const LoginModal: React.FC<LoginModalProps> = ({
    serviceId,
    featureId,
    onClose,
    onSuccess,
    isDisconnected = false,
    isFreshPrompt = false,
}) => {
    const { t } = useTranslation();
    const handleBackdropClick = useModalClose(true, onClose);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const service = getServiceById(serviceId);
    const feature = FEATURE_DEFINITIONS[featureId];
    const theme = getServiceTheme(serviceId);
    const isLightHeader = theme.messages.headerStyle === 'light';
    const headerBg = useMemo(() => {
        if (isLightHeader) return '#FFFFFF';
        const { from, via, to } = theme.messages.headerGradient;
        return `linear-gradient(to right, ${from}, ${via}, ${to})`;
    }, [theme, isLightHeader]);
    const headerTextColor = isLightHeader ? theme.messages.headerTextColor : 'white';

    const handleLogin = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/auth/login?service=${encodeURIComponent(serviceId)}`,
                { method: 'POST' }
            );
            if (!res.ok) throw new Error(t('login.loginFailed'));

            // Initialize service settings entry
            await fetch(
                `/api/settings/service/${encodeURIComponent(serviceId)}/init`,
                { method: 'POST' }
            );

            onSuccess();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t('login.loginFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={handleBackdropClick}>
            <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Header — matches chat room header style per service */}
                <div
                    className={cn('px-6 py-4', !isLightHeader && 'shadow-sm')}
                    style={{ background: headerBg }}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div
                                className="w-10 h-10 rounded-full flex items-center justify-center"
                                style={{ backgroundColor: isLightHeader ? `${headerTextColor}15` : 'rgba(255,255,255,0.2)' }}
                            >
                                <LogIn className="w-5 h-5" style={{ color: headerTextColor }} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold" style={{ color: headerTextColor }}>
                                    {isFreshPrompt
                                        ? t('login.connectPromptTitle')
                                        : isDisconnected
                                            ? t('login.sessionExpired')
                                            : t('login.loginRequired')}
                                </h3>
                                <p className="text-sm" style={{ color: headerTextColor, opacity: 0.8 }}>
                                    {service?.displayName ?? serviceId}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                            style={{ backgroundColor: isLightHeader ? `${headerTextColor}15` : 'rgba(255,255,255,0.2)' }}
                        >
                            <X className="w-4 h-4" style={{ color: headerTextColor }} />
                        </button>
                    </div>
                </div>
                {/* Gradient bar below header (light style only, e.g. Sakurazaka) */}
                {isLightHeader && (
                    <div className="h-1" style={{ background: theme.messages.headerBarGradient }} />
                )}

                {/* Content */}
                <div className="p-6 space-y-4">
                    <p className="text-gray-600">
                        {isFreshPrompt
                            ? t('login.connectPromptDesc', {
                                service: service?.displayName ?? serviceId,
                            })
                            : isDisconnected
                                ? t('login.sessionExpiredDesc', {
                                    service: service?.displayName ?? serviceId,
                                    feature: feature?.label ?? featureId
                                })
                                : t('login.premiumFeatureDesc', {
                                    feature: feature?.label ?? featureId,
                                    service: service?.name ?? serviceId
                                })
                        }
                    </p>

                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm">
                            {error}
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            disabled={isLoading}
                            className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                            {isFreshPrompt ? t('login.maybeLater') : t('common.cancel')}
                        </button>
                        <button
                            onClick={handleLogin}
                            disabled={isLoading}
                            className="flex-1 py-3 px-4 rounded-xl text-white font-medium transition-colors disabled:opacity-50"
                            style={{ backgroundColor: theme.primaryColor }}
                        >
                            {isLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    {t('login.connecting')}
                                </span>
                            ) : (
                                isFreshPrompt ? t('login.connectAccount') : t('common.login')
                            )}
                        </button>
                    </div>

                    <p className="text-xs text-gray-400 text-center">
                        {t('login.credentialsSaved')}
                    </p>
                </div>
            </div>
        </div>
    );
};
