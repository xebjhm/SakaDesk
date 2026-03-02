// frontend/src/core/layout/Layout.tsx
import React, { useEffect } from 'react';
import { ServiceRail } from './ServiceRail';
import { FeatureRail } from './FeatureRail';
import { ContentArea } from './ContentArea';
import { useAppStore } from '../../store/appStore';

interface LayoutProps {
    messagesContent: React.ReactNode;
    onAddService: () => void;
    onOpenSettings: () => void;
    onReportIssue: () => void;
    onOpenAbout: () => void;
    onOpenSearch: () => void;
}

export const Layout: React.FC<LayoutProps> = ({
    messagesContent,
    onAddService,
    onOpenSettings,
    onReportIssue,
    onOpenAbout,
    onOpenSearch,
}) => {
    const { activeService, setActiveService, selectedServices } = useAppStore();

    // Use selectedServices (user's selections) for display
    const services = selectedServices;

    // Auto-select first service if none selected
    useEffect(() => {
        if (services.length > 0 && !activeService) {
            setActiveService(services[0]);
        }
    }, [services, activeService, setActiveService]);

    return (
        <div className="flex flex-1 h-full overflow-hidden">
            {/* Zone A: Service Rail */}
            <ServiceRail
                services={services}
                onAddService={onAddService}
                onOpenSettings={onOpenSettings}
                onReportIssue={onReportIssue}
                onOpenAbout={onOpenAbout}
                onOpenSearch={onOpenSearch}
            />

            {/* Zone B: Feature Rail (only show when service selected) */}
            {activeService && (
                <FeatureRail service={activeService} />
            )}

            {/* Zone C: Content Area */}
            {activeService ? (
                <ContentArea
                    service={activeService}
                    messagesContent={messagesContent}
                />
            ) : (
                <div className="flex-1 flex items-center justify-center bg-[#F0F2F5] text-gray-500">
                    <div className="text-center">
                        <p className="text-lg mb-2">Welcome to HakoDesk</p>
                        <p className="text-sm">Select a service to get started</p>
                    </div>
                </div>
            )}
        </div>
    );
};
