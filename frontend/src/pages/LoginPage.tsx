import React, { useState } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { cn } from '../utils/classnames';
import { useTranslation } from '../i18n';

interface LoginPageProps {
    service: string;
    onLoginSuccess: () => void;
    initialError?: string;
}

export const LoginPage: React.FC<LoginPageProps> = ({ service, onLoginSuccess, initialError }) => {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(initialError || null);

    const handleLogin = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/auth/login?service=${encodeURIComponent(service)}`, { method: 'POST' });
            if (!res.ok) throw new Error(t('login.loginFailed'));

            // Brief delay before advancing to prevent concurrent browser launches
            await new Promise(resolve => setTimeout(resolve, 1500));
            onLoginSuccess();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#F0F2F5] flex flex-col items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center space-y-6">
                <div className="w-16 h-16 bg-blue-50 text-blue-400 rounded-full flex items-center justify-center mx-auto mb-4">
                    <LogIn className="w-8 h-8" />
                </div>

                <h1 className="text-2xl font-bold text-gray-900">{t('login.connectAccount')}</h1>
                <p className="text-gray-500">
                    {t('login.browserPrompt', { service })}
                </p>

                {error && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                        {error}
                    </div>
                )}

                <button
                    onClick={handleLogin}
                    disabled={isLoading}
                    className={cn(
                        "w-full py-3 px-4 rounded-xl font-semibold text-white shadow-lg transition-all transform hover:scale-[1.02]",
                        isLoading ? "bg-gray-400 cursor-not-allowed" : "bg-gradient-to-r from-[#b4dcff] to-[#f0bede] hover:shadow-xl"
                    )}
                >
                    {isLoading ? (
                        <span className="flex items-center justify-center gap-2">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            {t('login.waitingForBrowser')}
                        </span>
                    ) : (
                        t('login.launchBrowserLogin')
                    )}
                </button>

                <div className="text-xs text-gray-400 pt-4">
                    {t('login.credentialsSaved')}
                </div>
            </div>
        </div>
    );
};
