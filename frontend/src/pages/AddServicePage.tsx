// frontend/src/pages/AddServicePage.tsx
import React, { useState } from 'react';
import { Loader2, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';

interface ServiceCardInfo {
    id: string;
    name: string;
    displayName: string;
    color: string;
    description: string;
}

const SERVICES: ServiceCardInfo[] = [
    {
        id: 'hinatazaka46',
        name: 'Hinatazaka46',
        displayName: '日向坂46',
        color: 'from-[#7cc7e8] to-[#5eb3d8]',
        description: 'Connect to Hinatazaka46 Message app',
    },
    {
        id: 'sakurazaka46',
        name: 'Sakurazaka46',
        displayName: '櫻坂46',
        color: 'from-[#f19db5] to-[#e87a9a]',
        description: 'Connect to Sakurazaka46 Message app',
    },
    {
        id: 'nogizaka46',
        name: 'Nogizaka46',
        displayName: '乃木坂46',
        color: 'from-[#7e1083] to-[#5a0b5e]',
        description: 'Connect to Nogizaka46 Message app',
    },
];

interface AddServicePageProps {
    onLoginSuccess: () => void;
    onBack?: () => void;
    connectedServices?: string[];
}

export const AddServicePage: React.FC<AddServicePageProps> = ({
    onLoginSuccess,
    onBack,
    connectedServices = [],
}) => {
    const [loadingService, setLoadingService] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleConnect = async (serviceId: string) => {
        setLoadingService(serviceId);
        setError(null);
        try {
            const res = await fetch(`/api/auth/login?service=${encodeURIComponent(serviceId)}`, { method: 'POST' });
            if (!res.ok) throw new Error("Login failed or cancelled");
            onLoginSuccess();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoadingService(null);
        }
    };

    const availableServices = SERVICES.filter(s => !connectedServices.includes(s.id));

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col items-center justify-center p-4">
            <div className="max-w-3xl w-full">
                {onBack && (
                    <button
                        onClick={onBack}
                        className="mb-6 flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </button>
                )}

                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">
                        {connectedServices.length === 0 ? 'Welcome to HakoDesk' : 'Add Service'}
                    </h1>
                    <p className="text-gray-500">
                        {connectedServices.length === 0
                            ? 'Connect to a service to get started'
                            : 'Connect to another service'
                        }
                    </p>
                </div>

                {error && (
                    <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm mb-6 text-center">
                        {error}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {availableServices.map(service => (
                        <button
                            key={service.id}
                            onClick={() => handleConnect(service.id)}
                            disabled={loadingService !== null}
                            className={cn(
                                "relative bg-white rounded-2xl shadow-lg p-6 text-left transition-all transform hover:scale-[1.02] hover:shadow-xl",
                                "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500",
                                loadingService === service.id && "ring-2 ring-blue-500",
                                loadingService !== null && loadingService !== service.id && "opacity-50"
                            )}
                        >
                            <div className={cn(
                                "w-16 h-16 rounded-2xl bg-gradient-to-br flex items-center justify-center mb-4",
                                service.color
                            )}>
                                <span className="text-white font-bold text-xl">
                                    {service.id === 'hinatazaka46' ? 'HI' :
                                     service.id === 'sakurazaka46' ? 'SA' : 'NO'}
                                </span>
                            </div>

                            <h2 className="text-lg font-semibold text-gray-900 mb-1">
                                {service.displayName}
                            </h2>
                            <p className="text-sm text-gray-500 mb-4">
                                {service.description}
                            </p>

                            <div className={cn(
                                "py-2 px-4 rounded-xl text-center font-medium text-sm transition-colors",
                                loadingService === service.id
                                    ? "bg-gray-100 text-gray-500"
                                    : "bg-gradient-to-r text-white " + service.color
                            )}>
                                {loadingService === service.id ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Connecting...
                                    </span>
                                ) : (
                                    "Connect"
                                )}
                            </div>
                        </button>
                    ))}
                </div>

                {availableServices.length === 0 && (
                    <div className="text-center text-gray-500 py-12">
                        <p>All services are already connected!</p>
                    </div>
                )}

                <div className="text-center text-xs text-gray-400 mt-8">
                    Your credentials are saved locally on your device.
                </div>
            </div>
        </div>
    );
};
