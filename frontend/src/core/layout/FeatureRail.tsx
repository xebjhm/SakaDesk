// frontend/src/core/layout/FeatureRail.tsx
import React, { useState } from 'react';
import { useAppStore, FeatureId } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { getAvailableFeatures, isFeaturePaid } from '../../config/features';
import { useAuth } from '../../shell/hooks/useAuth';
import { LoginModal } from '../../shell/components/LoginModal';
import { RailItem } from '../../design/primitives';
import { useTranslation } from '../../i18n';

export interface FeatureRailProps {
    service: string;
}

/**
 * Feature rail (D-5): icon-only entries (label in a hover tooltip) on the group canvas, in the same level-0 block as
 * the feature's sidebar. The selected entry is a white card (RailItem) with the group accent on
 * its icon and left bar (the pre-D2 colour cues).
 */
export const FeatureRail: React.FC<FeatureRailProps> = ({ service }) => {
    const { t } = useTranslation();
    const activeFeature = useAppStore((s) => s.getActiveFeature(service));
    const featureOrder = useAppStore(useShallow((s) => s.getFeatureOrder(service)));
    const setActiveFeature = useAppStore((s) => s.setActiveFeature);
    const triggerBlogViewReset = useAppStore((s) => s.triggerBlogViewReset);
    const { isServiceConnected, checkAuth, isServiceDisconnected } = useAuth();
    const [loginModal, setLoginModal] = useState<{ featureId: FeatureId } | null>(null);

    const availableFeatures = getAvailableFeatures(service);

    // Sort available features by user preference
    const sortedFeatures = [...availableFeatures].sort((a, b) => {
        const aIndex = featureOrder.indexOf(a.id);
        const bIndex = featureOrder.indexOf(b.id);
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
    });

    const handleFeatureClick = (featureId: FeatureId) => {
        // Check if feature is paid and service is not connected
        if (isFeaturePaid(featureId) && !isServiceConnected(service)) {
            setLoginModal({ featureId });
            return;
        }

        // If clicking on blogs, trigger a reset to go back to recent posts
        if (featureId === 'blogs') {
            triggerBlogViewReset();
        }
        setActiveFeature(service, featureId);
    };

    const handleLoginSuccess = async () => {
        await checkAuth();
        if (loginModal) {
            // After login, navigate to the feature
            if (loginModal.featureId === 'blogs') {
                triggerBlogViewReset();
            }
            setActiveFeature(service, loginModal.featureId);
        }
        setLoginModal(null);
    };

    return (
        <>
            <nav aria-label={t('featureRail.label')} className="flex w-12 shrink-0 flex-col items-center gap-1 py-3">
                {sortedFeatures.map(feature => {
                    const Icon = feature.icon;
                    return (
                        <RailItem
                            key={feature.id}
                            icon={<Icon className="h-5 w-5" />}
                            label={t(feature.labelKey)}
                            selected={activeFeature === feature.id}
                            onClick={() => handleFeatureClick(feature.id)}
                        />
                    );
                })}
            </nav>

            {/* Login Modal for paid features */}
            {loginModal && (
                <LoginModal
                    serviceId={service}
                    featureId={loginModal.featureId}
                    onClose={() => setLoginModal(null)}
                    onSuccess={handleLoginSuccess}
                    isDisconnected={isServiceDisconnected(service)}
                />
            )}
        </>
    );
};
