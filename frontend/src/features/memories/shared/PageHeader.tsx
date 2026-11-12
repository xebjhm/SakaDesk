import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';

interface PageHeaderProps {
    title: React.ReactNode;
    onBack: () => void;
    /** Right-hand controls (filters, date navigation). Never a bare count: counts go next to her words (spec 1.1). */
    right?: React.ReactNode;
}

/** A Memories page header: back, the serif page title, and a right slot. */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, onBack, right }) => {
    const { t } = useTranslation();
    return (
        <header className="flex shrink-0 items-center gap-3 px-4 py-3">
            <IconButton aria-label={t('memories.common.back')} icon={<ArrowLeft className="h-5 w-5" />} onClick={onBack} />
            <h1 className="min-w-0 flex-1 truncate font-display text-heading text-primary">{title}</h1>
            {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
        </header>
    );
};
