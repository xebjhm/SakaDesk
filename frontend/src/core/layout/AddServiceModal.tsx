// frontend/src/core/layout/AddServiceModal.tsx
import React from 'react';
import { Modal } from '../../design/primitives';
import { getOrderedServiceDefs } from '../../data/services';
import { SERVICE_FEATURES, FEATURE_DEFINITIONS } from '../../config/features';
import { useAppStore } from '../../store/appStore';
import { cn } from '../../utils/classnames';
import { useTranslation } from '../../i18n';

interface AddServiceModalProps {
    selectedServices: string[];
    onClose: () => void;
}

export const AddServiceModal: React.FC<AddServiceModalProps> = ({
    selectedServices,
    onClose,
}) => {
    const { t } = useTranslation();
    const { addSelectedService, setActiveService, setActiveFeature, getServiceOrder, setFreshlyAddedService } = useAppStore();

    // Filter out already selected services, sorted by global order
    const availableServices = getOrderedServiceDefs(getServiceOrder()).filter(
        (s) => !selectedServices.includes(s.id)
    );

    const handleSelect = (serviceId: string) => {
        addSelectedService(serviceId);
        // Default to blogs (free) for services that support it
        if (SERVICE_FEATURES[serviceId]?.includes('blogs')) {
            setActiveFeature(serviceId, 'blogs');
        }
        setActiveService(serviceId);
        // Trigger login prompt for message account (if service supports messages)
        if (SERVICE_FEATURES[serviceId]?.includes('messages')) {
            setFreshlyAddedService(serviceId);
        }
        onClose();
    };

    return (
        <Modal isOpen onClose={onClose} title={t('addService.title')} closeLabel={t('common.close')} logId="add_service" className="max-w-lg">
            {availableServices.length === 0 ? (
                <p className="py-4 text-center text-body text-muted">{t('addService.allAdded')}</p>
            ) : (
                <div className="flex flex-col gap-3">
                    {availableServices.map((service) => (
                        <button
                            key={service.id}
                            type="button"
                            onClick={() => handleSelect(service.id)}
                            className="flex w-full items-center gap-4 rounded-card bg-card p-4 text-left shadow-card transition-colors duration-fast ease-standard hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group"
                        >
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-pill bg-card shadow-pill">
                                {service.logoUrl ? (
                                    <img
                                        src={service.logoUrl}
                                        alt=""
                                        className="h-9 w-9 object-contain"
                                        onError={(e) => {
                                            e.currentTarget.style.display = 'none';
                                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                        }}
                                    />
                                ) : null}
                                <span className={cn('font-semibold text-secondary', service.logoUrl ? 'hidden' : '')}>{service.shortCode}</span>
                            </span>
                            <span className="flex min-w-0 flex-col gap-1">
                                <span className="text-body font-semibold text-primary">{service.displayName}</span>
                                <span className="flex flex-wrap gap-1">
                                    {(SERVICE_FEATURES[service.id] || []).map((featureId) => {
                                        const feature = FEATURE_DEFINITIONS[featureId];
                                        const Icon = feature.icon;
                                        return (
                                            <span key={featureId} className="inline-flex items-center gap-1 rounded-pill bg-sunken px-2 py-1 text-caption text-secondary">
                                                <Icon className="h-3 w-3" />
                                                {t(`features.${featureId}`)}
                                            </span>
                                        );
                                    })}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </Modal>
    );
};
