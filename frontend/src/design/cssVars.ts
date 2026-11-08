/**
 * Pure token -> CSS custom property maps. `applyTokens.ts` writes them to
 * :root; `tailwind.config.js` utilities read them via var(--ds-*).
 */
import {
    color, groupRoles, groupTokens, radius, shadow, typeScale, fontFamily, motion, easingCss,
    ambientLayout, memberWash, aurora, groupAccent, blogFeed, type AccentRoles, type GroupId,
} from './tokens';

/** camelCase token name → kebab-case CSS variable segment (controlHover → control-hover). */
const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function staticTokenVars(): Record<string, string> {
    const vars: Record<string, string> = {};
    for (const [name, value] of Object.entries(color.surface)) vars[`--ds-surface-${name}`] = value;
    for (const [name, value] of Object.entries(color.text)) vars[`--ds-text-${name}`] = value;
    for (const [name, value] of Object.entries(color.border)) vars[`--ds-border-${name}`] = value;
    for (const [name, value] of Object.entries(color.overlay)) vars[`--ds-overlay-${kebab(name)}`] = value;
    for (const [name, value] of Object.entries(color.mark)) vars[`--ds-mark-${name}`] = value;
    for (const group of ['viewer', 'console', 'decor'] as const) {
        for (const [name, value] of Object.entries(color[group])) vars[`--ds-${group}-${kebab(name)}`] = value;
    }
    for (const [kind, steps] of Object.entries(color.semantic)) {
        if (typeof steps === 'string') {
            vars[`--ds-semantic-${kind}`] = steps;
            continue;
        }
        for (const [step, value] of Object.entries(steps)) vars[`--ds-semantic-${kind}-${step}`] = value;
    }
    // Cross-group search dots: set per element by groupMarkerStyle(); none by default.
    vars['--ds-group-marker'] = 'transparent';
    for (const [name, value] of Object.entries(radius)) vars[`--ds-radius-${name}`] = value;
    for (const [name, value] of Object.entries(shadow)) vars[`--ds-shadow-${name}`] = value;
    for (const [name, step] of Object.entries(typeScale)) {
        vars[`--ds-font-${name}-size`] = step.size;
        vars[`--ds-font-${name}-leading`] = step.leading;
    }
    for (const [name, ms] of Object.entries(motion.duration)) vars[`--ds-duration-${name}`] = `${ms}ms`;
    vars['--ds-ease-standard'] = easingCss(motion.easing.standard);
    vars['--ds-font-family-reading'] = fontFamily.reading;
    // First-paint defaults; installLanguageFonts() overrides them per UI language.
    vars['--ds-font-family-sans'] = fontFamily.sansJp;
    vars['--ds-font-family-serif'] = fontFamily.reading;
    // Member penlight wash: the colours are set per member on the wash element; none by default.
    vars['--ds-member-wash-alpha'] = memberWash.alpha;
    vars['--ds-member-wash-1'] = 'transparent';
    vars['--ds-member-wash-2'] = 'transparent';
    vars['--ds-aurora'] = aurora.gradient;
    // The blog feed tile (e4e4118 look, tokens/blogFeed.ts).
    for (const [name, size] of Object.entries(blogFeed.type)) vars[`--ds-blog-font-${kebab(name)}`] = size;
    vars['--ds-blog-shadow-tile'] = blogFeed.shadow.tile;
    vars['--ds-blog-shadow-caption'] = blogFeed.shadow.caption;
    vars['--ds-blog-glass'] = blogFeed.glass;
    vars['--ds-blog-glass-border'] = blogFeed.glassBorder;
    vars['--ds-blog-vignette'] = blogFeed.vignette;
    vars['--ds-blog-segment-track'] = blogFeed.segment.track;
    vars['--ds-blog-shadow-segment'] = blogFeed.segment.shadow;
    vars['--ds-blog-font-segment'] = blogFeed.segment.size;
    for (const [name, ms] of Object.entries(blogFeed.motion.duration)) vars[`--ds-duration-${name}`] = `${ms}ms`;
    vars['--ds-ease-spring'] = easingCss(blogFeed.motion.spring);
    // Timeline rail lens centre: set per element by TimelineRail while zoomed.
    vars['--ds-rail-lens-y'] = blogFeed.railLensY;
    return vars;
}

