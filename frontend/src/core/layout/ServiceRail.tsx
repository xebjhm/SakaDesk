// frontend/src/core/layout/ServiceRail.tsx
import React, { useState } from 'react';
import { Plus, Unplug } from 'lucide-react';
import { cn } from '../../utils/classnames';
import { useAppStore } from '../../store/appStore';
import { SettingsMenu } from '../common/SettingsMenu';
import { getServiceShortCode, getServiceBgColor, getServiceLogoUrl } from '../../data/services';
import { AddServiceModal } from './AddServiceModal';
import { useAuth } from '../../shell/hooks/useAuth';
import { useTranslation } from '../../i18n';

export interface ServiceRailProps {
    services: string[];
    onAddService: () => void;
    onOpenSettings: () => void;
    onReportIssue: () => void;
    onOpenAbout: () => void;
}

export const ServiceRail: React.FC<ServiceRailProps> = ({
    services,
    onOpenSettings,
    onReportIssue,
    onOpenAbout,
}) => {
    const { t } = useTranslation();
    const { activeService, setActiveService, removeSelectedService } = useAppStore();
    const [showAddModal, setShowAddModal] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ serviceId: string; x: number; y: number } | null>(null);
    const { isServiceDisconnected } = useAuth();

    // Check if all services are already selected
    const allServicesSelected = services.length >= 3;

    const handleContextMenu = (e: React.MouseEvent, serviceId: string) => {
        e.preventDefault();
        setContextMenu({ serviceId, x: e.clientX, y: e.clientY });
    };

    const handleRemoveService = () => {
        if (contextMenu) {
            removeSelectedService(contextMenu.serviceId);
            setContextMenu(null);
        }
    };

    return (
        <div className="w-14 bg-[#1e1f22] h-full flex flex-col items-center py-3 shrink-0" onClick={() => setContextMenu(null)}>
            {/* Service buttons */}
            <div className="flex flex-col items-center gap-2 flex-1">
                {services.map(service => {
                    const isActive = activeService === service;
                    const colorClass = getServiceBgColor(service);

                    return (
                        <button
                            key={service}
                            onClick={() => setActiveService(service)}
                            onContextMenu={(e) => handleContextMenu(e, service)}
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

                            {/* Service Icon with Logo */}
                            <div className={cn(
                                "w-12 h-12 rounded-[24px] flex items-center justify-center overflow-hidden transition-all duration-200",
                                colorClass,
                                isActive ? "rounded-[16px]" : "group-hover:rounded-[16px]"
                            )}>
                                {getServiceLogoUrl(service) ? (
                                    <img
                                        src={getServiceLogoUrl(service)}
                                        alt={service}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                            // Fallback to short code on error
                                            e.currentTarget.style.display = 'none';
                                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                        }}
                                    />
                                ) : null}
                                <span className={cn(
                                    "text-white font-bold text-sm",
                                    getServiceLogoUrl(service) ? "hidden" : ""
                                )}>
                                    {getServiceShortCode(service)}
                                </span>
                            </div>

                            {/* Disconnected Warning Badge */}
                            {isServiceDisconnected(service) && (
                                <div
                                    className="absolute -bottom-1 -right-1 w-5 h-5 bg-orange-500 rounded-full border-2 border-[#1e1f22] flex items-center justify-center"
                                    title={t('serviceRail.sessionExpiredRelogin')}
                                >
                                    <Unplug className="w-3 h-3 text-white" />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Context Menu for removing service */}
            {contextMenu && (
                <div
                    className="fixed bg-[#2b2d31] rounded-lg shadow-xl py-1 z-50 min-w-[140px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={handleRemoveService}
                        className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                        {t('common.removeService')}
                    </button>
                </div>
            )}

            {/* Separator line */}
            <div className="w-8 h-px bg-gray-600 my-2" />

            {/* Bottom actions: Add Service + Settings */}
            <div className="flex flex-col items-center gap-2">
                {/* Add Service Button - only show if not all services selected */}
                {!allServicesSelected && (
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="group relative w-12 h-12 rounded-[24px] flex items-center justify-center transition-all duration-200 hover:rounded-[16px]"
                        title={t('serviceRail.addService')}
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

            {/* Add Service Modal */}
            {showAddModal && (
                <AddServiceModal
                    selectedServices={services}
                    onClose={() => setShowAddModal(false)}
                />
            )}
        </div>
    );
};
