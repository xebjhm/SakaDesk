// frontend/src/core/layout/FeatureRail.tsx
import React, { useState } from 'react';
import { cn } from '../../utils/classnames';
import { useAppStore, FeatureId } from '../../store/appStore';
import { getAvailableFeatures, FEATURE_DEFINITIONS, isFeaturePaid } from '../../config/features';
import { useAuth } from '../../shell/hooks/useAuth';
import { LoginModal } from '../../shell/components/LoginModal';

export interface FeatureRailProps {
    service: string;
}

export const FeatureRail: React.FC<FeatureRailProps> = ({ service }) => {
    const { getActiveFeature, setActiveFeature, getFeatureOrder, triggerBlogViewReset } = useAppStore();
    const { isServiceConnected, checkAuth } = useAuth();
    const [loginModal, setLoginModal] = useState<{ featureId: FeatureId } | null>(null);

    const activeFeature = getActiveFeature(service);
    const featureOrder = getFeatureOrder(service);
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
            <div className="w-12 bg-[#2b2d31] h-full flex flex-col items-center py-3 gap-1 shrink-0 border-r border-[#1e1f22]">
                {sortedFeatures.map(feature => {
                    const isActive = activeFeature === feature.id;
                    const Icon = feature.icon;

                    return (
                        <button
                            key={feature.id}
                            onClick={() => handleFeatureClick(feature.id)}
                            className={cn(
                                "group relative w-10 h-10 rounded-lg flex items-center justify-center transition-all",
                                isActive
                                    ? "bg-[#404249] text-white"
                                    : "text-[#949ba4] hover:text-white hover:bg-[#35373c]"
                            )}
                            title={feature.label}
                        >
                            {/* Active indicator */}
                            {isActive && (
                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-white rounded-r-full" />
                            )}

                            <Icon className="w-5 h-5" />
                        </button>
                    );
                })}

                {/* Separator and future features hint */}
                {availableFeatures.length < Object.keys(FEATURE_DEFINITIONS).length && (
                    <>
                        <div className="w-8 h-px bg-[#3f4147] my-2" />
                        <div className="text-[10px] text-[#949ba4] text-center px-1">
                            More coming soon
                        </div>
                    </>
                )}
            </div>

            {/* Login Modal for paid features */}
            {loginModal && (
                <LoginModal
                    serviceId={service}
                    featureId={loginModal.featureId}
                    onClose={() => setLoginModal(null)}
                    onSuccess={handleLoginSuccess}
                />
            )}
        </>
    );
};
