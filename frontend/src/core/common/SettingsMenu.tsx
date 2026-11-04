// frontend/src/core/common/SettingsMenu.tsx
import React, { useState, useRef } from 'react';
import { Settings, Bug, Info, Lightbulb } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { IconButton, Menu, MenuItem, MenuSeparator } from '../../design/primitives';

declare const __APP_VERSION__: string;

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

**App Version:** ${__APP_VERSION__}
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

    return `https://github.com/xebjhm/SakaDesk/issues/new?${params.toString()}`;
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
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const close = () => setIsOpen(false);
    const run = (action: () => void) => { close(); action(); };

    return (
        <div className="relative">
            <IconButton
                ref={triggerRef}
                variant="secondary"
                className="h-11 w-11"
                aria-label={t('common.settings')}
                title={t('common.settings')}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                icon={<Settings className="h-5 w-5" />}
                onClick={() => setIsOpen((o) => !o)}
            />
            {isOpen && (
                <Menu
                    aria-label={t('common.settings')}
                    onClose={close}
                    returnFocusRef={triggerRef}
                    ignoreRefs={[triggerRef]}
                    className="absolute bottom-0 left-full ml-2 w-48"
                >
                    <MenuItem icon={<Settings className="h-4 w-4" />} onClick={() => run(onOpenSettings)}>{t('common.settings')}</MenuItem>
                    <MenuItem icon={<Bug className="h-4 w-4" />} onClick={() => run(onReportIssue)}>{t('common.reportIssue')}</MenuItem>
                    <MenuItem icon={<Lightbulb className="h-4 w-4" />} onClick={() => run(() => window.open(buildFeatureRequestUrl(), '_blank'))}>
                        {t('common.featureRequest')}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Info className="h-4 w-4" />} onClick={() => run(onOpenAbout)}>{t('common.about')}</MenuItem>
                </Menu>
            )}
        </div>
    );
};
