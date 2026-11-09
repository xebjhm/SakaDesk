# D1.5 Unified Colour System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-group grab-bag of colours with one two-layer system. Official-app colours stay verbatim; every other colour comes from a 10-step per-group scale through one fixed role→step mapping. The existing screens pick it up through the legacy `serviceThemes` view.

**Architecture:**
- `design/tokens/groups.ts` holds the data for each group:
  - logo colour, 10-step scale, bubble border and glow;
  - an `official` block (title, canvas, shelters, styles);
  - `legacyNeutral` tints.
- New `design/tokens/roles.ts` has one pure `groupRoles(id)`. It is the only place the role→step mapping lives.
- `config/serviceThemes.ts` becomes a builder over those two. It has no hex of its own, so its 23 consumers change colour with no code change.
- CSS variables, Tailwind utilities and the `/design` page follow the roles.

**Tech Stack:** React 18, TypeScript 5, Tailwind 3.4, tailwind-merge 2.6, i18next, vitest + Testing Library, Playwright (headless).

**Spec:** `docs/superpowers/specs/2026-11-04-d15-color-system-design.md`

## Global Constraints

- **Official layer is verbatim.** Title gradient/bar/text, canvas (sidebar) gradient, shelter colours, `shelterStyle`, `headerStyle` must stay byte-identical to today's values. Title and canvas are pinned by `frontend/src/design/__fixtures__/legacy-theme-values.json`.
- **System layer = role→step, same for every group:**

  | Role | Step |
  |---|---|
  | `logo` | the logo colour |
  | `action` (badge, primary button, play, scroll) | 600 |
  | `strong` (names, links, selected text) | 700 |
  | `subtle` (selected/hover background) | 50 |
  | `subtleBorder` | 200 |
  | `linkUnderline` | 300 |
  | `ring` (keyboard focus) | 600 |

  `bubbleBorder` and `glow` are per-group values listed in the spec.
- **Contrast floors:** `action` with white text ≥ 3.0:1, `strong` on white ≥ 4.5:1.
- **Hinatazaka step 600 is `#389dd1`.** Yodel keeps the green family. Sakurazaka keeps its white-base `light` styles.
- **Neutral hex in components stays** (that is D2). Only group-colour hard-codes are replaced.
- **i18n:** every visible string goes through `t()`, including the dev-only `/design` page. There are 5 locales (`en`, `ja`, `zh-TW`, `zh-CN`, `yue`), stored as 2-space JSON with a trailing newline.
- **Logging:** breadcrumbs via `clientLog`, with no text, names, URLs or paths. This plan adds no new decision paths.
- **Commands:**
  - frontend, from `SakaDesk/frontend`: `npx vitest run …`, `npx tsc --noEmit`, `npm run lint`
  - backend, from `SakaDesk`: `uv run pytest -q`
  - never `pip`
- **Commits:** use `uv run git commit` (bare `git commit` fails). Conventional Commits, subject ≤ 72 chars, imperative, no trailing period. The body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Branch:** `feat/d15-color-system` (cut from `dev` at 0d2d950, holds the spec commit).
- **Vitest gotcha:** under jsdom, `import.meta.url` is not a `file:` URL. Use `path.resolve(__dirname, …)` for file paths.

## Value tables (copy verbatim)

**Scales.** Keys are steps; the logo step is marked †.

| step | hinatazaka | sakurazaka | nogizaka | yodel | default |
|---|---|---|---|---|---|
| 50 | `#eff9fd` | `#fff3f6` | `#fef3fe` | `#f3f8f4` | `#f9fafb` |
| 100 | `#dbf1fb` | `#ffe5eb` | `#fce4fc` | `#e5f0e8` | `#f3f4f6` |
| 200 | `#bbe4f7` | `#fecdda` | `#f9cbf8` | `#cde3d3` | `#e5e7eb` |
| 300 | `#7cc7e8` † | `#feacc3` | `#f1abf1` | `#afd1b9` | `#d1d5db` |
| 400 | `#62bce2` | `#f19db5` † | `#e389e4` | `#90bc9e` | `#9ca3af` |
| 500 | `#50acdf` | `#e76692` | `#d06ad2` | `#74a684` | `#6b7280` † |
| 600 | `#389dd1` | `#c84575` | `#b24ab5` | `#5a8a6a` † | `#4b5563` |
| 700 | `#0d7aab` | `#a72f5d` | `#943397` | `#416f51` | `#374151` |
| 800 | `#025c83` | `#852048` | `#7f1083` † | `#30573e` | `#1f2937` |
| 900 | `#03425f` | `#641434` | `#57175a` | `#21402c` | `#111827` |

**Expected roles** (the test table):

| group | logo | action | strong | subtle | subtleBorder | linkUnderline | bubbleBorder | glow |
|---|---|---|---|---|---|---|---|---|
| hinatazaka | `#7cc7e8` | `#389dd1` | `#0d7aab` | `#eff9fd` | `#bbe4f7` | `#7cc7e8` | `#7cc7e8` | `rgba(124, 199, 232, 0.35)` |
| sakurazaka | `#f19db5` | `#c84575` | `#a72f5d` | `#fff3f6` | `#fecdda` | `#feacc3` | `#f19db5` | `rgba(241, 157, 181, 0.35)` |
| nogizaka | `#7f1083` | `#b24ab5` | `#943397` | `#fef3fe` | `#f9cbf8` | `#f1abf1` | `#b24ab5` | `rgba(127, 16, 131, 0.28)` |
| yodel | `#5a8a6a` | `#5a8a6a` | `#416f51` | `#f3f8f4` | `#cde3d3` | `#afd1b9` | `#5a8a6a` | `rgba(90, 138, 106, 0.3)` |
| default | `#6b7280` | `#4b5563` | `#374151` | `#f9fafb` | `#e5e7eb` | `#d1d5db` | `#E5E7EB` | `rgba(107, 114, 128, 0.25)` |

## File map

| Path | Responsibility |
|---|---|
| `frontend/src/design/tokens/groups.ts` | Rewritten: per-group data (logo, scale, bubble, glow, official, legacyNeutral) |
| `frontend/src/design/tokens/roles.ts` | New: `groupRoles(id)` role→step mapping, `FALLBACK_ACTION_COLOR` |
| `frontend/src/design/tokens/index.ts` | Re-exports |
| `frontend/src/design/cssVars.ts` | `groupTokenVars` reads roles/official |
| `frontend/src/config/serviceThemes.ts` | Rewritten as a hex-free builder |
| `frontend/src/config/serviceThemes.test.ts`, `config/colors/legacyEquality.test.ts`, `design/tokens/tokens.test.ts`, `design/applyTokens.test.ts`, `design/DesignPage.test.tsx` | Updated tests |
| `frontend/src/core/media/{VoicePlayer,TranscribeButton,TranscriptPanel}.tsx`, `core/common/TranslateButton.tsx`, `features/messages/components/MessageBubble.tsx` | Group-colour fallbacks → token |
| `frontend/tailwind.config.js`, `frontend/src/utils/classnames.ts` | Role utilities |
| `frontend/src/design/DesignPage.tsx` + locales | Scale and role sections |
| `docs/design/DESIGN_SYSTEM.md`, the spec | Docs |

---

### Task 1: Unified colour tokens, roles and the theme builder

This is the core switch. After it, every existing screen shows the new system-layer colours and the unchanged official-layer colours.

