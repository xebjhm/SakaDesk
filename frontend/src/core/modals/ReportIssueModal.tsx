import { useState } from 'react';
import { Bug, ExternalLink, Database, Play, LogIn, HelpCircle } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { Modal, Button, Input, Spinner } from '../../design/primitives';
import { logDialogLoad } from '../../design/dialog/dialogLog';
import { cn } from '../../utils/classnames';

type BugCategory = 'sync_data' | 'playback' | 'login' | 'other';

interface ReportIssueModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentMemberPath?: string;
    currentMessageId?: number;
    currentScreen?: string;
    crashError?: string;
}

interface CategoryConfig {
    id: BugCategory;
    labelKey: string;
    helpKey: string;
    icon: typeof Bug;
}

const CATEGORY_CONFIGS: CategoryConfig[] = [
    { id: 'sync_data', labelKey: 'report.categorySyncData', helpKey: 'report.categorySyncDataHelp', icon: Database },
    { id: 'playback', labelKey: 'report.categoryPlayback', helpKey: 'report.categoryPlaybackHelp', icon: Play },
    { id: 'login', labelKey: 'report.categoryLogin', helpKey: 'report.categoryLoginHelp', icon: LogIn },
    { id: 'other', labelKey: 'report.categoryOther', helpKey: 'report.categoryOtherHelp', icon: HelpCircle },
];

export function ReportIssueModal({
    isOpen,
    onClose,
    currentMemberPath,
    currentMessageId,
    currentScreen,
    crashError,
}: ReportIssueModalProps) {
    const { t } = useTranslation();
    const [category, setCategory] = useState<BugCategory | null>(crashError ? 'other' : null);
    const [whatDoing, setWhatDoing] = useState('');
    const [whatWrong, setWhatWrong] = useState(crashError || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
        if (!category) return;

        setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams({
                what_doing: whatDoing,
                what_wrong: whatWrong,
            });

            const res = await fetch(`/api/report?${params}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category,
                    member_path: currentMemberPath,
                    message_id: currentMessageId,
                    current_screen: currentScreen,
                    error_message: crashError,
                }),
            });

            if (!res.ok) throw new Error('Failed to generate report');

            const data = await res.json();

            // Copy full diagnostics (including logs) to clipboard for pasting into the issue
            try {
                await navigator.clipboard.writeText(JSON.stringify(data.diagnostics, null, 2));
            } catch {
                // Clipboard unavailable — user still gets compact diagnostics in the URL
            }

            // Open GitHub in new tab
            window.open(data.github_url, '_blank');
            logDialogLoad('report_issue', 'ok');
            onClose();
        } catch (err: any) {
            logDialogLoad('report_issue', 'error');
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        setCategory(null);
        setWhatDoing('');
        setWhatWrong(crashError || '');
        setError(null);
        onClose();
    };

    return (
        <Modal scope="brand" icon={<Bug />} isOpen={isOpen} onClose={handleClose} title={t('report.title')} closeLabel={t('common.close')} logId="report_issue" className="max-w-lg"
            bodyClassName="flex flex-col gap-6"
            footer={
                <>
                    <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
                    <Button variant="primary" onClick={handleSubmit} disabled={!category || loading}>
                        {loading ? <Spinner size="sm" tone="current" decorative /> : <ExternalLink className="h-4 w-4" />}
                        {loading ? t('report.generating') : t('report.createGitHubIssue')}
                    </Button>
                </>
            }
        >
            <section className="flex flex-col gap-3">
                <h3 className="text-small font-semibold text-secondary">{t('report.whatType')}</h3>
                <div className="grid grid-cols-2 gap-3">
                    {CATEGORY_CONFIGS.map((cat) => {
                        const Icon = cat.icon;
                        const isSelected = category === cat.id;
                        return (
                            <button
                                key={cat.id}
                                type="button"
                                aria-pressed={isSelected}
                                onClick={() => setCategory(cat.id)}
                                className={cn(
                                    'flex flex-col gap-1 rounded-card border-2 p-4 text-left shadow-card transition-colors duration-fast ease-standard',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                                    isSelected ? 'border-accent bg-accent-subtle' : 'border-transparent bg-card hover:bg-sunken',
                                )}
                            >
                                <span className="flex items-center gap-2 text-body font-semibold">
                                    <Icon className={cn('h-4 w-4', isSelected ? 'text-accent' : 'text-secondary')} />
                                    <span className={isSelected ? 'text-accent-strong' : 'text-primary'}>{t(cat.labelKey)}</span>
                                </span>
                                <span className="text-caption text-muted">{t(cat.helpKey)}</span>
                            </button>
                        );
                    })}
                </div>
            </section>
            <section className="flex flex-col gap-4">
                <label className="flex flex-col gap-1 text-small font-semibold text-secondary">
                    {t('report.whatDoing')}
                    <Input value={whatDoing} onChange={(e) => setWhatDoing(e.target.value)} placeholder={t('report.whatDoingPlaceholder')} />
                </label>
                <label className="flex flex-col gap-1 text-small font-semibold text-secondary">
                    {t('report.whatWrong')}
                    <Input value={whatWrong} onChange={(e) => setWhatWrong(e.target.value)} placeholder={t('report.whatWrongPlaceholder')} />
                </label>
            </section>
            {(currentMemberPath || crashError) && (
                <div className="flex flex-col gap-1 rounded-card bg-sunken p-3 text-caption text-secondary">
                    <p className="font-semibold text-primary">{t('report.autoContext')}</p>
                    {currentMemberPath && <p>{t('report.member')}: {currentMemberPath}</p>}
                    {crashError && <p className="text-status-danger">{t('common.error')}: {crashError.slice(0, 100)}...</p>}
                </div>
            )}
            {error && <p role="alert" className="text-small text-status-danger">{error}</p>}
        </Modal>
    );
}
