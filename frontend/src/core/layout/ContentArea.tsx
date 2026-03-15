// frontend/src/core/layout/ContentArea.tsx
import React from 'react';
import { useAppStore } from '../../store/appStore';
import { BlogsFeature } from '../../features/blogs';
import { InlineSyncView } from './InlineSyncView';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

interface ContentAreaProps {
    service: string;
    messagesContent: React.ReactNode;
    syncProgress?: SyncProgress;
    isInitialSyncing?: boolean;
}

export const ContentArea: React.FC<ContentAreaProps> = ({
    service,
    messagesContent,
    syncProgress,
    isInitialSyncing,
}) => {
    const { getActiveFeature } = useAppStore();
    const activeFeature = getActiveFeature(service);

    const renderFeature = () => {
        switch (activeFeature) {
            case 'messages':
                return messagesContent;
            case 'blogs':
                return <BlogsFeature />;
            case 'news':
                return (
                    <div className="flex-1 flex items-center justify-center text-gray-500">
                        <div className="text-center">
                            <p className="text-lg mb-2">News Feature</p>
                            <p className="text-sm">Coming soon...</p>
                        </div>
                    </div>
                );
            case 'fanclub':
                return (
                    <div className="flex-1 flex items-center justify-center text-gray-500">
                        <div className="text-center">
                            <p className="text-lg mb-2">Fan Club Feature</p>
                            <p className="text-sm">Coming soon...</p>
                        </div>
                    </div>
                );
            case 'ai':
                return (
                    <div className="flex-1 flex items-center justify-center text-gray-500">
                        <div className="text-center">
                            <p className="text-lg mb-2">AI Agent Feature</p>
                            <p className="text-sm">Coming soon...</p>
                        </div>
                    </div>
                );
            default:
                return messagesContent;
        }
    };

    if (isInitialSyncing && syncProgress?.state === 'running') {
        return (
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#F0F2F5]">
                <InlineSyncView service={service} syncProgress={syncProgress} />
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#F0F2F5]">
            {renderFeature()}
        </div>
    );
};