**Files:**
- Rewrite: `frontend/src/design/tokens/groups.ts`
- Create: `frontend/src/design/tokens/roles.ts`
- Modify: `frontend/src/design/tokens/index.ts`, `frontend/src/design/cssVars.ts`, `frontend/src/design/DesignPage.tsx:70-78` (swatch list only)
- Rewrite: `frontend/src/config/serviceThemes.ts`
- Tests:
  - rewrite `frontend/src/design/tokens/tokens.test.ts` and `frontend/src/config/colors/legacyEquality.test.ts`
  - modify `frontend/src/design/applyTokens.test.ts`, `frontend/src/design/DesignPage.test.tsx` and `frontend/src/config/serviceThemes.test.ts`

**Interfaces:**
- Produces:
  - `type ScaleStep = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900`
  - `SCALE_STEPS: readonly ScaleStep[]`
  - `interface GroupTokens { logo: string; scale: Record<ScaleStep, string>; bubbleBorder: string; glow: string; official: OfficialLayer; legacyNeutral: { surfaceBackground: string; textSecondary: string; textMuted: string } }`
  - `interface OfficialLayer { title: { gradient: { from: string; via: string; to: string }; bar: string; text: string }; canvas: readonly [string, string, string]; shelter: { picture: string; video: string; voice: string; text: string }; shelterStyle: 'classic' | 'light'; headerStyle: 'gradient' | 'light' }`
  - `SAKAMICHI_GROUPS: readonly GroupId[]` (`hinatazaka`, `sakurazaka`, `nogizaka`)
  - `SAKAMICHI_PURPLE = { base: '#7f1083', 100: '#fce4fc' }`
  - `interface GroupRoles { logo; action; strong; subtle; subtleBorder; linkUnderline; bubbleBorder; glow; ring; unreadShadow; buttonGradient: string; ambient: { orb1: string; orb2: string; orb3: string } }`
  - `groupRoles(id: GroupId): GroupRoles`
  - `FALLBACK_ACTION_COLOR: string` (= default group step 600)
  - `groupTokenVars(id)` now returns 17 keys:
    - `--ds-group-accent` (= action) and `--ds-group-logo`
    - `--ds-group-canvas`
    - `--ds-group-title-from/via/to/bar/text`
    - `--ds-group-ring`, `--ds-group-glow`, `--ds-shadow-group-glow`
    - `--ds-group-bubble-border`
    - `--ds-group-badge` (= action)
    - `--ds-group-strong`, `--ds-group-subtle`, `--ds-group-subtle-border`, `--ds-group-link-underline`
  - `ServiceTheme` loses these fields: `surface.card`, `surface.glass`, `surface.glassBorder`, `text.primary`, `interaction.focusRing`, `messages.defaultBackground`.
  - `getServiceThemeCSSVariables` is deleted.

- [ ] **Step 1: Write the failing token tests**

Replace `frontend/src/design/tokens/tokens.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import legacy from '../__fixtures__/legacy-theme-values.json';
import { contrastRatio } from '../contrast';
import {
    GROUP_IDS, SCALE_STEPS, groupTokens, groupRoles, color, radius, shadow, typeScale, motion, easingCss, SPACE_UNIT_PX,
} from './index';

const SHELTERS = {
    hinatazaka: { picture: '#a8d0e8', video: '#c4a8d8', voice: '#b8a8d8', text: '#8bb8d6' },
    sakurazaka: { picture: '#ec9595', video: '#edc094', voice: '#d695ec', text: '#eb95ae' },
    nogizaka: { picture: '#c4a8d8', video: '#9B59B6', voice: '#b8a8d8', text: '#d8c8e8' },
    yodel: { picture: '#8ab89a', video: '#6a9a7a', voice: '#7aaa8a', text: '#5a8a6a' },
    default: { picture: '#a8d0e8', video: '#c4a8d8', voice: '#b8a8d8', text: '#8bb8d6' },
} as const;

const ROLES = {
    hinatazaka: ['#7cc7e8', '#389dd1', '#0d7aab', '#eff9fd', '#bbe4f7', '#7cc7e8', '#7cc7e8', 'rgba(124, 199, 232, 0.35)'],
    sakurazaka: ['#f19db5', '#c84575', '#a72f5d', '#fff3f6', '#fecdda', '#feacc3', '#f19db5', 'rgba(241, 157, 181, 0.35)'],
    nogizaka: ['#7f1083', '#b24ab5', '#943397', '#fef3fe', '#f9cbf8', '#f1abf1', '#b24ab5', 'rgba(127, 16, 131, 0.28)'],
    yodel: ['#5a8a6a', '#5a8a6a', '#416f51', '#f3f8f4', '#cde3d3', '#afd1b9', '#5a8a6a', 'rgba(90, 138, 106, 0.3)'],
    default: ['#6b7280', '#4b5563', '#374151', '#f9fafb', '#e5e7eb', '#d1d5db', '#E5E7EB', 'rgba(107, 114, 128, 0.25)'],
} as const;

describe('group tokens — official layer (verbatim)', () => {
    it('defines exactly the five groups', () => {
        expect([...GROUP_IDS].sort()).toEqual(Object.keys(legacy.groups).sort());
        expect(Object.keys(groupTokens).sort()).toEqual([...GROUP_IDS].sort());
    });

    it.each(GROUP_IDS)('%s title and canvas equal the official values', (id) => {
        const o = groupTokens[id].official;
        const want = legacy.groups[id];
        expect(o.title.gradient).toEqual(want.titleGradient);
        expect(o.title.bar).toBe(want.titleBar);
        expect(o.title.text).toBe(want.titleText);
        expect([...o.canvas]).toEqual(want.canvas);
    });

    it.each(GROUP_IDS)('%s shelters and styles equal the official values', (id) => {
        const o = groupTokens[id].official;
        expect(o.shelter).toEqual(SHELTERS[id]);
        expect(o.shelterStyle).toBe(id === 'sakurazaka' ? 'light' : 'classic');
        expect(o.headerStyle).toBe(id === 'sakurazaka' ? 'light' : 'gradient');
    });
});

describe('group tokens — system layer', () => {
    it.each(GROUP_IDS)('%s has a 10-step scale that darkens and contains the logo colour', (id) => {
        const { scale, logo } = groupTokens[id];
        expect(Object.keys(scale).map(Number)).toEqual([...SCALE_STEPS]);
        const white = color.text.inverse;
        const ratios = SCALE_STEPS.map((s) => contrastRatio(scale[s], white) as number);
        for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeGreaterThan(ratios[i - 1]);
        expect(Object.values(scale).map((v) => v.toLowerCase())).toContain(logo.toLowerCase());
    });

    it.each(GROUP_IDS)('%s roles match the spec table', (id) => {
        const r = groupRoles(id);
        expect([r.logo, r.action, r.strong, r.subtle, r.subtleBorder, r.linkUnderline, r.bubbleBorder, r.glow]).toEqual([...ROLES[id]]);
        expect(r.ring).toBe(r.action);
    });

    it.each(GROUP_IDS)('%s meets the contrast floors', (id) => {
        const r = groupRoles(id);
        const white = color.text.inverse;
        expect(contrastRatio(r.action, white)).toBeGreaterThanOrEqual(3.0);
        expect(contrastRatio(r.strong, white)).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the user-chosen Hinatazaka 600', () => {
        expect(groupTokens.hinatazaka.scale[600]).toBe('#389dd1');
    });

    it('derives shadow, button gradient and ambient orbs from the scale', () => {
        const h = groupRoles('hinatazaka');
        expect(h.unreadShadow).toBe('0 0 12px rgba(124, 199, 232, 0.4)');
        expect(h.buttonGradient).toBe('linear-gradient(135deg, #7cc7e8 0%, #389dd1 100%)');
        expect(h.ambient.orb1).toBe('radial-gradient(circle, #bbe4f7 0%, #dbf1fb 30%, transparent 70%)');
        expect(h.ambient.orb2).toBe('radial-gradient(circle, #fce4fc 0%, #eff9fd 40%, transparent 70%)');
        expect(h.ambient.orb3).toBe('radial-gradient(circle, #dbf1fb 0%, transparent 70%)');
        expect(groupRoles('yodel').ambient.orb2).toBe('radial-gradient(circle, #e5f0e8 0%, #f3f8f4 40%, transparent 70%)');
    });
});

describe('neutral colour tokens', () => {
    const vars = legacy.cssVars.hinatazaka as Record<string, string>;

    it('match the pre-D1 surface, text and feedback values', () => {
        expect(color.surface.sheet).toBe(vars['--color-surface-base']);
        expect(color.surface.elevated).toBe(vars['--color-surface-elevated']);
        expect(color.surface.sunken).toBe(vars['--color-surface-sunken']);
        expect(color.text.primary).toBe(vars['--color-text-primary']);
        expect(color.text.secondary).toBe(vars['--color-text-secondary']);
        expect(color.text.muted).toBe(vars['--color-text-muted']);
        expect(color.text.inverse).toBe(vars['--color-text-inverse']);
        expect(color.feedback.success).toBe(vars['--color-success']);
        expect(color.feedback.warning).toBe(vars['--color-warning']);
        expect(color.feedback.error).toBe(vars['--color-error']);
    });

    it('use role names, never hue names (dark-mode ready)', () => {
        const names = Object.values(color).flatMap((group) => Object.keys(group));
        for (const n of names) expect(n).not.toMatch(/white|black|gray|grey|blue|pink|purple|green/i);
    });
});

describe('scales', () => {
    it('radius, shadow, type, motion and spacing are unchanged', () => {
        expect(radius).toEqual({ none: '0px', card: '14px', sheet: '20px', pill: '9999px' });
        expect(Object.keys(shadow)).toEqual(['none', 'pill', 'card', 'sheet']);
        expect(Object.keys(typeScale)).toEqual(['caption', 'small', 'body', 'title', 'heading']);
        expect(motion.duration).toEqual({ fast: 150, base: 200 });
        expect(easingCss(motion.easing.standard)).toBe('cubic-bezier(0.2, 0, 0, 1)');
        expect(SPACE_UNIT_PX).toBe(4);
    });
});
```

