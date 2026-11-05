# Design language v2 — foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v2 design-language foundation (brand tokens, Yodel re-base, semantic colours, accent roles + context scopes, 6-step radius, language-aware type, v2 primitives, style page, DESIGN_SYSTEM.md v2) so the later "screen re-apply" plan only has to switch screens over.

**Architecture:** A new `AccentRoles` object (one per context: brand or a group) is turned into context-neutral CSS variables (`--ds-accent-*`, `--ds-expressive-*`). `groupTokenVars()` emits the active group's accent vars; `brandScopeStyle()` emits the brand ones on any element. Primitives read only the `accent`/`expressive` utilities, so the same component renders brand ink in a brand scope and group colours in a group scope. Existing `*-group-*` utilities keep working unchanged; screens migrate in the next plan.

**Tech Stack:** React 18 + TypeScript, Tailwind 3 (utilities read `var(--ds-*)`), Vitest + Testing Library, Vite dev server (`?view=design`).

Spec: `docs/superpowers/specs/2026-11-05-design-language-v2-design.md` (read sections 3–10 before starting any task).

## Global Constraints

- All work in `SakaDesk/frontend/`; run commands from there. Tests: `npx vitest run <path>`; full suite `npm run test:run`; types `npx tsc --noEmit`; lint `npm run lint`.
- Commit from `SakaDesk/` with `uv run git commit` (bare `git commit` fails: pre-commit is not on PATH). Conventional Commits, whole line ≤ 72 chars, no trailing period (`docs/DOC_FORMATS.md`). Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Hex / `rgb()` literals only inside `src/design/tokens/` (guard: `src/design/guard.test.ts`). Primitives use Tailwind token utilities only.
- Brand ink scale (exact): 50 `#f4f7fc` · 100 `#e9eef7` · 200 `#d5deee` · 300 `#bac8e0` · 400 `#9dafce` · 500 `#8296b9` · 600 `#63769a` · 700 `#4d5e7d` · 800 `#3a4860` · 900 `#293345`.
- Aurora (exact): `linear-gradient(120deg, #cfe6ff 0%, #e3dcff 38%, #ffdcea 72%, #fff0dc 100%)`; orbs `#bfdcff`, `#ffd0e4`, `#e2d6ff`.
- Yodel scale (exact): 50 `#f3f6ff` · 100 `#e7ecff` · 200 `#d2daff` · 300 `#b5c0ff` · 400 `#98a2ff` · 500 `#7e85ff` · 600 `#6060e0` · 700 `#4c4bbb` · 800 `#393992` · 900 `#28286b`; logo `#6060e0`.
- Semantic (exact, subtle/icon/border/solid/text): success `#f0fbf4 #e3f6ea #cae8d7 #2e805a #216a49`; warning `#fff5ed #feedde #f6dac3 #9b5e1e #824c13`; danger `#fff3f1 #ffe7e4 #ffd1cd #b44543 #963635`; info = ink 50/100/200/600/700.
- Radius: xs 4 · sm 8 · md 12 · lg 16 · xl 24 · full 9999. Aliases: tail→xs, card→lg, sheet→xl, pill→full.
- Primary button gradient stays `linear-gradient(135deg, logo, 600)` (spec §12 accepted deviation). Never "fix" its contrast.
- Disabled = colour kept at 40 % opacity, no shadow, `cursor-not-allowed`, with a reason. Grey-out is banned.
- No user-facing hard-coded strings: new text goes through i18n keys in all five locales (`en`, `ja`, `zh-CN`, `zh-TW`, `yue`).
- Logging: `clientLog(event, fields)`; no free text or PII in fields.
- Docs and code comments in English.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/design/tokens/brand.ts` (new) | brand ink scale, aurora, brand glow | 1 |
| `src/design/tokens/accent.ts` (new) | `AccentRoles`, `brandAccent()`, `groupAccent(id)`, `mixHex()` | 1 |
| `src/design/tokens/groups.ts` | Yodel re-base | 2 |
| `src/design/tokens/color.ts` | `semantic` set replaces `feedback` + `status` | 3 |
| `src/design/cssVars.ts` | `accentTokenVars()`, semantic vars, aurora var | 1, 3 |
| `src/design/brandScope.ts` (new) | `brandScopeStyle()`, `<BrandScope>` | 4 |
| `tailwind.config.js` | accent / expressive / semantic / radius / display / font utilities | 1, 3, 5, 6 |
| `src/design/tokens/radius.ts` | 6 steps + aliases | 5 |
| `src/design/tokens/type.ts`, `src/design/fonts.ts` (new) | display step, per-language font stacks, font loader | 6 |
| `src/design/primitives/Button.tsx` | v2 variants and states | 7 |
| `src/design/primitives/Modal.tsx` | expressive header, `scope` prop | 8 |
| `src/design/primitives/EmptyState.tsx`, `Atmosphere.tsx`, `Celebration.tsx` (new) | brand-moment primitives | 9 |
| `src/design/DesignPage.tsx` | brand/group context switcher, v2 sections | 10 |
| `docs/design/DESIGN_SYSTEM.md`, `CLAUDE.md`, `CHANGELOG.md`, `src/design/guard.ts` | v2 docs + ratchet on superseded group role utilities | 11 |

---

### Task 1: Brand tokens and accent roles

**Files:**
- Create: `src/design/tokens/brand.ts`, `src/design/tokens/accent.ts`, `src/design/tokens/accent.test.ts`
- Modify: `src/design/tokens/index.ts`, `src/design/cssVars.ts`, `src/design/applyTokens.test.ts`, `tailwind.config.js`, `src/design/tailwindTokens.test.ts`

**Interfaces:**
- Produces: `brandInk: Record<ScaleStep,string>`, `aurora: { gradient: string; orbs: readonly [string,string,string] }`, `interface AccentRoles { accent; strong; subtle; border; logo; glow; gradient; tonal; tonalText; unread; soft; header; headerText; headerBar; orb1; orb2; orb3 }` (all `string`), `brandAccent(): AccentRoles`, `groupAccent(id: GroupId): AccentRoles`, `mixHex(a: string, b: string, t: number): string`, `accentTokenVars(a: AccentRoles): Record<string,string>` (exported from `cssVars.ts`).

- [ ] **Step 1: Write the failing test** — `src/design/tokens/accent.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { contrastRatio } from '../contrast';
import { aurora, brandInk } from './brand';
import { brandAccent, groupAccent, mixHex } from './accent';
import { GROUP_IDS, groupRoles, groupTokens } from './index';

