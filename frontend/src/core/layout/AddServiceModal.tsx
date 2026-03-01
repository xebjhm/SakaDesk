// frontend/src/core/layout/AddServiceModal.tsx
import React from 'react';
import { X } from 'lucide-react';
import { SERVICES } from '../../data/services';
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
    const { addSelectedService, setActiveService } = useAppStore();

    // Filter out already selected services
    const availableServices = SERVICES.filter(
        (s) => !selectedServices.includes(s.id)
    );

    const handleSelect = (serviceId: string) => {
        addSelectedService(serviceId);
        setActiveService(serviceId);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-500 to-indigo-500 px-6 py-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold text-white">
                            {t('addService.title')}
                        </h3>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                        >
                            <X className="w-4 h-4 text-white" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6">
                    {availableServices.length === 0 ? (
                        <p className="text-center text-gray-500 py-4">
                            {t('addService.allAdded')}
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {availableServices.map((service) => (
                                <button
                                    key={service.id}
                                    onClick={() => handleSelect(service.id)}
                                    className="group w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors text-left"
                                    style={{ '--hover-border-color': service.primaryColor } as React.CSSProperties}
                                    onMouseEnter={(e) => e.currentTarget.style.borderColor = service.primaryColor}
                                    onMouseLeave={(e) => e.currentTarget.style.borderColor = ''}
                                >
                                    {/* Logo circle with subtle ring */}
                                    <div className="w-12 h-12 rounded-full bg-white ring-1 ring-gray-200 flex items-center justify-center overflow-hidden shadow-sm">
                                        {service.logoUrl ? (
                                            <img
                                                src={service.logoUrl}
                                                alt={service.displayName}
                                                className="w-9 h-9 object-contain"
                                                onError={(e) => {
                                                    e.currentTarget.style.display = 'none';
                                                    e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                                }}
                                            />
                                        ) : null}
                                        <span className={cn(
                                            "text-gray-600 font-bold",
                                            service.logoUrl ? "hidden" : ""
                                        )}>
                                            {service.shortCode}
                                        </span>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-gray-900">
                                            {service.displayName}
                                        </h4>
                                        <p className="text-sm text-gray-500">
                                            {service.description}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
