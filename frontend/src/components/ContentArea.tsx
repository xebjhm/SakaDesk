// frontend/src/components/ContentArea.tsx
import React from 'react';
import { useAppStore } from '../stores/appStore';
import { BlogsFeature } from './features/BlogsFeature';

interface ContentAreaProps {
    service: string;
    // MessagesFeature will need these props initially
    messagesContent: React.ReactNode;
}

export const ContentArea: React.FC<ContentAreaProps> = ({
    service,
    messagesContent,
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

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#F0F2F5]">
            {renderFeature()}
        </div>
    );
};