Run: `npx vitest run src/design/tokens/tokens.test.ts`
Expected: FAIL — `SCALE_STEPS` / `groupRoles` are not exported.

- [ ] **Step 2: Rewrite `frontend/src/design/tokens/groups.ts`**

```ts
/**
 * Per-group colour data — the ONLY place group colours are defined.
 *
 * Two layers (docs/design/DESIGN_SYSTEM.md, "Colour system"):
 * - `official`: colours copied from the official apps. They are kept verbatim
 *   and pinned by tests: title gradient/bar/text, canvas, unread shelters and
 *   styles.
 * - System: `logo` plus a 10-step `scale` (OKLCH, logo colour snapped into its
 *   nearest step). Every other colour is a role from `roles.ts`, never a hex
 *   written here.
 * `legacyNeutral` holds today's per-group neutral tints, which D2 replaces
 * with shared neutrals.
 */
export type GroupId = 'hinatazaka' | 'sakurazaka' | 'nogizaka' | 'yodel' | 'default';

export const GROUP_IDS: readonly GroupId[] = ['hinatazaka', 'sakurazaka', 'nogizaka', 'yodel', 'default'];

/** Groups whose logos carry the shared Sakamichi purple. */
export const SAKAMICHI_GROUPS: readonly GroupId[] = ['hinatazaka', 'sakurazaka', 'nogizaka'];

/** The purple shared by every Sakamichi logo, and its tint used by the ambient orbs. */
export const SAKAMICHI_PURPLE = { base: '#7f1083', 100: '#fce4fc' } as const;

export type ScaleStep = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export const SCALE_STEPS: readonly ScaleStep[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

export interface OfficialLayer {
    title: {
        /** Chat/blog title gradient. */
        gradient: { from: string; via: string; to: string };
        /** Thin gradient bar under the title. */
        bar: string;
        /** Title text colour on light headers. */
        text: string;
    };
    /** Level-0 background (sidebar) gradient stops, top to bottom. */
    canvas: readonly [string, string, string];
    /** Unread-message cover colours per message type. */
    shelter: { picture: string; video: string; voice: string; text: string };
    /** 'classic' = coloured cover + white icon; 'light' = white cover + coloured icon. */
    shelterStyle: 'classic' | 'light';
    /** 'gradient' = filled gradient header + white text; 'light' = white header + coloured text. */
    headerStyle: 'gradient' | 'light';
}

export interface GroupTokens {
    /** The logo colour; it is also one step of `scale`. */
    logo: string;
    scale: Record<ScaleStep, string>;
    /** Message bubble border: the logo colour, or step 600 when the logo is too dark. */
    bubbleBorder: string;
    /** Selection glow: the logo colour at the group's alpha. */
    glow: string;
    official: OfficialLayer;
    legacyNeutral: { surfaceBackground: string; textSecondary: string; textMuted: string };
}

export const groupTokens: Record<GroupId, GroupTokens> = {
    hinatazaka: {
        logo: '#7cc7e8',
        scale: {
            50: '#eff9fd', 100: '#dbf1fb', 200: '#bbe4f7', 300: '#7cc7e8', 400: '#62bce2',
            500: '#50acdf', 600: '#389dd1', 700: '#0d7aab', 800: '#025c83', 900: '#03425f',
        },
        bubbleBorder: '#7cc7e8',
        glow: 'rgba(124, 199, 232, 0.35)',
        official: {
            title: {
                gradient: { from: '#a8c4e8', via: '#a0a9d8', to: '#9181c4' },
                bar: 'linear-gradient(to right, #a8c4e8, #9181c4)',
                text: '#5d95ae',
            },
            canvas: ['#c8d8ec', '#dde6f0', '#f0f4f8'],
            shelter: { picture: '#a8d0e8', video: '#c4a8d8', voice: '#b8a8d8', text: '#8bb8d6' },
            shelterStyle: 'classic',
            headerStyle: 'gradient',
        },
        legacyNeutral: { surfaceBackground: '#FEFEFE', textSecondary: '#4b5563', textMuted: '#9ca3af' },
    },
    sakurazaka: {
        logo: '#f19db5',
        scale: {
            50: '#fff3f6', 100: '#ffe5eb', 200: '#fecdda', 300: '#feacc3', 400: '#f19db5',
            500: '#e76692', 600: '#c84575', 700: '#a72f5d', 800: '#852048', 900: '#641434',
        },
        bubbleBorder: '#f19db5',
        glow: 'rgba(241, 157, 181, 0.35)',
        official: {
            title: {
                gradient: { from: '#fffdfe', via: '#d8b0c8', to: '#9b56a1' },
                bar: 'linear-gradient(to right, #ffffff 0%, #ffffff 5%, #fff6f7 10%, #eec8d2 25%, #e39eb1 50%, #bf78a0 75%, #95569c 100%)',
                text: '#d892aa',
            },
            canvas: ['#fce7f3', '#fdf2f8', '#fff5f7'],
            shelter: { picture: '#ec9595', video: '#edc094', voice: '#d695ec', text: '#eb95ae' },
            shelterStyle: 'light',
            headerStyle: 'light',
        },
        legacyNeutral: { surfaceBackground: '#FAFBFC', textSecondary: '#5a5a6e', textMuted: '#9898a8' },
    },
    nogizaka: {
        logo: '#7f1083',
        scale: {
            50: '#fef3fe', 100: '#fce4fc', 200: '#f9cbf8', 300: '#f1abf1', 400: '#e389e4',
            500: '#d06ad2', 600: '#b24ab5', 700: '#943397', 800: '#7f1083', 900: '#57175a',
        },
        bubbleBorder: '#b24ab5',
        glow: 'rgba(127, 16, 131, 0.28)',
        official: {
            title: {
                gradient: { from: '#d8c8e8', via: '#c4a8d8', to: '#9B59B6' },
                bar: 'linear-gradient(to right, #9B59B6, #7e1083)',
                text: '#7e1083',
            },
            canvas: ['#ede4f2', '#f3eef6', '#f8f5fa'],
            shelter: { picture: '#c4a8d8', video: '#9B59B6', voice: '#b8a8d8', text: '#d8c8e8' },
            shelterStyle: 'classic',
            headerStyle: 'gradient',
        },
        legacyNeutral: { surfaceBackground: '#FCFBFD', textSecondary: '#5c5666', textMuted: '#8e889a' },
    },
    yodel: {
        logo: '#5a8a6a',
        scale: {
            50: '#f3f8f4', 100: '#e5f0e8', 200: '#cde3d3', 300: '#afd1b9', 400: '#90bc9e',
            500: '#74a684', 600: '#5a8a6a', 700: '#416f51', 800: '#30573e', 900: '#21402c',
        },
        bubbleBorder: '#5a8a6a',
        glow: 'rgba(90, 138, 106, 0.3)',
        official: {
            title: {
                gradient: { from: '#b8d8c8', via: '#8ab89a', to: '#5a8a6a' },
                bar: 'linear-gradient(to right, #b8d8c8, #5a8a6a)',
                text: '#4a7a5a',
            },
            canvas: ['#d4ebe0', '#e5f2eb', '#f0f8f4'],
            shelter: { picture: '#8ab89a', video: '#6a9a7a', voice: '#7aaa8a', text: '#5a8a6a' },
            shelterStyle: 'classic',
            headerStyle: 'gradient',
        },
        legacyNeutral: { surfaceBackground: '#FBFDFC', textSecondary: '#4b5e53', textMuted: '#8fa399' },
    },
    default: {
        logo: '#6b7280',
        scale: {
            50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af',
            500: '#6b7280', 600: '#4b5563', 700: '#374151', 800: '#1f2937', 900: '#111827',
        },
        bubbleBorder: '#E5E7EB',
        glow: 'rgba(107, 114, 128, 0.25)',
        official: {
            title: {
                gradient: { from: '#a8c4e8', via: '#a0a9d8', to: '#9181c4' },
                bar: 'linear-gradient(to right, #a8c4e8, #9181c4)',
                text: '#4B5563',
            },
            canvas: ['#e5e7eb', '#f3f4f6', '#f9fafb'],
            shelter: { picture: '#a8d0e8', video: '#c4a8d8', voice: '#b8a8d8', text: '#8bb8d6' },
            shelterStyle: 'classic',
            headerStyle: 'gradient',
        },
        legacyNeutral: { surfaceBackground: '#FAFAFA', textSecondary: '#4B5563', textMuted: '#9CA3AF' },
    },
};
```