describe('brand tokens', () => {
    it('ink 600 carries white text at ≥ 4.5:1', () => {
        expect(contrastRatio(brandInk[600], '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });
    it('aurora is the spec gradient', () => {
        expect(aurora.gradient).toBe('linear-gradient(120deg, #cfe6ff 0%, #e3dcff 38%, #ffdcea 72%, #fff0dc 100%)');
        expect(aurora.orbs).toEqual(['#bfdcff', '#ffd0e4', '#e2d6ff']);
    });
});

describe('mixHex', () => {
    it('mixes in sRGB', () => {
        expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
        expect(mixHex('#7cc7e8', '#ffffff', 0)).toBe('#7cc7e8');
    });
});

describe('brandAccent', () => {
    const a = brandAccent();
    it('maps the ink scale to roles', () => {
        expect([a.accent, a.strong, a.subtle, a.border, a.logo]).toEqual([
            brandInk[600], brandInk[700], brandInk[50], brandInk[200], brandInk[400],
        ]);
        expect(a.gradient).toBe(`linear-gradient(135deg, ${brandInk[400]} 0%, ${brandInk[600]} 100%)`);
        expect(a.tonalText).toBe(brandInk[800]);
    });
    it('uses the aurora for the expressive header with dark text and no bar', () => {
        expect(a.header).toBe(aurora.gradient);
        expect(a.headerText).toBe('#1f2937');
        expect(a.headerBar).toBe('none');
        expect(a.soft).toBe(aurora.gradient);
    });
});

describe('groupAccent', () => {
    it.each(['hinatazaka', 'sakurazaka', 'nogizaka', 'yodel'] as const)('%s follows the group roles', (id) => {
        const r = groupRoles(id);
        const a = groupAccent(id);
        expect([a.accent, a.strong, a.subtle, a.border, a.logo, a.glow]).toEqual([
            r.action, r.strong, r.subtle, r.subtleBorder, r.logo, r.glow,
        ]);
        expect(a.gradient).toBe(`linear-gradient(135deg, ${r.logo} 0%, ${r.action} 100%)`);
        expect(a.tonal).toBe(`linear-gradient(135deg, ${r.subtleBorder} 0%, ${mixHex(r.logo, '#ffffff', 0.35)} 100%)`);
        expect(a.tonalText).toBe(groupTokens[id].scale[800]);
        expect([a.orb1, a.orb2, a.orb3]).toEqual([r.ambient.orb1, r.ambient.orb2, r.ambient.orb3]);
    });
    it('gradient groups get the title gradient with white text and no bar', () => {
        const g = groupTokens.hinatazaka.official.title.gradient;
        const a = groupAccent('hinatazaka');
        expect(a.header).toBe(`linear-gradient(to right, ${g.from}, ${g.via}, ${g.to})`);
        expect(a.headerText).toBe('#FFFFFF');
        expect(a.headerBar).toBe('none');
    });
    it('Sakurazaka (light header) gets a white header, title text and the bar', () => {
        const o = groupTokens.sakurazaka.official;
        const a = groupAccent('sakurazaka');
        expect(a.header).toBe('#FFFFFF');
        expect(a.headerText).toBe(o.title.text);
        expect(a.headerBar).toBe(o.title.bar);
    });
    it('the retired default group resolves to the brand', () => {
        expect(groupAccent('default')).toEqual(brandAccent());
    });
    it('covers every group id', () => {
        for (const id of GROUP_IDS) expect(groupAccent(id).accent).toMatch(/^#/);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/design/tokens/accent.test.ts`
Expected: FAIL — `Failed to resolve import "./brand"`.

- [ ] **Step 3: Implement** — `src/design/tokens/brand.ts`

```ts
/**
 * SakaDesk's own brand (design language v2, spec §3.1). Solid UI uses the ink
 * scale; expressive surfaces use the aurora. Used in brand context only.
 */
import type { ScaleStep } from './groups';

export const brandInk: Record<ScaleStep, string> = {
    50: '#f4f7fc', 100: '#e9eef7', 200: '#d5deee', 300: '#bac8e0', 400: '#9dafce',
    500: '#8296b9', 600: '#63769a', 700: '#4d5e7d', 800: '#3a4860', 900: '#293345',
};

export const aurora = {
    /** Sky → lavender → pink → peach. Text on it is always dark. */
    gradient: 'linear-gradient(120deg, #cfe6ff 0%, #e3dcff 38%, #ffdcea 72%, #fff0dc 100%)',
    /** The three L2 orb colours in brand context. */
    orbs: ['#bfdcff', '#ffd0e4', '#e2d6ff'] as const,
} as const;

/** Ink 500 at 0.35: the brand L1 glow. */
export const brandGlow = 'rgba(130, 150, 185, 0.35)';
/** Ink 400 at 0.4: the brand unread glow. */
export const brandUnread = '0 0 12px rgba(157, 175, 206, 0.4)';
```

`src/design/tokens/accent.ts`

```ts
/**
 * Accent roles (spec §3.5): what a component asks for. The context decides the
 * values — brand ink in brand context, the group's scale in group context.
 * Components never read a hue directly.
 */
import { aurora, brandGlow, brandInk, brandUnread } from './brand';
import { color } from './color';
import { groupTokens, type GroupId } from './groups';
import { groupRoles } from './roles';

export interface AccentRoles {
    /** Step 600: primary fill, switches, selection and focus ring. */
    accent: string;
    /** Step 700: links, selected text. */
    strong: string;
    /** Step 50: selected background, hover. */
    subtle: string;
    /** Step 200: selected border. */
    border: string;
    /** Light end of the button gradient (group logo / ink 400). */
    logo: string;
    /** L1 glow colour (rgba). */
    glow: string;
    /** Primary button fill: logo → accent (spec §12 accepted contrast). */
    gradient: string;
    /** Tonal (secondary emphasis) button fill. */
    tonal: string;
    /** Text on the tonal fill (step 800). */
    tonalText: string;
    /** Unread glow box-shadow. */
    unread: string;
    /** Soft fill for empty-state circles and milestone cards. */
    soft: string;
    /** Expressive dialog header fill. */
    header: string;
    /** Text and icons on the expressive header. */
    headerText: string;
    /** Bar under a light header, or 'none'. */
    headerBar: string;
    /** L2 orb fills (radial gradients). */
    orb1: string;
    orb2: string;
    orb3: string;
}

/** Linear sRGB-space mix of two #rrggbb colours; t = 0 → a, t = 1 → b. */
export function mixHex(a: string, b: string, t: number): string {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

const orb = (c: string) => `radial-gradient(circle, ${c} 0%, transparent 70%)`;

export function brandAccent(): AccentRoles {
    const s = brandInk;
    return {
        accent: s[600], strong: s[700], subtle: s[50], border: s[200], logo: s[400],
        glow: brandGlow,
        gradient: `linear-gradient(135deg, ${s[400]} 0%, ${s[600]} 100%)`,
        tonal: `linear-gradient(135deg, ${s[200]} 0%, ${mixHex(s[400], '#ffffff', 0.35)} 100%)`,
        tonalText: s[800],
        unread: brandUnread,
        soft: aurora.gradient,
        header: aurora.gradient,
        headerText: color.text.primary,
        headerBar: 'none',
        orb1: orb(aurora.orbs[0]), orb2: orb(aurora.orbs[1]), orb3: orb(aurora.orbs[2]),
    };
}

export function groupAccent(id: GroupId): AccentRoles {
    if (id === 'default') return brandAccent();
    const g = groupTokens[id];
    const r = groupRoles(id);
    const t = g.official.title;
    const light = g.official.headerStyle === 'light';
    return {
        accent: r.action, strong: r.strong, subtle: r.subtle, border: r.subtleBorder, logo: r.logo,
        glow: r.glow,
        gradient: `linear-gradient(135deg, ${r.logo} 0%, ${r.action} 100%)`,
        tonal: `linear-gradient(135deg, ${r.subtleBorder} 0%, ${mixHex(r.logo, '#ffffff', 0.35)} 100%)`,
        tonalText: g.scale[800],
        unread: r.unreadShadow,
        soft: `linear-gradient(135deg, ${r.subtle} 0%, ${r.highlight} 100%)`,
        header: light ? color.surface.sheet : `linear-gradient(to right, ${t.gradient.from}, ${t.gradient.via}, ${t.gradient.to})`,
        headerText: light ? t.text : color.text.inverse,
        headerBar: light ? t.bar : 'none',
        orb1: r.ambient.orb1, orb2: r.ambient.orb2, orb3: r.ambient.orb3,
    };
}
```

Add to `src/design/tokens/index.ts`:

```ts
export { brandInk, aurora, brandGlow } from './brand';
export { brandAccent, groupAccent, mixHex, type AccentRoles } from './accent';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/design/tokens/accent.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing CSS-variable test** — append to `src/design/applyTokens.test.ts`

```ts
import { accentTokenVars, groupTokenVars, staticTokenVars } from './cssVars';
import { brandAccent, groupAccent, aurora } from './tokens';

describe('accent CSS variables', () => {
    it('maps every role to a --ds-accent-* / --ds-expressive-* variable', () => {
        const a = brandAccent();
        const v = accentTokenVars(a);
        expect(v['--ds-accent']).toBe(a.accent);
        expect(v['--ds-accent-strong']).toBe(a.strong);
        expect(v['--ds-accent-subtle']).toBe(a.subtle);
        expect(v['--ds-accent-border']).toBe(a.border);
        expect(v['--ds-accent-gradient']).toBe(a.gradient);
        expect(v['--ds-accent-tonal']).toBe(a.tonal);
        expect(v['--ds-accent-tonal-text']).toBe(a.tonalText);
        expect(v['--ds-shadow-accent-glow']).toBe(`0 4px 14px ${a.glow}`);
        expect(v['--ds-shadow-accent-glow-hover']).toBe(`0 6px 22px ${a.glow}`);
        expect(v['--ds-shadow-accent-unread']).toBe(a.unread);
        expect(v['--ds-expressive-soft']).toBe(a.soft);
        expect(v['--ds-expressive-header']).toBe(a.header);
        expect(v['--ds-expressive-header-text']).toBe(a.headerText);
        expect(v['--ds-expressive-header-bar']).toBe(a.headerBar);
        expect(v['--ds-expressive-orb-1']).toBe(a.orb1);
    });
    it('group vars include that group\'s accent vars', () => {
        expect(groupTokenVars('sakurazaka')).toMatchObject(accentTokenVars(groupAccent('sakurazaka')));
    });
    it('the aurora is a static variable', () => {
        expect(staticTokenVars()['--ds-aurora']).toBe(aurora.gradient);
    });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/design/applyTokens.test.ts`
Expected: FAIL — `accentTokenVars is not a function` (or not exported).

- [ ] **Step 7: Implement in `src/design/cssVars.ts`**

Add `aurora, groupAccent, type AccentRoles` to the import from `./tokens`, then:

```ts
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
        '--ds-accent-tonal': a.tonal,
        '--ds-accent-tonal-text': a.tonalText,
        '--ds-shadow-accent-glow': `0 4px 14px ${a.glow}`,
        '--ds-shadow-accent-glow-hover': `0 6px 22px ${a.glow}`,
        '--ds-shadow-accent-unread': a.unread,
        '--ds-expressive-soft': a.soft,
        '--ds-expressive-header': a.header,
        '--ds-expressive-header-text': a.headerText,
        '--ds-expressive-header-bar': a.headerBar,
        '--ds-expressive-orb-1': a.orb1,
        '--ds-expressive-orb-2': a.orb2,
        '--ds-expressive-orb-3': a.orb3,
    };
}
```

In `staticTokenVars()` add `vars['--ds-aurora'] = aurora.gradient;`. In `groupTokenVars()` change `return { ... }` to `return { ...accentTokenVars(groupAccent(groupId)), ... }` (spread first so nothing existing changes).

- [ ] **Step 8: Add Tailwind utilities** — in `tailwind.config.js` `theme.extend`:

```js
// backgroundColor
accent: 'var(--ds-accent)',
'accent-subtle': 'var(--ds-accent-subtle)',
// backgroundImage
'accent-gradient': 'var(--ds-accent-gradient)',
'accent-tonal': 'var(--ds-accent-tonal)',
'expressive-soft': 'var(--ds-expressive-soft)',
'expressive-header': 'var(--ds-expressive-header)',
'expressive-header-bar': 'var(--ds-expressive-header-bar)',
'expressive-orb-1': 'var(--ds-expressive-orb-1)',
'expressive-orb-2': 'var(--ds-expressive-orb-2)',
'expressive-orb-3': 'var(--ds-expressive-orb-3)',
aurora: 'var(--ds-aurora)',
// textColor
accent: 'var(--ds-accent)',
'accent-strong': 'var(--ds-accent-strong)',
'accent-tonal': 'var(--ds-accent-tonal-text)',
'expressive-header': 'var(--ds-expressive-header-text)',
// borderColor
'accent-border': 'var(--ds-accent-border)',
accent: 'var(--ds-accent)',
// ringColor
accent: 'var(--ds-accent)',
// boxShadow
'accent-glow': 'var(--ds-shadow-accent-glow)',
'accent-glow-hover': 'var(--ds-shadow-accent-glow-hover)',
'accent-unread': 'var(--ds-shadow-accent-unread)',
// accentColor
accent: 'var(--ds-accent)',
// scale (new key in extend)
scale: { 97: '0.97' },
```

Place each entry in the existing object of the same name (create `scale` alongside `transitionDuration`). Then add the same keys to `src/design/tailwindTokens.test.ts` following its existing pattern (it asserts each utility maps to a `var(--ds-*)` that `staticTokenVars()`/`groupTokenVars()` defines — add `'--ds-accent'` … `'--ds-aurora'` to its expected list).

- [ ] **Step 9: Run the design tests**

Run: `npx vitest run src/design`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/design frontend/tailwind.config.js
uv run git commit -m "feat(design): add brand ink, aurora and accent roles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Re-base Yodel on its logo periwinkle

**Files:**
- Modify: `src/design/tokens/groups.ts` (yodel entry), `src/design/tokens/tokens.test.ts` (`SHELTERS.yodel`, `ROLES.yodel`), `src/design/__fixtures__/legacy-theme-values.json` (`groups.yodel` official fields only), `src/design/__fixtures__/README.md`
- Test: `src/design/tokens/tokens.test.ts`, `src/config/colors/legacyEquality.test.ts`, `src/config/serviceThemes.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `groupTokens.yodel` with the values below; `groupAccent('yodel')` follows automatically.

- [ ] **Step 1: Update the expected values first (failing test)** — in `src/design/tokens/tokens.test.ts`:

```ts
// SHELTERS
yodel: { picture: '#b5c0ff', video: '#98a2ff', voice: '#7e85ff', text: '#6060e0' },
// ROLES: logo, action(600), strong(700), subtle(50), subtleBorder(200), linkUnderline(300), bubbleBorder, glow
yodel: ['#6060e0', '#6060e0', '#4c4bbb', '#f3f6ff', '#d2daff', '#b5c0ff', '#6060e0', 'rgba(96, 96, 224, 0.3)'],
```

In `legacy-theme-values.json` replace `groups.yodel.titleGradient`, `titleBar`, `titleText`, `canvas` with:

```json
"titleGradient": { "from": "#d2daff", "via": "#98a2ff", "to": "#6060e0" },
"titleBar": "linear-gradient(to right, #d2daff, #6060e0)",
"titleText": "#4c4bbb",
"canvas": ["#e7ecff", "#f3f6ff", "#f8f9ff"]
```

(leave its historical `accent`/`ring`/... entries and `cssVars.yodel` neutral entries untouched). Append to `__fixtures__/README.md`:

```md
Exception (design language v2): Yodel's official fields are system-derived from its logo periwinkle
`#6060E0` — the old green was one OG's page colour (spec 2026-11-05-design-language-v2 §3.2).
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/design/tokens/tokens.test.ts`
Expected: FAIL on the yodel rows (`#5a8a6a` received).

- [ ] **Step 3: Implement** — replace the `yodel` entry in `src/design/tokens/groups.ts`:

```ts
    yodel: {
        // Design language v2: the logo periwinkle. The old green (#5a8a6a) was one OG's page colour.
        // Official fields are SYSTEM-DERIVED from this scale (no official periwinkle data); a
        // per-OG layer is reserved (spec §3.2).
        logo: '#6060e0',
        scale: {
            50: '#f3f6ff', 100: '#e7ecff', 200: '#d2daff', 300: '#b5c0ff', 400: '#98a2ff',
            500: '#7e85ff', 600: '#6060e0', 700: '#4c4bbb', 800: '#393992', 900: '#28286b',
        },
        bubbleBorder: '#6060e0',
        glow: 'rgba(96, 96, 224, 0.3)',
        official: {
            title: {
                gradient: { from: '#d2daff', via: '#98a2ff', to: '#6060e0' },
                bar: 'linear-gradient(to right, #d2daff, #6060e0)',
                text: '#4c4bbb',
            },
            canvas: ['#e7ecff', '#f3f6ff', '#f8f9ff'],
            shelter: { picture: '#b5c0ff', video: '#98a2ff', voice: '#7e85ff', text: '#6060e0' },
            shelterStyle: 'classic',
            headerStyle: 'gradient',
        },
    },
```

Also update the file's header comment: after "kept verbatim and pinned by tests" add "(Yodel's are system-derived since v2)".

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/design src/config`
Expected: PASS. If `serviceThemes.test.ts` or a snapshot pins the old yodel green, update that expectation to the new value (it must come from `groupTokens.yodel`, not a literal) and re-run.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
uv run git commit -m "feat(design): re-base Yodel colours on its logo periwinkle" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Merge status colours into one harmonized semantic set

**Files:**
- Modify: `src/design/tokens/color.ts`, `src/design/cssVars.ts`, `tailwind.config.js`, `src/config/colors/palette.ts`, `src/design/tokens/tokens.test.ts`, `src/design/tailwindTokens.test.ts`, `src/design/d2cTokens.test.ts` (if it pins `status` values)

**Interfaces:**
- Produces: `color.semantic: Record<'success'|'warning'|'danger'|'info', { subtle; icon; border; solid; text }>`; CSS vars `--ds-semantic-<kind>-<step>`; utilities `bg-semantic-<kind>-subtle|icon|solid`, `border-semantic-<kind>`, `text-semantic-<kind>`. Existing utilities keep their names: `bg-status-danger|success` → solid, `bg-status-attention` → warning solid, `text-status-danger|success|warning` → text step.
- Removes: `color.feedback`, `color.status`, `--ds-feedback-*`, `--ds-status-*`.

- [ ] **Step 1: Write the failing test** — add to `src/design/tokens/tokens.test.ts` (and delete the three `color.feedback.*` lines at ~96–98):

```ts
describe('semantic colours (v2 harmonized)', () => {
    it('match the spec table', () => {
        expect(color.semantic.success).toEqual({ subtle: '#f0fbf4', icon: '#e3f6ea', border: '#cae8d7', solid: '#2e805a', text: '#216a49' });
        expect(color.semantic.warning).toEqual({ subtle: '#fff5ed', icon: '#feedde', border: '#f6dac3', solid: '#9b5e1e', text: '#824c13' });
        expect(color.semantic.danger).toEqual({ subtle: '#fff3f1', icon: '#ffe7e4', border: '#ffd1cd', solid: '#b44543', text: '#963635' });
    });
    it('info is the brand ink', () => {
        expect(color.semantic.info).toEqual({ subtle: brandInk[50], icon: brandInk[100], border: brandInk[200], solid: brandInk[600], text: brandInk[700] });
    });
    it.each(['success', 'warning', 'danger', 'info'] as const)('%s: white on solid ≥ 4.5 and text on white ≥ 4.5', (k) => {
        expect(contrastRatio(color.semantic[k].solid, '#ffffff')).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(color.semantic[k].text, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });
    it('legacy feedback CSS variables follow the semantic solids', () => {
        const vars = generateThemeCSSVariables('hinatazaka');
        expect(vars['--color-success']).toBe(color.semantic.success.solid);
        expect(vars['--color-warning']).toBe(color.semantic.warning.solid);
        expect(vars['--color-error']).toBe(color.semantic.danger.solid);
    });
});
```

(Import `brandInk` from `./index`; `generateThemeCSSVariables` is already imported in this file — if not, import it from `'../../config/colors'`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/design/tokens/tokens.test.ts`
Expected: FAIL — `color.semantic` is undefined.

- [ ] **Step 3: Implement** — in `src/design/tokens/color.ts` delete the `feedback` and `status` blocks and add (import `brandInk` from `./brand`):

```ts
    /**
     * Semantic colours (v2, harmonized ~35 % below signal chroma). Global: they never follow
     * context. subtle = banner bg, icon = icon circle bg, border = outline, solid = destructive
     * fill (white text ≥ 4.5:1), text = text and glyphs (≥ 4.5:1 on white). Info is the brand ink.
     */
    semantic: {
        success: { subtle: '#f0fbf4', icon: '#e3f6ea', border: '#cae8d7', solid: '#2e805a', text: '#216a49' },
        warning: { subtle: '#fff5ed', icon: '#feedde', border: '#f6dac3', solid: '#9b5e1e', text: '#824c13' },
        danger: { subtle: '#fff3f1', icon: '#ffe7e4', border: '#ffd1cd', solid: '#b44543', text: '#963635' },
        info: { subtle: brandInk[50], icon: brandInk[100], border: brandInk[200], solid: brandInk[600], text: brandInk[700] },
    },
```

`src/config/colors/palette.ts` line 24:

```ts
export const FEEDBACK_COLORS = {
    success: color.semantic.success.solid,
    warning: color.semantic.warning.solid,
    error: color.semantic.danger.solid,
} as const;
```

`src/design/cssVars.ts` `staticTokenVars()`: remove the `color.feedback` loop, change `['status', 'viewer', 'decor']` to `['viewer', 'decor']`, and add:

```ts
    for (const [kind, steps] of Object.entries(color.semantic)) {
        for (const [step, value] of Object.entries(steps)) vars[`--ds-semantic-${kind}-${step}`] = value;
    }
```

`tailwind.config.js`: replace the `status-*` entries:

```js
// backgroundColor
'status-danger': 'var(--ds-semantic-danger-solid)',
'status-success': 'var(--ds-semantic-success-solid)',
'status-attention': 'var(--ds-semantic-warning-solid)',
'semantic-success-subtle': 'var(--ds-semantic-success-subtle)',
'semantic-warning-subtle': 'var(--ds-semantic-warning-subtle)',
'semantic-danger-subtle': 'var(--ds-semantic-danger-subtle)',
'semantic-info-subtle': 'var(--ds-semantic-info-subtle)',
'semantic-success-icon': 'var(--ds-semantic-success-icon)',
'semantic-warning-icon': 'var(--ds-semantic-warning-icon)',
'semantic-danger-icon': 'var(--ds-semantic-danger-icon)',
'semantic-info-icon': 'var(--ds-semantic-info-icon)',
// textColor
'status-danger': 'var(--ds-semantic-danger-text)',
'status-success': 'var(--ds-semantic-success-text)',
'status-warning': 'var(--ds-semantic-warning-text)',
'semantic-success': 'var(--ds-semantic-success-text)',
'semantic-warning': 'var(--ds-semantic-warning-text)',
'semantic-danger': 'var(--ds-semantic-danger-text)',
'semantic-info': 'var(--ds-semantic-info-text)',
// borderColor
'semantic-success': 'var(--ds-semantic-success-border)',
'semantic-warning': 'var(--ds-semantic-warning-border)',
'semantic-danger': 'var(--ds-semantic-danger-border)',
'semantic-info': 'var(--ds-semantic-info-border)',
```

Update `tailwindTokens.test.ts` expectations for the renamed variables.

- [ ] **Step 4: Find remaining consumers**

Run: `grep -rn "ds-status-\|ds-feedback-\|color\.status\|color\.feedback" src --include=*.ts --include=*.tsx`
Expected: no output. Fix any hit by switching to `color.semantic.<kind>.<step>` / `--ds-semantic-*`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/design src/config && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src frontend/tailwind.config.js
uv run git commit -m "feat(design): merge status colours into one semantic set" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Brand scope

**Files:**
- Create: `src/design/brandScope.ts`, `src/design/brandScope.test.tsx`

**Interfaces:**
- Consumes: `accentTokenVars`, `brandAccent` (Task 1).
- Produces: `brandScopeStyle(): React.CSSProperties`; `BrandScope: React.FC<{ children: React.ReactNode; className?: string }>` (a `div` with the style and `data-scope="brand"`).

- [ ] **Step 1: Write the failing test** — `src/design/brandScope.test.tsx`

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandScope, brandScopeStyle } from './brandScope';
import { accentTokenVars } from './cssVars';
import { brandAccent } from './tokens';
import { groupScopeStyle } from './groupScope';

describe('brand scope', () => {
    it('returns the brand accent variables', () => {
        expect(brandScopeStyle()).toEqual(accentTokenVars(brandAccent()));
    });
    it('BrandScope overrides an outer group scope', () => {
        render(
            <div style={groupScopeStyle('sakurazaka')}>
                <BrandScope><span>inside</span></BrandScope>
            </div>,
        );
        const scope = screen.getByText('inside').parentElement as HTMLElement;
        expect(scope.dataset.scope).toBe('brand');
        expect(scope.style.getPropertyValue('--ds-accent')).toBe(brandAccent().accent);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/design/brandScope.test.tsx`
Expected: FAIL — cannot resolve `./brandScope`.

- [ ] **Step 3: Implement** — `src/design/brandScope.ts`

```ts
import React, { type CSSProperties } from 'react';
import { accentTokenVars } from './cssVars';
import { brandAccent } from './tokens';

/**
 * Inline custom properties that make every accent / expressive utility inside an element use
 * the SakaDesk brand (ink + aurora) whatever group is active (docs/design/DESIGN_SYSTEM.md,
 * "Contexts"). Brand screens and app-level dialogs apply it to themselves.
 */
export function brandScopeStyle(): CSSProperties {
    return accentTokenVars(brandAccent()) as CSSProperties;
}

export const BrandScope: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) =>
    React.createElement('div', { 'data-scope': 'brand', className, style: brandScopeStyle() }, children);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/design/brandScope.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/design/brandScope.ts frontend/src/design/brandScope.test.tsx
uv run git commit -m "feat(design): add brand scope for brand-context surfaces" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Six-step radius scale

**Files:**
- Modify: `src/design/tokens/radius.ts`, `tailwind.config.js`, `src/design/tokens/tokens.test.ts`, `src/design/DesignPage.tsx` (`RADIUS_CLASS` map only)

**Interfaces:**
- Produces: `radius` keys `none xs sm md lg xl full` plus deprecated aliases `tail card sheet pill`; utilities `rounded-xs|sm|md|lg|xl|full` (overriding Tailwind's defaults with token vars) and the aliases.

- [ ] **Step 1: Write the failing test** — in `tokens.test.ts` replace the radius assertions with:

```ts
describe('radius (v2, 6 steps)', () => {
    it('defines the scale', () => {
        expect(radius).toMatchObject({ none: '0px', xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px', full: '9999px' });
    });
    it('keeps the D1 names as aliases of the new steps', () => {
        expect(radius.tail).toBe(radius.xs);
        expect(radius.card).toBe(radius.lg);
        expect(radius.sheet).toBe(radius.xl);
        expect(radius.pill).toBe(radius.full);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/design/tokens/tokens.test.ts -t radius`
Expected: FAIL.

- [ ] **Step 3: Implement** — `src/design/tokens/radius.ts`

```ts
/**
 * Corner radius, 6 steps (design language v2, spec §7). Buttons are `md`; `full` is only
 * for tag-like items (date pill, filters, badges, avatars, switches). Nested boxes use
 * concentric radii: inner = outer − padding, never below `xs`.
 */
const steps = {
    none: '0px',
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    full: '9999px',
} as const;

export const radius = {
    ...steps,
    /** @deprecated D1 name → `xs` (bubble tail corner). */
    tail: steps.xs,
    /** @deprecated D1 name → `lg`. */
    card: steps.lg,
    /** @deprecated D1 name → `xl`. */
    sheet: steps.xl,
    /** @deprecated D1 name → `full`. */
    pill: steps.full,
} as const;

export type RadiusStep = keyof typeof radius;
```

`tailwind.config.js` `borderRadius`:

```js
borderRadius: {
    none: 'var(--ds-radius-none)',
    xs: 'var(--ds-radius-xs)',
    sm: 'var(--ds-radius-sm)',
    md: 'var(--ds-radius-md)',
    lg: 'var(--ds-radius-lg)',
    xl: 'var(--ds-radius-xl)',
    full: 'var(--ds-radius-full)',
    tail: 'var(--ds-radius-tail)',
    card: 'var(--ds-radius-card)',
    sheet: 'var(--ds-radius-sheet)',
    pill: 'var(--ds-radius-pill)',
},
```

`DesignPage.tsx` `RADIUS_CLASS`:

```ts
const RADIUS_CLASS: Record<RadiusStep, string> = {
    none: 'rounded-none', xs: 'rounded-xs', sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl', full: 'rounded-full',
    tail: 'rounded-tail', card: 'rounded-card', sheet: 'rounded-sheet', pill: 'rounded-pill',
};
```

Note for the reviewer: Tailwind's own `rounded-sm/md/lg/xl` used by pre-D1 code now resolve to the token values (sm 8 instead of 2, md 12 instead of 6, lg 16 instead of 8, xl 24 instead of 12). This is intended (one radius scale); the screen re-apply plan checks every screen.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/design && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src frontend/tailwind.config.js
uv run git commit -m "feat(design): switch to the six-step radius scale" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Display size, tabular numerals and language-aware fonts

**Files:**
- Modify: `src/design/tokens/type.ts`, `src/design/cssVars.ts`, `tailwind.config.js`, `src/index.css`, `index.html`, `src/shell/main.tsx`
- Create: `src/design/fonts.ts`, `src/design/fonts.test.ts`

**Interfaces:**
- Consumes: `i18n` instance (`src/i18n`), `SupportedLanguage`.
- Produces: `typeScale.display = { size: '32px', leading: '40px' }`; `fontStacks: Record<SupportedLanguage, { sans: string; serif: string; google: string }>`; `applyLanguageFonts(lang: string, doc?: Document): void` (sets `--ds-font-family-sans`, `--ds-font-family-serif`, `<html lang>`, and one `<link id="ds-fonts">`); `installLanguageFonts(): void` (applies now and on every `languageChanged`). Utilities `font-sans` (var), `font-display` (serif var), `text-display`, `tabular-nums` (Tailwind built-in).

- [ ] **Step 1: Write the failing test** — `src/design/fonts.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyLanguageFonts, fontStacks } from './fonts';
import { typeScale } from './tokens';

describe('language-aware fonts', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        document.documentElement.removeAttribute('style');
    });
    it.each([
        ['ja', 'Noto Sans JP', 'Noto Serif JP'],
        ['zh-TW', 'Noto Sans TC', 'Noto Serif TC'],
        ['yue', 'Noto Sans HK', 'Noto Serif HK'],
        ['zh-CN', 'Noto Sans SC', 'Noto Serif SC'],
        ['en', 'Noto Sans', 'Noto Serif'],
    ])('%s uses %s / %s first', (lang, sans, serif) => {
        applyLanguageFonts(lang);
        const root = document.documentElement;
        expect(root.style.getPropertyValue('--ds-font-family-sans').startsWith(`"${sans}"`)).toBe(true);
        expect(root.style.getPropertyValue('--ds-font-family-serif').startsWith(`"${serif}"`)).toBe(true);
        expect(root.lang).toBe(lang);
    });
    it('keeps Noto Sans JP as the fallback for Japanese content in every stack', () => {
        for (const stack of Object.values(fontStacks)) expect(stack.sans).toContain('"Noto Sans JP"');
    });
    it('loads only the active language family through one link', () => {
        applyLanguageFonts('zh-TW');
        applyLanguageFonts('ja');
        const links = document.head.querySelectorAll('link#ds-fonts');
        expect(links).toHaveLength(1);
        expect((links[0] as HTMLLinkElement).href).toContain('Noto+Sans+JP');
        expect((links[0] as HTMLLinkElement).href).not.toContain('Noto+Sans+TC');
    });
    it('falls back to English stacks for an unknown language', () => {
        applyLanguageFonts('xx');
        expect(document.documentElement.style.getPropertyValue('--ds-font-family-sans').startsWith('"Noto Sans"')).toBe(true);
    });
    it('adds the display step', () => {
        expect(typeScale.display).toEqual({ size: '32px', leading: '40px' });
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/design/fonts.test.ts`
Expected: FAIL — cannot resolve `./fonts`.

- [ ] **Step 3: Implement**

`src/design/tokens/type.ts`: add to `typeScale` (after `heading`):

```ts
    /** Brand-moment headings only (landing hero, about, empty states, celebrations), in the display (serif) face. */
    display: { size: '32px', leading: '40px' },
```

and add to `fontFamily`:

```ts
    /** Per-language sans / serif stacks; see design/fonts.ts. Values are set at runtime. */
    sansVar: 'var(--ds-font-family-sans)',
    serifVar: 'var(--ds-font-family-serif)',
```

`src/design/fonts.ts`

```ts
/**
 * Language-aware font stacks (spec §6). The UI language picks the glyph set
 * (JP / TC / HK / SC / Latin); Japanese content keeps JP glyphs through
 * `:lang(ja)` in index.css. Only the active language's family is loaded.
 */
import i18n from '../i18n';
import { clientLog } from '../utils/clientLog';

interface FontStack { sans: string; serif: string; google: string }

const JP_FALLBACK = '"Noto Sans JP", system-ui, -apple-system, sans-serif';
const SERIF_FALLBACK = '"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif';
const W = 'wght@400;500;600;700';

export const fontStacks: Record<'ja' | 'zh-TW' | 'yue' | 'zh-CN' | 'en', FontStack> = {
    ja: { sans: JP_FALLBACK, serif: SERIF_FALLBACK, google: `family=Noto+Sans+JP:${W}&family=Noto+Serif+JP:${W}` },
    'zh-TW': { sans: `"Noto Sans TC", ${JP_FALLBACK}`, serif: `"Noto Serif TC", ${SERIF_FALLBACK}`, google: `family=Noto+Sans+TC:${W}&family=Noto+Serif+TC:${W}` },
    yue: { sans: `"Noto Sans HK", ${JP_FALLBACK}`, serif: `"Noto Serif HK", ${SERIF_FALLBACK}`, google: `family=Noto+Sans+HK:${W}&family=Noto+Serif+HK:${W}` },
    'zh-CN': { sans: `"Noto Sans SC", ${JP_FALLBACK}`, serif: `"Noto Serif SC", ${SERIF_FALLBACK}`, google: `family=Noto+Sans+SC:${W}&family=Noto+Serif+SC:${W}` },
    en: { sans: `"Noto Sans", ${JP_FALLBACK}`, serif: `"Noto Serif", ${SERIF_FALLBACK}`, google: `family=Noto+Sans:${W}&family=Noto+Serif:${W}` },
};

function stackFor(lang: string): FontStack {
    return (fontStacks as Record<string, FontStack>)[lang] ?? fontStacks.en;
}

export function applyLanguageFonts(lang: string, doc: Document = document): void {
    const stack = stackFor(lang);
    const root = doc.documentElement;
    root.style.setProperty('--ds-font-family-sans', stack.sans);
    root.style.setProperty('--ds-font-family-serif', stack.serif);
    root.lang = lang;
    let link = doc.getElementById('ds-fonts') as HTMLLinkElement | null;
    if (!link) {
        link = doc.createElement('link');
        link.id = 'ds-fonts';
        link.rel = 'stylesheet';
        doc.head.appendChild(link);
    }
    link.href = `https://fonts.googleapis.com/css2?${stack.google}&display=swap`;
    clientLog('design_fonts_applied', { language: (lang in fontStacks) ? lang : 'fallback_en' });
}

/** Applies the current language now and on every change. Call once per entry point. */
export function installLanguageFonts(): void {
    applyLanguageFonts(i18n.language);
    i18n.on('languageChanged', (lng: string) => applyLanguageFonts(lng));
}
```

`src/shell/main.tsx`: after `applyStaticTokens()` add

```ts
import { installLanguageFonts } from '../design/fonts'
// ...
installLanguageFonts()
```

`tailwind.config.js` `fontFamily`:

```js
fontFamily: {
    sans: 'var(--ds-font-family-sans)',
    display: 'var(--ds-font-family-serif)',
    reading: 'var(--ds-font-family-reading)',
},
```

and `fontSize` add `display: ['var(--ds-font-display-size)', { lineHeight: 'var(--ds-font-display-leading)' }],` (the vars come from the existing `typeScale` loop in `staticTokenVars`).

`src/design/cssVars.ts` `staticTokenVars()`: add defaults so the first paint is right before `installLanguageFonts` runs:

```ts
    vars['--ds-font-family-sans'] = '"Noto Sans JP", system-ui, -apple-system, sans-serif';
    vars['--ds-font-family-serif'] = fontFamily.reading;
```

`src/index.css` (append):

```css
/* Japanese content keeps Japanese glyphs whatever the UI language (spec §6). */
:lang(ja) { font-family: "Noto Sans JP", system-ui, -apple-system, sans-serif; }
```

`index.html`: keep the existing JP `<link>` (Japanese content always needs it). No other change.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/design src/shell/main.test.tsx && npx tsc --noEmit`
Expected: PASS. If `main.test.tsx` mocks modules strictly, add `vi.mock('../design/fonts', () => ({ installLanguageFonts: vi.fn() }))` next to its existing `applyTokens` mock.

- [ ] **Step 5: Commit**

```bash
git add frontend/src frontend/tailwind.config.js
uv run git commit -m "feat(design): pick font glyphs by UI language, add display size" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Button v2 — variants and states

**Files:**
- Modify: `src/design/primitives/Button.tsx`, `src/design/primitives/Controls.test.tsx`
- Modify (i18n): `src/i18n/locales/{en,ja,zh-CN,zh-TW,yue}.json` (`design.loading`)

**Interfaces:**
- Consumes: Tailwind utilities from Tasks 1, 3, 5.
- Produces: `ButtonVariant = 'primary' | 'tonal' | 'secondary' | 'ghost' | 'danger' | 'overlay'`; `ButtonProps` adds `loading?: boolean`, `disabledReason?: string`. `IconButtonVariant` keeps `'accent'` (now `bg-accent-gradient`).

Behaviour:
- `disabledReason` set → the button is `aria-disabled="true"` (stays focusable so the reason can be read), clicks are swallowed, `title={disabledReason}`, and a visually hidden `<span id>` with the reason is linked by `aria-describedby`.
- `disabled` without `disabledReason` → dev-only `console.warn` once (`[Button] disabled without disabledReason`), still renders disabled.
- `loading` → spinner before the label, `aria-busy="true"`, clicks swallowed, width unchanged (label stays in the DOM).

- [ ] **Step 1: Write the failing tests** — append to `src/design/primitives/Controls.test.tsx`

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { Button } from './Button';

describe('Button v2', () => {
    it('primary uses the accent gradient, glow and 12px radius', () => {
        render(<Button variant="primary">Save</Button>);
        const b = screen.getByRole('button', { name: 'Save' });
        expect(b.className).toContain('bg-accent-gradient');
        expect(b.className).toContain('shadow-accent-glow');
        expect(b.className).toContain('rounded-md');
        expect(b.className).not.toContain('rounded-pill');
    });
    it('tonal uses the tonal fill and text', () => {
        render(<Button variant="tonal">Mark all read</Button>);
        const b = screen.getByRole('button', { name: 'Mark all read' });
        expect(b.className).toContain('bg-accent-tonal');
        expect(b.className).toContain('text-accent-tonal');
    });
    it('danger stays semantic in every context', () => {
        render(<Button variant="danger">Delete</Button>);
        expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('bg-status-danger');
    });
    it('disabledReason keeps the button focusable, blocks clicks and exposes the reason', () => {
        const onClick = vi.fn();
        render(<Button variant="primary" disabledReason="Choose a group first" onClick={onClick}>Start</Button>);
        const b = screen.getByRole('button', { name: 'Start' });
        expect(b).toHaveAttribute('aria-disabled', 'true');
        expect(b).not.toBeDisabled();
        expect(b).toHaveAttribute('title', 'Choose a group first');
        expect(b).toHaveAccessibleDescription('Choose a group first');
        fireEvent.click(b);
        expect(onClick).not.toHaveBeenCalled();
        expect(b.className).toContain('aria-disabled:opacity-40');
        expect(b.className).not.toContain('grayscale');
    });
    it('warns once in development when disabled has no reason', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        render(<><Button disabled>A</Button><Button disabled>B</Button></>);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('disabledReason');
        warn.mockRestore();
    });
    it('loading shows a spinner, sets aria-busy and swallows clicks', () => {
        const onClick = vi.fn();
        render(<Button variant="primary" loading onClick={onClick}>Save</Button>);
        const b = screen.getByRole('button', { name: /Save/ });
        expect(b).toHaveAttribute('aria-busy', 'true');
        expect(b.querySelector('[data-spinner]')).not.toBeNull();
        fireEvent.click(b);
        expect(onClick).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/design/primitives/Controls.test.tsx`
Expected: FAIL (`bg-accent-gradient` not in className, `tonal` unknown).

- [ ] **Step 3: Implement** — replace the top of `src/design/primitives/Button.tsx` down to the `Button` component:

```tsx
import React, { useId } from 'react';
import { cn } from '../../utils/classnames';

export type ButtonVariant = 'primary' | 'tonal' | 'secondary' | 'ghost' | 'danger' | 'overlay';
export type IconButtonVariant = 'secondary' | 'ghost' | 'overlay' | 'accent';
export type ButtonSize = 'sm' | 'md';

/** States per spec §8: hover brighten + lift + glow, pressed shrink, focus ring, disabled keeps colour. */
const BASE = cn(
    'inline-flex items-center justify-center gap-2 rounded-md font-semibold',
    'transition duration-fast ease-standard',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
    'active:scale-97',
    'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none',
    'aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:shadow-none',
);

const LIFT = 'hover:brightness-105 hover:-translate-y-px aria-disabled:hover:translate-y-0 aria-disabled:hover:brightness-100';

const VARIANT: Record<ButtonVariant, string> = {
    /** L1: logo → accent gradient + glow. At most ONE primary or danger per screen and per dialog. */
    primary: cn('bg-accent-gradient text-inverse shadow-accent-glow hover:shadow-accent-glow-hover', LIFT),
    /** Secondary emphasis (e.g. "mark all read"): soft tonal gradient, dark accent text. */
    tonal: cn('bg-accent-tonal text-accent-tonal', LIFT),
    secondary: 'bg-pill text-primary border border-strong hover:bg-sunken',
    ghost: 'bg-transparent text-accent-strong hover:bg-accent-subtle',
    /** Destructive confirm (semantic, never follows context). Counts as the screen's one primary. */
    danger: cn('bg-status-danger text-inverse shadow-pill', LIFT),
    /** Controls on the dark photo/video viewer. */
    overlay: 'bg-viewer-control text-viewer hover:bg-viewer-control-hover',
};

const ICON_VARIANT: Record<IconButtonVariant, string> = {
    secondary: VARIANT.secondary,
    ghost: 'bg-transparent text-secondary hover:bg-sunken hover:text-primary',
    overlay: VARIANT.overlay,
    /** Floating accent button (the chat's unread arrows). */
    accent: cn('bg-accent-gradient text-inverse shadow-accent-glow', LIFT),
};

const SIZE: Record<ButtonSize, string> = {
    sm: 'h-8 px-3 text-small',
    md: 'h-10 px-5 text-body',
};

const ICON_SIZE: Record<ButtonSize, string> = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
};

let warnedNoReason = false;
function warnNoReason(): void {
    if (!import.meta.env.DEV || warnedNoReason) return;
    warnedNoReason = true;
    console.warn('[Button] disabled without disabledReason: tell the user why (docs/design/DESIGN_SYSTEM.md, "States")');
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Shows a spinner, keeps the width and swallows clicks. */
    loading?: boolean;
    /** Translated reason the action is unavailable. Renders an aria-disabled, focusable button. */
    disabledReason?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ variant = 'secondary', size = 'md', type = 'button', className, loading = false, disabledReason, disabled, onClick, children, ...rest }, ref) => {
        const reasonId = useId();
        if (disabled && !disabledReason) warnNoReason();
        const blocked = loading || disabledReason !== undefined;
        return (
            <button
                ref={ref}
                type={type}
                disabled={disabled && !disabledReason}
                aria-disabled={disabledReason !== undefined ? true : undefined}
                aria-busy={loading || undefined}
                aria-describedby={disabledReason !== undefined ? reasonId : undefined}
                title={disabledReason}
                className={cn(BASE, VARIANT[variant], SIZE[size], className)}
                onClick={blocked ? (e) => e.preventDefault() : onClick}
                {...rest}
            >
                {loading && (
                    <span data-spinner aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
                )}
                {children}
                {disabledReason !== undefined && <span id={reasonId} className="sr-only">{disabledReason}</span>}
            </button>
        );
    },
);
Button.displayName = 'Button';
```

Keep `IconButton` as is (it already uses `BASE` and `ICON_VARIANT`). Export a test-only reset is not needed: the warn test renders two disabled buttons in one test; if another test in the file triggers the warning first, move the warn test to its own file `src/design/primitives/Button.warn.test.tsx` (module state resets per file).

- [ ] **Step 4: Run tests and fix fallout**

Run: `npx vitest run src/design src/features src/shell src/core`
Expected: PASS except possibly snapshot/class assertions that pinned `rounded-pill` or `bg-group-accent` on buttons. Update those assertions to the new classes (they test the primitive's look, which this task intentionally changes). Do not change component code outside `design/primitives`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
uv run git commit -m "feat(design): add v2 button variants, loading and disabled reason" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Modal — expressive header and brand scope

**Files:**
- Modify: `src/design/primitives/Modal.tsx`, `src/design/primitives/Modal.test.tsx`

**Interfaces:**
- Consumes: `brandScopeStyle()` (Task 4), expressive utilities (Task 1).
- Produces: `ModalProps.scope?: 'inherit' | 'brand'` (default `'inherit'`); `ModalProps.header?: 'expressive' | 'plain'` (default `'expressive'`). The standard header renders `data-testid="modal-header"` with `bg-expressive-header text-expressive-header`, followed by a `data-testid="modal-header-bar"` strip (`h-[3px] bg-expressive-header-bar`).

- [ ] **Step 1: Write the failing tests** — append to `Modal.test.tsx`

```tsx
describe('Modal v2 header and scope', () => {
    it('standard layout draws the expressive header by default', () => {
        render(<Modal isOpen onClose={() => {}} title="Favourites" closeLabel="Close">body</Modal>);
        const header = screen.getByTestId('modal-header');
        expect(header.className).toContain('bg-expressive-header');
        expect(header.className).toContain('text-expressive-header');
        expect(screen.getByTestId('modal-header-bar').className).toContain('bg-expressive-header-bar');
    });
    it('header="plain" keeps the quiet header', () => {
        render(<Modal isOpen onClose={() => {}} title="Confirm" header="plain">body</Modal>);
        expect(screen.getByTestId('modal-header').className).not.toContain('bg-expressive-header');
        expect(screen.queryByTestId('modal-header-bar')).toBeNull();
    });
    it('scope="brand" sets the brand accent variables on the frame', () => {
        render(<Modal isOpen onClose={() => {}} title="Settings" scope="brand">body</Modal>);
        const frame = screen.getByRole('dialog');
        expect(frame.style.getPropertyValue('--ds-accent')).toBe(brandAccent().accent);
        expect(frame.dataset.scope).toBe('brand');
    });
    it('frame uses the xl radius', () => {
        render(<Modal isOpen onClose={() => {}} title="X">body</Modal>);
        expect(screen.getByRole('dialog').className).toContain('rounded-xl');
    });
});
```

(Import `brandAccent` from `'../tokens'`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/design/primitives/Modal.test.tsx -t "v2 header"`
Expected: FAIL — no `modal-header` test id.

- [ ] **Step 3: Implement** — in `Modal.tsx`:

Add to `ModalProps`:

```ts
    /** 'brand': the dialog is a brand-context surface (settings, search, about...). Default inherits the opener's context. */
    scope?: 'inherit' | 'brand';
    /** 'expressive' (default): context gradient header (L1). 'plain': quiet header for small confirms. */
    header?: 'expressive' | 'plain';
```

Destructure `scope = 'inherit', header = 'expressive'` in `OpenModal`. Import `brandScopeStyle` from `'../brandScope'`. On the frame `div` add:

```tsx
                data-scope={scope === 'brand' ? 'brand' : undefined}
                style={scope === 'brand' ? brandScopeStyle() : undefined}
```

and change `rounded-sheet` to `rounded-xl` in its sheet class string. Replace the standard header block with:

```tsx
                        <div
                            data-testid="modal-header"
                            className={cn(
                                'flex shrink-0 items-center gap-3 px-6',
                                header === 'expressive' ? 'bg-expressive-header py-4 text-expressive-header' : 'pb-2 pt-5 text-primary',
                            )}
                        >
                            {title !== undefined && (
                                <h2 id={titleId} className="min-w-0 flex-1 truncate text-title font-semibold">{title}</h2>
                            )}
                            {headerExtra}
                            {dismissible && closeLabel && (
                                <IconButton
                                    size="sm"
                                    aria-label={closeLabel}
                                    icon={<X />}
                                    className={header === 'expressive' ? 'text-expressive-header hover:bg-accent-subtle hover:text-accent-strong' : undefined}
                                    onClick={() => requestClose('button')}
                                />
                            )}
                        </div>
                        {header === 'expressive' && <div data-testid="modal-header-bar" aria-hidden="true" className="h-[3px] shrink-0 bg-expressive-header-bar" />}
                        <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 text-body text-primary', bodyClassName)}>{children}</div>
```

- [ ] **Step 4: Run tests and fix fallout**

Run: `npx vitest run src/design/primitives/Modal.test.tsx src/core src/shell src/features`
Expected: PASS after updating any assertion that pinned the old header classes (`pt-5 text-primary` on the title, `rounded-sheet` on the frame). `ConfirmDialog` (`src/shell/components/ConfirmDialog.tsx`) passes `header="plain"` — add that prop there (the one allowed screen-file change in this plan, because a confirm with a big gradient band contradicts spec §5's L0 rule for small confirms).

- [ ] **Step 5: Commit**

```bash
git add frontend/src
uv run git commit -m "feat(design): restore expressive dialog headers, add brand scope" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Brand-moment primitives — EmptyState, Atmosphere, Celebration

**Files:**
- Create: `src/design/primitives/EmptyState.tsx`, `src/design/primitives/Atmosphere.tsx`, `src/design/primitives/Celebration.tsx`, `src/design/primitives/Moments.test.tsx`
- Modify: `src/design/primitives/index.ts`, `tailwind.config.js` (keyframes)

**Interfaces:**
- Produces:
  - `EmptyState: React.FC<{ icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode }>` — circle `bg-expressive-soft`, title `font-display text-heading`.
  - `Atmosphere: React.FC<{ children: React.ReactNode; className?: string }>` — three `bg-expressive-orb-N` orbs (`animate-orb-drift-1/2`, `animate-orb-breathe`, `motion-reduce:animate-none`) behind a relative content layer.
  - `CelebrationToast: React.FC<{ title: string; description?: string; icon?: React.ReactNode }>` — glass toast, `bg-aurora` icon circle, one shimmer (`animate-shimmer`), 10 sparkles (`data-sparkle`, hidden with reduced motion). Role `status`, `aria-live="polite"`.
  - `MilestoneCard: React.FC<{ value: string; label: string }>` — `bg-expressive-soft` card, `font-display text-display tabular-nums text-accent-strong` number, `shadow-accent-glow`, `animate-pop`, 26 confetti pieces (`data-confetti`, `animate-confetti`, hidden with reduced motion; ≤ 1.2 s).
  - Confetti/sparkle positions are deterministic: piece `i` uses angle `i * 137.5°` and distance `40 + (i % 5) * 20` px, passed as CSS variables `--dx`/`--dy` in an inline style (numbers only; no colours inline). Colours cycle through `bg-accent`, `bg-accent-subtle`, `bg-accent-border`, `bg-sheet` (confetti) and the aurora orbs `bg-expressive-orb-1..3` (sparkles).

- [ ] **Step 1: Write the failing tests** — `src/design/primitives/Moments.test.tsx`

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';
import { Atmosphere } from './Atmosphere';
import { CelebrationToast, MilestoneCard } from './Celebration';

describe('brand-moment primitives', () => {
    it('EmptyState: soft circle, display-face title, optional action', () => {
        render(<EmptyState icon={<span>i</span>} title="No favourites yet" description="Right-click a message" action={<button>Go</button>} />);
        const title = screen.getByRole('heading', { name: 'No favourites yet' });
        expect(title.className).toContain('font-display');
        expect(screen.getByTestId('empty-state-circle').className).toContain('bg-expressive-soft');
        expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
    });
    it('Atmosphere draws three orbs that stop with reduced motion', () => {
        render(<Atmosphere><p>content</p></Atmosphere>);
        const orbs = screen.getAllByTestId('atmosphere-orb');
        expect(orbs).toHaveLength(3);
        orbs.forEach((o, i) => {
            expect(o.className).toContain(`bg-expressive-orb-${i + 1}`);
            expect(o.className).toContain('motion-reduce:animate-none');
        });
        expect(screen.getByText('content')).toBeInTheDocument();
    });
    it('CelebrationToast is a polite status with sparkles hidden under reduced motion', () => {
        render(<CelebrationToast title="Sync complete" description="12,846 messages" />);
        const toast = screen.getByRole('status');
        expect(toast).toHaveAttribute('aria-live', 'polite');
        const sparkles = toast.querySelectorAll('[data-sparkle]');
        expect(sparkles).toHaveLength(10);
        sparkles.forEach((s) => expect(s.className).toContain('motion-reduce:hidden'));
    });
    it('MilestoneCard shows the number in the display face with tabular numerals and 26 confetti', () => {
        render(<MilestoneCard value="365" label="days" />);
        const n = screen.getByText('365');
        expect(n.className).toContain('font-display');
        expect(n.className).toContain('tabular-nums');
        expect(document.querySelectorAll('[data-confetti]')).toHaveLength(26);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/design/primitives/Moments.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`tailwind.config.js` `keyframes` add:

```js
shimmer: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
pop: { '0%': { opacity: '0', transform: 'scale(0.9)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
burst: {
    '0%': { opacity: '1', transform: 'translate(0, 0) rotate(0deg)' },
    '100%': { opacity: '0', transform: 'translate(var(--dx), var(--dy)) rotate(540deg)' },
},
```

`animation` add:

```js
shimmer: 'shimmer 1.2s 300ms var(--ds-ease-standard) both',
pop: 'pop 500ms cubic-bezier(0.2, 1.4, 0.4, 1) both',
confetti: 'burst 1.2s cubic-bezier(0.2, 0.7, 0.3, 1) both',
sparkle: 'burst 900ms 350ms cubic-bezier(0.2, 0.7, 0.3, 1) both',
```

`src/design/primitives/EmptyState.tsx`

```tsx
import React from 'react';

export interface EmptyStateProps {
    icon: React.ReactNode;
    title: string;
    description?: string;
    action?: React.ReactNode;
}

/** Brand moment (spec §9): soft circle + line icon + display-face title + one line + one action. */
export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <div data-testid="empty-state-circle" className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-expressive-soft text-accent-strong">
            <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center">{icon}</span>
        </div>
        <h3 className="font-display text-heading font-semibold text-primary">{title}</h3>
        {description && <p className="max-w-sm text-small text-secondary">{description}</p>}
        {action && <div className="mt-2">{action}</div>}
    </div>
);
```

`src/design/primitives/Atmosphere.tsx`

```tsx
import React from 'react';
import { cn } from '../../utils/classnames';

const ORBS = [
    'bg-expressive-orb-1 -left-1/4 -top-1/3 h-3/4 w-3/4 animate-orb-drift-1',
    'bg-expressive-orb-2 -right-1/4 top-1/4 h-2/3 w-2/3 animate-orb-drift-2',
    'bg-expressive-orb-3 -bottom-1/3 left-1/4 h-1/2 w-1/2 animate-orb-breathe',
] as const;

/** L2 atmosphere (spec §5): drifting context orbs behind the content. Low-density screens only. */
export const Atmosphere: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <div className={cn('relative overflow-hidden', className)}>
        {ORBS.map((orb) => (
            <div key={orb} data-testid="atmosphere-orb" aria-hidden="true" className={cn('pointer-events-none absolute rounded-full motion-reduce:animate-none', orb)} />
        ))}
        <div className="relative">{children}</div>
    </div>
);
```

`src/design/primitives/Celebration.tsx`

```tsx
import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../utils/classnames';

/** Deterministic burst offsets (golden angle), so renders and tests are stable. */
function burstStyle(i: number, scale: number): React.CSSProperties {
    const angle = (i * 137.5 * Math.PI) / 180;
    const dist = (40 + (i % 5) * 20) * scale;
    return { '--dx': `${Math.round(Math.cos(angle) * dist)}px`, '--dy': `${Math.round(Math.sin(angle) * dist + dist * 0.6)}px` } as React.CSSProperties;
}

const SPARKLE_FILL = ['bg-expressive-orb-1', 'bg-expressive-orb-2', 'bg-expressive-orb-3'] as const;
const CONFETTI_FILL = ['bg-accent', 'bg-accent-subtle', 'bg-accent-border', 'bg-sheet'] as const;

export interface CelebrationToastProps { title: string; description?: string; icon?: React.ReactNode }

/** Tier B celebration (spec §9): glass toast + one aurora shimmer + sparkles. Never blocks input. */
export const CelebrationToast: React.FC<CelebrationToastProps> = ({ title, description, icon }) => (
    <div role="status" aria-live="polite" className="relative flex items-center gap-3 overflow-hidden rounded-lg bg-sheet px-4 py-3 shadow-sheet animate-reveal motion-reduce:animate-none">
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-aurora opacity-60 animate-shimmer motion-reduce:hidden" />
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-aurora text-accent-strong">
            {icon ?? <Check className="h-4 w-4" aria-hidden="true" />}
        </span>
        <span className="relative flex flex-col">
            <span className="text-body font-semibold text-primary">{title}</span>
            {description && <span className="text-small text-secondary">{description}</span>}
        </span>
        {Array.from({ length: 10 }, (_, i) => (
            <span key={i} data-sparkle aria-hidden="true" style={burstStyle(i, 0.8)}
                className={cn('pointer-events-none absolute right-8 top-1/2 h-1.5 w-1.5 rounded-full animate-sparkle motion-reduce:hidden', SPARKLE_FILL[i % 3])} />
        ))}
    </div>
);

export interface MilestoneCardProps { value: string; label: string }

/** Tier C celebration (spec §9): in-timeline card in the context accent + short confetti. */
export const MilestoneCard: React.FC<MilestoneCardProps> = ({ value, label }) => (
    <div className="relative mx-auto flex w-fit flex-col items-center rounded-lg border border-accent-border bg-expressive-soft px-7 py-3 text-center shadow-accent-glow animate-pop motion-reduce:animate-none">
        <span className="font-display text-display font-semibold tabular-nums text-accent-strong">{value}</span>
        <span className="text-small text-secondary">{label}</span>
        {Array.from({ length: 26 }, (_, i) => (
            <span key={i} data-confetti aria-hidden="true" style={burstStyle(i, 1.6)}
                className={cn('pointer-events-none absolute left-1/2 top-1/2 h-2.5 w-1.5 rounded-xs animate-confetti motion-reduce:hidden', CONFETTI_FILL[i % 4])} />
        ))}
    </div>
);
```

`src/design/primitives/index.ts` add:

```ts
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { Atmosphere } from './Atmosphere';
export { CelebrationToast, MilestoneCard, type CelebrationToastProps, type MilestoneCardProps } from './Celebration';
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/design && npx vitest run src/design/guard.test.ts`
Expected: PASS (no new hex/rgb or arbitrary radius/shadow/text/spacing; `h-[3px]` is a height and allowed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src frontend/tailwind.config.js
uv run git commit -m "feat(design): add empty state, atmosphere and celebration primitives" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Style page — context switcher and v2 sections

**Files:**
- Modify: `src/design/DesignPage.tsx`, `src/design/DesignPage.test.tsx`, `src/i18n/locales/{en,ja,zh-CN,zh-TW,yue}.json` (`designPage.*` keys below)

**Interfaces:**
- Consumes: everything above.
- Produces: a "Context" switcher (`brand` + the four groups); when `brand` is chosen the page body is wrapped in `<BrandScope>` (group tokens still applied for the official layer). New sections: Brand (ink scale swatches + aurora), Semantic (four kinds × five steps, contrast labels, a banner per kind using subtle/border/icon/text), Buttons (five variants + loading + disabledReason; the existing Modal demo shows the context header), Expression tiers (L0 list, L1 card with `shadow-accent-glow`, L2 `Atmosphere` with a glass card), Brand moments (`EmptyState`, `CelebrationToast`, `MilestoneCard` with a "replay" button that remounts it via a `key`), Typography (display step in each language's face — render the sample with `lang` set per language).

New i18n keys (add to all five locale files; English values shown, translate the others):

```json
"designPage": {
  "context": "Context",
  "contextBrand": "SakaDesk brand",
  "brand": "Brand",
  "semantic": "Semantic colours",
  "buttons": "Buttons",
  "tiers": "Expression tiers",
  "tierQuiet": "L0 quiet",
  "tierInteractive": "L1 interactive",
  "tierAtmosphere": "L2 atmosphere",
  "moments": "Brand moments",
  "replay": "Replay",
  "sampleEmptyTitle": "No favourites yet",
  "sampleEmptyBody": "Right-click a message and choose Add to favourites.",
  "sampleToastTitle": "Sync complete",
  "sampleToastBody": "12,846 messages saved",
  "sampleMilestone": "days since you subscribed",
  "sampleDisabledReason": "Choose a group first",
  "displaySample": "Keep every message"
}
```

(Merge into the existing `designPage` object; do not remove existing keys.)

- [ ] **Step 1: Write the failing test** — append to `DesignPage.test.tsx`

```tsx
describe('DesignPage v2', () => {
    it('switching to the brand context wraps the page in a brand scope', async () => {
        render(<DesignPage />);
        fireEvent.click(screen.getByRole('button', { name: /SakaDesk brand/ }));
        expect(document.querySelector('[data-scope="brand"]')).not.toBeNull();
    });
    it('shows the v2 sections', () => {
        render(<DesignPage />);
        for (const name of ['Brand', 'Semantic colours', 'Buttons', 'Expression tiers', 'Brand moments']) {
            expect(screen.getByRole('heading', { name })).toBeInTheDocument();
        }
    });
    it('renders every button variant and a disabled button with its reason', () => {
        render(<DesignPage />);
        expect(screen.getAllByRole('button', { name: /^primary$/ }).length).toBeGreaterThan(0);
        expect(screen.getAllByRole('button', { name: /^tonal$/ }).length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: /disabled/ })).toHaveAccessibleDescription('Choose a group first');
    });
});
```

(Use the file's existing render helper/mocks if it has them; the page renders in English in tests.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/design/DesignPage.test.tsx`
Expected: FAIL — no "SakaDesk brand" button.

- [ ] **Step 3: Implement**

In `DesignPage.tsx`:
1. Replace the group state with `const [context, setContext] = useState<'brand' | GroupId>('hinatazaka')`; derive `const group: GroupId = context === 'brand' ? 'hinatazaka' : context;` and keep calling `applyGroupTokens(group)` exactly where it is called today.
2. Render the switcher as the first control: a `Pill` per option (`brand` first, label `t('designPage.contextBrand')`, then each of `['hinatazaka','sakurazaka','nogizaka','yodel']` with `serviceThemes[id].name`), `selected={context === option}`, `onClick={() => setContext(option)}`.
3. Wrap the page body (everything below the toolbar) in `context === 'brand' ? <BrandScope>{body}</BrandScope> : body`.
4. Add the sections, each with `<Section title={t('designPage.<key>')}>`:

```tsx
<Section title={t('designPage.brand')}>
    <div className="flex flex-wrap gap-3">
        {SCALE_STEPS.map((s) => <Swatch key={s} name={`ink ${s}`} value={brandInk[s]} />)}
    </div>
    <div className="h-24 rounded-xl bg-aurora" />
</Section>
<Section title={t('designPage.semantic')}>
    {(['success', 'warning', 'danger', 'info'] as const).map((k) => (
        <div key={k} className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-3">
                {(['subtle', 'icon', 'border', 'solid', 'text'] as const).map((step) => (
                    <Swatch key={step} name={`${k} ${step}`} value={color.semantic[k][step]} />
                ))}
            </div>
            <div className={SEMANTIC_BANNER[k]}>
                <span className={SEMANTIC_ICON[k]}>!</span>
                <span className={SEMANTIC_TEXT[k]}>{k}</span>
            </div>
        </div>
    ))}
</Section>
```

with full class maps at the top of the file (so Tailwind generates them):

```ts
const SEMANTIC_BANNER = {
    success: 'flex items-center gap-3 rounded-md border border-semantic-success bg-semantic-success-subtle px-4 py-2',
    warning: 'flex items-center gap-3 rounded-md border border-semantic-warning bg-semantic-warning-subtle px-4 py-2',
    danger: 'flex items-center gap-3 rounded-md border border-semantic-danger bg-semantic-danger-subtle px-4 py-2',
    info: 'flex items-center gap-3 rounded-md border border-semantic-info bg-semantic-info-subtle px-4 py-2',
} as const;
const SEMANTIC_ICON = {
    success: 'flex h-6 w-6 items-center justify-center rounded-full border border-semantic-success bg-semantic-success-icon text-caption font-bold text-semantic-success',
    warning: 'flex h-6 w-6 items-center justify-center rounded-full border border-semantic-warning bg-semantic-warning-icon text-caption font-bold text-semantic-warning',
    danger: 'flex h-6 w-6 items-center justify-center rounded-full border border-semantic-danger bg-semantic-danger-icon text-caption font-bold text-semantic-danger',
    info: 'flex h-6 w-6 items-center justify-center rounded-full border border-semantic-info bg-semantic-info-icon text-caption font-bold text-semantic-info',
} as const;
const SEMANTIC_TEXT = {
    success: 'text-small font-semibold text-semantic-success',
    warning: 'text-small font-semibold text-semantic-warning',
    danger: 'text-small font-semibold text-semantic-danger',
    info: 'text-small font-semibold text-semantic-info',
} as const;
```

Buttons section (labels are variant names — dev page, not user-facing, same convention as the existing primitives section):

```tsx
<Section title={t('designPage.buttons')}>
    <div className="flex flex-wrap items-center gap-3">
        {(['primary', 'tonal', 'secondary', 'ghost', 'danger'] as const).map((v) => <Button key={v} variant={v}>{v}</Button>)}
        <Button variant="primary" loading>loading</Button>
        <Button variant="primary" disabledReason={t('designPage.sampleDisabledReason')}>disabled</Button>
    </div>
</Section>
```

Dialog header: no new code. The primitives section already opens a `Modal` (`modalOpen`, around lines 316–330, button `t('designPage.openModal')`); after Task 8 it shows the expressive header of the current context. Do not add the `dialogHeader` / `openDialog` keys.

Tiers:

```tsx
<Section title={t('designPage.tiers')}>
    <div className="grid grid-cols-3 gap-4">
        <Card className="p-4"><p className="text-caption text-muted">{t('designPage.tierQuiet')}</p>
            <div className="mt-2 rounded-sm bg-accent-subtle px-3 py-2 text-small font-semibold text-accent-strong">Selected</div>
            <div className="px-3 py-2 text-small text-secondary">Item</div></Card>
        <Card className="p-4 shadow-accent-glow"><p className="text-caption text-muted">{t('designPage.tierInteractive')}</p>
            <div className="mt-3 flex gap-2"><Button variant="primary" size="sm">primary</Button><Button variant="tonal" size="sm">tonal</Button></div></Card>
        <Atmosphere className="h-40 rounded-lg bg-sheet">
            <div className="m-6 rounded-lg bg-sheet p-4 shadow-card"><p className="text-caption text-muted">{t('designPage.tierAtmosphere')}</p></div>
        </Atmosphere>
    </div>
</Section>
```

Moments:

```tsx
<Section title={t('designPage.moments')}>
    <div className="grid grid-cols-3 items-start gap-4">
        <Card><EmptyState icon={<BookOpen />} title={t('designPage.sampleEmptyTitle')} description={t('designPage.sampleEmptyBody')} /></Card>
        <CelebrationToast key={`t${replay}`} title={t('designPage.sampleToastTitle')} description={t('designPage.sampleToastBody')} />
        <MilestoneCard key={`m${replay}`} value="365" label={t('designPage.sampleMilestone')} />
    </div>
    <div><Button size="sm" onClick={() => setReplay((n) => n + 1)}>{t('designPage.replay')}</Button></div>
</Section>
```

(`const [replay, setReplay] = useState(0);`). Typography: add `display: 'text-display'` to `TYPE_CLASS`, and render one sample per language:

```tsx
{(['ja', 'zh-TW', 'yue', 'zh-CN', 'en'] as const).map((lng) => (
    <p key={lng} lang={lng} className="font-display text-display text-primary">{lng} · {t('designPage.displaySample', { lng })}</p>
))}
```

Note: `:lang(ja)` in `index.css` forces the JP sans; the display samples set `font-display` explicitly so they still show the serif.

- [ ] **Step 4: Run tests and visual check**

Run: `npx vitest run src/design src/i18n && npx tsc --noEmit && npm run lint`
Expected: PASS (i18n completeness tests check the five locales have the same keys).

Then start the dev server (`npm run dev`) and open the page in the Windows browser (never Playwright MCP or WSLg):

```bash
powershell.exe -NoProfile -Command "Start-Process 'http://localhost:5173/?view=design'"
```

Check: brand context shows ink buttons and an aurora dialog header with dark text; Sakurazaka shows the white header with the bar; Yodel shows periwinkle; the disabled button keeps its colour.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
uv run git commit -m "feat(design): show v2 contexts and primitives on the style page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: DESIGN_SYSTEM.md v2, CLAUDE.md rule, CHANGELOG

**Files:**
- Modify: `docs/design/DESIGN_SYSTEM.md` (rewrite), `CLAUDE.md` (UI rule paragraph), `CHANGELOG.md` (`[Unreleased]`)

**Interfaces:**
- Consumes: the final code of Tasks 1–10. Every token, utility and prop named in the doc must exist (zero-drift rule).

- [ ] **Step 1: Rewrite `docs/design/DESIGN_SYSTEM.md`** with exactly these sections, each describing the code as it now is, with the rationale in one line where the spec gives one:

1. *How to use this file* (tokens in `frontend/src/design/tokens/`, primitives in `frontend/src/design/primitives/`, style page `?view=design` with the context switcher).
2. *Brand personality* — A skeleton + C surface; the doing vs. waiting/finishing rule (spec §2, §9).
3. *Contexts* — the "whose content?" rule, the full screen table from spec §4, `brandScopeStyle()` / `<BrandScope>` / `Modal scope="brand"`, `groupScopeStyle()` for group markers, viewer mode.
4. *Colour* — brand ink + aurora; group scales and official layer (Yodel system-derived, OG layer reserved); ink neutral and the "no tint on large surfaces" rule; semantic set and its utilities; the accent role table with every `*-accent-*` / `*-expressive-*` utility.
5. *Expression tiers* — L0/L1/L2 with where each is allowed, the restore inventory (spec §5 table) mapped to utilities.
6. *The four levels* — kept from v1 with the new radius names (Canvas none, Sheet/Modal `rounded-xl`, Card `rounded-lg`, tag-like `rounded-full`).
7. *Radius* — the 6 steps, use per step, concentric rule, deprecated aliases.
8. *Typography* — sans/display faces, per-language table, `:lang(ja)` content rule, sizes incl. `display`, `tabular-nums`.
9. *Buttons and states* — the variant table (one primary/danger per screen and dialog), the state table, `loading`, `disabledReason`, grey-out banned, forms never disable.
10. *Brand moments* — `EmptyState`, `Atmosphere`, `CelebrationToast`, `MilestoneCard`, the celebration event table and rules (once, non-blocking, reduced motion).
11. *Motion and elevation* — durations and the listed exceptions.
12. *Accepted deviations* — copy spec §12 verbatim.
13. *Do / Don't* — keep the v1 list items that still hold; replace "group colour only in four places" with: "Don't use group colour in brand screens; don't use neutral grey where the original design had colour — pick the tier instead; don't grey out disabled controls; don't hard-code colours."
14. *Migration note* — `*-group-accent/strong/subtle/badge` utilities still work and are migrated to `*-accent-*` by the screen re-apply plan; new code uses `*-accent-*`.

Remove the old "Where group colour may appear" section and the "four places" rule (superseded).

- [ ] **Step 2: Update `CLAUDE.md`** — replace the UI design system paragraph's middle sentence with:

```md
Read `docs/design/DESIGN_SYSTEM.md` before touching UI: it defines the
contexts (brand vs group), the colour roles, the three expression tiers, the
four levels and the Do/Don't list. Use `*-accent-*` / `*-expressive-*`
utilities so components follow their context; brand screens and app-level
dialogs use `brandScopeStyle()` / `Modal scope="brand"`.
```

(Keep the guard sentences that follow.)

- [ ] **Step 3: Add the changelog entry** under `[Unreleased]` → `### Changed` (end-user wording, no code identifiers; follow `docs/DOC_FORMATS.md`):

```md
- **Yodel now uses its own periwinkle colours.** The old green came from one member's page; Yodel screens now follow the Yodel logo colour.
- **Interface text uses the right characters for your language.** Traditional Chinese, Cantonese and Simplified Chinese menus now show their own character forms instead of the Japanese ones; messages and blogs stay in Japanese forms.
```

- [ ] **Step 4: Ratchet the old group role utilities** (spec §11: guard updated)

In `src/design/guard.ts` add one pattern to `PATTERNS` and extend the header comment ("…and the D1 group role utilities superseded by `*-accent-*`"):

```ts
    /(?<![\w-])(?:bg-group-(?:accent|badge|subtle)|text-group-strong|border-group-subtle|ring-group(?![\w-])|accent-group|shadow-group-glow)(?![\w-])/g,
```

Add a case to `src/design/guard.test.ts` next to the existing `countViolations` cases:

```ts
it('counts superseded group role utilities but not the official layer', () => {
    expect(countViolations('className="bg-group-accent text-group-strong ring-group"')).toBe(3);
    expect(countViolations('className="bg-group-title text-group-title bg-group-canvas ring-group-logo"')).toBe(0);
    expect(countViolations('className="bg-accent text-accent-strong ring-accent"')).toBe(0);
});
```

Regenerate the baseline (existing files may keep their current usages; new files must use `*-accent-*`). Create a temporary file `src/design/printBaseline.test.ts`:

```ts
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { scanTree } from './guard';

it('writes the guard baseline', () => {
    writeFileSync('src/design/guard-baseline.json', `${JSON.stringify(scanTree('src'), null, 2)}\n`);
});
```

Run: `npx vitest run src/design/printBaseline.test.ts && rm src/design/printBaseline.test.ts && npx vitest run src/design/guard.test.ts`
Expected: PASS. `git diff src/design/guard-baseline.json` shows only increases caused by the new pattern (no file's literal count changed).

- [ ] **Step 5: Verify docs match code**

Run: `grep -oE "(bg|text|border|ring|shadow|rounded|font)-[a-z0-9-]+" ../docs/design/DESIGN_SYSTEM.md | sort -u` and check each class appears in `tailwind.config.js` or is a Tailwind built-in; run `grep -n "brandScopeStyle\|disabledReason\|MilestoneCard\|CelebrationToast\|EmptyState\|Atmosphere" -r src/design | head` to confirm each named API exists.
Expected: every documented name resolves.

- [ ] **Step 6: Full verification**

Run: `npm run test:run && npx tsc --noEmit && npm run lint && npm run build`
Expected: all green; the build output contains no `DesignPage` chunk (`grep -r DesignPage dist/assets | wc -l` → `0`).

- [ ] **Step 7: Commit**

```bash
git add docs/design/DESIGN_SYSTEM.md CLAUDE.md CHANGELOG.md frontend/src/design/guard.ts frontend/src/design/guard.test.ts frontend/src/design/guard-baseline.json
uv run git commit -m "docs(design): rewrite the design system for language v2" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After all tasks

Open a PR `feat/design-v2-foundation` → `dev` with the four required body sections (`## Why`, `## What`, `## Testing`, `## Changelog`; `docs/DOC_FORMATS.md`), body ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The user reviews `?view=design` in the Windows browser before merge.

Not in this plan (next plan, "screen re-apply"): switching screens to `*-accent-*`, applying `scope="brand"` / `<BrandScope>` to the brand screens of spec §4 (ToS and landing included, which then stop using the `default` group), restoring the spec §5 inventory per screen, wiring celebration events (spec §9 table) and empty states into screens.
