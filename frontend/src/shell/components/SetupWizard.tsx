import React from 'react';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface SetupWizardProps {
    outputDirInput: string;
    setOutputDirInput: (dir: string) => void;
    setupBlogFullBackup: boolean;
    setSetupBlogFullBackup: (enabled: boolean) => void;
    onSelectFolder: () => void;
    onComplete: () => void;
    isValid: boolean;
}

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

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] px-6 py-5">
                    <div className="flex items-center gap-3">
                        <FolderOpen className="w-8 h-8 text-white" />
                        <div>
                            <h3 className="text-xl font-bold text-white">{t('setup.welcome')}</h3>
                            <p className="text-sm text-white/80">{t('setup.setupDataFolder')}</p>
                        </div>
                    </div>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            {t('setup.outputFolderPath')}
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={outputDirInput}
                                onChange={(e) => setOutputDirInput(e.target.value)}
                                placeholder={t('setup.outputFolderPlaceholder')}
                                className="flex-1 px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <button
                                onClick={onSelectFolder}
                                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors border border-gray-200"
                            >
                                {t('common.browse')}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                            {t('setup.outputFolderHint')}
                        </p>
                    </div>

                    {/* Blog Sync Mode Option */}
                    <div className="bg-gray-50 rounded-xl p-4">
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={setupBlogFullBackup}
                                onChange={(e) => setSetupBlogFullBackup(e.target.checked)}
                                className="mt-1 w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                            />
                            <div>
                                <span className="text-sm font-medium text-gray-700">{t('setup.downloadBlogsOffline')}</span>
                                <p className="text-xs text-gray-500 mt-1">
                                    {t('setup.downloadBlogsHint')}
                                </p>
                            </div>
                        </label>
                    </div>

                    <button
                        onClick={onComplete}
                        disabled={!isValid}
                        className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {t('setup.startUsing')}
                    </button>
                </div>
            </div>
        </div>
    );
};
