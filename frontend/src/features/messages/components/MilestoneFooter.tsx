import React from 'react';
import { useTranslation } from '../../../i18n';
import { MilestoneCard } from '../../../design/primitives';
import type { Milestone } from '../milestones';

/**
 * The tier-C milestone card at the end of the chat timeline (spec §9, decision D10), in the
 * chat's group context: the number in the display face and what it counts. Full years show
 * as years.
 */
export const MilestoneFooter: React.FC<{ milestone: Milestone }> = ({ milestone }) => {
    const { t, i18n } = useTranslation();
    const years = milestone.kind === 'days' && milestone.value % 365 === 0 ? milestone.value / 365 : 0;
    const value = years > 0 ? String(years) : milestone.value.toLocaleString(i18n.language);
    const label = milestone.kind === 'messages'
        ? t('celebration.milestoneMessages')
        : years > 0
            ? t('celebration.milestoneYears', { count: years })
            : t('celebration.milestoneDays');
    return (
        <div data-testid="milestone-footer" className="px-4 pb-6 pt-2">
            <MilestoneCard value={value} label={label} />
        </div>
    );
};
