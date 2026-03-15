// frontend/src/core/layout/Layout.tsx
import React, { useEffect } from 'react';
import { ServiceRail } from './ServiceRail';
import { FeatureRail } from './FeatureRail';
import { ContentArea } from './ContentArea';
import { useAppStore } from '../../store/appStore';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

interface LayoutProps {
    messagesContent: React.ReactNode;
    onAddService: () => void;
    onOpenSettings: () => void;
    onReportIssue: () => void;
    onOpenAbout: () => void;
    onOpenSearch: () => void;
    syncProgressByService?: Record<string, SyncProgress>;
    initialSyncServices?: Record<string, true>;
}

export const Layout: React.FC<LayoutProps> = ({
    messagesContent,
    onAddService,
    onOpenSettings,
    onReportIssue,
    onOpenAbout,
    onOpenSearch,
    syncProgressByService,
    initialSyncServices,
}) => {
    const { activeService, setActiveService, selectedServices, getServiceOrder } = useAppStore();

    // Sort selected services by global display order
    const serviceOrder = getServiceOrder();
    const services = [...selectedServices].sort(
        (a, b) => serviceOrder.indexOf(a) - serviceOrder.indexOf(b)
    );

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
                    syncProgress={syncProgressByService?.[activeService]}
                    isInitialSyncing={!!initialSyncServices?.[activeService]}
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
