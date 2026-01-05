import React, { useState, useEffect } from 'react';
import { ServiceRail } from './ServiceRail';
import { GroupSidebar } from './GroupSidebar';
import { MultiGroupAuthStatus } from '../types';

interface LayoutProps {
    authStatus: MultiGroupAuthStatus | null;
    children: React.ReactNode;
    onSelectGroup: (groupDir: string, isGroupChat: boolean, displayName: string) => void;
    selectedGroupDir?: string;
    isSyncing?: boolean;
    onOpenSettings: () => void;
    onOpenDiagnostics: () => void;
    isMobileSidebarOpen?: boolean;
    onCloseMobileSidebar?: () => void;
}

export const Layout: React.FC<LayoutProps> = ({
    authStatus,
    children,
    onSelectGroup,
    selectedGroupDir,
    isSyncing,
    onOpenSettings,
    onOpenDiagnostics,
    isMobileSidebarOpen,
    onCloseMobileSidebar
}) => {
    const [services, setServices] = useState<string[]>([]);
    const [activeService, setActiveService] = useState<string | undefined>();

    useEffect(() => {
        if (authStatus) {
            const authenticatedServices = Object.entries(authStatus)
                .filter(([_, status]) => status.is_authenticated)
                .map(([name]) => name);

            setServices(authenticatedServices);

            if (authenticatedServices.length > 0 && !activeService) {
                setActiveService(authenticatedServices[0]);
            }
        }
    }, [authStatus]);

    return (
        <div className="flex h-screen bg-[#F0F2F5] font-sans overflow-hidden">
            {/* Zone A: Service Rail */}
            <ServiceRail
                services={services}
                activeService={activeService}
                onSelectService={setActiveService}
            />

            {/* Zone B: Group Sidebar - SINGLE instance, CSS handles responsive */}
            <div className={`
                w-80 shrink-0 bg-white border-r border-gray-200
                fixed inset-y-0 left-16 md:left-20 z-30
                md:relative md:left-0
                transform transition-transform duration-300 ease-in-out
                ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
            `}>
                <GroupSidebar
                    activeService={activeService}
                    onSelectGroup={onSelectGroup}
                    selectedGroupDir={selectedGroupDir}
                    isSyncing={isSyncing}
                    onOpenSettings={onOpenSettings}
                    onOpenDiagnostics={onOpenDiagnostics}
                />
            </div>

            {/* Mobile Overlay */}
            {isMobileSidebarOpen && (
                <div
                    className="md:hidden fixed inset-0 z-20 bg-black/50"
                    style={{ left: '64px' }}
                    onClick={onCloseMobileSidebar}
                />
            )}

            {/* Zone C: Main Content */}
            <div className="flex-1 flex flex-col h-full relative overflow-hidden">
                {children}
            </div>
        </div>
    );
};
