// frontend/src/core/layout/FeatureRail.tsx
import React, { useState } from 'react';
import { cn } from '../../utils/classnames';
import { useAppStore, FeatureId } from '../../store/appStore';
import { getAvailableFeatures, isFeaturePaid } from '../../config/features';
import { useAuth } from '../../shell/hooks/useAuth';
import { LoginModal } from '../../shell/components/LoginModal';
import { getServicePrimaryColor } from '../../data/services';

export interface FeatureRailProps {
    service: string;
}

/**
 * Convert hex color to rgba with opacity for light tints
 */
function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const FeatureRail: React.FC<FeatureRailProps> = ({ service }) => {
    const { getActiveFeature, setActiveFeature, getFeatureOrder, triggerBlogViewReset } = useAppStore();
    const { isServiceConnected, checkAuth, isServiceDisconnected } = useAuth();
    const [loginModal, setLoginModal] = useState<{ featureId: FeatureId } | null>(null);

    const activeFeature = getActiveFeature(service);
    const featureOrder = getFeatureOrder(service);
    const availableFeatures = getAvailableFeatures(service);
    const primaryColor = getServicePrimaryColor(service);

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
            <div className="w-12 bg-white h-full flex flex-col items-center py-3 gap-1 shrink-0 border-r border-gray-100">
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
                                    ? ""
                                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                            )}
                            style={isActive ? {
                                backgroundColor: hexToRgba(primaryColor, 0.2),
                                color: primaryColor,
                            } : undefined}
                            title={feature.label}
                        >
                            {/* Active indicator - colored bar */}
                            {isActive && (
                                <div
                                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                                    style={{ backgroundColor: primaryColor }}
                                />
                            )}

                            <Icon className="w-5 h-5" />
                        </button>
                    );
                })}

            </div>

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
