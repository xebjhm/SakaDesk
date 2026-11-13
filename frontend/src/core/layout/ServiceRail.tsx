// frontend/src/core/layout/ServiceRail.tsx
import React, { useState, useCallback, useRef } from 'react';
import { Plus, Unplug, Search } from 'lucide-react';
import { cn } from '../../utils/classnames';
import { clientLog } from '../../utils/clientLog';
import { useAppStore } from '../../store/appStore';
import { SettingsMenu } from '../common/SettingsMenu';
import { SERVICES, getServiceShortCode, getServiceLogoUrl, getServiceDisplayName } from '../../data/services';
import { AddServiceModal } from './AddServiceModal';
import { UpgradeIcon } from './UpgradeIcon';
import { useAuth } from '../../shell/hooks/useAuth';
import { useTranslation } from '../../i18n';
import { IconButton, Menu, MenuItem } from '../../design/primitives';
import { BrandScope } from '../../design/brandScope';

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
    const activeService = useAppStore((s) => s.activeService);
    const setActiveService = useAppStore((s) => s.setActiveService);
    const removeSelectedService = useAppStore((s) => s.removeSelectedService);
    // Read at drop time (an event handler), so the function itself is selected.
    const getServiceOrder = useAppStore((s) => s.getServiceOrder);
    const setServiceOrder = useAppStore((s) => s.setServiceOrder);
    const [showAddModal, setShowAddModal] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ serviceId: string; x: number; y: number } | null>(null);
    // The button the menu was opened from; the menu hands focus back to it when it closes (the
    // buttons are keyed by service, so after a move it is still the moved group's button).
    const menuTriggerRef = useRef<HTMLElement | null>(null);
    const { isServiceDisconnected } = useAuth();

    // Drag-and-drop state
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    const dragNodeRef = useRef<HTMLElement | null>(null);

    // Check if all services are already selected
    const allServicesSelected = services.length >= SERVICES.length;

    const handleContextMenu = (e: React.MouseEvent, serviceId: string) => {
        e.preventDefault();
        menuTriggerRef.current = e.currentTarget as HTMLElement;
        // A keyboard-opened menu (Shift+F10, the Menu key) can have no pointer position: open it at the button.
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const fromKeyboard = e.clientX === 0 && e.clientY === 0;
        setContextMenu({ serviceId, x: fromKeyboard ? rect.right : e.clientX, y: fromKeyboard ? rect.top : e.clientY });
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

    // One rail move, from drag-and-drop or the menu's Move up / Move down (UI health A-K6). The new
    // rail order is merged into the global order: selected-service slots take the new rail order.
    const moveService = useCallback((from: number, to: number, via: 'drag' | 'move_up' | 'move_down') => {
        if (from === to || to < 0 || to >= services.length) {
            clientLog('rail_reorder', { target: via, outcome: 'blocked' });
            return;
        }
        const newRail = [...services];
        const [moved] = newRail.splice(from, 1);
        newRail.splice(to, 0, moved);
        const selectedSet = new Set(services);
        let railIdx = 0;
        setServiceOrder(getServiceOrder().map((id) => (selectedSet.has(id) ? newRail[railIdx++] : id)));
        clientLog('rail_reorder', { target: via, outcome: 'moved' });
    }, [services, getServiceOrder, setServiceOrder]);

    const handleDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
        e.preventDefault();
        if (dragIndex === null || dragIndex === targetIndex) {
            handleDragEnd();
            return;
        }

        moveService(dragIndex, targetIndex, 'drag');
        handleDragEnd();
    }, [dragIndex, moveService, handleDragEnd]);

    return (
        <nav
            aria-label={t('serviceRail.label')}
            className="flex h-full w-16 shrink-0 flex-col items-center bg-elevated py-3"
            onClick={() => setContextMenu(null)}
        >
            {/* Service buttons */}
            <div className="flex flex-col items-center gap-3 flex-1">
                {services.map((service, index) => {
                    const isActive = activeService === service;
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
                                <div className="absolute -top-2 left-1/2 w-8 -translate-x-1/2 border-t-2 border-strong" />
                            )}

                            <button
                                onClick={() => setActiveService(service)}
                                onContextMenu={(e) => handleContextMenu(e, service)}
                                className="group relative flex items-center justify-center rounded-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                title={getServiceDisplayName(service)}
                                aria-label={isServiceDisconnected(service)
                                    ? t('serviceRail.serviceDisconnected', { name: getServiceDisplayName(service) })
                                    : getServiceDisplayName(service)}
                                aria-current={isActive ? 'page' : undefined}
                            >
                                {/* Service Icon Container */}
                                <div
                                    className={cn(
                                        'flex h-11 w-11 items-center justify-center overflow-hidden rounded-pill bg-card',
                                        'transition duration-fast ease-standard hover:scale-105',
                                        isActive ? 'ring-2 ring-group-logo ring-offset-2 shadow-accent-halo' : 'shadow-pill hover:shadow-card',
                                    )}
                                >
                                    {getServiceLogoUrl(service) ? (
                                        <img
                                            src={getServiceLogoUrl(service)}
                                            alt={getServiceDisplayName(service)}
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
                                        'text-small font-semibold text-secondary',
                                        getServiceLogoUrl(service) ? "hidden" : ""
                                    )}>
                                        {getServiceShortCode(service)}
                                    </span>
                                </div>

                                {/* Disconnected Warning Badge */}
                                {isServiceDisconnected(service) && (
                                    <div
                                        aria-hidden="true"
                                        className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-pill border-2 border-surface bg-status-attention"
                                        title={t('serviceRail.sessionExpiredRelogin')}
                                    >
                                        <Unplug className="h-2.5 w-2.5 text-inverse" />
                                    </div>
                                )}
                            </button>

                            {/* Drop indicator — after */}
                            {showDropAfter && (
                                <div className="absolute -bottom-2 left-1/2 w-8 -translate-x-1/2 border-t-2 border-strong" />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Context menu: reorder (also the keyboard path, UI health A-K6) and remove */}
            {contextMenu && (() => {
                const at = services.indexOf(contextMenu.serviceId);
                return (
                    <Menu aria-label={t('common.moreOptions')} returnFocusRef={menuTriggerRef} onClose={() => setContextMenu(null)} point={{ x: contextMenu.x, y: contextMenu.y }} estimatedSize={{ width: 176, height: 136 }}>
                        {at > 0 && <MenuItem onClick={() => { moveService(at, at - 1, 'move_up'); setContextMenu(null); }}>{t('serviceRail.moveUp')}</MenuItem>}
                        {at >= 0 && at < services.length - 1 && <MenuItem onClick={() => { moveService(at, at + 1, 'move_down'); setContextMenu(null); }}>{t('serviceRail.moveDown')}</MenuItem>}
                        <MenuItem destructive onClick={handleRemoveService}>{t('common.removeService')}</MenuItem>
                    </Menu>
                );
            })()}

            {/* Bottom actions: brand context (spec §4: the rail frame's icons use the brand ink) */}
            <BrandScope className="mt-4 flex flex-col items-center gap-2">
                {/* Add Service Button - only show if not all services selected */}
                {!allServicesSelected && (
                    <IconButton
                        variant="soft"
                        shape="circle"
                        className="h-11 w-11"
                        aria-label={t('serviceRail.addService')}
                        title={t('serviceRail.addService')}
                        icon={<Plus className="h-5 w-5" />}
                        onClick={() => setShowAddModal(true)}
                    />
                )}

                {/* Upgrade Icon — appears when an update is available */}
                <UpgradeIcon />

                {/* Search Button */}
                <IconButton
                    variant="soft"
                    shape="circle"
                    className="h-11 w-11"
                    aria-label={t('search.placeholder')}
                    title={`${t('search.placeholder')} (${navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl+'}K)`}
                    icon={<Search className="h-5 w-5" />}
                    onClick={onOpenSearch}
                />

                {/* Settings Menu */}
                <SettingsMenu
                    onOpenSettings={onOpenSettings}
                    onReportIssue={onReportIssue}
                    onOpenAbout={onOpenAbout}
                />
            </BrandScope>

            {/* Add Service Modal */}
            {showAddModal && (
                <AddServiceModal
                    selectedServices={services}
                    onClose={() => setShowAddModal(false)}
                />
            )}
        </nav>
    );
};