- [ ] **Step 3: Create `frontend/src/design/tokens/roles.ts`**

```ts
/**
 * Role → scale-step mapping, identical for every group. This is the ONLY
 * place the mapping lives; components and the legacy theme read roles,
 * never raw steps.
 */
import { groupTokens, SAKAMICHI_GROUPS, SAKAMICHI_PURPLE, type GroupId } from './groups';

export interface GroupRoles {
    /** Brand / logo colour (decoration, gradients). */
    logo: string;
    /** Step 600: badge, primary button, play button, scroll button (white text ≥ 3:1). */
    action: string;
    /** Step 700: member names, links, selected text (≥ 4.5:1 on white). */
    strong: string;
    /** Step 50: selected / hover background. */
    subtle: string;
    /** Step 200: border of subtle selections. */
    subtleBorder: string;
    /** Step 300: link underline. */
    linkUnderline: string;
    bubbleBorder: string;
    glow: string;
    /** Step 600: keyboard focus ring. */
    ring: string;
    unreadShadow: string;
    buttonGradient: string;
    ambient: { orb1: string; orb2: string; orb3: string };
}

function hexToRgba(hex: string, alpha: number): string {
    const value = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function groupRoles(id: GroupId): GroupRoles {
    const g = groupTokens[id];
    const s = g.scale;
    const orb2Core = SAKAMICHI_GROUPS.includes(id) ? SAKAMICHI_PURPLE[100] : s[100];
    return {
        logo: g.logo,
        action: s[600],
        strong: s[700],
        subtle: s[50],
        subtleBorder: s[200],
        linkUnderline: s[300],
        bubbleBorder: g.bubbleBorder,
        glow: g.glow,
        ring: s[600],
        unreadShadow: `0 0 12px ${hexToRgba(g.logo, 0.4)}`,
        buttonGradient: `linear-gradient(135deg, ${g.logo} 0%, ${s[600]} 100%)`,
        ambient: {
            orb1: `radial-gradient(circle, ${s[200]} 0%, ${s[100]} 30%, transparent 70%)`,
            orb2: `radial-gradient(circle, ${orb2Core} 0%, ${s[50]} 40%, transparent 70%)`,
            orb3: `radial-gradient(circle, ${s[100]} 0%, transparent 70%)`,
        },
    };
}

/** Action colour for media controls rendered without a group theme. */
export const FALLBACK_ACTION_COLOR = groupTokens.default.scale[600];
```

Update `frontend/src/design/tokens/index.ts`. The groups line becomes the following, plus the roles line:

```ts
export {
    GROUP_IDS, SAKAMICHI_GROUPS, SAKAMICHI_PURPLE, SCALE_STEPS, groupTokens,
    type GroupId, type GroupTokens, type OfficialLayer, type ScaleStep,
} from './groups';
export { groupRoles, FALLBACK_ACTION_COLOR, type GroupRoles } from './roles';
```

- [ ] **Step 4: Update `cssVars.ts` and the DesignPage swatch list**

In `frontend/src/design/cssVars.ts`:
- Change the import to `import { color, groupRoles, groupTokens, radius, shadow, typeScale, motion, easingCss, type GroupId } from './tokens';`
- Replace `groupTokenVars` with:

```ts
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
```

In `frontend/src/design/DesignPage.tsx`:
- Import `groupRoles` from `./tokens`. Drop `groupTokens` from that import if it becomes unused.
- Replace the `const g = …` line and the `groupSwatches` array with:

```tsx
    const r = groupRoles(group);
    const groupSwatches = [
        ['logo', r.logo], ['action (600)', r.action], ['strong (700)', r.strong], ['subtle (50)', r.subtle],
        ['subtleBorder (200)', r.subtleBorder], ['linkUnderline (300)', r.linkUnderline],
        ['bubbleBorder', r.bubbleBorder], ['glow', r.glow],
        ['title.text', groupTokenVars(group)['--ds-group-title-text']],
        ['title.bar', groupTokenVars(group)['--ds-group-title-bar']],
        ['canvas', groupTokenVars(group)['--ds-group-canvas']],
    ] as const;
```

The swatch names are token identifiers, not user-facing prose. The page already renders them untranslated in the same way.

- [ ] **Step 5: Rewrite `frontend/src/config/serviceThemes.ts` as a builder**

