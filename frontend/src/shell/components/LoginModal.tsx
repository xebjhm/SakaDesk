// frontend/src/shell/components/LoginModal.tsx
import React, { useState } from 'react';
import { X, Loader2, LogIn } from 'lucide-react';
import { getServiceById, getServiceColor } from '../../data/services';
import { FEATURE_DEFINITIONS } from '../../config/features';
import type { FeatureId } from '../../store/appStore';
import { cn } from '../../utils/classnames';

interface LoginModalProps {
    serviceId: string;
    featureId: FeatureId;
    onClose: () => void;
    onSuccess: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
    serviceId,
    featureId,
    onClose,
    onSuccess,
}) => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const service = getServiceById(serviceId);
    const feature = FEATURE_DEFINITIONS[featureId];
    const serviceColor = getServiceColor(serviceId);

    const handleLogin = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/auth/login?service=${encodeURIComponent(serviceId)}`,
                { method: 'POST' }
            );
            if (!res.ok) throw new Error('Login failed or cancelled');

            // Initialize service settings entry
            await fetch(
                `/api/settings/service/${encodeURIComponent(serviceId)}/init`,
                { method: 'POST' }
            );

            onSuccess();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Login failed');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
                {/* Header */}
                <div className={cn('bg-gradient-to-r px-6 py-4', serviceColor)}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                                <LogIn className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">
                                    Login Required
                                </h3>
                                <p className="text-sm text-white/80">
                                    {service?.displayName ?? serviceId}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                        >
                            <X className="w-4 h-4 text-white" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    <p className="text-gray-600">
                        <span className="font-medium text-gray-900">
                            {feature?.label ?? featureId}
                        </span>{' '}
                        is a premium feature that requires logging in with your{' '}
                        {service?.name ?? serviceId} account.
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
                            Cancel
                        </button>
                        <button
                            onClick={handleLogin}
                            disabled={isLoading}
                            className={cn(
                                'flex-1 py-3 px-4 rounded-xl text-white font-medium transition-colors disabled:opacity-50 bg-gradient-to-r',
                                serviceColor
                            )}
                        >
                            {isLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Connecting...
                                </span>
                            ) : (
                                'Login'
                            )}
                        </button>
                    </div>

                    <p className="text-xs text-gray-400 text-center">
                        Your credentials are saved locally on your device.
                    </p>
                </div>
            </div>
        </div>
    );
};
