// frontend/src/pages/LandingPage.tsx
import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { SERVICES } from '../data/services';
import { cn } from '../utils/classnames';
import { useTranslation } from '../i18n';

interface LandingPageProps {
    onComplete: (selectedServices: string[]) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onComplete }) => {
    const { t } = useTranslation();
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const toggleService = (serviceId: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(serviceId)) {
                next.delete(serviceId);
            } else {
                next.add(serviceId);
            }
            return next;
        });
    };

    const handleGetStarted = () => {
        if (selected.size > 0) {
            onComplete(Array.from(selected));
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col items-center justify-center p-4">
            <div className="max-w-4xl w-full">
                {/* Header */}
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-bold text-gray-900 mb-3">
                        {t('landing.welcome')}
                    </h1>
                    <p className="text-lg text-gray-500">
                        {t('landing.selectGroups')}
                    </p>
                </div>

                {/* Service Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                    {SERVICES.map((service) => {
                        const isSelected = selected.has(service.id);
                        return (
                            <button
                                key={service.id}
                                onClick={() => toggleService(service.id)}
                                className={cn(
                                    'relative bg-white rounded-2xl shadow-lg p-6 text-left transition-all transform hover:scale-[1.02]',
                                    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500',
                                    isSelected && 'ring-2 ring-blue-500 shadow-xl'
                                )}
                            >
                                {/* Selection indicator */}
                                <div
                                    className={cn(
                                        'absolute top-4 right-4 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors',
                                        isSelected
                                            ? 'bg-blue-500 border-blue-500'
                                            : 'border-gray-300'
                                    )}
                                >
                                    {isSelected && (
                                        <Check className="w-4 h-4 text-white" />
                                    )}
                                </div>

                                {/* Service icon with logo */}
                                <div
                                    className={cn(
                                        'w-16 h-16 rounded-2xl bg-gradient-to-br flex items-center justify-center mb-4 overflow-hidden',
                                        service.color
                                    )}
                                >
                                    {service.logoUrl ? (
                                        <img
                                            src={service.logoUrl}
                                            alt={service.displayName}
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                e.currentTarget.style.display = 'none';
                                                e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                            }}
                                        />
                                    ) : null}
                                    <span className={cn(
                                        "text-white font-bold text-xl",
                                        service.logoUrl ? "hidden" : ""
                                    )}>
                                        {service.shortCode}
                                    </span>
                                </div>

                                {/* Service info */}
                                <h2 className="text-xl font-semibold text-gray-900 mb-1">
                                    {service.displayName}
                                </h2>
                                <p className="text-sm text-gray-500 mb-2">
                                    {service.name}
                                </p>
                                <p className="text-sm text-gray-400">
                                    {service.description}
                                </p>
                            </button>
                        );
                    })}
                </div>

                {/* Get Started button */}
                <div className="text-center">
                    <button
                        onClick={handleGetStarted}
                        disabled={selected.size === 0}
                        className={cn(
                            'px-8 py-4 rounded-xl text-lg font-semibold transition-all',
                            selected.size > 0
                                ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600 shadow-lg hover:shadow-xl'
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        )}
                    >
                        {selected.size === 0
                            ? t('landing.selectAtLeastOne')
                            : selected.size === 1
                            ? t('landing.getStarted')
                            : t('landing.getStartedWith', { count: selected.size })}
                    </button>
                </div>

                {/* Footer note */}
                <div className="text-center text-sm text-gray-400 mt-8">
                    <p>
                        {t('landing.footerNote')}
                    </p>
                </div>
            </div>
        </div>
    );
};
