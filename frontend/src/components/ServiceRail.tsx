import React from 'react';
import { cn } from '../lib/utils';

export interface ServiceRailProps {
    services: string[];
    activeService?: string;
    onSelectService: (service: string) => void;
}

// Map service names to short codes or icons if we had them. 
// For now, use initials.
const getInitials = (name: string) => {
    if (name === 'Hinatazaka46') return 'HI';
    if (name === 'Sakurazaka46') return 'SA';
    if (name === 'Nogizaka46') return 'NO';
    return name.substring(0, 2).toUpperCase();
};

// Color mapping for known services
const getServiceColor = (name: string) => {
    if (name === 'Hinatazaka46') return 'bg-[#7cc7e8]'; // Sky Blue
    if (name === 'Sakurazaka46') return 'bg-[#f19db5]'; // Sakura Pink
    if (name === 'Nogizaka46') return 'bg-[#7e1083]';   // Purple
    return 'bg-gray-500';
};

export const ServiceRail: React.FC<ServiceRailProps> = ({ services, activeService, onSelectService }) => {
    return (
        <div className="w-16 md:w-20 bg-white border-r border-gray-200 h-full flex flex-col items-center py-4 gap-4 z-40 shadow-sm shrink-0">
            {services.map(service => {
                const isActive = activeService === service;
                const colorClass = getServiceColor(service);

                return (
                    <button
                        key={service}
                        onClick={() => onSelectService(service)}
                        className={cn(
                            "group relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300",
                            isActive ? "bg-gray-100" : "hover:bg-gray-50"
                        )}
                        title={service}
                    >
                        {/* Active Indicator Bar */}
                        {isActive && (
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-3/4 bg-blue-400 rounded-r-full" />
                        )}

                        {/* Ring Effect */}
                        <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-md transition-transform",
                            colorClass,
                            isActive ? "scale-110 ring-2 ring-blue-100 ring-offset-2" : "opacity-80 group-hover:opacity-100 group-hover:scale-105"
                        )}>
                            {getInitials(service)}
                        </div>
                    </button>
                );
            })}
        </div>
    );
};
