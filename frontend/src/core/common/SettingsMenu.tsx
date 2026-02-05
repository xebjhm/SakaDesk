// frontend/src/core/common/SettingsMenu.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Settings, Bug, Info, Lightbulb } from 'lucide-react';
import { cn } from '../../utils/classnames';

// App version (keep in sync with AboutModal)
const APP_VERSION = '0.1.0';

/**
 * Build a GitHub issue URL for feature requests with pre-filled template.
 * Opens in user's browser - no auth needed (uses their GitHub login).
 */
function buildFeatureRequestUrl(): string {
    // Detect OS for the template
    const getOS = (): string => {
        const ua = navigator.userAgent;
        if (ua.includes('Win')) return 'Windows';
        if (ua.includes('Mac')) return 'macOS';
        if (ua.includes('Linux')) return 'Linux';
        return 'Unknown';
    };

    const os = getOS();

    // Pre-fill the issue body with a template
    const body = `## Feature Request

**App Version:** ${APP_VERSION}
**OS:** ${os}

### Description
<!-- Please describe the feature you'd like to see -->


### Use Case
<!-- Why would this feature be useful? -->


### Additional Context
<!-- Any other context, screenshots, or examples -->

`;

    const params = new URLSearchParams({
        template: 'feature_request.md',
        title: 'Feature Request: ',
        labels: 'enhancement',
        body: body,
    });

    return `https://github.com/xtorker/HakoDesk/issues/new?${params.toString()}`;
}

interface SettingsMenuProps {
    onOpenSettings: () => void;
    onReportIssue: () => void;
    onOpenAbout: () => void;
}

export const SettingsMenu: React.FC<SettingsMenuProps> = ({
    onOpenSettings,
    onReportIssue,
    onOpenAbout,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleMenuAction = (action: () => void) => {
        setIsOpen(false);
        action();
    };

    return (
        <div className="relative" ref={menuRef}>
            {/* Settings Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="group relative w-12 h-12 rounded-[24px] flex items-center justify-center transition-all duration-200 hover:rounded-[16px]"
                title="Settings"
            >
                <div className={cn(
                    "w-12 h-12 rounded-[24px] bg-[#313338] flex items-center justify-center text-gray-400 transition-all duration-200 group-hover:rounded-[16px] group-hover:bg-gray-600 group-hover:text-white",
                    isOpen && "rounded-[16px] bg-gray-600 text-white"
                )}>
                    <Settings className="w-5 h-5" />
                </div>
            </button>

            {/* Dropdown Menu - Opens to the right */}
            {isOpen && (
                <div className="absolute left-full bottom-0 ml-2 w-48 bg-[#111214] rounded-lg shadow-xl border border-gray-700 py-1.5 z-50">
                    <button
                        onClick={() => handleMenuAction(onOpenSettings)}
                        className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-[#3b3d44] flex items-center gap-2.5 transition-colors"
                    >
                        <Settings className="w-4 h-4 text-gray-400" />
                        Settings
                    </button>
                    <button
                        onClick={() => handleMenuAction(onReportIssue)}
                        className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-[#3b3d44] flex items-center gap-2.5 transition-colors"
                    >
                        <Bug className="w-4 h-4 text-gray-400" />
                        Report Issue
                    </button>
                    <button
                        onClick={() => {
                            setIsOpen(false);
                            window.open(buildFeatureRequestUrl(), '_blank');
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-[#3b3d44] flex items-center gap-2.5 transition-colors"
                    >
                        <Lightbulb className="w-4 h-4 text-gray-400" />
                        Feature Request
                    </button>
                    <div className="h-px bg-gray-700 my-1" />
                    <button
                        onClick={() => handleMenuAction(onOpenAbout)}
                        className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-[#3b3d44] flex items-center gap-2.5 transition-colors"
                    >
                        <Info className="w-4 h-4 text-gray-400" />
                        About
                    </button>
                </div>
            )}
        </div>
    );
};
