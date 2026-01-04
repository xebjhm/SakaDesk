import React, { useState } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface LoginPageProps {
    onLoginSuccess: () => void;
    initialError?: string;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, initialError }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(initialError || null);

    const handleLogin = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/auth/login', { method: 'POST' });
            if (!res.ok) throw new Error("Login failed or cancelled");
            onLoginSuccess();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center space-y-6">
                <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <LogIn className="w-8 h-8" />
                </div>

                <h1 className="text-2xl font-bold text-gray-900">Connect Account</h1>
                <p className="text-gray-500">
                    Please log in to your Hinatazaka46 Message account.
                    A browser window will open for you to enter your credentials.
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
                        isLoading ? "bg-gray-400 cursor-not-allowed" : "bg-gradient-to-r from-blue-500 to-indigo-600 hover:shadow-xl"
                    )}
                >
                    {isLoading ? (
                        <span className="flex items-center justify-center gap-2">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Waiting for browser...
                        </span>
                    ) : (
                        "Launch Browser Login"
                    )}
                </button>

                <div className="text-xs text-gray-400 pt-4">
                    Your credentials are saved locally on your device.
                </div>
            </div>
        </div>
    );
};