Replace everything above `// Map service IDs to service themes` (the imports, the interface and the `serviceThemes` literal) with the code below. Delete `getServiceThemeCSSVariables` and its comment. Keep `getServiceTheme` and `DEFAULT_SHELTER_COLORS` unchanged.

```ts
// frontend/src/config/serviceThemes.ts
// Legacy per-feature view of the design tokens. Every colour comes from
// design/tokens (the official layer or groupRoles); this file only adds
// non-colour metadata. New code should read design/tokens directly.

import { GROUP_IDS, groupTokens, type GroupId } from '../design/tokens/groups';
import { groupRoles } from '../design/tokens/roles';

export type { GroupId };

interface AmbientOrb {
    color: string;
    position: string;
    size: string;
    opacity: number;
}

type OrbLayout = Omit<AmbientOrb, 'color'>;

export interface ServiceTheme {
    id: GroupId;
    name: string;
    nameJp: string;

    // Core brand colors
    primaryColor: string;     // logo colour
    secondaryColor: string;   // action (step 600)
    accentColor: string;      // subtle (step 50)

    // Ambient background orbs
    ambient: { orb1: AmbientOrb; orb2: AmbientOrb; orb3: AmbientOrb };

    surface: { background: string };
    text: { secondary: string; muted: string };

    interaction: {
        hoverGlow: string;
        buttonGradient: string;
    };

    // Visual vibe keywords
    vibe: string[];

    blog: {
        memberNameColor: string;
        linkColor: string;
        linkUnderlineColor: string;
        headerTitleColor: string;
        timelineIndicator: string;
    };

    // Modal accent colors (Date Search, Favorites, Media, Background, Sent Letters)
    modals: {
        accentColor: string;        // action — buttons, selected states
        accentColorLight: string;   // subtle — backgrounds, hover
        accentColorMuted: string;   // subtleBorder — borders
    };

    messages: {
        headerGradient: { from: string; via: string; to: string };
        headerTextColor: string;
        headerBarGradient: string;
        bubbleBorder: string;
        voicePlayerAccent: string;
        scrollButtonColor: string;
        unreadShadow: string;
        unreadBadge: string;
        sidebarGradient: string[];
        shelterColors: { picture: string; video: string; voice: string; text: string };
        shelterStyle: 'classic' | 'light';
        headerStyle: 'gradient' | 'light';
    };
}

interface ThemeMeta {
    name: string;
    nameJp: string;
    vibe: string[];
    ambient: { orb1: OrbLayout; orb2: OrbLayout; orb3: OrbLayout };
}

const THEME_META: Record<GroupId, ThemeMeta> = {
    hinatazaka: {
        name: 'Hinatazaka46', nameJp: '日向坂46',
        vibe: ['airy', 'bright', 'komorebi', 'summer sky', 'gentle warmth'],
        ambient: {
            orb1: { position: 'top: -20%; left: -10%;', size: '70vw', opacity: 0.4 },
            orb2: { position: 'top: 15%; right: -15%;', size: '60vw', opacity: 0.35 },
            orb3: { position: 'bottom: -25%; left: 25%;', size: '50vw', opacity: 0.3 },
        },
    },
    sakurazaka: {
        name: 'Sakurazaka46', nameJp: '櫻坂46',
        vibe: ['artistic', 'ephemeral', 'clean canvas', 'cherry blossom', 'cool elegance'],
        ambient: {
            orb1: { position: 'top: -15%; right: -10%;', size: '65vw', opacity: 0.5 },
            orb2: { position: 'top: 30%; left: -20%;', size: '55vw', opacity: 0.4 },
            orb3: { position: 'bottom: -20%; right: 20%;', size: '45vw', opacity: 0.35 },
        },
    },
    nogizaka: {
        name: 'Nogizaka46', nameJp: '乃木坂46',
        vibe: ['sophisticated', 'french', 'mature', 'noble', 'elegant'],
        ambient: {
            orb1: { position: 'top: -18%; left: -8%;', size: '68vw', opacity: 0.5 },
            orb2: { position: 'top: 25%; right: -18%;', size: '58vw', opacity: 0.45 },
            orb3: { position: 'bottom: -22%; left: 35%;', size: '48vw', opacity: 0.38 },
        },
    },
    yodel: {
        name: 'Yodel', nameJp: 'ヨーデル',
        vibe: ['fresh', 'natural', 'independent', 'meadow', 'serene'],
        ambient: {
            orb1: { position: 'top: -18%; left: -8%;', size: '68vw', opacity: 0.45 },
            orb2: { position: 'top: 25%; right: -18%;', size: '58vw', opacity: 0.4 },
            orb3: { position: 'bottom: -22%; left: 30%;', size: '48vw', opacity: 0.35 },
        },
    },
    default: {
        name: 'Default', nameJp: '',
        vibe: ['neutral', 'minimal', 'professional'],
        ambient: {
            orb1: { position: 'top: -20%; left: -10%;', size: '70vw', opacity: 0.4 },
            orb2: { position: 'top: 20%; right: -15%;', size: '60vw', opacity: 0.35 },
            orb3: { position: 'bottom: -25%; left: 30%;', size: '50vw', opacity: 0.3 },
        },
    },
};

function buildTheme(id: GroupId): ServiceTheme {
    const g = groupTokens[id];
    const o = g.official;
    const r = groupRoles(id);
    const meta = THEME_META[id];
    return {
        id,
        name: meta.name,
        nameJp: meta.nameJp,
        primaryColor: r.logo,
        secondaryColor: r.action,
        accentColor: r.subtle,
        ambient: {
            orb1: { color: r.ambient.orb1, ...meta.ambient.orb1 },
            orb2: { color: r.ambient.orb2, ...meta.ambient.orb2 },
            orb3: { color: r.ambient.orb3, ...meta.ambient.orb3 },
        },
        surface: { background: g.legacyNeutral.surfaceBackground },
        text: { secondary: g.legacyNeutral.textSecondary, muted: g.legacyNeutral.textMuted },
        interaction: { hoverGlow: r.glow, buttonGradient: r.buttonGradient },
        vibe: [...meta.vibe],
        blog: {
            memberNameColor: r.strong,
            linkColor: r.strong,
            linkUnderlineColor: r.linkUnderline,
            headerTitleColor: r.strong,
            timelineIndicator: r.strong,
        },
        modals: { accentColor: r.action, accentColorLight: r.subtle, accentColorMuted: r.subtleBorder },
        messages: {
            headerGradient: { ...o.title.gradient },
            headerTextColor: o.title.text,
            headerBarGradient: o.title.bar,
            bubbleBorder: r.bubbleBorder,
            voicePlayerAccent: r.action,
            scrollButtonColor: r.action,
            unreadShadow: r.unreadShadow,
            unreadBadge: r.action,
            sidebarGradient: [...o.canvas],
            shelterColors: { ...o.shelter },
            shelterStyle: o.shelterStyle,
            headerStyle: o.headerStyle,
        },
    };
}

export const serviceThemes = Object.fromEntries(
    GROUP_IDS.map((id) => [id, buildTheme(id)]),
) as Record<GroupId, ServiceTheme>;
```

- [ ] **Step 6: Update the legacy and integration tests**

