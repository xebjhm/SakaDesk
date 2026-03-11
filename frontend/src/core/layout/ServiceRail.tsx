// frontend/src/core/layout/ServiceRail.tsx
import React, { useState, useCallback, useRef } from 'react';
import { Plus, Unplug, Search } from 'lucide-react';
import { cn } from '../../utils/classnames';
import { useAppStore } from '../../store/appStore';
import { SettingsMenu } from '../common/SettingsMenu';
import { SERVICES, getServiceShortCode, getServiceLogoUrl, getServicePrimaryColor } from '../../data/services';
import { AddServiceModal } from './AddServiceModal';
import { useAuth } from '../../shell/hooks/useAuth';
import { useTranslation } from '../../i18n';

export interface ServiceRailProps {
    services: string[];
    onAddService: () => void;
    onOpenSettings: () => void;
    onReportIssue: () => void;
    onOpenAbout: () => void;
    onOpenSearch: () => void;
}

export const ServiceRail: React.FC<ServiceRailProps> = ({
    services,
    onOpenSettings,
    onReportIssue,
    onOpenAbout,
    onOpenSearch,
}) => {
    const { t } = useTranslation();
    const { activeService, setActiveService, removeSelectedService, getServiceOrder, setServiceOrder } = useAppStore();
    const [showAddModal, setShowAddModal] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ serviceId: string; x: number; y: number } | null>(null);
    const { isServiceDisconnected } = useAuth();

    // Drag-and-drop state
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    const dragNodeRef = useRef<HTMLElement | null>(null);

    // Check if all services are already selected
    const allServicesSelected = services.length >= SERVICES.length;

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

    // --- Drag-and-drop handlers ---

    const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
        setDragIndex(index);
        dragNodeRef.current = e.currentTarget as HTMLElement;
        e.dataTransfer.effectAllowed = 'move';
        // Required by Chromium/Edge for dragover/drop events to fire
        e.dataTransfer.setData('text/plain', '');
        // Make the drag image slightly transparent
        requestAnimationFrame(() => {
            if (dragNodeRef.current) {
                dragNodeRef.current.style.opacity = '0.4';
            }
        });
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragIndex === null || dragIndex === index) {
            setDropIndex(null);
            return;
        }
        setDropIndex(index);
    }, [dragIndex]);

    const handleDragEnd = useCallback(() => {
        if (dragNodeRef.current) {
            dragNodeRef.current.style.opacity = '';
        }
        setDragIndex(null);
        setDropIndex(null);
        dragNodeRef.current = null;
    }, []);

    const handleDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
        e.preventDefault();
        if (dragIndex === null || dragIndex === targetIndex) {
            handleDragEnd();
            return;
        }

        // Compute new rail order
        const newRail = [...services];
        const [moved] = newRail.splice(dragIndex, 1);
        newRail.splice(targetIndex, 0, moved);

        // Merge new rail order into global order:
        // Walk global order, replace selected-service slots with new rail order
        const selectedSet = new Set(services);
        const globalOrder = getServiceOrder();
        let railIdx = 0;
        const newGlobal = globalOrder.map((id) => {
            if (selectedSet.has(id)) {
                return newRail[railIdx++];
            }
            return id;
        });

        setServiceOrder(newGlobal);
        handleDragEnd();
    }, [dragIndex, services, getServiceOrder, setServiceOrder, handleDragEnd]);

    return (
        <div
            className="w-16 bg-gray-50 h-full flex flex-col items-center py-3 shrink-0 border-r border-gray-200"
            onClick={() => setContextMenu(null)}
        >
            {/* Service buttons */}
            <div className="flex flex-col items-center gap-3 flex-1">
                {services.map((service, index) => {
                    const isActive = activeService === service;
                    const primaryColor = getServicePrimaryColor(service);
                    const showDropBefore = dropIndex === index && dragIndex !== null && dragIndex > index;
                    const showDropAfter = dropIndex === index && dragIndex !== null && dragIndex < index;

                    return (
                        <div
                            key={service}
                            className="relative"
                            draggable
                            onDragStart={(e) => handleDragStart(e, index)}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDrop={(e) => handleDrop(e, index)}
                            onDragEnd={handleDragEnd}
                        >
                            {/* Drop indicator — before */}
                            {showDropBefore && (
                                <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-blue-400" />
                            )}

                            <button
                                onClick={() => setActiveService(service)}
                                onContextMenu={(e) => handleContextMenu(e, service)}
                                className="group relative flex items-center justify-center transition-all duration-200"
                                title={service}
                            >
                                {/* Service Icon Container */}
                                <div
                                    className={cn(
                                        "w-11 h-11 rounded-full bg-white flex items-center justify-center overflow-hidden transition-all duration-200",
                                        "shadow-sm hover:shadow-md hover:scale-105",
                                        isActive ? "ring-[2.5px] ring-offset-1" : "ring-1 ring-gray-200"
                                    )}
                                    style={isActive ? { '--tw-ring-color': primaryColor } as React.CSSProperties : undefined}
                                >
                                    {getServiceLogoUrl(service) ? (
                                        <img
                                            src={getServiceLogoUrl(service)}
                                            alt={service}
                                            className="w-8 h-8 object-contain"
                                            draggable={false}
                                            onError={(e) => {
                                                // Fallback to short code on error
                                                e.currentTarget.style.display = 'none';
                                                e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                            }}
                                        />
                                    ) : null}
                                    <span className={cn(
                                        "text-gray-600 font-semibold text-sm",
                                        getServiceLogoUrl(service) ? "hidden" : ""
                                    )}>
                                        {getServiceShortCode(service)}
                                    </span>
                                </div>

                                {/* Disconnected Warning Badge */}
                                {isServiceDisconnected(service) && (
                                    <div
                                        className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-orange-500 rounded-full border-2 border-gray-50 flex items-center justify-center"
                                        title={t('serviceRail.sessionExpiredRelogin')}
                                    >
                                        <Unplug className="w-2.5 h-2.5 text-white" />
                                    </div>
                                )}
                            </button>

                            {/* Drop indicator — after */}
                            {showDropAfter && (
                                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-blue-400" />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Context Menu for removing service */}
            {contextMenu && (
                <div
                    className="fixed bg-white rounded-lg shadow-xl py-1 z-50 min-w-[140px] border border-gray-200"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={handleRemoveService}
                        className="w-full px-3 py-2 text-left text-sm text-red-500 hover:bg-red-50 transition-colors"
                    >
                        {t('common.removeService')}
                    </button>
                </div>
            )}

            {/* Separator line */}
            <div className="w-8 h-px bg-gray-300 my-2" />

            {/* Bottom actions: Add Service + Settings */}
            <div className="flex flex-col items-center gap-2">
                {/* Add Service Button - only show if not all services selected */}
                {!allServicesSelected && (
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="group w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200"
                        title={t('serviceRail.addService')}
                    >
                        <div className="w-11 h-11 rounded-full bg-gray-200 flex items-center justify-center text-green-600 transition-all duration-200 group-hover:bg-green-500 group-hover:text-white">
                            <Plus className="w-5 h-5" />
                        </div>
                    </button>
                )}

                {/* Search Button */}
                <button
                    onClick={onOpenSearch}
                    className="group w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200"
                    title={`${t('search.placeholder')} (${navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl+'}K)`}
                >
                    <div className="w-11 h-11 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 transition-all duration-200 group-hover:bg-blue-500 group-hover:text-white">
                        <Search className="w-5 h-5" />
                    </div>
                </button>

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