/** Context-neutral accent and expressive variables (spec §3.5). */
export function accentTokenVars(a: AccentRoles): Record<string, string> {
    return {
        '--ds-accent': a.accent,
        '--ds-accent-strong': a.strong,
        '--ds-accent-subtle': a.subtle,
        '--ds-accent-border': a.border,
        '--ds-accent-logo': a.logo,
        '--ds-accent-glow': a.glow,
        '--ds-accent-gradient': a.gradient,
        // Pre-D2 resting look of a quiet accent control: logo 8 % -> accent 6 % wash, logo 19 % hairline.
        '--ds-accent-wash': `linear-gradient(135deg, color-mix(in srgb, ${a.logo} 8%, transparent), color-mix(in srgb, ${a.accent} 6%, transparent))`,
        '--ds-accent-wash-border': `color-mix(in srgb, ${a.logo} 19%, transparent)`,
        '--ds-accent-tonal': a.tonal,
        '--ds-accent-tonal-text': a.tonalText,
        '--ds-shadow-accent-glow': `0 4px 14px ${a.glow}`,
        '--ds-shadow-accent-halo': `0 0 12px 2px ${a.glow}`,
        '--ds-shadow-accent-glow-hover': `0 6px 22px ${a.glow}`,
        '--ds-shadow-accent-unread': a.unread,
        // Blog feed tile hover (e4e4118): a logo-colour glow over a neutral lift ("35" and "40" hex alpha = 21 % / 25 %).
        '--ds-shadow-accent-tile': `0 16px 40px -10px color-mix(in srgb, ${a.logo} 21%, transparent), ${blogFeed.shadow.tileLift}`,
        // Timeline rail current-post dot (e4e4118): a strong-colour glow ("60" and "40" hex alpha = 38 % / 25 %).
        '--ds-shadow-accent-beacon': `0 0 12px color-mix(in srgb, ${a.strong} 38%, transparent), 0 0 4px color-mix(in srgb, ${a.strong} 25%, transparent)`,
        '--ds-shadow-accent-caption': `0 10px 28px -6px color-mix(in srgb, ${a.logo} 25%, transparent), ${blogFeed.shadow.captionLift}`,
        '--ds-expressive-soft': a.soft,
        '--ds-expressive-header': a.header,
        '--ds-expressive-header-text': a.headerText,
        '--ds-expressive-header-bar': a.headerBar,
        '--ds-expressive-progress': a.progress,
        '--ds-expressive-orb-1': a.orb1,
        '--ds-expressive-orb-2': a.orb2,
        '--ds-expressive-orb-3': a.orb3,
    };
}

export function groupTokenVars(groupId: GroupId): Record<string, string> {
    const o = groupTokens[groupId].official;
    const r = groupRoles(groupId);
    const a = ambientLayout[groupId];
    return {
        ...accentTokenVars(groupAccent(groupId)),
        '--ds-group-accent': r.action,
        '--ds-group-logo': r.logo,
        '--ds-group-canvas': `linear-gradient(to bottom, ${o.canvas[0]}, ${o.canvas[1]}, ${o.canvas[2]})`,
        '--ds-group-title-from': o.title.gradient.from,
        '--ds-group-title-via': o.title.gradient.via,
        '--ds-group-title-to': o.title.gradient.to,
        '--ds-group-title-bar': o.title.bar,
        '--ds-group-title-text': o.title.text,
        // Official unread-shelter colours (per message type).
        '--ds-group-shelter-picture': o.shelter.picture,
        '--ds-group-shelter-video': o.shelter.video,
        '--ds-group-shelter-voice': o.shelter.voice,
        '--ds-group-shelter-text': o.shelter.text,
        '--ds-group-ring': r.ring,
        '--ds-group-glow': r.glow,
        '--ds-shadow-group-glow': `0 0 12px 2px ${r.glow}`,
        '--ds-group-bubble-border': r.bubbleBorder,
        '--ds-group-badge': r.action,
        '--ds-group-strong': r.strong,
        '--ds-group-subtle': r.subtle,
        '--ds-group-subtle-border': r.subtleBorder,
        '--ds-group-highlight': r.highlight,
        '--ds-group-link-underline': r.linkUnderline,
        '--ds-group-ambient-1': r.ambient.orb1,
        '--ds-group-ambient-2': r.ambient.orb2,
        '--ds-group-ambient-3': r.ambient.orb3,
        '--ds-group-ambient-1-size': a.orb1.size,
        '--ds-group-ambient-2-size': a.orb2.size,
        '--ds-group-ambient-3-size': a.orb3.size,
        '--ds-group-ambient-1-opacity': String(a.orb1.opacity),
        '--ds-group-ambient-2-opacity': String(a.orb2.opacity),
        '--ds-group-ambient-3-opacity': String(a.orb3.opacity),
    };
}
