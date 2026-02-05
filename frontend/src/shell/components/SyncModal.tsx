import React from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslation } from '../../i18n';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

interface SyncModalProps {
    syncProgress: SyncProgress;
}

const formatTime = (seconds: number | undefined): string => {
    if (!seconds || seconds <= 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m >= 60) {
        const h = Math.floor(m / 60);
        return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const formatSpeed = (speed: number | null | undefined, unit: string): string => {
    if (!speed || speed <= 0) return '';
    return `${speed.toFixed(2)} ${unit}/s`;
};

export const SyncModal: React.FC<SyncModalProps> = ({ syncProgress }) => {
    const { t } = useTranslation();

    const getUnitLabel = () => {
        if (syncProgress.phase_number === 2) return t('sync.members');
        if (syncProgress.phase_number === 3) return t('sync.files');
        return t('sync.items');
    };

    return (
        <div className="fixed inset-0 bg-gradient-to-br from-slate-900/90 to-slate-800/90 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
                {/* Header - Chat Room Style */}
                <div className="bg-gradient-to-r from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                            <Download className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">
                                {t('sync.phase', { number: syncProgress.phase_number || 1, name: syncProgress.phase_name || t('sync.starting') })}
                            </h3>
                            <p className="text-sm text-white/80">
                                {syncProgress.total ? `${syncProgress.total.toLocaleString()} ${getUnitLabel()}` : t('sync.pleaseWait')}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-5">
                    {/* Progress Bar */}
                    <div>
                        <div className="flex justify-between text-sm mb-2">
                            <span className="text-gray-600 font-medium">
                                {syncProgress.completed?.toLocaleString() || 0} / {syncProgress.total?.toLocaleString() || 0}
                            </span>
                            <span className="text-gray-900 font-semibold">
                                {syncProgress.total && syncProgress.total > 0
                                    ? `${Math.round(((syncProgress.completed || 0) / syncProgress.total) * 100)}%`
                                    : '0%'
                                }
                            </span>
                        </div>
                        <div className="h-4 bg-gray-100 rounded-full overflow-hidden shadow-inner">
                            <div
                                className="h-full bg-gradient-to-r from-blue-400 via-blue-500 to-indigo-500 transition-all duration-300 ease-out rounded-full relative"
                                style={{
                                    width: syncProgress.total && syncProgress.total > 0
                                        ? `${((syncProgress.completed || 0) / syncProgress.total) * 100}%`
                                        : '0%'
                                }}
                            >
                                <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/20" />
                            </div>
                        </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="bg-gray-50 rounded-xl p-3 text-center">
                            <div className="text-xs text-gray-500 mb-1">{t('time.elapsed')}</div>
                            <div className="text-lg font-mono font-semibold text-gray-900">
                                {formatTime(syncProgress.elapsed_seconds)}
                            </div>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-3 text-center">
                            <div className="text-xs text-gray-500 mb-1">{t('time.eta')}</div>
                            <div className="text-lg font-mono font-semibold text-gray-900">
                                {syncProgress.eta_seconds ? formatTime(syncProgress.eta_seconds) : '--:--'}
                            </div>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-3 text-center">
                            <div className="text-xs text-gray-500 mb-1">{t('time.speed')}</div>
                            <div className="text-lg font-mono font-semibold text-gray-900">
                                {formatSpeed(syncProgress.speed, syncProgress.speed_unit || 'it')}
                            </div>
                        </div>
                    </div>

                    {/* Current Item Detail or Warning */}
                    <div className={`rounded-xl px-4 py-3 flex items-center ${syncProgress.phase_number === 3 ? 'bg-amber-50 border border-amber-100 justify-center' : 'bg-blue-50'
                        }`}>
                        {syncProgress.phase_number === 3 ? (
                            <div className="flex items-center gap-2 text-amber-700">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span className="text-sm font-medium">
                                    {t('sync.downloadingMedia')}
                                </span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                                <span className="text-sm text-gray-700 font-medium truncate">
                                    {syncProgress.detail || t('sync.processing')}
                                    {syncProgress.detail_extra && ` ${syncProgress.detail_extra}`}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Phase Dots */}
                    <div className="flex justify-center gap-3 pt-2">
                        {[
                            { phase: 'scanning', label: t('sync.scan') },
                            { phase: 'syncing', label: t('sync.syncing') },
                            { phase: 'downloading', label: t('sync.download') }
                        ].map((p) => {
                            const currentPhaseIndex = ['scanning', 'discovering', 'syncing', 'downloading'].indexOf(syncProgress.phase || '');
                            const thisPhaseIndex = ['scanning', 'discovering', 'syncing', 'downloading'].indexOf(p.phase);
                            const isActive = syncProgress.phase === p.phase || (p.phase === 'scanning' && syncProgress.phase === 'discovering');
                            const isComplete = currentPhaseIndex > thisPhaseIndex;

                            return (
                                <div key={p.phase} className="flex flex-col items-center gap-1">
                                    <div
                                        className={`w-3 h-3 rounded-full transition-all ${isActive ? 'bg-blue-500 ring-4 ring-blue-100' :
                                            isComplete ? 'bg-green-500' :
                                                'bg-gray-200'
                                            }`}
                                    />
                                    <span className={`text-xs ${isActive ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                                        {p.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};
