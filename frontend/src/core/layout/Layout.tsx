// frontend/src/core/layout/Layout.tsx
import React, { useEffect } from 'react';
import { ServiceRail } from './ServiceRail';
import { FeatureRail } from './FeatureRail';
import { ContentArea } from './ContentArea';
import { Canvas } from '../../design/primitives';
import { useAppStore } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '../../i18n';

interface LayoutProps {
    messagesContent: React.ReactNode;
    onAddService: () => void;
    onOpenSettings: () => void;
    onReportIssue: () => void;
    onOpenAbout: () => void;
    onOpenSearch: () => void;
    initialSyncServices?: Record<string, true>;
    blogBackupEnabled?: boolean;
    /** The fan's nickname per service (`%%%` in her messages). */
    userNicknames?: Record<string, string>;
}

/**
 * D-4/D-5 frame: a neutral group rail, then one canvas block (level 0, the official group
 * gradient, rounded on the left) holding the feature rail, each feature's own sidebar and the
 * content sheet.
 */
export const Layout: React.FC<LayoutProps> = ({
    messagesContent,
    onAddService,
    onOpenSettings,
    onReportIssue,
    onOpenAbout,
    onOpenSearch,
    initialSyncServices,
    blogBackupEnabled,
    userNicknames,
}) => {
    const { t } = useTranslation();
    const activeService = useAppStore((s) => s.activeService);
    const setActiveService = useAppStore((s) => s.setActiveService);
    const selectedServices = useAppStore((s) => s.selectedServices);
    // getServiceOrder() builds a new array when services are missing from the stored order: compare by content.
    const serviceOrder = useAppStore(useShallow((s) => s.getServiceOrder()));

    // Sort selected services by global display order
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
        <div className="flex h-full flex-1 overflow-hidden bg-elevated">
            <ServiceRail
                services={services}
                onAddService={onAddService}
                onOpenSettings={onOpenSettings}
                onReportIssue={onReportIssue}
                onOpenAbout={onOpenAbout}
                onOpenSearch={onOpenSearch}
            />

            {activeService ? (
                <Canvas className="flex h-full min-w-0 flex-1 rounded-l-sheet">
                    <FeatureRail service={activeService} />
                    <ContentArea
                        service={activeService}
                        messagesContent={messagesContent}
                        isInitialSyncing={!!initialSyncServices?.[activeService]}
                        blogBackupEnabled={blogBackupEnabled}
                        userNickname={userNicknames?.[activeService]}
                    />
                </Canvas>
            ) : (
                <div className="flex flex-1 items-center justify-center text-secondary">
                    <div className="text-center">
                        <p className="mb-2 text-title">{t('landing.welcome')}</p>
                        <p className="text-small">{t('landing.selectService')}</p>
                    </div>
                </div>
            )}
        </div>
    );
};
