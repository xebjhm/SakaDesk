import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { SERVICES, type ServiceDefinition } from '../data/services';
import { SERVICE_FEATURES, FEATURE_DEFINITIONS } from '../config/features';
import { Atmosphere, Button, Sheet } from '../design/primitives';
import { BrandScope } from '../design/brandScope';
import { useGroupMarker } from '../design/useGroupMarker';
import { cn } from '../utils/classnames';
import { useTranslation } from '../i18n';

interface LandingPageProps {
    onComplete: (selectedServices: string[]) => void;
}

interface GroupCardProps {
    service: ServiceDefinition;
    selected: boolean;
    onToggle: () => void;
}

/**
 * One group's toggle card: a group marker in that group's colours (spec §4, §9). Picked restores
 * e4e4118 (a 2px ring plus a large shadow, ring colour = the group's primary colour) as a ring in
 * the group's logo colour on the card and the logo circle; the check disc is in step 600 so the white check reads (decision D4). Hover lifts and glows (spec §8).
 */
const GroupCard: React.FC<GroupCardProps> = ({ service, selected, onToggle }) => {
    const { t } = useTranslation();
    const marker = useGroupMarker(service.id, 'landing');
    return (
        <button
            type="button"
            data-testid={`landing-card-${service.id}`}
            aria-pressed={selected}
            onClick={onToggle}
            style={marker}
            className={cn(
                'group relative flex flex-col items-start gap-3 rounded-lg bg-card p-6 text-left shadow-card transition duration-fast ease-standard',
                'hover:-translate-y-px hover:shadow-accent-glow-hover active:scale-97',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                selected && 'shadow-accent-glow ring-2 ring-accent-logo',
            )}
        >
            <span
                data-testid="landing-check"
                aria-hidden="true"
                className={cn(
                    'absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full transition-colors duration-fast ease-standard',
                    selected ? 'bg-accent text-inverse' : 'border-2 border-strong',
                )}
            >
                {selected && <Check className="h-4 w-4" />}
            </span>

            <span
                data-testid="landing-logo"
                className={cn(
                    'flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-card shadow-pill transition-shadow duration-fast ease-standard',
                    selected && 'ring-2 ring-accent-logo ring-offset-2 ring-offset-surface',
                )}
            >
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
                <span lang="ja" className="text-title font-semibold text-primary">{service.displayName}</span>
                <span className="text-small text-secondary">{service.name}</span>
            </span>

            <span className="flex flex-wrap gap-1">
                {(SERVICE_FEATURES[service.id] || []).map((featureId) => {
                    const feature = FEATURE_DEFINITIONS[featureId];
                    const Icon = feature.icon;
                    return (
                        <span key={featureId} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-1 text-caption text-secondary">
                            <Icon className="h-3 w-3" />
                            {t(`features.${featureId}`)}
                        </span>
                    );
                })}
            </span>
        </button>
    );
};

/**
 * Pick the groups to follow (first launch, or every group removed): a brand screen on the aurora
 * orbs (spec §4, §5 L2, §9) with one sheet, one marker card per group and one primary button.
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
        <BrandScope className="h-screen overflow-y-auto overscroll-contain bg-window">
            <Atmosphere className="min-h-full">
                <div className="flex min-h-full items-center justify-center p-4">
                    <Sheet className="flex w-full max-w-4xl flex-col gap-8 p-10 animate-reveal motion-reduce:animate-none">
                        <header className="flex flex-col gap-2 text-center">
                            <h1 className="text-balance font-display text-display font-bold text-primary">{t('landing.welcome')}</h1>
                            <p className="text-body text-secondary">{t('landing.selectGroups')}</p>
                        </header>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            {SERVICES.map((service) => (
                                <GroupCard
                                    key={service.id}
                                    service={service}
                                    selected={selected.has(service.id)}
                                    onToggle={() => toggleService(service.id)}
                                />
                            ))}
                        </div>

                        <div className="flex flex-col items-center gap-4">
                            <Button
                                variant="primary"
                                className="px-8"
                                onClick={handleGetStarted}
                                disabledReason={selected.size === 0 ? t('landing.selectAtLeastOne') : undefined}
                            >
                                {selected.size === 0
                                    ? t('landing.selectAtLeastOne')
                                    : selected.size === 1
                                        ? t('landing.getStarted')
                                        : t('landing.getStartedWith', { count: selected.size })}
                            </Button>
                            <p className="text-center text-small text-muted">{t('landing.footerNote')}</p>
                        </div>
                    </Sheet>
                </div>
            </Atmosphere>
        </BrandScope>
    );
};
