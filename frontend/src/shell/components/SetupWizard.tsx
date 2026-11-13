import React, { useId, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { Button, Input, Modal } from '../../design/primitives';
import { clientLog } from '../../utils/clientLog';

interface SetupWizardProps {
    outputDirInput: string;
    setupBlogFullBackup: boolean;
    setSetupBlogFullBackup: (enabled: boolean) => void;
    onSelectFolder: () => void;
    onComplete: () => void;
    isValid: boolean;
    /** i18n key of the last folder-picker failure (`settings.outputDirError.*`), shown under the field; null when none. */
    folderErrorKey?: string | null;
}

/**
 * First-launch output folder: a brand dialog (spec §4), not dismissible, one primary (D2d
 * decisions 4, 17, 18). A form never disables its submit (spec §8): Start validates on click,
 * says what is missing and focuses the field. The folder is chosen with Browse only, in the
 * native picker the backend runs (security audit 2026-11-13), so the field shows it read-only
 * and a refused pick says why inside this dialog.
 */
export const SetupWizard: React.FC<SetupWizardProps> = ({
    outputDirInput,
    setupBlogFullBackup,
    setSetupBlogFullBackup,
    onSelectFolder,
    onComplete,
    isValid,
    folderErrorKey = null,
}) => {
    const { t } = useTranslation();
    const inputId = useId();
    const hintId = useId();
    const errorId = useId();
    const folderErrorId = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const [triedEmpty, setTriedEmpty] = useState(false);
    // A folder chosen with Browse clears the message without another click.
    const missing = triedEmpty && !isValid;
    const describedBy = [hintId, missing ? errorId : null, folderErrorKey ? folderErrorId : null]
        .filter(Boolean)
        .join(' ');

    const handleStart = () => {
        if (!isValid) {
            setTriedEmpty(true);
            clientLog('entry_validation', { surface: 'setup', reason: 'missing_folder' });
            inputRef.current?.focus();
            return;
        }
        onComplete();
    };

    return (
        <Modal
            isOpen
            onClose={() => {}}
            scope="brand"
            title={t('setup.welcome')}
            icon={<FolderOpen />}
            dismissible={false}
            logId="setup"
            className="max-w-md"
            bodyClassName="flex flex-col gap-4"
            footer={
                <Button variant="primary" className="w-full" onClick={handleStart}>
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
                        ref={inputRef}
                        id={inputId}
                        value={outputDirInput}
                        readOnly
                        placeholder={t('setup.outputFolderPlaceholder')}
                        aria-invalid={missing || !!folderErrorKey || undefined}
                        aria-describedby={describedBy}
                        className="flex-1"
                    />
                    <Button variant="secondary" onClick={onSelectFolder}>{t('common.browse')}</Button>
                </div>
                <p id={hintId} className="text-caption text-muted">{t('setup.outputFolderHint')}</p>
                {missing && (
                    <p id={errorId} role="alert" className="text-caption text-status-danger">{t('setup.folderRequired')}</p>
                )}
                {folderErrorKey && (
                    <p id={folderErrorId} role="alert" className="text-caption text-status-danger">{t(folderErrorKey)}</p>
                )}
            </div>

            {/* Blog sync option (e4e4118: near-white gray box, blue checkbox; now elevated fill, ink checkbox) */}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-elevated p-4">
                <input
                    type="checkbox"
                    checked={setupBlogFullBackup}
                    onChange={(e) => setSetupBlogFullBackup(e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-accent"
                />
                <span className="flex flex-col gap-1">
                    <span className="text-small font-semibold text-primary">{t('setup.downloadBlogsOffline')}</span>
                    <span className="text-caption text-secondary">{t('setup.downloadBlogsHint')}</span>
                </span>
            </label>
        </Modal>
    );
};
