import React, { useEffect, useId } from 'react';
import { Switch, announce } from '../../design/primitives';

interface SettingRowProps {
    label: React.ReactNode;
    /** Id for the label heading, to name a group under it (the sync-mode radios). */
    labelId?: string;
    description?: React.ReactNode;
    /** Id for the description, so a field under the row can name it in `aria-describedby`. */
    descriptionId?: string;
    /** Control on the right of the label (a Switch, a Button). It is described by the row's description and error unless it names its own `aria-describedby`; with an error it is `aria-invalid`. */
    control?: React.ReactNode;
    /** Content under the label (radio groups, fields). */
    children?: React.ReactNode;
    /** Shown under the row when saving it failed (or, on the output folder row, when its picker failed). */
    error?: string;
    /** Id for the error, so a field under the row can name it in `aria-describedby`. */
    errorId?: string;
}

/** One setting: label + description, a control on the right, optional content below. */
export const SettingRow: React.FC<SettingRowProps> = ({ label, labelId, description, descriptionId, control, children, error, errorId }) => {
    const autoId = useId();
    const descId = description ? (descriptionId ?? `${autoId}-desc`) : undefined;
    const errId = error ? (errorId ?? `${autoId}-err`) : undefined;
    // A failed save is announced through the dialog's one live region, not by a region that mounts
    // with its text (often missed). The error line itself has no live role, so it is not read twice;
    // the control reads it again through aria-describedby when focused.
    useEffect(() => { if (error) announce(error); }, [error]);
    const describedBy = [descId, errId].filter(Boolean).join(' ') || undefined;
    // The control reads the row's description and error (UI health A-S6), unless it names its own.
    // aria-invalid is for fields and switches, not a plain button.
    const fieldLike = React.isValidElement<{ role?: string }>(control)
        && (control.type === 'input' || control.type === 'select' || control.type === 'textarea'
            || control.props.role === 'switch' || control.props.role === 'checkbox' || control.type === Switch);
    const linkedControl = React.isValidElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean }>(control) && (describedBy || error)
        ? React.cloneElement(control, {
            ...(describedBy && !control.props['aria-describedby'] ? { 'aria-describedby': describedBy } : {}),
            ...(error && fieldLike && control.props['aria-invalid'] === undefined ? { 'aria-invalid': true } : {}),
        })
        : control;
    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
                <h3 id={labelId} className="flex items-center gap-2 text-body font-semibold text-primary">{label}</h3>
                {linkedControl}
            </div>
            {description && <p id={descId} className="max-w-md text-small text-muted">{description}</p>}
            {children}
            {error && <p id={errId} className="text-small text-status-danger">{error}</p>}
        </section>
    );
};
