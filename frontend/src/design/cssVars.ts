/**
 * Pure token -> CSS custom property maps. `applyTokens.ts` writes them to
 * :root; `tailwind.config.js` utilities read them via var(--ds-*).
 */
import { color, groupRoles, groupTokens, radius, shadow, typeScale, motion, easingCss, type GroupId } from './tokens';

export function staticTokenVars(): Record<string, string> {
    const vars: Record<string, string> = {};
    for (const [name, value] of Object.entries(color.surface)) vars[`--ds-surface-${name}`] = value;
    for (const [name, value] of Object.entries(color.text)) vars[`--ds-text-${name}`] = value;
    for (const [name, value] of Object.entries(color.border)) vars[`--ds-border-${name}`] = value;
    for (const [name, value] of Object.entries(color.overlay)) vars[`--ds-overlay-${name}`] = value;
    for (const [name, value] of Object.entries(color.feedback)) vars[`--ds-feedback-${name}`] = value;
    for (const [name, value] of Object.entries(radius)) vars[`--ds-radius-${name}`] = value;
    for (const [name, value] of Object.entries(shadow)) vars[`--ds-shadow-${name}`] = value;
    for (const [name, step] of Object.entries(typeScale)) {
        vars[`--ds-font-${name}-size`] = step.size;
        vars[`--ds-font-${name}-leading`] = step.leading;
    }
    for (const [name, ms] of Object.entries(motion.duration)) vars[`--ds-duration-${name}`] = `${ms}ms`;
    vars['--ds-ease-standard'] = easingCss(motion.easing.standard);
    return vars;
}

export function groupTokenVars(groupId: GroupId): Record<string, string> {
    const o = groupTokens[groupId].official;
    const r = groupRoles(groupId);
    return {
        '--ds-group-accent': r.action,
        '--ds-group-logo': r.logo,
        '--ds-group-canvas': `linear-gradient(to bottom, ${o.canvas[0]}, ${o.canvas[1]}, ${o.canvas[2]})`,
        '--ds-group-title-from': o.title.gradient.from,
        '--ds-group-title-via': o.title.gradient.via,
        '--ds-group-title-to': o.title.gradient.to,
        '--ds-group-title-bar': o.title.bar,
        '--ds-group-title-text': o.title.text,
        '--ds-group-ring': r.ring,
        '--ds-group-glow': r.glow,
        '--ds-shadow-group-glow': `0 0 12px 2px ${r.glow}`,
        '--ds-group-bubble-border': r.bubbleBorder,
        '--ds-group-badge': r.action,
        '--ds-group-strong': r.strong,
        '--ds-group-subtle': r.subtle,
        '--ds-group-subtle-border': r.subtleBorder,
        '--ds-group-link-underline': r.linkUnderline,
    };
}
