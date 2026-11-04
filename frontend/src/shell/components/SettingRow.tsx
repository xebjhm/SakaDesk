import React from 'react';

interface SettingRowProps {
    label: React.ReactNode;
    description?: React.ReactNode;
    /** Control on the right of the label (a Switch, a Button). */
    control?: React.ReactNode;
    /** Content under the label (radio groups, fields). */
    children?: React.ReactNode;
}

/** One setting: label + description, a control on the right, optional content below. */
export const SettingRow: React.FC<SettingRowProps> = ({ label, description, control, children }) => (
    <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
            <h3 className="flex items-center gap-2 text-body font-semibold text-primary">{label}</h3>
            {control}
        </div>
        {description && <p className="max-w-md text-small text-muted">{description}</p>}
        {children}
    </section>
);
