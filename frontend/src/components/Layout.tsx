// frontend/src/components/Layout.tsx
import React, { useEffect } from 'react';
import { ServiceRail } from './ServiceRail';
import { FeatureRail } from './FeatureRail';
import { ContentArea } from './ContentArea';
import { useAppStore } from '../stores/appStore';
import { MultiGroupAuthStatus } from '../types';

interface LayoutProps {
    authStatus: MultiGroupAuthStatus | null;
    messagesContent: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({
    authStatus,
    messagesContent,
}) => {
    const { activeService, setActiveService } = useAppStore();

    // Get authenticated services
    const services = authStatus
        ? Object.entries(authStatus)
            .filter(([_, status]) => status.is_authenticated)
            .map(([name]) => name)
        : [];

    // Auto-select first service if none selected
    useEffect(() => {
        if (services.length > 0 && !activeService) {
            setActiveService(services[0]);
        }
    }, [services, activeService, setActiveService]);

    return (
        <div className="flex h-full overflow-hidden">
            {/* Zone A: Service Rail */}
            <ServiceRail services={services} />

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
