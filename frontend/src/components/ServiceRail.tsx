// frontend/src/components/ServiceRail.tsx
import React from 'react';
import { Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAppStore } from '../stores/appStore';
import { SettingsMenu } from './SettingsMenu';

export interface ServiceRailProps {
    services: string[];
    onAddService: () => void;
    onOpenSettings: () => void;
    onReportIssue: () => void;
    onOpenAbout: () => void;
}

const getInitials = (name: string) => {
    if (name === 'hinatazaka46') return 'HI';
    if (name === 'sakurazaka46') return 'SA';
    if (name === 'nogizaka46') return 'NO';
    return name.substring(0, 2).toUpperCase();
};

const getServiceColor = (name: string) => {
    if (name === 'hinatazaka46') return 'bg-[#7cc7e8]'; // Sky Blue
    if (name === 'sakurazaka46') return 'bg-[#f19db5]'; // Sakura Pink
    if (name === 'nogizaka46') return 'bg-[#7e1083]';   // Purple
    return 'bg-gray-500';
};

export const ServiceRail: React.FC<ServiceRailProps> = ({
    services,
    onAddService,
    onOpenSettings,
    onReportIssue,
    onOpenAbout,
}) => {
    const { activeService, setActiveService } = useAppStore();

    // Check if all services are already connected
    const allServicesConnected = services.length >= 3;

    return (
        <div className="w-14 bg-[#1e1f22] h-full flex flex-col items-center py-3 shrink-0">
            {/* Service buttons */}
            <div className="flex flex-col items-center gap-2 flex-1">
                {services.map(service => {
                    const isActive = activeService === service;
                    const colorClass = getServiceColor(service);

                    return (
                        <button
                            key={service}
                            onClick={() => setActiveService(service)}
                            className={cn(
                                "group relative w-12 h-12 rounded-[24px] flex items-center justify-center transition-all duration-200",
                                isActive ? "rounded-[16px]" : "hover:rounded-[16px]"
                            )}
                            title={service}
                        >
                            {/* Active Indicator Pill */}
                            <div className={cn(
                                "absolute left-0 top-1/2 -translate-y-1/2 w-1 bg-white rounded-r-full transition-all",
                                isActive ? "h-10" : "h-0 group-hover:h-5"
                            )} />

                            {/* Service Icon */}
                            <div className={cn(
                                "w-12 h-12 rounded-[24px] flex items-center justify-center text-white font-bold text-sm transition-all duration-200",
                                colorClass,
                                isActive ? "rounded-[16px]" : "group-hover:rounded-[16px]"
                            )}>
                                {getInitials(service)}
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Separator line */}
            <div className="w-8 h-px bg-gray-600 my-2" />

            {/* Bottom actions: Add Service + Settings */}
            <div className="flex flex-col items-center gap-2">
                {/* Add Service Button - only show if not all services connected */}
                {!allServicesConnected && (
                    <button
                        onClick={onAddService}
                        className="group relative w-12 h-12 rounded-[24px] flex items-center justify-center transition-all duration-200 hover:rounded-[16px]"
                        title="Add Service"
                    >
                        <div className="w-12 h-12 rounded-[24px] bg-[#313338] flex items-center justify-center text-green-500 transition-all duration-200 group-hover:rounded-[16px] group-hover:bg-green-600 group-hover:text-white">
                            <Plus className="w-6 h-6" />
                        </div>
                    </button>
                )}

                {/* Settings Menu */}
                <SettingsMenu
                    onOpenSettings={onOpenSettings}
                    onReportIssue={onReportIssue}
                    onOpenAbout={onOpenAbout}
                />
            </div>
        </div>
    );
};
