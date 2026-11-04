/**
 * Pure token -> CSS custom property maps. `applyTokens.ts` writes them to
 * :root; `tailwind.config.js` utilities read them via var(--ds-*).
 */
import { color, groupTokens, radius, shadow, typeScale, motion, easingCss, type GroupId } from './tokens';

export function staticTokenVars(): Record<string, string> {
    const vars: Record<string, string> = {};
    for (const [name, value] of Object.entries(color.surface)) vars[`--ds-surface-${name}`] = value;
    for (const [name, value] of Object.entries(color.text)) vars[`--ds-text-${name}`] = value;
    for (const [name, value] of Object.entries(color.border)) vars[`--ds-border-${name}`] = value;
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
    const t = groupTokens[groupId];
    return {
        '--ds-group-accent': t.accent,
        '--ds-group-canvas': `linear-gradient(to bottom, ${t.canvas[0]}, ${t.canvas[1]}, ${t.canvas[2]})`,
        '--ds-group-title-from': t.title.gradient.from,
        '--ds-group-title-via': t.title.gradient.via,
        '--ds-group-title-to': t.title.gradient.to,
        '--ds-group-title-bar': t.title.bar,
        '--ds-group-title-text': t.title.text,
        '--ds-group-ring': t.ring,
        '--ds-group-glow': t.glow,
        '--ds-group-bubble-border': t.bubbleBorder,
        '--ds-group-badge': t.badge,
    };
}
