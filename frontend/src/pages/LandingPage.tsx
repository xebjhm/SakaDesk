import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { SERVICES } from '../data/services';
import { SERVICE_FEATURES, FEATURE_DEFINITIONS } from '../config/features';
import { Button, Canvas, Sheet } from '../design/primitives';
import { cn } from '../utils/classnames';
import { useTranslation } from '../i18n';

interface LandingPageProps {
    onComplete: (selectedServices: string[]) => void;
}

/**
 * Pick the groups to follow (first launch, or every group removed). No group is active yet, so
 * the page uses the neutral `default` roles (spec D2d decisions 3, 8): one sheet on the canvas,
 * one toggle card per group, one primary button.
 */
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
        <Canvas className="flex min-h-screen items-center justify-center p-4">
            <Sheet className="flex w-full max-w-4xl flex-col gap-8 p-10 animate-reveal motion-reduce:animate-none">
                <header className="flex flex-col gap-2 text-center">
                    <h1 className="text-heading font-semibold text-primary">{t('landing.welcome')}</h1>
                    <p className="text-body text-secondary">{t('landing.selectGroups')}</p>
                </header>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {SERVICES.map((service) => {
                        const isSelected = selected.has(service.id);
                        return (
                            <button
                                key={service.id}
                                type="button"
                                aria-pressed={isSelected}
                                onClick={() => toggleService(service.id)}
                                className={cn(
                                    'group relative flex flex-col items-start gap-3 rounded-card border-2 p-6 text-left shadow-card transition-colors duration-fast ease-standard',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group',
                                    isSelected ? 'border-group-subtle bg-group-subtle' : 'border-transparent bg-card hover:bg-sunken',
                                )}
                            >
                                <span
                                    aria-hidden="true"
                                    className={cn(
                                        'absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-pill transition-colors duration-fast ease-standard',
                                        isSelected ? 'bg-group-accent text-inverse' : 'border-2 border-strong',
                                    )}
                                >
                                    {isSelected && <Check className="h-4 w-4" />}
                                </span>

                                <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-pill bg-card shadow-pill">
                                    {/* Decorative: the card's name already says which group it is. */}
                                    {service.logoUrl ? (
                                        <img
                                            src={service.logoUrl}
                                            alt=""
                                            className="h-12 w-12 object-contain"
                                            onError={(e) => {
                                                e.currentTarget.style.display = 'none';
                                                e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                            }}
                                        />
                                    ) : null}
                                    <span className={cn('text-title font-semibold text-secondary', service.logoUrl ? 'hidden' : '')}>
                                        {service.shortCode}
                                    </span>
                                </span>

                                <span className="flex flex-col gap-1">
                                    <span className="text-title font-semibold text-primary">{service.displayName}</span>
                                    <span className="text-small text-secondary">{service.name}</span>
                                </span>

                                <span className="flex flex-wrap gap-1">
                                    {(SERVICE_FEATURES[service.id] || []).map((featureId) => {
                                        const feature = FEATURE_DEFINITIONS[featureId];
                                        const Icon = feature.icon;
                                        return (
                                            <span key={featureId} className="inline-flex items-center gap-1 rounded-pill bg-sunken px-2 py-1 text-caption text-secondary transition-colors duration-fast ease-standard group-hover:bg-card">
                                                <Icon className="h-3 w-3" />
                                                {t(`features.${featureId}`)}
                                            </span>
                                        );
                                    })}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="flex flex-col items-center gap-4">
                    <Button variant="primary" className="px-8" onClick={handleGetStarted} disabled={selected.size === 0}>
                        {selected.size === 0
                            ? t('landing.selectAtLeastOne')
                            : selected.size === 1
                                ? t('landing.getStarted')
                                : t('landing.getStartedWith', { count: selected.size })}
                    </Button>
                    <p className="text-center text-small text-muted">{t('landing.footerNote')}</p>
                </div>
            </Sheet>
        </Canvas>
    );
};
