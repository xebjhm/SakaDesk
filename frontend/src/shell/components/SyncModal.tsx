import React from 'react';
import { Download, Loader2, Image as ImageIcon, Video, Mic } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { formatDateTime } from '../../utils/classnames';
import { getServiceById } from '../../data/services';
import { formatSyncTime, formatSyncSpeed, getSyncPhaseName, getSyncUnitLabel } from '../../utils/syncFormatters';
import type { SyncProgress } from '../../features/messages/MessagesFeature';
import type { SequentialSyncInfo } from '../hooks/useSync';

interface SyncModalProps {
    syncProgress: SyncProgress;
    sequentialSyncInfo?: SequentialSyncInfo | null;
    onClose?: () => void;
}

export const SyncModal: React.FC<SyncModalProps> = ({ syncProgress, sequentialSyncInfo, onClose }) => {
    const { t } = useTranslation();

    const getPhaseName = () => getSyncPhaseName(syncProgress, t);
    const getUnitLabel = () => getSyncUnitLabel(syncProgress, t);

    const serviceName = sequentialSyncInfo
        ? getServiceById(sequentialSyncInfo.currentService)?.displayName ?? sequentialSyncInfo.currentService
        : null;

    return (
        <div className="fixed inset-0 bg-gradient-to-br from-slate-900/90 to-slate-800/90 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
                {/* Header - Chat Room Style */}
                <div className="bg-gradient-to-r from-[#b4dcff] to-[#f0bede] px-6 py-4">
                    {/* Multi-service counter (shown during sequential sync) */}
                    {sequentialSyncInfo && sequentialSyncInfo.total > 1 && (
                        <div className="flex items-center justify-center gap-2 mb-3">
                            {Array.from({ length: sequentialSyncInfo.total }, (_, i) => (
                                <div
                                    key={i}
                                    className={`h-1.5 rounded-full transition-all ${
                                        i < sequentialSyncInfo.currentIndex ? 'bg-white w-6' :
                                        i === sequentialSyncInfo.currentIndex ? 'bg-white w-10' :
                                        'bg-white/30 w-6'
                                    }`}
                                />
                            ))}
                            <span className="text-white/80 text-xs ml-2 font-medium">
                                {serviceName} ({sequentialSyncInfo.currentIndex + 1}/{sequentialSyncInfo.total})
                            </span>
                        </div>
                    )}
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                            <Download className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">
                                {syncProgress.phase === 'complete'
                                    ? t('sync.complete')
                                    : t('sync.phase', { number: syncProgress.phase_number || 1, name: getPhaseName() })
                                }
                            </h3>
                            <p className="text-sm text-white/80">
                                {syncProgress.phase === 'complete'
                                    ? t('sync.syncComplete')
                                    : syncProgress.total
                                        ? `${syncProgress.total.toLocaleString()} ${getUnitLabel()}`
                                        : t('sync.pleaseWait')
                                }
                            </p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-5">
                    {syncProgress.state === 'complete' && syncProgress.result && (
                        <div className="text-xs text-gray-600 space-y-2">
                            <p>
                                {syncProgress.result.missing === 0 && (syncProgress.result.unresolved ?? 0) === 0
                                    ? t('settings.verifyNoGaps')
                                    : t('settings.verifySummary', {
                                          checked: syncProgress.result.checked,
                                          repaired: syncProgress.result.repaired,
                                          stillMissing: syncProgress.result.still_missing,
                                      })}
                            </p>
                            {(syncProgress.result.unresolved ?? 0) > 0 && (
                                <div className="rounded-xl border border-amber-100 overflow-hidden">
                                    <div className="px-3 py-2 bg-amber-50 font-medium text-amber-700">
                                        {t('settings.verifyUnresolved', { count: syncProgress.result.unresolved })}
                                    </div>
                                    {(syncProgress.result.unresolved_items?.length ?? 0) > 0 && (
                                        <div className="max-h-44 overflow-y-auto divide-y divide-gray-100">
                                            {syncProgress.result.unresolved_items!.map((it, i) => {
                                                const Icon = it.media_type === 'video' ? Video
                                                    : it.media_type === 'voice' ? Mic : ImageIcon;
                                                return (
                                                    <div key={i} className="flex items-center gap-2.5 px-3 py-2">
                                                        <Icon className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" />
                                                        <span className="flex-1 truncate text-gray-700">{it.member}</span>
                                                        <span className="flex-shrink-0 tabular-nums text-gray-400">
                                                            {it.timestamp ? formatDateTime(it.timestamp) : ''}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
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
                                className="h-full bg-gradient-to-r from-[#b4dcff] to-[#f0bede] transition-all duration-300 ease-out rounded-full relative"
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
                                {formatSyncTime(syncProgress.elapsed_seconds)}
                            </div>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-3 text-center">
                            <div className="text-xs text-gray-500 mb-1">{t('time.eta')}</div>
                            <div className="text-lg font-mono font-semibold text-gray-900">
                                {syncProgress.eta_seconds ? formatSyncTime(syncProgress.eta_seconds) : '--:--'}
                            </div>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-3 text-center">
                            <div className="text-xs text-gray-500 mb-1">{t('time.speed')}</div>
                            <div className="text-lg font-mono font-semibold text-gray-900">
                                {formatSyncSpeed(syncProgress.speed, syncProgress.speed_unit || 'it')}
                            </div>
                        </div>
                    </div>

                    {/* Current Item Detail or Warning — only while actively running.
                        On completion the backend leaves phase_number at 3; without this
                        guard the "downloading media... do not close" warning (and the
                        spinner) would persist and make a finished sync look stuck. */}
                    {syncProgress.state === 'running' && (
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
                    )}

                    {/* Phase Dots */}
                    <div className="flex justify-center gap-3 pt-2">
                        {[
                            { phase: 'scanning', label: t('sync.scan') },
                            { phase: 'syncing', label: t('sync.syncing') },
                            { phase: 'downloading', label: t('sync.download') }
                        ].map((p) => {
                            const phaseOrder = ['scanning', 'discovering', 'syncing', 'downloading', 'complete'];
                            const currentPhaseIndex = phaseOrder.indexOf(syncProgress.phase || '');
                            const thisPhaseIndex = phaseOrder.indexOf(p.phase);
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

                    {(syncProgress.state === 'complete' || syncProgress.state === 'error') && onClose && (
                        <div className="flex justify-center pt-1">
                            <button
                                onClick={onClose}
                                className="px-5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700"
                            >
                                {t('common.done')}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
