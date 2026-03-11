// frontend/src/pages/LandingPage.tsx
import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { SERVICES, getServicePrimaryColor } from '../data/services';
import { SERVICE_FEATURES, FEATURE_DEFINITIONS } from '../config/features';
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
                                    'focus:outline-none focus:ring-2 focus:ring-offset-2',
                                    isSelected && 'ring-2 shadow-xl'
                                )}
                                style={isSelected ? { '--tw-ring-color': getServicePrimaryColor(service.id) } as React.CSSProperties : undefined}
                            >
                                {/* Selection indicator */}
                                <div
                                    className={cn(
                                        'absolute top-4 right-4 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors',
                                        isSelected
                                            ? 'border-transparent'
                                            : 'border-gray-300'
                                    )}
                                    style={isSelected ? { backgroundColor: getServicePrimaryColor(service.id), borderColor: getServicePrimaryColor(service.id) } : undefined}
                                >
                                    {isSelected && (
                                        <Check className="w-4 h-4 text-white" />
                                    )}
                                </div>

                                {/* Service icon with logo - white circle with colored ring when selected */}
                                <div
                                    className={cn(
                                        'w-16 h-16 rounded-full bg-white flex items-center justify-center mb-4 overflow-hidden shadow-sm transition-all',
                                        isSelected ? 'ring-[3px] ring-offset-2' : 'ring-1 ring-gray-200'
                                    )}
                                    style={isSelected ? { '--tw-ring-color': getServicePrimaryColor(service.id) } as React.CSSProperties : undefined}
                                >
                                    {service.logoUrl ? (
                                        <img
                                            src={service.logoUrl}
                                            alt={service.displayName}
                                            className="w-12 h-12 object-contain"
                                            onError={(e) => {
                                                e.currentTarget.style.display = 'none';
                                                e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                            }}
                                        />
                                    ) : null}
                                    <span className={cn(
                                        "text-gray-600 font-bold text-xl",
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
                                <div className="flex flex-wrap gap-1.5">
                                    {(SERVICE_FEATURES[service.id] || []).map(featureId => {
                                        const feature = FEATURE_DEFINITIONS[featureId];
                                        const Icon = feature.icon;
                                        return (
                                            <span key={featureId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">
                                                <Icon className="w-3 h-3" />
                                                {t(`features.${featureId}`)}
                                            </span>
                                        );
                                    })}
                                </div>
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
                                ? 'bg-gradient-to-r from-[#b4dcff] to-[#f0bede] text-white hover:from-[#a0d0fc] hover:to-[#e8b0d6] shadow-lg hover:shadow-xl'
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
