import React from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Pill } from '../../../design/primitives';
import { logMemoriesToggle } from '../memoriesLog';

interface ThenNowToggleProps {
    /** Whether the host shows `ThenNowPanel` instead of its normal view. */
    on: boolean;
    onChange: (next: boolean) => void;
    /** False when the host knows there is nothing to compare: the toggle renders nothing. */
    available: boolean;
}

/**
 * The ⇆ あの日と今日 toggle a host puts in its header (On This Day's day view, the memoir
 * timeline's month): 「⇆ ほかの年とならべる」, and 「もとの表示へ」 while the comparison is shown. A
 * `Pill` whose pressed state is the current state. Logs `memories_toggle` `then_now`.
 */
export const ThenNowToggle: React.FC<ThenNowToggleProps> = ({ on, onChange, available }) => {
    const { t } = useTranslation();
    if (!available) return null;
    const flip = () => {
        logMemoriesToggle('then_now', !on);
        onChange(!on);
    };
    return (
        <Pill selected={on} onClick={flip}>
            <ArrowLeftRight aria-hidden="true" className="h-3.5 w-3.5" />
            {t(on ? 'memories.thenNow.back' : 'memories.thenNow.toggle')}
        </Pill>
    );
};
