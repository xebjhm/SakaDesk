// frontend/src/components/ServiceRail.tsx
import React from 'react';
import { cn } from '../lib/utils';
import { useAppStore } from '../stores/appStore';

export interface ServiceRailProps {
    services: string[];
}

const getInitials = (name: string) => {
    if (name === 'Hinatazaka46') return 'HI';
    if (name === 'Sakurazaka46') return 'SA';
    if (name === 'Nogizaka46') return 'NO';
    return name.substring(0, 2).toUpperCase();
};

const getServiceColor = (name: string) => {
    if (name === 'Hinatazaka46') return 'bg-[#7cc7e8]'; // Sky Blue
    if (name === 'Sakurazaka46') return 'bg-[#f19db5]'; // Sakura Pink
    if (name === 'Nogizaka46') return 'bg-[#7e1083]';   // Purple
    return 'bg-gray-500';
};

export const ServiceRail: React.FC<ServiceRailProps> = ({ services }) => {
    const { activeService, setActiveService } = useAppStore();

    return (
        <div className="w-14 bg-[#1e1f22] h-full flex flex-col items-center py-3 gap-2 shrink-0">
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
    );
};