Replace `frontend/src/config/colors/legacyEquality.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import legacy from '../../design/__fixtures__/legacy-theme-values.json';
import { GROUP_IDS, groupRoles, groupTokens } from '../../design/tokens';
import { serviceThemes } from '../serviceThemes';
import { generateThemeCSSVariables, UI_TOKENS } from './index';

const GROUP_VARS = ['--color-primary', '--color-secondary', '--color-accent', '--color-gradient-from', '--color-gradient-to'];

describe('legacy theme is a view of the design tokens', () => {
    it.each(GROUP_IDS)('%s neutral CSS variables are unchanged', (id) => {
        const vars = generateThemeCSSVariables(id);
        const want = legacy.cssVars[id] as Record<string, string>;
        for (const [name, value] of Object.entries(want)) {
            if (!GROUP_VARS.includes(name)) expect(vars[name]).toBe(value);
        }
    });

    it.each(GROUP_IDS)('%s group CSS variables follow the roles', (id) => {
        const vars = generateThemeCSSVariables(id);
        const r = groupRoles(id);
        expect(vars['--color-primary']).toBe(r.logo);
        expect(vars['--color-secondary']).toBe(r.action);
        expect(vars['--color-accent']).toBe(r.subtle);
        expect(vars['--color-gradient-from']).toBe(r.logo);
        expect(vars['--color-gradient-to']).toBe(r.action);
    });

    it.each(GROUP_IDS)('%s official fields are byte-identical to the official values', (id) => {
        const t = serviceThemes[id];
        const want = legacy.groups[id];
        expect(t.messages.headerGradient).toEqual(want.titleGradient);
        expect(t.messages.headerBarGradient).toBe(want.titleBar);
        expect(t.messages.headerTextColor).toBe(want.titleText);
        expect(t.messages.sidebarGradient).toEqual(want.canvas);
        expect(t.messages.shelterColors).toEqual(groupTokens[id].official.shelter);
    });

    it.each(GROUP_IDS)('%s system fields come from the roles', (id) => {
        const t = serviceThemes[id];
        const r = groupRoles(id);
        expect(t.primaryColor).toBe(r.logo);
        expect([t.messages.unreadBadge, t.messages.voicePlayerAccent, t.messages.scrollButtonColor, t.modals.accentColor]).toEqual([r.action, r.action, r.action, r.action]);
        expect([t.blog.memberNameColor, t.blog.linkColor, t.blog.headerTitleColor, t.blog.timelineIndicator]).toEqual([r.strong, r.strong, r.strong, r.strong]);
        expect(t.modals.accentColorLight).toBe(r.subtle);
        expect(t.modals.accentColorMuted).toBe(r.subtleBorder);
        expect(t.blog.linkUnderlineColor).toBe(r.linkUnderline);
        expect(t.messages.bubbleBorder).toBe(r.bubbleBorder);
        expect(t.interaction.hoverGlow).toBe(r.glow);
        expect(t.ambient.orb1.color).toBe(r.ambient.orb1);
    });

    it('serviceThemes.ts contains no hand-written colour', () => {
        const source = readFileSync(path.resolve(__dirname, '../serviceThemes.ts'), 'utf-8');
        expect(source.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)).toBeNull();
    });

    it('border tokens are unchanged', () => {
        expect(UI_TOKENS.border).toEqual(legacy.border);
    });
});
```

In `frontend/src/design/applyTokens.test.ts`:
- In the `groupTokenVars` test, change `toHaveLength(12)` (or whatever the current group-var count assertion is) to `toHaveLength(17)`.
- Replace any `groupTokens[id].canvas` / `.badge` / `.bubbleBorder` references with `groupTokens[id].official.canvas`, `groupRoles(id).action` and `groupRoles(id).bubbleBorder`. Import `groupRoles` from `./tokens`.
- Keep the `--ds-shadow-group-glow` assertion, now built from `groupRoles(id).glow`.

In `frontend/src/design/DesignPage.test.tsx`, replace `groupTokens[id].badge` with `groupRoles(id).action` and import `groupRoles` from `./tokens`. The "White text 1.9:1" assertion stays valid, because the logo swatch is still `#7cc7e8`.

In `frontend/src/config/serviceThemes.test.ts`:
- Delete the whole `describe('getServiceThemeCSSVariables', …)` block and remove the function from the import.
- In 'should have all required theme sections' (and any other test), delete assertions on `surface.card`, `surface.glass`, `surface.glassBorder`, `text.primary`, `interaction.focusRing` or `messages.defaultBackground`. Keep everything else.

- [ ] **Step 7: Run the tests and the full suite**

Run: `npx vitest run src/design src/config && npx tsc --noEmit && npx vitest run`
Expected:
- All PASS and `tsc` is silent.
- If `tsc` reports a consumer still reading a deleted field, the spec's "no consumers" assumption was wrong. Report it, and do not silently re-add the field.
- The guard test still passes (`serviceThemes.ts` and `design/tokens/**` are excluded).

- [ ] **Step 8: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src/design frontend/src/config
uv run git commit -m "feat(design): switch groups to the unified two-layer colour system

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Replace hard-coded group-colour fallbacks

`#6da0d4` (the old Hinatazaka voice accent) is the fallback when media controls get no theme colour. That fallback is now the neutral default action colour.

**Files:**
- Modify:
  - `frontend/src/core/media/VoicePlayer.tsx:100-102`
  - `frontend/src/core/media/TranscribeButton.tsx:24`
  - `frontend/src/core/media/TranscriptPanel.tsx:50`
  - `frontend/src/core/common/TranslateButton.tsx:35`
  - `frontend/src/features/messages/components/MessageBubble.tsx:466-467`
- Modify: `frontend/src/design/guard-baseline.json` (regenerated)
- Test: `frontend/src/design/tokens/fallback.test.ts`

**Interfaces:**
- Consumes: `FALLBACK_ACTION_COLOR` from `frontend/src/design/tokens` (= `#4b5563`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/design/tokens/fallback.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FALLBACK_ACTION_COLOR, groupRoles } from './index';

const SRC = path.resolve(__dirname, '../..');
const FILES = [
    'core/media/VoicePlayer.tsx',
    'core/media/TranscribeButton.tsx',
    'core/media/TranscriptPanel.tsx',
    'core/common/TranslateButton.tsx',
    'features/messages/components/MessageBubble.tsx',
];

