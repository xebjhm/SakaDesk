import React, { useId } from 'react';
import { useTranslation } from '../../i18n';
import { Button, Input, Modal } from '../../design/primitives';

interface SetupWizardProps {
    outputDirInput: string;
    setOutputDirInput: (dir: string) => void;
    setupBlogFullBackup: boolean;
    setSetupBlogFullBackup: (enabled: boolean) => void;
    onSelectFolder: () => void;
    onComplete: () => void;
    isValid: boolean;
}

/** First-launch output folder (spec D2d decisions 4, 17, 18): not dismissible; one primary. */
export const SetupWizard: React.FC<SetupWizardProps> = ({
    outputDirInput,
    setOutputDirInput,
    setupBlogFullBackup,
    setSetupBlogFullBackup,
    onSelectFolder,
    onComplete,
    isValid,
}) => {
    const { t } = useTranslation();
    const inputId = useId();

    return (
        <Modal
            isOpen
            onClose={() => {}}
            title={t('setup.welcome')}
            dismissible={false}
            logId="setup"
            className="max-w-md"
            bodyClassName="flex flex-col gap-4"
            footer={
                <Button variant="primary" className="w-full" onClick={onComplete} disabled={!isValid}>
                    {t('setup.startUsing')}
                </Button>
            }
        >
            <p className="text-small text-muted">{t('setup.setupDataFolder')}</p>

            <div className="flex flex-col gap-2">
                <label htmlFor={inputId} className="text-small font-semibold text-secondary">
                    {t('setup.outputFolderPath')}
                </label>
                <div className="flex gap-2">
                    <Input
                        id={inputId}
                        value={outputDirInput}
                        onChange={(e) => setOutputDirInput(e.target.value)}
                        placeholder={t('setup.outputFolderPlaceholder')}
                        className="flex-1"
                    />
                    <Button variant="secondary" onClick={onSelectFolder}>{t('common.browse')}</Button>
                </div>
                <p className="text-caption text-muted">{t('setup.outputFolderHint')}</p>
            </div>

            {/* Blog Sync Mode Option */}
            <label className="flex cursor-pointer items-start gap-3 rounded-card bg-sunken p-4">
                <input
                    type="checkbox"
                    checked={setupBlogFullBackup}
                    onChange={(e) => setSetupBlogFullBackup(e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-group"
                />
                <span className="flex flex-col gap-1">
                    <span className="text-small font-semibold text-primary">{t('setup.downloadBlogsOffline')}</span>
                    <span className="text-caption text-secondary">{t('setup.downloadBlogsHint')}</span>
                </span>
            </label>
        </Modal>
    );
};
