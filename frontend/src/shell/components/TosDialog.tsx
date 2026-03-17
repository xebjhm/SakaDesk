import React, { useState } from 'react';
import { FileText, ExternalLink } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface TosDialogProps {
    onAccept: () => void;
}

/**
 * Terms of Service acknowledgment dialog shown on first launch.
 * Blocks app usage until the user accepts the terms.
 */
export const TosDialog: React.FC<TosDialogProps> = ({ onAccept }) => {
    const { t } = useTranslation();
    const [acknowledged, setAcknowledged] = useState(false);

    const handleAccept = () => {
        if (acknowledged) {
            // Store acceptance timestamp in localStorage
            localStorage.setItem('tos_accepted_at', new Date().toISOString());
            onAccept();
        }
    };

    return (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#b4dcff] to-[#f0bede] px-6 py-5">
                    <div className="flex items-center gap-3">
                        <FileText className="w-8 h-8 text-white" />
                        <div>
                            <h3 className="text-xl font-bold text-white">{t('tos.title')}</h3>
                            <p className="text-sm text-white/80">{t('tos.subtitle')}</p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    {/* Disclaimer box */}
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                        <h4 className="font-semibold text-amber-800 mb-2">{t('tos.disclaimer')}</h4>
                        <p className="text-sm text-amber-700">
                            {t('tos.disclaimerText')}
                        </p>
                    </div>

                    {/* Official ToS excerpts (collapsible) */}
                    <details className="bg-gray-50 rounded-xl p-4">
                        <summary className="text-xs text-gray-600 font-medium cursor-pointer select-none">
                            {t('tos.officialExcerpts')}
                        </summary>
                        <div className="mt-3 text-xs text-gray-500 space-y-3 leading-relaxed">
                            <div>
                                <p className="font-semibold">第3条（知的財産権）</p>
                                <p>当社が別に定める場合を除き、お客様が本コンテンツを複製、翻案、頒布、公衆送信等することは禁止します。</p>
                            </div>
                            <div>
                                <p className="font-semibold">第8条（禁止事項）</p>
                                <p>(11) 当社または第三者の情報、データおよびソフトウェアを修正、改変、改ざん、リバースエンジニアリング、逆コンパイル、逆アッセンブルまたは消去等する行為</p>
                                <p>(16) 当社が指定するアクセス方法以外の手段で本サービスにアクセスし、またはアクセスを試みる行為</p>
                                <p>(17) 自動化された手段（クローラおよび類似の技術を含む）を用いて本サービスにアクセスし、またはアクセスを試みる行為</p>
                            </div>
                        </div>
                    </details>

                    {/* Official ToS links */}
                    <div className="bg-gray-50 rounded-xl p-4">
                        <p className="text-xs text-gray-500 mb-3">
                            {t('tos.reviewOfficialTos')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <a
                                href="https://contact.nogizaka46.com/s/n46app/page/app_terms"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 hover:underline"
                            >
                                <ExternalLink className="w-3 h-3" />
                                {t('tos.nogizakaTos')}
                            </a>
                            <span className="text-gray-300">|</span>
                            <a
                                href="https://sakurazaka46.com/s/s46app/page/app_terms"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-pink-600 hover:text-pink-800 hover:underline"
                            >
                                <ExternalLink className="w-3 h-3" />
                                {t('tos.sakurazakaTos')}
                            </a>
                            <span className="text-gray-300">|</span>
                            <a
                                href="https://www.hinatazaka46.com/s/h46app/page/app_terms"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                            >
                                <ExternalLink className="w-3 h-3" />
                                {t('tos.hinatazakaTos')}
                            </a>
                            <span className="text-gray-300">|</span>
                            <a
                                href="https://yodel-app.com/s/yodel/rule"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
                            >
                                <ExternalLink className="w-3 h-3" />
                                {t('tos.yodelTos')}
                            </a>
                        </div>
                    </div>

                    {/* Acknowledgment checkbox */}
                    <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl hover:bg-gray-50 transition-colors">
                        <input
                            type="checkbox"
                            checked={acknowledged}
                            onChange={(e) => setAcknowledged(e.target.checked)}
                            className="mt-0.5 w-5 h-5 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                        />
                        <span className="text-sm text-gray-700">
                            {t('tos.acceptCheckbox')}
                        </span>
                    </label>

                    {/* Accept button */}
                    <button
                        onClick={handleAccept}
                        disabled={!acknowledged}
                        className="w-full py-3 bg-blue-400 text-white rounded-xl font-medium hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {t('tos.acceptAndContinue')}
                    </button>
                </div>
            </div>
        </div>
    );
};