describe('media accent fallback', () => {
    it('is the neutral default action colour (6-digit hex, safe for alpha suffixes)', () => {
        expect(FALLBACK_ACTION_COLOR).toBe(groupRoles('default').action);
        expect(FALLBACK_ACTION_COLOR).toMatch(/^#[0-9a-f]{6}$/);
    });

    it.each(FILES)('%s no longer hard-codes the old Hinatazaka accent', (rel) => {
        const source = readFileSync(path.join(SRC, rel), 'utf-8');
        expect(source.toLowerCase()).not.toContain('#6da0d4');
        expect(source).toContain('FALLBACK_ACTION_COLOR');
    });
});
```

Run: `npx vitest run src/design/tokens/fallback.test.ts`
Expected: FAIL. The five files still contain `#6da0d4`.

- [ ] **Step 2: Replace the literals**

In each file, import `FALLBACK_ACTION_COLOR`. Use the right relative path to `design/tokens`: `../../design/tokens` from `core/media` and `core/common`, and `../../../design/tokens` from `features/messages/components`. Then:
- `VoicePlayer.tsx`:
  - Delete the comment line about "Fallback to Hinatazaka's voice player accent (#6da0d4)".
  - Change `const DEFAULT_ACCENT_COLOR = '#6da0d4';` to `const DEFAULT_ACCENT_COLOR = FALLBACK_ACTION_COLOR; // neutral action colour when no group theme is given`.
- `TranscribeButton.tsx`, `TranscriptPanel.tsx`, `TranslateButton.tsx`: change the default parameter `accentColor = '#6da0d4',` to `accentColor = FALLBACK_ACTION_COLOR,`.
- `MessageBubble.tsx`: change both `${theme?.voicePlayerAccent || '#6da0d4'}` to `${theme?.voicePlayerAccent || FALLBACK_ACTION_COLOR}`.

- [ ] **Step 3: Lower the guard baseline**

```bash
UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts
npx vitest run src/design/guard.test.ts
git diff src/design/guard-baseline.json
```

Expected: the second run PASSES. The diff only *lowers* (or removes) the entries for the five files above; no other entry changes.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src
uv run git commit -m "refactor(design): use the token fallback for media accent colours

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tailwind utilities for the new roles

**Files:**
- Modify: `frontend/tailwind.config.js`, `frontend/src/utils/classnames.ts`
- Test: `frontend/src/utils/classnames.test.ts`. The existing `frontend/src/design/tailwindTokens.test.ts` must stay green.

**Interfaces:**
- Consumes: the `--ds-group-strong`, `--ds-group-subtle`, `--ds-group-subtle-border` and `--ds-group-link-underline` variables from Task 1.
- Produces: the classes `text-group-strong`, `bg-group-subtle`, `border-group-subtle` and `decoration-group`.

- [ ] **Step 1: Write the failing test**

Append to the `cn with design-system classes` describe in `frontend/src/utils/classnames.test.ts`:

```ts
    it('treats the group role utilities as colours of their property', () => {
        expect(cn('text-group-strong', 'text-primary')).toBe('text-primary');
        expect(cn('text-body', 'text-group-strong')).toBe('text-body text-group-strong');
        expect(cn('bg-group-subtle', 'bg-sheet')).toBe('bg-sheet');
    });
```

Run: `npx vitest run src/utils/classnames.test.ts`
Expected: FAIL on the first assertion. tailwind-merge does not yet know `group-strong` as a text colour, so it keeps both classes.

- [ ] **Step 2: Add the utilities**

In `frontend/tailwind.config.js` under `theme.extend`, make four changes:
- In `backgroundColor`, add `'group-subtle': 'var(--ds-group-subtle)',`.
- In `textColor`, add `'group-strong': 'var(--ds-group-strong)',`.
- In `borderColor`, add `'group-subtle': 'var(--ds-group-subtle-border)',`.
- Add a new key next to `ringColor`:

```js
            textDecorationColor: {
                group: 'var(--ds-group-link-underline)',
            },
```

In `frontend/src/utils/classnames.ts`, add `'group-strong'` to the `'text-color'` class-group list.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/utils/classnames.test.ts src/design/tailwindTokens.test.ts && npx tsc --noEmit`
Expected: PASS. The tailwindTokens test proves every new `var(--ds-…)` is written by `groupTokenVars`.

- [ ] **Step 4: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/tailwind.config.js frontend/src/utils
uv run git commit -m "feat(design): add Tailwind utilities for the group colour roles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Show the scale and role map on `/design`

**Files:**
- Modify: `frontend/src/design/DesignPage.tsx`, `frontend/src/design/DesignPage.test.tsx`
- Modify: `frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json`, `frontend/src/i18n/designSystem.test.ts`

**Interfaces:**
- Consumes: `SCALE_STEPS`, `groupTokens`, `groupRoles` (Task 1); `contrastRatio` (`./contrast`); `Card`, `Section`, `Swatch` (already in the page).
- Produces: i18n keys `designPage.scale`, `designPage.logoStep`, `designPage.roles`, `designPage.roleName`, `designPage.roleStep`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/design/DesignPage.test.tsx`. Import `SCALE_STEPS` and `groupTokens` from `./tokens` if they are not already imported.

```tsx
describe('DesignPage colour system', () => {
    it('shows the selected group scale with the logo step marked', async () => {
        render(<DesignPage />);
        expect(screen.getByRole('heading', { name: 'Scale' })).toBeInTheDocument();
        for (const step of SCALE_STEPS) {
            expect(screen.getAllByText(groupTokens.hinatazaka.scale[step]).length).toBeGreaterThan(0);
        }
        expect(screen.getByText('Logo color')).toBeInTheDocument();
    });

    it('lists the role map', () => {
        render(<DesignPage />);
        expect(screen.getByRole('heading', { name: 'Roles' })).toBeInTheDocument();
        for (const role of ['action', 'strong', 'subtle', 'subtleBorder', 'linkUnderline']) {
            expect(screen.getAllByText(role).length).toBeGreaterThan(0);
        }
    });
});
```

Append to `frontend/src/i18n/designSystem.test.ts` (inside the file, after the existing describes):

```ts
describe('design page colour-system strings', () => {
    it.each(Object.entries(locales))('%s has the scale and role keys', (_code, data) => {
        const page = (data as unknown as Tree).designPage;
        for (const key of ['scale', 'logoStep', 'roles', 'roleName', 'roleStep']) expect(page?.[key], key).toBeTruthy();
    });
});
```

Run: `npx vitest run src/design/DesignPage.test.tsx src/i18n/designSystem.test.ts`
Expected: FAIL, because the headings and keys are missing.

- [ ] **Step 2: Add the strings**

Run from `SakaDesk/frontend`:

```bash
cat > /tmp/ds15-i18n-$$.mjs <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const add = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
for (const [loc, tree] of Object.entries(add)) {
  const file = `src/i18n/locales/${loc}.json`;
  const data = JSON.parse(readFileSync(file, 'utf-8'));
  for (const [ns, keys] of Object.entries(tree)) data[ns] = { ...(data[ns] ?? {}), ...keys };
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
EOF
cat > /tmp/ds15-i18n-$$.json <<'EOF'
{
  "en":    { "designPage": { "scale": "Scale", "logoStep": "Logo color", "roles": "Roles", "roleName": "Role", "roleStep": "Step" } },
  "ja":    { "designPage": { "scale": "色階", "logoStep": "ロゴの色", "roles": "役割", "roleName": "役割", "roleStep": "段階" } },
  "zh-TW": { "designPage": { "scale": "色階", "logoStep": "logo 原色", "roles": "用途", "roleName": "用途", "roleStep": "色階" } },
  "zh-CN": { "designPage": { "scale": "色阶", "logoStep": "logo 原色", "roles": "用途", "roleName": "用途", "roleStep": "色阶" } },
  "yue":   { "designPage": { "scale": "色階", "logoStep": "logo 原色", "roles": "用途", "roleName": "用途", "roleStep": "色階" } }
}
EOF
node /tmp/ds15-i18n-$$.mjs /tmp/ds15-i18n-$$.json && rm /tmp/ds15-i18n-$$.mjs /tmp/ds15-i18n-$$.json
git diff --stat src/i18n/locales
```

The en `designPage` strings use American spelling ("Color"), so the key is `"Logo color"`.

Add `'scale', 'logoStep', 'roles', 'roleName', 'roleStep'` to the `DESIGN_PAGE_KEYS` list in `frontend/src/i18n/designSystem.test.ts` as well.

- [ ] **Step 3: Add the two sections to the page**

In `frontend/src/design/DesignPage.tsx`, import `SCALE_STEPS` and `groupTokens` from `./tokens`. Insert this inside the Colors `<Section>`, after the group swatches grid:

```tsx
                    <h3 className="text-title text-secondary">{t('designPage.scale')}</h3>
                    <div className="flex flex-wrap gap-2">
                        {SCALE_STEPS.map((step) => {
                            const value = groupTokens[group].scale[step];
                            const isLogo = value.toLowerCase() === groupTokens[group].logo.toLowerCase();
                            return (
                                <Card key={step} className={cn('flex w-20 flex-col overflow-hidden', isLogo && 'ring-2 ring-group')}>
                                    <div className="h-10" style={{ background: value }} />
                                    <div className="flex flex-col p-2">
                                        <span className="text-caption font-semibold text-primary">{step}</span>
                                        <span className="text-caption text-muted">{value}</span>
                                        {isLogo && <span className="text-caption text-secondary">{t('designPage.logoStep')}</span>}
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                    <h3 className="text-title text-secondary">{t('designPage.roles')}</h3>
                    <Card className="p-4">
                        <div className="grid grid-cols-3 gap-2 text-small">
                            <span className="font-semibold text-secondary">{t('designPage.roleName')}</span>
                            <span className="font-semibold text-secondary">{t('designPage.roleStep')}</span>
                            <span />
                            {([
                                ['action', 600, r.action], ['strong', 700, r.strong], ['subtle', 50, r.subtle],
                                ['subtleBorder', 200, r.subtleBorder], ['linkUnderline', 300, r.linkUnderline], ['ring', 600, r.ring],
                            ] as const).map(([role, step, value]) => (
                                <React.Fragment key={role}>
                                    <span className="text-primary">{role}</span>
                                    <span className="text-muted">{step}</span>
                                    <span className="h-5 w-12 rounded-pill" style={{ background: value }} />
                                </React.Fragment>
                            ))}
                        </div>
                    </Card>
```

Role names and step numbers are token identifiers shown as code-like labels, the same as the existing swatch names. Headings and column labels are translated.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/design src/i18n && npx tsc --noEmit && npm run lint`
Expected: PASS. The guard stays green, because the page reads colours from tokens only.

- [ ] **Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src/design frontend/src/i18n
uv run git commit -m "feat(design): show group scales and the role map on the style page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Document the colour system and sync the spec

**Files:**
- Modify: `docs/design/DESIGN_SYSTEM.md`, `docs/superpowers/specs/2026-11-04-d15-color-system-design.md`

- [ ] **Step 1: Add a "Colour system" section to `DESIGN_SYSTEM.md`** (after "Where group colour may appear")

```markdown
## Colour system

Every group colour comes from `frontend/src/design/tokens/groups.ts` through
one of two layers:

- **Official layer** (`groupTokens[id].official`): title gradient, thin bar and
  title text, the canvas (sidebar) gradient, unread-shelter colours and the
  `shelterStyle` / `headerStyle` switches. These were copied from the official
  apps and are kept verbatim — tests pin them. Do not "fix" them to match the
  scale.
- **System layer**: each group has its logo colour and a 10-step scale
  (50 lightest … 900 darkest, logo colour snapped into its step). Colours are
  taken by **role**, never by step, through `groupRoles(id)` in
  `design/tokens/roles.ts`:

| Role | Step | Used for | Utility |
|---|---|---|---|
| `action` | 600 | badge, primary button, play / scroll buttons | `bg-group-accent`, `bg-group-badge` |
| `strong` | 700 | member names, links, selected text | `text-group-strong` |
| `subtle` | 50 | selected / hover background | `bg-group-subtle` |
| `subtleBorder` | 200 | border of subtle selections | `border-group-subtle` |
| `linkUnderline` | 300 | link underline | `decoration-group` |
| `ring` | 600 | keyboard focus ring | `ring-group` |
| `bubbleBorder` | logo (Nogizaka 600) | message bubble border | `border-group-bubble` |
| `glow` | logo at alpha | selection glow | `shadow-group-glow` |

Contrast floors are enforced by tests: `action` with white text ≥ 3:1 and
`strong` on white ≥ 4.5:1. Sakurazaka is the one stylistic exception: a white
base with pink accents (`light` header and shelters). `--ds-group-accent` is
the **action** colour; the logo colour itself is `--ds-group-logo`.

To add a colour, add a **role** in `roles.ts` (and a CSS variable and utility
if components need it). Never add a new hex to a component or to
`serviceThemes.ts` (a test fails if that file contains any colour literal).
```

Also update the "Where group colour may appear" list so it names the utilities in the table above. Item 4 now reads "Badge: `Badge`, `bg-group-badge` (the action colour)". The primary-button exception now reads "`Button variant="primary"` uses `bg-group-accent` (the action colour, step 600)".

- [ ] **Step 2: Sync the spec with the implementation**

In `docs/superpowers/specs/2026-11-04-d15-color-system-design.md`, make these edits:
- In the role mapping table, rename `accent` → `logo` and `onAccent` → `action`. Note that `--ds-group-accent` and `--ds-group-badge` carry `action`, and that `--ds-group-logo` carries the logo colour.
- In "Deleted / unchanged", say the remaining per-group neutral tints move to `groupTokens[id].legacyNeutral`, so that `serviceThemes.ts` holds no colour literal.
- In "Hard-coded group colours", the list becomes the five files that held `#6da0d4`. `config/uiConstants.ts` is a neutral chat-background preset list and is not a group colour, so it is out of scope. The replacement is `FALLBACK_ACTION_COLOR` (default group step 600).

- [ ] **Step 3: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add docs
uv run git commit -m "docs(design): document the unified colour system

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Verify, capture before/after, user review, PR

**Files:** none new.

- [ ] **Step 1: Full checks**

Run from `SakaDesk/frontend`: `npx vitest run`, `npx tsc --noEmit` and `npm run lint`. Then, from `SakaDesk`, run `uv run pytest -q`.
Expected: all pass. Record the counts.

- [ ] **Step 2: Before/after screenshots**

Run from `SakaDesk/frontend`:

```bash
OUT=/tmp/claude-1000/-home-xtorker-repos-Project-Saka/0c8e0563-c43f-4768-acb0-ad888fb2dc2f/scratchpad/d15-shots
mkdir -p "$OUT/before" "$OUT/after"
cp e2e/visual-zero-pixel.spec.ts-snapshots/*.png "$OUT/before/"
npm run build
npx playwright test e2e/visual-zero-pixel.spec.ts --update-snapshots --reporter=line
cp e2e/visual-zero-pixel.spec.ts-snapshots/*.png "$OUT/after/"
npx playwright test e2e/visual-zero-pixel.spec.ts --reporter=line
```

Expected: the final run reports `3 passed` against the new baselines. The `before/` images are the D1 (pre-colour) baselines, which equal `dev`. Send both sets to the user with SendUserFile.

- [ ] **Step 3: User review on Windows**

Start `npm run dev -- --port 5173 --strictPort` in the background. Open `http://localhost:5173/?view=design` with `powershell.exe -NoProfile -Command "Start-Process '…'"`. Never use Playwright or WSLg.

Ask the user to review the style page in all five groups. Then ask them to review the real app in their Windows dev build and say where anything looks off.

To stop the dev server afterwards, use `kill` on the PID reported by the background task. Never `pkill -f` a pattern that also matches your own shell command.

- [ ] **Step 4: PR (after the user's review)**

Push `feat/d15-color-system`. Open a PR to `dev` with the body below, written to a scratch file via the Write tool. Use `## Why`, `## What`, `## Testing` and `## Changelog`. The changelog entry needs a CHANGELOG.md `[Unreleased]` entry, because users see new colours:

```
### Changed
- **One consistent colour design per group**: badges, buttons, links,
  dialogs and the voice player now follow each group's logo colours, while
  the official title bars, sidebars and unread covers stay as before.
```

Add that entry under `[Unreleased]` → `### Changed` in `CHANGELOG.md` in the same PR, commit it with `docs(changelog): note the unified group colours`, and quote it in `## Changelog`. End the PR body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
