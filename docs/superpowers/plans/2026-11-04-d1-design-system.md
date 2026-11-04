# D1 Design-System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give SakaDesk one design language — tokens, primitives, a dev-only style page, docs and a ratchet guard — without changing a single pixel of the existing screens.

**Architecture:** TypeScript token modules in `frontend/src/design/tokens/` are the only definitions. `applyStaticTokens()` / `applyGroupTokens()` write them to `:root` as `--ds-*` CSS variables (plus the legacy `--color-*` ones), and Tailwind utilities point at those variables. The legacy `serviceThemes.ts` / `config/colors/` keep their public shape but read their brand values from the tokens. Presentational primitives in `frontend/src/design/primitives/` use only token utilities and are shown on `?view=design` (DEV only). D2 converts screens later.

**Tech Stack:** React 18, TypeScript 5, Tailwind 3.4, tailwind-merge 2.6, i18next, vitest + Testing Library (jsdom), Playwright (headless chromium), FastAPI + pydantic + structlog (backend log whitelist), pytest.

**Spec:** `docs/superpowers/specs/2026-11-04-d1-design-system-design.md`

## Global Constraints

- **Zero pixel change** on every existing screen. Every token value is copied verbatim from the current code; `legacy-theme-values.json` (Task 1) pins them.
- **Dark mode: reserve, do not build.** Token names are roles (`surface.sheet`), never hues (`white`). Ship light values only.
- **Group colour appears only in:** title gradient, selection ring/glow, bubble border, badge — plus at most **one** `primary` button per screen. Everything else is neutral.
- **Scales:** radius `none 0 / card 14px / sheet 20px / pill 9999px`; type `caption 11/16, small 13/20, body 14/22, title 16/24, heading 20/28`; spacing multiples of 4 px (Tailwind default scale); motion `fast 150ms / base 200ms`, easing `cubic-bezier(0.2, 0, 0, 1)`.
- **No Divider primitive.** Separate blocks with spacing and levels.
- **Hinatazaka badge stays `#7cc7e8`.**
- **i18n:** no hard-coded user-facing strings, including the dev-only `/design` page. Locales: `en`, `ja`, `zh-TW`, `zh-CN`, `yue` (`frontend/src/i18n/locales/*.json`, 2-space indent, trailing newline).
- **Logging:** breadcrumbs only via `clientLog`; never text, names, URLs, paths or raw client ids.
- **Commands:** frontend from `SakaDesk/frontend` with `npx vitest run …`, `npx tsc --noEmit`, `npm run lint`; backend from `SakaDesk` with `uv run pytest …`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy backend/`. **Never** `pip`.
- **Commits:** `uv run git commit` (bare `git commit` fails: pre-commit is only on the uv PATH). Conventional Commits, subject ≤ 72 chars, imperative, no trailing period, body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Branch:** `feat/d1-design-system` (already created, holds the spec commit).

## File map

| Path | Responsibility |
|---|---|
| `frontend/src/design/__fixtures__/legacy-theme-values.json` | Frozen pre-D1 values (Task 1) |
| `frontend/e2e/visual-zero-pixel.spec.ts` | Local pixel-regression screenshots |
| `frontend/src/design/tokens/{color,groups,radius,shadow,type,space,motion,index}.ts` | Token definitions (only place values live) |
| `frontend/src/design/cssVars.ts` | Pure token → CSS-variable maps |
| `frontend/src/design/applyTokens.ts` | Writes the maps to `:root`, logs |
| `frontend/src/design/primitives/*.tsx` | Canvas, Sheet, Card, Pill, Badge, Avatar, DatePill, Button, IconButton, RailItem, Modal |
| `frontend/src/design/contrast.ts` | WCAG contrast ratio for the style page |
| `frontend/src/design/designRoute.ts` | `isDesignView(search)` |
| `frontend/src/design/DesignPage.tsx` | Dev-only living style page |
| `frontend/src/design/guard.ts` + `guard.test.ts` + `guard-baseline.json` | Hard-coded-style ratchet |
| `frontend/src/config/serviceThemes.ts` | Legacy theme; 9 brand fields per group now read `groupTokens` |
| `frontend/src/config/colors/{palette,semantic,css-variables,index}.ts` | Legacy bridge; values from `design/tokens/color.ts` |
| `frontend/src/utils/classnames.ts` | `cn` learns the custom token classes |
| `frontend/src/utils/dateFormatters.ts` | `formatDatePillLabel` |
| `frontend/src/utils/clientLog.ts`, `backend/api/client_log.py` | New events + field keys |
| `frontend/tailwind.config.js` | Token utilities |
| `frontend/src/shell/main.tsx`, `frontend/src/shell/App.tsx` | Wiring |
| `docs/design/DESIGN_SYSTEM.md`, `CLAUDE.md` | Rules for humans and agents |

---

### Task 1: Freeze the legacy values and capture pixel baselines

Nothing in `src/` changes in this task. It records the "before" state that every later task is measured against.

**Files:**
- Create: `frontend/src/design/__fixtures__/legacy-theme-values.json`
- Create: `frontend/e2e/visual-zero-pixel.spec.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `legacy-theme-values.json` with shape
  `{ groups: Record<GroupId, { accent, canvas: [s,s,s], titleGradient: {from,via,to}, titleBar, titleText, ring, glow, bubbleBorder, badge }>, cssVars: Record<GroupId, Record<'--color-*', string>>, border: { light, base } }`.
  Tasks 2, 3 and 4 read it.

- [ ] **Step 1: Dump the current values into the fixture**

Run from `SakaDesk/frontend`:

```bash
T=$(mktemp -d)
cat > "$T/entry.ts" <<EOF
export { serviceThemes } from '$PWD/src/config/serviceThemes';
export { generateThemeCSSVariables, UI_TOKENS } from '$PWD/src/config/colors';
EOF
npx esbuild "$T/entry.ts" --bundle --format=esm --platform=node --outfile="$T/legacy.mjs" --log-level=error
cat > "$T/dump.mjs" <<'EOF'
import { writeFileSync, mkdirSync } from 'node:fs';
const { serviceThemes, generateThemeCSSVariables, UI_TOKENS } = await import(process.argv[2]);
const groups = {};
const cssVars = {};
for (const [id, t] of Object.entries(serviceThemes)) {
  groups[id] = {
    accent: t.primaryColor,
    canvas: t.messages.sidebarGradient,
    titleGradient: t.messages.headerGradient,
    titleBar: t.messages.headerBarGradient,
    titleText: t.messages.headerTextColor,
    ring: t.interaction.focusRing,
    glow: t.interaction.hoverGlow,
    bubbleBorder: t.messages.bubbleBorder,
    badge: t.messages.unreadBadge,
  };
  cssVars[id] = generateThemeCSSVariables(id);
}
mkdirSync('src/design/__fixtures__', { recursive: true });
writeFileSync(
  'src/design/__fixtures__/legacy-theme-values.json',
  JSON.stringify({ groups, cssVars, border: UI_TOKENS.border }, null, 2) + '\n',
  'utf-8',
);
EOF
node "$T/dump.mjs" "$T/legacy.mjs"
```

- [ ] **Step 2: Check the fixture**

Run: `node -e "const f=require('./src/design/__fixtures__/legacy-theme-values.json');console.log(Object.keys(f.groups), f.groups.hinatazaka.badge, f.groups.sakurazaka.bubbleBorder, f.cssVars.nogizaka['--color-primary'], f.border)"`

Expected: `[ 'hinatazaka', 'sakurazaka', 'nogizaka', 'yodel', 'default' ] #7cc7e8 #E85298 #7e1083 { light: '#e5e7eb', base: '#d1d5db' }`

- [ ] **Step 3: Write the zero-pixel Playwright spec**

Create `frontend/e2e/visual-zero-pixel.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// Pixel-regression guard for refactors that must not change the UI (D1 design-system
// foundation). Baselines are local-only (gitignored): capture them on the base commit
// with --update-snapshots, then run without it after the change.
test.describe('zero-pixel regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  test('home', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Test Member')).toBeVisible({ timeout: 10000 })
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot('home.png', { fullPage: true })
  })

  test('member chat', async ({ page }) => {
    await page.goto('/')
    await page.getByText('Test Member').click()
    await expect(page.getByText('Hello! This is a test message.')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot('chat-member.png', { fullPage: true })
  })

  test('group chat', async ({ page }) => {
    await page.goto('/')
    await page.getByText('Test Group Chat').click()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot('chat-group.png', { fullPage: true })
  })
})
```

- [ ] **Step 4: Ignore the local snapshots**

Append to `SakaDesk/.gitignore`:

```
# Local-only pixel baselines (e2e/visual-zero-pixel.spec.ts)
frontend/e2e/*.spec.ts-snapshots/
```

- [ ] **Step 5: Build the current frontend and capture the baselines**

Run from `SakaDesk/frontend`:

```bash
npm run build
npx playwright test e2e/visual-zero-pixel.spec.ts --update-snapshots --reporter=line
```

Expected: `3 passed`, and three PNGs under `e2e/visual-zero-pixel.spec.ts-snapshots/`. The backend test mode is started by `playwright.config.ts` (`webServer`).

Then run once more **without** `--update-snapshots`. Expected: `3 passed`. If this second run fails, the screens are not deterministic: add `mask: [locator]` for the unstable element, recapture, and note it in the PR. If the backend test server cannot start in this environment, **stop and report** — do not continue without baselines.

- [ ] **Step 6: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add .gitignore frontend/e2e/visual-zero-pixel.spec.ts frontend/src/design/__fixtures__/legacy-theme-values.json
uv run git commit -m "test(design): freeze legacy theme values and pixel baselines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Token modules

**Files:**
- Create: `frontend/src/design/tokens/color.ts`, `groups.ts`, `radius.ts`, `shadow.ts`, `type.ts`, `space.ts`, `motion.ts`, `index.ts`
- Test: `frontend/src/design/tokens/tokens.test.ts`

**Interfaces:**
- Consumes: `legacy-theme-values.json` (Task 1).
- Produces:
  - `type GroupId = 'hinatazaka' | 'sakurazaka' | 'nogizaka' | 'yodel' | 'default'`
  - `GROUP_IDS: readonly GroupId[]`
  - `interface GroupTokens { accent: string; canvas: readonly [string, string, string]; title: { gradient: { from: string; via: string; to: string }; bar: string; text: string }; ring: string; glow: string; bubbleBorder: string; badge: string }`
  - `groupTokens: Record<GroupId, GroupTokens>`
  - `color` = `{ surface: { sheet, card, pill, elevated, sunken }, text: { primary, secondary, muted, inverse }, border: { subtle, strong }, feedback: { success, warning, error } }`
  - `radius` = `{ none, card, sheet, pill }` (CSS lengths)
  - `shadow` = `{ none, pill, card, sheet }` (CSS box-shadow)
  - `typeScale` = `{ caption|small|body|title|heading: { size, leading } }`
  - `motion` = `{ duration: { fast: 150, base: 200 }, easing: { standard: [0.2, 0, 0, 1] } }`, `easingCss(e)`
  - `SPACE_UNIT_PX = 4`
  - Type aliases `RadiusStep`, `ShadowStep`, `TypeStep`, `DurationStep`

- [ ] **Step 1: Write the failing contract test**

Create `frontend/src/design/tokens/tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import legacy from '../__fixtures__/legacy-theme-values.json';
import {
    GROUP_IDS, groupTokens, color, radius, shadow, typeScale, motion, easingCss, SPACE_UNIT_PX,
} from './index';

describe('group tokens', () => {
    it('defines exactly the five groups', () => {
        expect([...GROUP_IDS].sort()).toEqual(Object.keys(legacy.groups).sort());
        expect(Object.keys(groupTokens).sort()).toEqual([...GROUP_IDS].sort());
    });

    it.each(GROUP_IDS)('%s equals the frozen pre-D1 values', (id) => {
        const t = groupTokens[id];
        const want = legacy.groups[id];
        expect(t.accent).toBe(want.accent);
        expect([...t.canvas]).toEqual(want.canvas);
        expect(t.title.gradient).toEqual(want.titleGradient);
        expect(t.title.bar).toBe(want.titleBar);
        expect(t.title.text).toBe(want.titleText);
        expect(t.ring).toBe(want.ring);
        expect(t.glow).toBe(want.glow);
        expect(t.bubbleBorder).toBe(want.bubbleBorder);
        expect(t.badge).toBe(want.badge);
    });

    it('keeps the Hinatazaka badge unchanged', () => {
        expect(groupTokens.hinatazaka.badge).toBe('#7cc7e8');
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

    it('match the pre-D1 border values', () => {
        expect(color.border.subtle).toBe(legacy.border.light);
        expect(color.border.strong).toBe(legacy.border.base);
    });

    it('use role names, never hue names (dark-mode ready)', () => {
        const names = Object.values(color).flatMap((group) => Object.keys(group));
        for (const n of names) expect(n).not.toMatch(/white|black|gray|grey|blue|pink|purple|green/i);
    });
});

describe('scales', () => {
    it('radius has the four agreed steps', () => {
        expect(radius).toEqual({ none: '0px', card: '14px', sheet: '20px', pill: '9999px' });
    });

    it('shadow has four layers', () => {
        expect(Object.keys(shadow)).toEqual(['none', 'pill', 'card', 'sheet']);
        expect(shadow.none).toBe('none');
    });

    it('type has the five agreed sizes', () => {
        expect(Object.fromEntries(Object.entries(typeScale).map(([k, v]) => [k, v.size]))).toEqual({
            caption: '11px', small: '13px', body: '14px', title: '16px', heading: '20px',
        });
    });

    it('motion stays within 150-200 ms', () => {
        expect(motion.duration).toEqual({ fast: 150, base: 200 });
        expect(easingCss(motion.easing.standard)).toBe('cubic-bezier(0.2, 0, 0, 1)');
    });

    it('spacing unit is 4 px', () => {
        expect(SPACE_UNIT_PX).toBe(4);
    });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/design/tokens/tokens.test.ts`
Expected: FAIL — `Failed to resolve import "./index"`.

- [ ] **Step 3: Write the token modules**

`frontend/src/design/tokens/color.ts`:

```ts
/**
 * Neutral colour tokens, named by role (never by hue) so a dark set can be
 * added later as a second value map. Values are copied verbatim from the
 * pre-D1 palette; `legacy-theme-values.json` pins them.
 */
export const color = {
    surface: {
        /** Level 1 sheet (content area). */
        sheet: '#FFFFFF',
        /** Level 2 card (photos, info cards, bubbles). */
        card: '#FFFFFF',
        /** Level 3 pill (tabs, filters, dates). */
        pill: '#FFFFFF',
        /** Slightly raised neutral, e.g. hover backgrounds. */
        elevated: '#FAFAFA',
        /** Recessed neutral, e.g. avatar placeholder, selected pill. */
        sunken: '#F3F4F6',
    },
    text: {
        primary: '#1f2937',
        secondary: '#4b5563',
        muted: '#9ca3af',
        inverse: '#FFFFFF',
    },
    border: {
        subtle: '#e5e7eb',
        strong: '#d1d5db',
    },
    feedback: {
        success: '#10B981',
        warning: '#F59E0B',
        error: '#EF4444',
    },
} as const;
```

`frontend/src/design/tokens/groups.ts`:

```ts
/**
 * Per-group colour tokens — the ONLY place group colours are defined.
 *
 * Group colour may appear in four places only: title gradient, selection
 * ring/glow, bubble border and badge (plus at most one `primary` button per
 * screen, which uses `accent`). `canvas` is the level-0 background gradient.
 *
 * Values are copied verbatim from the pre-D1 `serviceThemes.ts`;
 * `legacy-theme-values.json` pins them.
 */
export type GroupId = 'hinatazaka' | 'sakurazaka' | 'nogizaka' | 'yodel' | 'default';

export const GROUP_IDS: readonly GroupId[] = ['hinatazaka', 'sakurazaka', 'nogizaka', 'yodel', 'default'];

export interface GroupTokens {
    /** Brand colour; also the one-per-screen primary button. */
    accent: string;
    /** Level-0 background gradient stops, top to bottom. */
    canvas: readonly [string, string, string];
    title: {
        /** Chat/blog title gradient. */
        gradient: { from: string; via: string; to: string };
        /** Thin gradient bar under the title. */
        bar: string;
        /** Title text colour on light headers. */
        text: string;
    };
    /** Keyboard focus ring. */
    ring: string;
    /** Selection glow around the white selection ring. */
    glow: string;
    /** Message bubble border. */
    bubbleBorder: string;
    /** Unread badge background. */
    badge: string;
}

export const groupTokens: Record<GroupId, GroupTokens> = {
    hinatazaka: {
        accent: '#7cc7e8',
        canvas: ['#c8d8ec', '#dde6f0', '#f0f4f8'],
        title: {
            gradient: { from: '#a8c4e8', via: '#a0a9d8', to: '#9181c4' },
            bar: 'linear-gradient(to right, #a8c4e8, #9181c4)',
            text: '#5d95ae',
        },
        ring: '#7cc7e8',
        glow: 'rgba(124, 199, 232, 0.35)',
        bubbleBorder: '#7cc7e8',
        badge: '#7cc7e8',
    },
    sakurazaka: {
        accent: '#f7a6c9',
        canvas: ['#fce7f3', '#fdf2f8', '#fff5f7'],
        title: {
            gradient: { from: '#fffdfe', via: '#d8b0c8', to: '#9b56a1' },
            bar: 'linear-gradient(to right, #ffffff 0%, #ffffff 5%, #fff6f7 10%, #eec8d2 25%, #e39eb1 50%, #bf78a0 75%, #95569c 100%)',
            text: '#d892aa',
        },
        ring: '#f7a6c9',
        glow: 'rgba(247, 166, 201, 0.35)',
        bubbleBorder: '#E85298',
        badge: '#E85298',
    },
    nogizaka: {
        accent: '#7e1083',
        canvas: ['#ede4f2', '#f3eef6', '#f8f5fa'],
        title: {
            gradient: { from: '#d8c8e8', via: '#c4a8d8', to: '#9B59B6' },
            bar: 'linear-gradient(to right, #9B59B6, #7e1083)',
            text: '#7e1083',
        },
        ring: '#9B59B6',
        glow: 'rgba(126, 16, 131, 0.28)',
        bubbleBorder: '#9B59B6',
        badge: '#9B59B6',
    },
    yodel: {
        accent: '#5a8a6a',
        canvas: ['#d4ebe0', '#e5f2eb', '#f0f8f4'],
        title: {
            gradient: { from: '#b8d8c8', via: '#8ab89a', to: '#5a8a6a' },
            bar: 'linear-gradient(to right, #b8d8c8, #5a8a6a)',
            text: '#4a7a5a',
        },
        ring: '#5a8a6a',
        glow: 'rgba(90, 138, 106, 0.3)',
        bubbleBorder: '#5a8a6a',
        badge: '#5a8a6a',
    },
    default: {
        accent: '#6B7280',
        canvas: ['#e5e7eb', '#f3f4f6', '#f9fafb'],
        title: {
            gradient: { from: '#a8c4e8', via: '#a0a9d8', to: '#9181c4' },
            bar: 'linear-gradient(to right, #a8c4e8, #9181c4)',
            text: '#4B5563',
        },
        ring: '#6B7280',
        glow: 'rgba(107, 114, 128, 0.25)',
        bubbleBorder: '#E5E7EB',
        badge: '#6B7280',
    },
};
```

`frontend/src/design/tokens/radius.ts`:

```ts
/** Corner radius, one step per visual level (background has none). */
export const radius = {
    none: '0px',
    card: '14px',
    sheet: '20px',
    pill: '9999px',
} as const;

export type RadiusStep = keyof typeof radius;
```

`frontend/src/design/tokens/shadow.ts`:

```ts
/** Elevation, one layer per visual level. */
export const shadow = {
    none: 'none',
    /** Level 3: tabs, filters, dates, badges. */
    pill: '0 1px 2px rgba(15, 23, 42, 0.06)',
    /** Level 2: cards, bubbles, photos. */
    card: '0 2px 8px rgba(15, 23, 42, 0.08)',
    /** Level 1: the content sheet and modals. */
    sheet: '0 12px 40px rgba(15, 23, 42, 0.12)',
} as const;

export type ShadowStep = keyof typeof shadow;
```

`frontend/src/design/tokens/type.ts`:

```ts
/** The five text sizes (font-size / line-height). */
export const typeScale = {
    caption: { size: '11px', leading: '16px' },
    small: { size: '13px', leading: '20px' },
    body: { size: '14px', leading: '22px' },
    title: { size: '16px', leading: '24px' },
    heading: { size: '20px', leading: '28px' },
} as const;

export type TypeStep = keyof typeof typeScale;
```

`frontend/src/design/tokens/space.ts`:

```ts
/**
 * Spacing uses Tailwind's default scale, where 1 step = 4 px (`p-1` = 4 px,
 * `gap-3` = 12 px). Arbitrary spacing values such as `p-[13px]` are forbidden
 * and caught by `design/guard.test.ts`.
 */
export const SPACE_UNIT_PX = 4;
```

`frontend/src/design/tokens/motion.ts`:

```ts
/** Motion: every animation is 150-200 ms with one easing curve. */
export const motion = {
    /** Milliseconds. framer-motion wants seconds: `motion.duration.base / 1000`. */
    duration: { fast: 150, base: 200 },
    /** Cubic-bezier control points; pass directly to framer-motion `ease`. */
    easing: { standard: [0.2, 0, 0, 1] },
} as const;

export type DurationStep = keyof typeof motion.duration;

export function easingCss(points: readonly [number, number, number, number]): string {
    return `cubic-bezier(${points.join(', ')})`;
}
```

`frontend/src/design/tokens/index.ts`:

```ts
export { color } from './color';
export { GROUP_IDS, groupTokens, type GroupId, type GroupTokens } from './groups';
export { radius, type RadiusStep } from './radius';
export { shadow, type ShadowStep } from './shadow';
export { typeScale, type TypeStep } from './type';
export { SPACE_UNIT_PX } from './space';
export { motion, easingCss, type DurationStep } from './motion';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/design/tokens/tokens.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src/design/tokens
uv run git commit -m "feat(design): add design tokens as the single source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Make the legacy theme read the tokens

**Files:**
- Modify: `frontend/src/config/serviceThemes.ts` (line 4 `GroupId`; 9 brand fields in each of the 5 group blocks)
- Modify: `frontend/src/config/colors/palette.ts`, `frontend/src/config/colors/semantic.ts`
- Test: `frontend/src/config/colors/legacyEquality.test.ts`

**Interfaces:**
- Consumes: `groupTokens`, `GroupId`, `color` (Task 2); `legacy-theme-values.json` (Task 1).
- Produces: unchanged public API of `serviceThemes.ts` and `config/colors` (`GroupId` is still exported from both). `NEUTRAL_COLORS` shrinks to `{ surface: { base, elevated, sunken }, text, border: { light, base } }`; `UI_TOKENS` loses `dark`.

- [ ] **Step 1: Write the failing equality test**

Create `frontend/src/config/colors/legacyEquality.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import legacy from '../../design/__fixtures__/legacy-theme-values.json';
import { GROUP_IDS, groupTokens } from '../../design/tokens';
import { serviceThemes } from '../serviceThemes';
import { generateThemeCSSVariables, UI_TOKENS } from './index';

describe('legacy theme reads the tokens without changing values', () => {
    it.each(GROUP_IDS)('%s CSS variables are byte-identical to pre-D1', (id) => {
        expect(generateThemeCSSVariables(id)).toEqual(legacy.cssVars[id]);
    });

    it.each(GROUP_IDS)('%s serviceThemes brand fields are byte-identical to pre-D1', (id) => {
        const t = serviceThemes[id];
        const want = legacy.groups[id];
        expect(t.primaryColor).toBe(want.accent);
        expect(t.messages.sidebarGradient).toEqual(want.canvas);
        expect(t.messages.headerGradient).toEqual(want.titleGradient);
        expect(t.messages.headerBarGradient).toBe(want.titleBar);
        expect(t.messages.headerTextColor).toBe(want.titleText);
        expect(t.interaction.focusRing).toBe(want.ring);
        expect(t.interaction.hoverGlow).toBe(want.glow);
        expect(t.messages.bubbleBorder).toBe(want.bubbleBorder);
        expect(t.messages.unreadBadge).toBe(want.badge);
    });

    it.each(GROUP_IDS)('%s serviceThemes brand fields come from groupTokens', (id) => {
        expect(serviceThemes[id].primaryColor).toBe(groupTokens[id].accent);
        expect(serviceThemes[id].messages.unreadBadge).toBe(groupTokens[id].badge);
    });

    it('border tokens are unchanged', () => {
        expect(UI_TOKENS.border).toEqual(legacy.border);
    });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/config/colors/legacyEquality.test.ts`
Expected: the two "byte-identical" groups and the border test PASS already (nothing changed yet). The "come from groupTokens" test PASSES by value too. That is fine: this test is a **safety net** for the refactor in Step 3. Note the passing count so you can compare after Step 4.

- [ ] **Step 3: Point the legacy files at the tokens**

1. In `frontend/src/config/serviceThemes.ts`, replace line 4

```ts
export type GroupId = 'hinatazaka' | 'sakurazaka' | 'nogizaka' | 'yodel' | 'default';
```

with

```ts
import { groupTokens, type GroupId } from '../design/tokens/groups';

export type { GroupId };
```

2. Rewrite the 9 brand fields in each group block. Run from `SakaDesk/frontend`:

```bash
python3 - <<'EOF'
import re
from pathlib import Path

p = Path("src/config/serviceThemes.ts")
s = p.read_text(encoding="utf-8")
groups = ["hinatazaka", "sakurazaka", "nogizaka", "yodel", "default"]
starts = [s.index(f"\n    {g}: {{\n") for g in groups]
ends = starts[1:] + [s.index("\n};\n", starts[-1])]
rules = [
    (r"primaryColor: '[^']*',", "primaryColor: groupTokens.{g}.accent,"),
    (r"hoverGlow: '[^']*',", "hoverGlow: groupTokens.{g}.glow,"),
    (r"focusRing: '[^']*',", "focusRing: groupTokens.{g}.ring,"),
    (r"headerGradient: \{[^}]*\},", "headerGradient: {{ ...groupTokens.{g}.title.gradient }},"),
    (r"headerTextColor: '[^']*',", "headerTextColor: groupTokens.{g}.title.text,"),
    (r"headerBarGradient: '[^']*',", "headerBarGradient: groupTokens.{g}.title.bar,"),
    (r"bubbleBorder: '[^']*',", "bubbleBorder: groupTokens.{g}.bubbleBorder,"),
    (r"unreadBadge: '[^']*',", "unreadBadge: groupTokens.{g}.badge,"),
    (r"sidebarGradient: \[[^\]]*\],", "sidebarGradient: [...groupTokens.{g}.canvas],"),
]
out, cursor = [], 0
for g, a, b in zip(groups, starts, ends):
    out.append(s[cursor:a])
    block = s[a:b]
    for pat, rep in rules:
        block, n = re.subn(pat, rep.format(g=g), block)
        assert n == 1, (g, pat, n)
    out.append(block)
    cursor = b
out.append(s[cursor:])
p.write_text("".join(out), encoding="utf-8")
print("rewrote 45 fields")
EOF
```

Expected output: `rewrote 45 fields`. Then check that `git diff --stat src/config/serviceThemes.ts` shows only these lines plus the import, and that trailing `// …` comments survived.

3. Replace `frontend/src/config/colors/palette.ts` with:

```ts
/**
 * Legacy neutral palette (pre-D1 API).
 *
 * Values now come from `design/tokens/color.ts`, the single source. New code
 * imports `design/tokens` directly; D2 deletes this file with its last caller.
 */
import { color } from '../../design/tokens/color';

export type { GroupId } from '../serviceThemes';

export const NEUTRAL_COLORS = {
    surface: {
        base: color.surface.sheet,
        elevated: color.surface.elevated,
        sunken: color.surface.sunken,
    },
    text: color.text,
    border: {
        light: color.border.subtle,
        base: color.border.strong,
    },
} as const;

export const FEEDBACK_COLORS = color.feedback;
```

4. In `frontend/src/config/colors/semantic.ts`, replace the `UI_TOKENS` object (from `export const UI_TOKENS = {` to its closing `} as const;`) with:

```ts
export const UI_TOKENS = {
    /** Surface colors for different elevation levels */
    surface: NEUTRAL_COLORS.surface,
    /** Text colors by importance */
    text: NEUTRAL_COLORS.text,
    /** Border colors */
    border: NEUTRAL_COLORS.border,
    /** Feedback states */
    feedback: FEEDBACK_COLORS,
} as const;
```

5. Confirm nothing used the removed entries:

Run: `grep -rn "NEUTRAL_COLORS\.\(dark\|surface\.\(white\|offWhite\|gray\)\)\|UI_TOKENS\.dark" src`
Expected: no output.

- [ ] **Step 4: Run the theme tests, the type check and the full suite**

Run: `npx vitest run src/config src/design && npx tsc --noEmit && npx vitest run`
Expected: all PASS, `tsc` prints nothing, the same passing count as in Step 2 for `legacyEquality.test.ts`.

- [ ] **Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src/config
uv run git commit -m "refactor(design): read legacy theme values from tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Write tokens to CSS variables, wire the app, log the decisions

**Files:**
- Create: `frontend/src/design/cssVars.ts`, `frontend/src/design/applyTokens.ts`
- Test: `frontend/src/design/applyTokens.test.ts`, `frontend/src/config/colors/serviceIdToGroupId.test.ts`
- Modify: `frontend/src/config/colors/css-variables.ts` (remove `applyThemeToDocument`, `clearThemeFromDocument`; log in `serviceIdToGroupId`)
- Modify: `frontend/src/config/colors/index.ts`
- Modify: `frontend/src/shell/main.tsx`, `frontend/src/shell/App.tsx:10,46-52`
- Modify: `frontend/src/utils/clientLog.ts`
- Modify: `backend/api/client_log.py`
- Test: `backend/tests/test_client_log_api.py`

**Interfaces:**
- Consumes: tokens (Task 2), `generateThemeCSSVariables(groupId)` (legacy).
- Produces:
  - `staticTokenVars(): Record<string, string>` — keys are `--ds-surface-{sheet,card,pill,elevated,sunken}`, `--ds-text-{primary,secondary,muted,inverse}`, `--ds-border-{subtle,strong}`, `--ds-feedback-{success,warning,error}`, `--ds-radius-{none,card,sheet,pill}`, `--ds-shadow-{none,pill,card,sheet}`, `--ds-font-{step}-size`, `--ds-font-{step}-leading`, `--ds-duration-{fast,base}`, `--ds-ease-standard`.
  - `groupTokenVars(groupId: GroupId): Record<string, string>` — keys are `--ds-group-accent`, `--ds-group-canvas`, `--ds-group-title-from`, `--ds-group-title-via`, `--ds-group-title-to`, `--ds-group-title-bar`, `--ds-group-title-text`, `--ds-group-ring`, `--ds-group-glow`, `--ds-group-bubble-border`, `--ds-group-badge`.
  - `applyStaticTokens(root?: HTMLElement): void`
  - `applyGroupTokens(groupId: GroupId, root?: HTMLElement): void`
  - New `ClientLogEvent`s: `'design_tokens_applied' | 'design_tokens_fallback' | 'avatar_fallback'`; new `ClientLogFieldKey`s: `'theme' | 'size'`.

- [ ] **Step 1: Write the failing frontend tests**

Create `frontend/src/design/applyTokens.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));

import { clientLog } from '../utils/clientLog';
import legacy from './__fixtures__/legacy-theme-values.json';
import { GROUP_IDS, groupTokens } from './tokens';
import { staticTokenVars, groupTokenVars } from './cssVars';
import { applyStaticTokens, applyGroupTokens } from './applyTokens';

const style = () => document.documentElement.style;

describe('cssVars', () => {
    it('maps every static token to a --ds- variable', () => {
        const vars = staticTokenVars();
        expect(vars['--ds-surface-sheet']).toBe('#FFFFFF');
        expect(vars['--ds-radius-sheet']).toBe('20px');
        expect(vars['--ds-font-body-size']).toBe('14px');
        expect(vars['--ds-font-body-leading']).toBe('22px');
        expect(vars['--ds-duration-base']).toBe('200ms');
        expect(vars['--ds-ease-standard']).toBe('cubic-bezier(0.2, 0, 0, 1)');
        expect(Object.keys(vars).every((k) => k.startsWith('--ds-'))).toBe(true);
        expect(Object.keys(vars)).toHaveLength(5 + 4 + 2 + 3 + 4 + 4 + 10 + 2 + 1);
    });

    it.each(GROUP_IDS)('maps every %s group token', (id) => {
        const vars = groupTokenVars(id);
        const t = groupTokens[id];
        expect(vars['--ds-group-canvas']).toBe(
            `linear-gradient(to bottom, ${t.canvas[0]}, ${t.canvas[1]}, ${t.canvas[2]})`,
        );
        expect(vars['--ds-group-badge']).toBe(t.badge);
        expect(vars['--ds-group-bubble-border']).toBe(t.bubbleBorder);
        expect(Object.keys(vars)).toHaveLength(11);
    });
});

describe('applyStaticTokens', () => {
    it('writes every static variable on :root', () => {
        applyStaticTokens();
        for (const [name, value] of Object.entries(staticTokenVars())) {
            expect(style().getPropertyValue(name)).toBe(value);
        }
    });
});

describe('applyGroupTokens', () => {
    beforeEach(() => vi.mocked(clientLog).mockClear());

    it.each(GROUP_IDS)('writes %s group and legacy variables and logs', (id) => {
        applyGroupTokens(id);
        for (const [name, value] of Object.entries(groupTokenVars(id))) {
            expect(style().getPropertyValue(name)).toBe(value);
        }
        for (const [name, value] of Object.entries(legacy.cssVars[id])) {
            expect(style().getPropertyValue(name)).toBe(value);
        }
        expect(clientLog).toHaveBeenCalledWith('design_tokens_applied', { theme: id });
    });
});
```

Create `frontend/src/config/colors/serviceIdToGroupId.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

import { clientLog } from '../../utils/clientLog';
import { serviceIdToGroupId } from './css-variables';

describe('serviceIdToGroupId', () => {
    beforeEach(() => vi.mocked(clientLog).mockClear());

    it.each([
        ['hinatazaka46', 'hinatazaka'],
        ['sakurazaka46', 'sakurazaka'],
        ['nogizaka46', 'nogizaka'],
        ['yodel', 'yodel'],
    ])('maps %s to %s without logging', (service, group) => {
        expect(serviceIdToGroupId(service)).toBe(group);
        expect(clientLog).not.toHaveBeenCalled();
    });

    it('falls back to hinatazaka for an unknown service and logs without the raw id', () => {
        expect(serviceIdToGroupId('未知の service 🌸')).toBe('hinatazaka');
        expect(clientLog).toHaveBeenCalledWith('design_tokens_fallback', { reason: 'unknown_service' });
    });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/design/applyTokens.test.ts src/config/colors/serviceIdToGroupId.test.ts`
Expected: FAIL — `./cssVars` cannot be resolved; the fallback test fails because nothing is logged.

- [ ] **Step 3: Implement the variable maps and apply functions**

Create `frontend/src/design/cssVars.ts`:

```ts
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
```

Create `frontend/src/design/applyTokens.ts`:

```ts
/**
 * Writes design tokens to the document as CSS custom properties.
 *
 * - applyStaticTokens(): group-independent --ds-* variables. main.tsx calls it
 *   once, synchronously, before the first render of every entry point.
 * - applyGroupTokens(): --ds-group-* variables plus the legacy --color-*
 *   variables (identical values) so pre-D1 Tailwind classes keep working.
 *   App.tsx calls it whenever the active service changes.
 */
import { generateThemeCSSVariables } from '../config/colors/css-variables';
import { clientLog } from '../utils/clientLog';
import { groupTokenVars, staticTokenVars } from './cssVars';
import type { GroupId } from './tokens';

function write(root: HTMLElement, vars: Record<string, string>): void {
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}

export function applyStaticTokens(root: HTMLElement = document.documentElement): void {
    write(root, staticTokenVars());
}

export function applyGroupTokens(groupId: GroupId, root: HTMLElement = document.documentElement): void {
    write(root, groupTokenVars(groupId));
    write(root, generateThemeCSSVariables(groupId));
    clientLog('design_tokens_applied', { theme: groupId });
}
```

- [ ] **Step 4: Update `css-variables.ts` and its index**

In `frontend/src/config/colors/css-variables.ts`:

1. Add `import { clientLog } from '../../utils/clientLog';` below the existing imports.
2. Replace `serviceIdToGroupId` with:

```ts
/**
 * Convert a service ID to a GroupId.
 * Unknown IDs fall back to 'hinatazaka' (pre-D1 behaviour, kept so nothing
 * shifts) and leave a breadcrumb; the raw ID is client text and is not logged.
 */
export function serviceIdToGroupId(serviceId: string): GroupId {
    const groupId = SERVICE_TO_GROUP[serviceId];
    if (groupId) return groupId;
    clientLog('design_tokens_fallback', { reason: 'unknown_service' });
    return 'hinatazaka';
}
```

3. Delete the functions `applyThemeToDocument` and `clearThemeFromDocument` with their doc comments (App.tsx was the only caller; `grep -rn "applyThemeToDocument\|clearThemeFromDocument" src` must print nothing after Step 5).

In `frontend/src/config/colors/index.ts`, replace the CSS-variable export block with:

```ts
// CSS variable utilities (legacy; design/applyTokens.ts writes them now)
export {
    CSS_VAR_NAMES,
    generateThemeCSSVariables,
    serviceIdToGroupId,
    isGroupId,
} from './css-variables';
```

- [ ] **Step 5: Wire `main.tsx` and `App.tsx`**

In `frontend/src/shell/main.tsx`, after `import { isCallPopupView } from './callPopupRoute'` add:

```tsx
import { applyStaticTokens } from '../design/applyTokens'

// Design tokens must exist before the first paint of any entry point.
applyStaticTokens()
```

In `frontend/src/shell/App.tsx`:
- Replace line 10 `import { applyThemeToDocument, serviceIdToGroupId } from '../config/colors'` with

```tsx
import { serviceIdToGroupId } from '../config/colors'
import { applyGroupTokens } from '../design/applyTokens'
```

- Replace the effect body's `applyThemeToDocument(groupId);` with `applyGroupTokens(groupId);` and update its comment to `// Apply group design tokens (and legacy theme variables) when activeService changes`.

- [ ] **Step 6: Add the events to the frontend whitelist**

In `frontend/src/utils/clientLog.ts`, extend the unions:

```ts
export type ClientLogEvent =
    | 'call_ring' | 'call_skip' | 'call_answer' | 'call_decline'
    | 'call_timeout' | 'call_end' | 'call_cancel' | 'call_error'
    | 'notify_open_chat' | 'backend_sync_followed' | 'backend_sync_skipped'
    | 'call_popup_start' | 'call_popup_error'
    | 'call_popup_heard_applied' | 'call_popup_heard_ignored'
    | 'app_load_failed'
    | 'design_tokens_applied' | 'design_tokens_fallback' | 'avatar_fallback';

export type ClientLogFieldKey =
    | 'service' | 'group_id' | 'member_id' | 'message_id' | 'reason'
    | 'phase' | 'ring_ms' | 'talk_ms' | 'error_type'
    | 'surface' | 'call_id' | 'changed' | 'has_target'
    | 'theme' | 'size';
```

- [ ] **Step 7: Run the frontend tests**

Run: `npx vitest run src/design src/config src/shell && npx tsc --noEmit`
Expected: PASS; `tsc` silent. If any shell test mocked `../config/colors` with `applyThemeToDocument`, change the mock to the new imports.

- [ ] **Step 8: Write the failing backend test**

Append to `backend/tests/test_client_log_api.py`:

```python
@pytest.mark.parametrize(
    ("event", "fields", "level"),
    [
        ("design_tokens_applied", {"theme": "sakurazaka"}, "info"),
        ("design_tokens_fallback", {"reason": "unknown_service"}, "warning"),
        ("avatar_fallback", {"size": "md"}, "info"),
    ],
)
def test_design_system_events_are_accepted(event, fields, level):
    with capture_logs() as logs:
        res = client.post("/api/client-log", json={"event": event, "fields": fields})
    assert res.status_code == 204
    entry = _client_events(logs)[0]
    assert entry["event"] == event
    assert entry["log_level"] == level
    for key, value in fields.items():
        assert entry[key] == value
```

Run: `cd /home/xtorker/repos/Project-Saka/SakaDesk && uv run pytest backend/tests/test_client_log_api.py -q`
Expected: the three new cases FAIL with `422`.

- [ ] **Step 9: Extend the backend whitelist**

In `backend/api/client_log.py`:
- Add `"design_tokens_applied"`, `"design_tokens_fallback"`, `"avatar_fallback"` to the `ClientEvent` `Literal` (after `"backend_sync_skipped"`).
- Add `"theme"` and `"size"` to `ALLOWED_FIELDS`.
- Change `WARNING_EVENTS` to `frozenset({"call_error", "app_load_failed", "design_tokens_fallback"})`.

Run: `uv run pytest backend/tests/test_client_log_api.py -q && uv run ruff check backend && uv run mypy backend/`
Expected: all PASS / clean.

- [ ] **Step 10: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src/design frontend/src/config frontend/src/shell frontend/src/utils/clientLog.ts backend/api/client_log.py backend/tests/test_client_log_api.py
uv run git commit -m "feat(design): write tokens to CSS variables with breadcrumbs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Tailwind utilities and `cn` support

**Files:**
- Modify: `frontend/tailwind.config.js`
- Modify: `frontend/src/utils/classnames.ts`
- Test: `frontend/src/utils/classnames.test.ts`, `frontend/src/design/tailwindTokens.test.ts`

**Interfaces:**
- Consumes: CSS variable names from Task 4.
- Produces Tailwind classes used by every later task:
  - backgrounds `bg-sheet`, `bg-card`, `bg-pill`, `bg-elevated`, `bg-sunken`, `bg-group-accent`, `bg-group-badge`, `bg-group-canvas`, `bg-group-title-bar`
  - text colours `text-primary`, `text-secondary`, `text-muted`, `text-inverse`
  - text sizes `text-caption`, `text-small`, `text-body`, `text-title`, `text-heading`
  - borders `border-subtle`, `border-strong`, `border-group-bubble`; ring `ring-group`
  - radius `rounded-card`, `rounded-sheet`, `rounded-pill`; shadow `shadow-pill`, `shadow-card`, `shadow-sheet`, `shadow-group-glow`
  - motion `duration-fast`, `duration-base`, `ease-standard`
  - `cn()` merges these correctly (a size and a colour never cancel each other).

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/utils/classnames.test.ts` (keep the existing imports; add `cn` to them if missing):

```ts
describe('cn with design-system classes', () => {
    it('keeps a token text size and a token text colour together', () => {
        expect(cn('text-body', 'text-primary')).toBe('text-body text-primary');
    });
    it('lets a later token text size win', () => {
        expect(cn('text-body', 'text-title')).toBe('text-title');
    });
    it('lets a later token text colour win', () => {
        expect(cn('text-primary', 'text-muted')).toBe('text-muted');
    });
    it('merges token radius and shadow steps', () => {
        expect(cn('rounded-card', 'rounded-sheet')).toBe('rounded-sheet');
        expect(cn('shadow-card', 'shadow-sheet')).toBe('shadow-sheet');
    });
    it('merges token durations', () => {
        expect(cn('duration-fast', 'duration-base')).toBe('duration-base');
    });
});
```

Create `frontend/src/design/tailwindTokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GROUP_IDS } from './tokens';
import { staticTokenVars, groupTokenVars } from './cssVars';

const config = readFileSync(fileURLToPath(new URL('../../tailwind.config.js', import.meta.url)), 'utf-8');

describe('tailwind.config.js token utilities', () => {
    it('only references --ds- variables that applyTokens writes', () => {
        const written = new Set([...Object.keys(staticTokenVars()), ...Object.keys(groupTokenVars(GROUP_IDS[0]))]);
        const referenced = [...config.matchAll(/var\((--ds-[a-z0-9-]+)\)/g)].map((m) => m[1]);
        expect(referenced.length).toBeGreaterThan(30);
        expect(referenced.filter((name) => !written.has(name))).toEqual([]);
    });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/utils/classnames.test.ts src/design/tailwindTokens.test.ts`
Expected: FAIL — `cn('text-body', 'text-primary')` returns `'text-primary'`; `referenced.length` is 0.

- [ ] **Step 3: Add the utilities**

Replace `frontend/tailwind.config.js` with:

```js
/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Noto Sans JP"', 'system-ui', '-apple-system', 'sans-serif'],
            },
            colors: {
                // Theme-aware colors (change when service switches)
                'theme-primary': 'var(--color-primary)',
                'theme-secondary': 'var(--color-secondary)',
                'theme-accent': 'var(--color-accent)',
                // Surfaces
                'surface-base': 'var(--color-surface-base)',
                'surface-elevated': 'var(--color-surface-elevated)',
                'surface-sunken': 'var(--color-surface-sunken)',
                // Text
                'text-primary': 'var(--color-text-primary)',
                'text-secondary': 'var(--color-text-secondary)',
                'text-muted': 'var(--color-text-muted)',
                'text-inverse': 'var(--color-text-inverse)',
                // Feedback
                'feedback-success': 'var(--color-success)',
                'feedback-warning': 'var(--color-warning)',
                'feedback-error': 'var(--color-error)',
                // Legacy (keep for backwards compatibility)
                'brand-purple-start': '#9181c4',
                'brand-purple-end': '#a8c4e8',
                'brand-blue': '#6da0d4',
            },
            backgroundImage: {
                // Theme-aware gradients
                'theme-gradient': 'linear-gradient(to right, var(--color-gradient-from), var(--color-gradient-to))',
                'theme-gradient-vertical': 'linear-gradient(to bottom, var(--color-gradient-from), var(--color-gradient-to))',
                // Design system (docs/design/DESIGN_SYSTEM.md)
                'group-canvas': 'var(--ds-group-canvas)',
                'group-title-bar': 'var(--ds-group-title-bar)',
            },
            // ---- Design system tokens (frontend/src/design/tokens) ----
            // Values are CSS variables written by design/applyTokens.ts.
            // Opacity modifiers (bg-sheet/50) do not work with these; add a token instead.
            backgroundColor: {
                sheet: 'var(--ds-surface-sheet)',
                card: 'var(--ds-surface-card)',
                pill: 'var(--ds-surface-pill)',
                elevated: 'var(--ds-surface-elevated)',
                sunken: 'var(--ds-surface-sunken)',
                'group-accent': 'var(--ds-group-accent)',
                'group-badge': 'var(--ds-group-badge)',
            },
            textColor: {
                primary: 'var(--ds-text-primary)',
                secondary: 'var(--ds-text-secondary)',
                muted: 'var(--ds-text-muted)',
                inverse: 'var(--ds-text-inverse)',
                'group-title': 'var(--ds-group-title-text)',
            },
            borderColor: {
                subtle: 'var(--ds-border-subtle)',
                strong: 'var(--ds-border-strong)',
                'group-bubble': 'var(--ds-group-bubble-border)',
            },
            ringColor: {
                group: 'var(--ds-group-ring)',
            },
            borderRadius: {
                card: 'var(--ds-radius-card)',
                sheet: 'var(--ds-radius-sheet)',
                pill: 'var(--ds-radius-pill)',
            },
            boxShadow: {
                pill: 'var(--ds-shadow-pill)',
                card: 'var(--ds-shadow-card)',
                sheet: 'var(--ds-shadow-sheet)',
                'group-glow': '0 0 12px 2px var(--ds-group-glow)',
            },
            fontSize: {
                caption: ['var(--ds-font-caption-size)', { lineHeight: 'var(--ds-font-caption-leading)' }],
                small: ['var(--ds-font-small-size)', { lineHeight: 'var(--ds-font-small-leading)' }],
                body: ['var(--ds-font-body-size)', { lineHeight: 'var(--ds-font-body-leading)' }],
                title: ['var(--ds-font-title-size)', { lineHeight: 'var(--ds-font-title-leading)' }],
                heading: ['var(--ds-font-heading-size)', { lineHeight: 'var(--ds-font-heading-leading)' }],
            },
            transitionDuration: {
                fast: 'var(--ds-duration-fast)',
                base: 'var(--ds-duration-base)',
            },
            transitionTimingFunction: {
                standard: 'var(--ds-ease-standard)',
            },
        },
    },
    plugins: [],
}
```

Replace the first five lines of `frontend/src/utils/classnames.ts` (the imports and `cn`) with:

```ts
import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Teach tailwind-merge the design-system classes (tailwind.config.js) so a token
// text size and a token text colour are not treated as conflicting `text-*` classes.
const twMerge = extendTailwindMerge({
    extend: {
        classGroups: {
            'font-size': [{ text: ['caption', 'small', 'body', 'title', 'heading'] }],
            'text-color': [{ text: ['primary', 'secondary', 'muted', 'inverse', 'group-title'] }],
            rounded: [{ rounded: ['card', 'sheet', 'pill'] }],
            shadow: [{ shadow: ['pill', 'card', 'sheet', 'group-glow'] }],
            duration: [{ duration: ['fast', 'base'] }],
            ease: [{ ease: ['standard'] }],
        },
    },
})

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}
```

- [ ] **Step 4: Run the tests and the full suite**

Run: `npx vitest run src/utils/classnames.test.ts src/design/tailwindTokens.test.ts && npx vitest run && npx tsc --noEmit`
Expected: PASS. The full suite must still pass: existing `cn` calls only use standard Tailwind classes, which merge as before.

- [ ] **Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/tailwind.config.js frontend/src/utils/classnames.ts frontend/src/utils/classnames.test.ts frontend/src/design/tailwindTokens.test.ts
uv run git commit -m "feat(design): add token Tailwind utilities and cn support

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Date-pill label and shared i18n keys

**Files:**
- Modify: `frontend/src/utils/dateFormatters.ts`
- Test: `frontend/src/utils/dateFormatters.test.ts`
- Modify: `frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json`
- Test: `frontend/src/i18n/designSystem.test.ts`

**Interfaces:**
- Produces:
  - `type DatePillKey = 'date.today' | 'date.yesterday'`
  - `formatDatePillLabel(date: Date, now: Date, locale: string, t: (key: DatePillKey) => string): string`
  - i18n keys `date.today`, `date.yesterday`, `common.unreadCount` (`{{count}}` interpolation)

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/utils/dateFormatters.test.ts` (add `formatDatePillLabel` to its import from `./dateFormatters`):

```ts
describe('formatDatePillLabel', () => {
    const t = (key: 'date.today' | 'date.yesterday') => (key === 'date.today' ? 'TODAY' : 'YESTERDAY');
    const now = new Date(2026, 10, 4, 12, 0); // Wed 4 Nov 2026, local time

    it('says today for any time on the same local day', () => {
        expect(formatDatePillLabel(new Date(2026, 10, 4, 0, 5), now, 'ja', t)).toBe('TODAY');
        expect(formatDatePillLabel(new Date(2026, 10, 4, 23, 59), now, 'ja', t)).toBe('TODAY');
    });

    it('says yesterday for the previous local day', () => {
        expect(formatDatePillLabel(new Date(2026, 10, 3, 23, 59), now, 'ja', t)).toBe('YESTERDAY');
    });

    it('shows month, day and weekday without the year in the same year', () => {
        expect(formatDatePillLabel(new Date(2026, 10, 2), now, 'ja', t)).toBe('11月2日(月)');
        expect(formatDatePillLabel(new Date(2026, 10, 2), now, 'zh-TW', t)).toBe('11月2日 週一');
        expect(formatDatePillLabel(new Date(2026, 10, 2), now, 'en', t)).toBe('Mon, November 2');
    });

    it('always shows the year for an earlier year', () => {
        expect(formatDatePillLabel(new Date(2025, 10, 2), now, 'ja', t)).toBe('2025年11月2日(日)');
        expect(formatDatePillLabel(new Date(2025, 10, 2), now, 'zh-TW', t)).toBe('2025年11月2日 週日');
    });

    it('handles the year boundary', () => {
        const newYear = new Date(2027, 0, 1, 10, 0);
        expect(formatDatePillLabel(new Date(2026, 11, 31, 22, 0), newYear, 'ja', t)).toBe('YESTERDAY');
        expect(formatDatePillLabel(new Date(2026, 11, 30), newYear, 'ja', t)).toBe('2026年12月30日(水)');
    });
});
```

Create `frontend/src/i18n/designSystem.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;
type Tree = Record<string, Record<string, string>>;

describe('design-system strings', () => {
    it.each(Object.entries(locales))('%s has the date and badge keys', (_code, data) => {
        const tree = data as unknown as Tree;
        expect(tree.date?.today).toBeTruthy();
        expect(tree.date?.yesterday).toBeTruthy();
        expect(tree.common.unreadCount).toContain('{{count}}');
    });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/utils/dateFormatters.test.ts src/i18n/designSystem.test.ts`
Expected: FAIL — `formatDatePillLabel` is not exported; `tree.date` is undefined.

- [ ] **Step 3: Implement**

Append to `frontend/src/utils/dateFormatters.ts`:

```ts
export type DatePillKey = 'date.today' | 'date.yesterday';

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * Label for the floating date pill in timelines.
 *
 * Today / Yesterday come from i18n; otherwise month + day + weekday in the UI
 * locale, with the year added whenever the date is not in `now`'s year.
 * Compares local calendar days (timestamps stay UTC until display).
 */
export function formatDatePillLabel(
  date: Date,
  now: Date,
  locale: string,
  t: (key: DatePillKey) => string,
): string {
  if (isSameLocalDay(date, now)) return t('date.today');
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) return t('date.yesterday');
  const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', weekday: 'short' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return new Intl.DateTimeFormat(locale, options).format(date);
}
```

Add the locale keys. Run from `SakaDesk/frontend`:

```bash
cat > /tmp/ds-i18n-$$.mjs <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const add = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
for (const [loc, tree] of Object.entries(add)) {
  const file = `src/i18n/locales/${loc}.json`;
  const data = JSON.parse(readFileSync(file, 'utf-8'));
  for (const [ns, keys] of Object.entries(tree)) data[ns] = { ...(data[ns] ?? {}), ...keys };
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
EOF
cat > /tmp/ds-i18n-$$.json <<'EOF'
{
  "en":    { "date": { "today": "Today", "yesterday": "Yesterday" }, "common": { "unreadCount": "{{count}} unread" } },
  "ja":    { "date": { "today": "今日", "yesterday": "昨日" }, "common": { "unreadCount": "未読 {{count}} 件" } },
  "zh-TW": { "date": { "today": "今天", "yesterday": "昨天" }, "common": { "unreadCount": "{{count}} 則未讀" } },
  "zh-CN": { "date": { "today": "今天", "yesterday": "昨天" }, "common": { "unreadCount": "{{count}} 条未读" } },
  "yue":   { "date": { "today": "今日", "yesterday": "尋日" }, "common": { "unreadCount": "{{count}} 則未讀" } }
}
EOF
node /tmp/ds-i18n-$$.mjs /tmp/ds-i18n-$$.json && rm /tmp/ds-i18n-$$.mjs /tmp/ds-i18n-$$.json
git diff --stat src/i18n/locales
```

Expected: five locale files changed, a handful of added lines each (the script round-trips the existing formatting unchanged).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/utils/dateFormatters.test.ts src/i18n`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src/utils/dateFormatters.ts frontend/src/utils/dateFormatters.test.ts frontend/src/i18n
uv run git commit -m "feat(design): add date-pill label and shared i18n keys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Surface primitives — Canvas, Sheet, Card, Pill

**Files:**
- Create: `frontend/src/design/primitives/Surfaces.tsx`, `frontend/src/design/primitives/Pill.tsx`, `frontend/src/design/primitives/index.ts`
- Test: `frontend/src/design/primitives/Surfaces.test.tsx`

**Interfaces:**
- Consumes: Task 5 classes, `cn`.
- Produces:
  - `Canvas`, `Sheet`, `Card`: `React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>`
  - `Pill`: `React.forwardRef<HTMLButtonElement, PillProps>`, `interface PillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { selected?: boolean }` — renders `<button type="button" aria-pressed={selected}>`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/design/primitives/Surfaces.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Canvas, Sheet, Card, Pill } from './index';

describe('surface primitives', () => {
    it.each([
        ['Canvas', Canvas, ['bg-group-canvas']],
        ['Sheet', Sheet, ['bg-sheet', 'rounded-sheet', 'shadow-sheet']],
        ['Card', Card, ['bg-card', 'rounded-card', 'shadow-card']],
    ] as const)('%s renders its level classes and merges className', (_name, Component, classes) => {
        render(<Component data-testid="s" className="p-4">日向坂 🌸</Component>);
        const el = screen.getByTestId('s');
        expect(el).toHaveTextContent('日向坂 🌸');
        for (const c of classes) expect(el).toHaveClass(c);
        expect(el).toHaveClass('p-4');
    });

    it('Canvas has no radius or shadow', () => {
        render(<Canvas data-testid="c" />);
        expect(screen.getByTestId('c').className).not.toMatch(/rounded|shadow/);
    });
});

describe('Pill', () => {
    it('is a button that reports its selected state', async () => {
        const onClick = vi.fn();
        render(
            <>
                <Pill onClick={onClick}>すべて</Pill>
                <Pill selected>未読</Pill>
            </>,
        );
        const all = screen.getByRole('button', { name: 'すべて' });
        const unread = screen.getByRole('button', { name: '未読' });
        expect(all).toHaveAttribute('type', 'button');
        expect(all).toHaveAttribute('aria-pressed', 'false');
        expect(unread).toHaveAttribute('aria-pressed', 'true');
        expect(all).toHaveClass('rounded-pill', 'shadow-pill');
        await userEvent.click(all);
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('never uses the group colour for the selected state', () => {
        render(<Pill selected>x</Pill>);
        expect(screen.getByRole('button').className).not.toMatch(/group/);
    });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/design/primitives/Surfaces.test.tsx`
Expected: FAIL — `./index` cannot be resolved.

- [ ] **Step 3: Implement**

Create `frontend/src/design/primitives/Surfaces.tsx`:

```tsx
import React from 'react';
import { cn } from '../../utils/classnames';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/** Level 0 — the group gradient background. No corners, no shadow. */
export const Canvas = React.forwardRef<HTMLDivElement, DivProps>(({ className, ...rest }, ref) => (
    <div ref={ref} className={cn('bg-group-canvas', className)} {...rest} />
));
Canvas.displayName = 'Canvas';

/** Level 1 — the one content sheet (chat, blog, modal bodies). */
export const Sheet = React.forwardRef<HTMLDivElement, DivProps>(({ className, ...rest }, ref) => (
    <div ref={ref} className={cn('bg-sheet rounded-sheet shadow-sheet', className)} {...rest} />
));
Sheet.displayName = 'Sheet';

/** Level 2 — cards on a sheet (photos, info cards; D2 builds bubbles from it). */
export const Card = React.forwardRef<HTMLDivElement, DivProps>(({ className, ...rest }, ref) => (
    <div ref={ref} className={cn('bg-card rounded-card shadow-card', className)} {...rest} />
));
Card.displayName = 'Card';
```

Create `frontend/src/design/primitives/Pill.tsx`:

```tsx
import React from 'react';
import { cn } from '../../utils/classnames';

export interface PillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Selected tab/filter. Neutral emphasis — never the group colour. */
    selected?: boolean;
}

/** Level 3 — a fully rounded tab or filter button. */
export const Pill = React.forwardRef<HTMLButtonElement, PillProps>(
    ({ selected = false, className, type = 'button', ...rest }, ref) => (
        <button
            ref={ref}
            type={type}
            aria-pressed={selected}
            className={cn(
                'inline-flex items-center gap-1 rounded-pill px-3 py-1 text-small shadow-pill',
                'transition-colors duration-fast ease-standard',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group',
                selected ? 'bg-sunken font-semibold text-primary' : 'bg-pill text-secondary hover:text-primary',
                className,
            )}
            {...rest}
        />
    ),
);
Pill.displayName = 'Pill';
```

Create `frontend/src/design/primitives/index.ts`:

```ts
export { Canvas, Sheet, Card } from './Surfaces';
export { Pill, type PillProps } from './Pill';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/design/primitives && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src/design/primitives
uv run git commit -m "feat(design): add Canvas, Sheet, Card and Pill primitives

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Badge, Avatar, DatePill

**Files:**
- Create: `frontend/src/design/primitives/Badge.tsx`, `Avatar.tsx`, `DatePill.tsx`
- Modify: `frontend/src/design/primitives/index.ts`
- Test: `frontend/src/design/primitives/Indicators.test.tsx`

**Interfaces:**
- Consumes: `formatDatePillLabel`, `toLocalDateStr` (`utils/dateFormatters`), `useTranslation` (`../../i18n`), `clientLog`.
- Produces:
  - `Badge: React.FC<{ count: number; className?: string }>`
  - `type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'`; `Avatar: React.FC<{ src?: string; name: string; size?: AvatarSize; selected?: boolean; className?: string }>`
  - `DatePill: React.FC<{ date: Date; sticky?: boolean; className?: string }>`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/design/primitives/Indicators.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

import i18n from '../../i18n';
import { clientLog } from '../../utils/clientLog';
import { Badge, Avatar, DatePill } from './index';

beforeAll(async () => {
    await i18n.changeLanguage('en');
});

describe('Badge', () => {
    it('renders nothing at zero', () => {
        const { container } = render(<Badge count={0} />);
        expect(container).toBeEmptyDOMElement();
    });

    it.each([
        [1, '1'],
        [99, '99'],
        [100, '99+'],
        [1234, '99+'],
    ])('shows %i as %s with an accessible label', (count, text) => {
        render(<Badge count={count} />);
        const badge = screen.getByText(text);
        expect(badge).toHaveAttribute('aria-label', `${count} unread`);
        expect(badge).toHaveClass('bg-group-badge', 'rounded-pill');
    });
});

describe('Avatar', () => {
    beforeEach(() => vi.mocked(clientLog).mockClear());

    it('shows the image with the name as alt text', () => {
        render(<Avatar src="/a.jpg" name="小坂菜緒" />);
        expect(screen.getByRole('img', { name: '小坂菜緒' })).toHaveAttribute('src', '/a.jpg');
    });

    it('falls back to the first character and logs only the size', () => {
        render(<Avatar src="/missing.jpg" name="小坂菜緒" size="lg" />);
        fireEvent.error(screen.getByRole('img', { name: '小坂菜緒' }));
        expect(screen.getByText('小')).toBeInTheDocument();
        expect(clientLog).toHaveBeenCalledWith('avatar_fallback', { size: 'lg' });
    });

    it('takes a whole emoji as the initial', () => {
        render(<Avatar name="🌸さくら" />);
        expect(screen.getByText('🌸')).toBeInTheDocument();
        expect(clientLog).not.toHaveBeenCalled();
    });

    it('adds the white ring and group glow when selected', () => {
        const { container } = render(<Avatar name="A" selected />);
        expect(container.firstChild).toHaveClass('ring-2', 'ring-white', 'shadow-group-glow');
    });
});

describe('DatePill', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 10, 4, 12, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('labels today and carries the machine-readable date', () => {
        render(<DatePill date={new Date(2026, 10, 4, 9, 0)} />);
        const time = screen.getByText('Today');
        expect(time.tagName).toBe('TIME');
        expect(time).toHaveAttribute('dateTime', '2026-11-04');
    });

    it('sticks to the top when asked', () => {
        const { container } = render(<DatePill date={new Date(2025, 0, 1)} sticky />);
        expect(container.firstChild).toHaveClass('sticky', 'top-0');
        expect(screen.getByText(/2025/)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/design/primitives/Indicators.test.tsx`
Expected: FAIL — `Badge` is not exported.

- [ ] **Step 3: Implement**

Create `frontend/src/design/primitives/Badge.tsx`:

```tsx
import React from 'react';
import { useTranslation } from '../../i18n';
import { cn } from '../../utils/classnames';

export interface BadgeProps {
    count: number;
    className?: string;
}

/** Level 3 — unread count in the group badge colour. Hidden at 0, capped at 99+. */
export const Badge: React.FC<BadgeProps> = ({ count, className }) => {
    const { t } = useTranslation();
    if (count <= 0) return null;
    return (
        <span
            aria-label={t('common.unreadCount', { count })}
            className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-group-badge px-1.5',
                'text-caption font-semibold text-inverse shadow-pill',
                className,
            )}
        >
            {count > 99 ? '99+' : count}
        </span>
    );
};
```

Create `frontend/src/design/primitives/Avatar.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { cn } from '../../utils/classnames';
import { clientLog } from '../../utils/clientLog';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE: Record<AvatarSize, string> = {
    sm: 'h-8 w-8 text-small',
    md: 'h-10 w-10 text-body',
    lg: 'h-14 w-14 text-title',
    xl: 'h-20 w-20 text-heading',
};

export interface AvatarProps {
    src?: string;
    /** Used as alt text and for the fallback initial. */
    name: string;
    size?: AvatarSize;
    /** Selected member: white ring + group-colour glow. */
    selected?: boolean;
    className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({ src, name, size = 'md', selected = false, className }) => {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [src]);

    // Array.from keeps surrogate pairs (emoji) whole.
    const initial = Array.from(name.trim())[0] ?? '?';
    const showImage = Boolean(src) && !failed;

    return (
        <span
            className={cn(
                'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill',
                'bg-sunken font-semibold text-secondary transition-shadow duration-base ease-standard',
                SIZE[size],
                selected && 'ring-2 ring-white shadow-group-glow',
                className,
            )}
        >
            {showImage ? (
                <img
                    src={src}
                    alt={name}
                    draggable={false}
                    className="h-full w-full object-cover"
                    onError={() => {
                        setFailed(true);
                        clientLog('avatar_fallback', { size });
                    }}
                />
            ) : (
                <span role="img" aria-label={name}>{initial}</span>
            )}
        </span>
    );
};
```

Note: the fallback `<span role="img" aria-label={name}>` contains the initial as text, so `getByText('小')` finds it.

Create `frontend/src/design/primitives/DatePill.tsx`:

```tsx
import React from 'react';
import { useTranslation } from '../../i18n';
import { cn } from '../../utils/classnames';
import { formatDatePillLabel, toLocalDateStr } from '../../utils/dateFormatters';

export interface DatePillProps {
    date: Date;
    /** Stick to the top of the scrolling timeline. */
    sticky?: boolean;
    className?: string;
}

/** Level 3 — floating date label for timelines. */
export const DatePill: React.FC<DatePillProps> = ({ date, sticky = false, className }) => {
    const { t, i18n } = useTranslation();
    const label = formatDatePillLabel(date, new Date(), i18n.language, (key) => t(key));
    return (
        <div className={cn('pointer-events-none flex justify-center py-2', sticky && 'sticky top-0 z-10', className)}>
            <time
                dateTime={toLocalDateStr(date)}
                className="pointer-events-auto rounded-pill bg-pill px-3 py-1 text-caption text-secondary shadow-pill"
            >
                {label}
            </time>
        </div>
    );
};
```

Append to `frontend/src/design/primitives/index.ts`:

```ts
export { Badge, type BadgeProps } from './Badge';
export { Avatar, type AvatarProps, type AvatarSize } from './Avatar';
export { DatePill, type DatePillProps } from './DatePill';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/design/primitives && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src/design/primitives
uv run git commit -m "feat(design): add Badge, Avatar and DatePill primitives

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Button, IconButton, RailItem, Modal

**Files:**
- Create: `frontend/src/design/primitives/Button.tsx`, `RailItem.tsx`, `Modal.tsx`
- Modify: `frontend/src/design/primitives/index.ts`
- Test: `frontend/src/design/primitives/Controls.test.tsx`

**Interfaces:**
- Consumes: `useModalClose(isOpen, onClose)` and `Portal` from `frontend/src/core/common/`.
- Produces:
  - `type ButtonVariant = 'primary' | 'secondary' | 'ghost'`, `type ButtonSize = 'sm' | 'md'`
  - `Button: forwardRef<HTMLButtonElement, ButtonProps>`, `ButtonProps extends ButtonHTMLAttributes { variant?: ButtonVariant; size?: ButtonSize }`
  - `IconButton: forwardRef<HTMLButtonElement, IconButtonProps>`, `IconButtonProps extends Omit<ButtonHTMLAttributes, 'aria-label' | 'children'> { 'aria-label': string; icon: ReactNode; variant?: 'secondary' | 'ghost'; size?: ButtonSize }`
  - `RailItem: React.FC<{ icon: ReactNode; label: string; selected?: boolean; onClick?: () => void; className?: string }>`
  - `Modal: React.FC<{ isOpen: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }>`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/design/primitives/Controls.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { X, MessageCircle } from 'lucide-react';
import { Button, IconButton, RailItem, Modal } from './index';

describe('Button', () => {
    it('defaults to a secondary md button of type button', () => {
        render(<Button>保存</Button>);
        const b = screen.getByRole('button', { name: '保存' });
        expect(b).toHaveAttribute('type', 'button');
        expect(b).toHaveClass('bg-pill', 'h-10', 'rounded-pill');
    });

    it('primary uses the group accent; ghost and secondary do not', () => {
        render(
            <>
                <Button variant="primary">answer</Button>
                <Button variant="ghost">cancel</Button>
            </>,
        );
        expect(screen.getByRole('button', { name: 'answer' })).toHaveClass('bg-group-accent', 'text-inverse');
        expect(screen.getByRole('button', { name: 'cancel' }).className).not.toMatch(/group-accent/);
    });

    it('does not fire when disabled', async () => {
        const onClick = vi.fn();
        render(<Button disabled onClick={onClick}>x</Button>);
        await userEvent.click(screen.getByRole('button'));
        expect(onClick).not.toHaveBeenCalled();
    });
});

describe('IconButton', () => {
    it('is labelled by its required aria-label', async () => {
        const onClick = vi.fn();
        render(<IconButton aria-label="閉じる" icon={<X />} onClick={onClick} />);
        await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('requires aria-label at the type level', () => {
        // @ts-expect-error aria-label is required
        const el = <IconButton icon={<X />} />;
        expect(el).toBeTruthy();
    });
});

describe('RailItem', () => {
    it('shows icon and label and marks the current item', () => {
        render(
            <>
                <RailItem icon={<MessageCircle />} label="トーク" selected />
                <RailItem icon={<MessageCircle />} label="ブログ" />
            </>,
        );
        expect(screen.getByRole('button', { name: 'トーク' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'ブログ' })).not.toHaveAttribute('aria-current');
    });
});

describe('Modal', () => {
    it('renders nothing when closed', () => {
        render(<Modal isOpen={false} onClose={vi.fn()} title="t">body</Modal>);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('renders a labelled sheet dialog with footer', async () => {
        render(
            <Modal isOpen onClose={vi.fn()} title="設定" footer={<Button>OK</Button>}>
                本文
            </Modal>,
        );
        const dialog = await screen.findByRole('dialog', { name: '設定' });
        expect(dialog).toHaveClass('bg-sheet', 'rounded-sheet', 'shadow-sheet');
        expect(dialog).toHaveTextContent('本文');
        expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
    });

    it('closes on Escape and on backdrop click, not on a click inside', async () => {
        const onClose = vi.fn();
        render(<Modal isOpen onClose={onClose} title="t">inside</Modal>);
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(dialog);
        expect(onClose).not.toHaveBeenCalled();
        await userEvent.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);
        await userEvent.click(screen.getByTestId('modal-backdrop'));
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/design/primitives/Controls.test.tsx`
Expected: FAIL — `Button` is not exported.

- [ ] **Step 3: Implement**

Create `frontend/src/design/primitives/Button.tsx`:

```tsx
import React from 'react';
import { cn } from '../../utils/classnames';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md';

const BASE = cn(
    'inline-flex items-center justify-center gap-2 rounded-pill font-semibold',
    'transition duration-fast ease-standard',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group',
    'disabled:pointer-events-none disabled:opacity-50',
);

const VARIANT: Record<ButtonVariant, string> = {
    /** Group accent. At most ONE per screen (docs/design/DESIGN_SYSTEM.md). */
    primary: 'bg-group-accent text-inverse shadow-pill hover:brightness-105',
    secondary: 'bg-pill text-primary shadow-pill hover:bg-sunken',
    ghost: 'bg-transparent text-secondary hover:bg-sunken hover:text-primary',
};

const SIZE: Record<ButtonSize, string> = {
    sm: 'h-8 px-3 text-small',
    md: 'h-10 px-4 text-body',
};

const ICON_SIZE: Record<ButtonSize, string> = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ variant = 'secondary', size = 'md', type = 'button', className, ...rest }, ref) => (
        <button ref={ref} type={type} className={cn(BASE, VARIANT[variant], SIZE[size], className)} {...rest} />
    ),
);
Button.displayName = 'Button';

export interface IconButtonProps
    extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
    /** Required: an icon-only button has no other accessible name. */
    'aria-label': string;
    icon: React.ReactNode;
    variant?: Exclude<ButtonVariant, 'primary'>;
    size?: ButtonSize;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    ({ icon, variant = 'ghost', size = 'md', type = 'button', className, ...rest }, ref) => (
        <button ref={ref} type={type} className={cn(BASE, VARIANT[variant], ICON_SIZE[size], className)} {...rest}>
            <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center">{icon}</span>
        </button>
    ),
);
IconButton.displayName = 'IconButton';
```

Create `frontend/src/design/primitives/RailItem.tsx`:

```tsx
import React from 'react';
import { cn } from '../../utils/classnames';

export interface RailItemProps {
    icon: React.ReactNode;
    /** Already translated by the caller. */
    label: string;
    selected?: boolean;
    onClick?: () => void;
    className?: string;
}

/** Feature-rail entry: icon above a text label. */
export const RailItem: React.FC<RailItemProps> = ({ icon, label, selected = false, onClick, className }) => (
    <button
        type="button"
        onClick={onClick}
        aria-current={selected ? 'page' : undefined}
        className={cn(
            'flex w-full flex-col items-center gap-1 rounded-card px-2 py-2 text-caption',
            'transition-colors duration-fast ease-standard',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group',
            selected ? 'bg-sheet font-semibold text-primary shadow-card' : 'text-secondary hover:bg-elevated hover:text-primary',
            className,
        )}
    >
        <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center">{icon}</span>
        <span>{label}</span>
    </button>
);
```

Create `frontend/src/design/primitives/Modal.tsx`:

```tsx
import React, { useId } from 'react';
import { Portal } from '../../core/common/Portal';
import { useModalClose } from '../../core/common/useModalClose';
import { cn } from '../../utils/classnames';

export interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    className?: string;
}

/** Level 1 dialog. Escape / backdrop close and the portal reuse core/common. */
export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer, className }) => {
    const handleBackdropClick = useModalClose(isOpen, onClose);
    const titleId = useId();
    if (!isOpen) return null;
    return (
        <Portal>
            <div
                data-testid="modal-backdrop"
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                onClick={handleBackdropClick}
            >
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={titleId}
                    className={cn(
                        'flex max-h-full w-full max-w-lg flex-col overflow-hidden bg-sheet rounded-sheet shadow-sheet',
                        className,
                    )}
                >
                    <h2 id={titleId} className="px-6 pb-2 pt-6 text-title font-semibold text-primary">{title}</h2>
                    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 text-body text-primary">{children}</div>
                    {footer && <div className="flex justify-end gap-2 px-6 pb-6">{footer}</div>}
                </div>
            </div>
        </Portal>
    );
};
```

Append to `frontend/src/design/primitives/index.ts`:

```ts
export {
    Button, IconButton,
    type ButtonProps, type IconButtonProps, type ButtonVariant, type ButtonSize,
} from './Button';
export { RailItem, type RailItemProps } from './RailItem';
export { Modal, type ModalProps } from './Modal';
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run src/design/primitives && npx tsc --noEmit`
Expected: PASS; `tsc` silent. This proves the `@ts-expect-error` is needed, i.e. `aria-label` is required.

- [ ] **Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src/design/primitives
uv run git commit -m "feat(design): add Button, IconButton, RailItem and Modal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Hard-coded-style ratchet guard

**Files:**
- Create: `frontend/src/design/guard.ts`, `frontend/src/design/guard.test.ts`, `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Produces:
  - `countViolations(source: string): number`
  - `isScanned(relPath: string): boolean` (posix path relative to `src/`)
  - `scanTree(srcRoot: string): Record<string, number>` (only files with count > 0, sorted keys)
  - `compareToBaseline(current, baseline, exists: (rel: string) => boolean): string[]` (empty = pass)
  - Regenerate the baseline with `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/design/guard.test.ts`:

```ts
// Runs in the default jsdom environment on purpose: src/__tests__/setup.ts touches
// `window`, so `@vitest-environment node` would crash; node:fs works in jsdom too.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareToBaseline, countViolations, isScanned, scanTree } from './guard';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const BASELINE = fileURLToPath(new URL('./guard-baseline.json', import.meta.url));

describe('countViolations', () => {
    it.each([
        ["const c = '#7cc7e8';", 1],
        ["const c = '#FFF'; const d = '#ffffffcc';", 2],
        ["style={{ color: 'rgba(0, 0, 0, .5)', background: 'hsl(10 20% 30%)' }}", 2],
        ['className="rounded-[10px] shadow-[0_0_4px] text-[13px] p-[3px] -mt-[2px] gap-x-[5px] space-y-[7px]"', 7],
        ['className="hover:rounded-tl-[6px] md:px-[10px]"', 2],
    ])('counts %s as %i', (source, count) => {
        expect(countViolations(source)).toBe(count);
    });

    it.each([
        'className="rounded-card shadow-sheet text-body text-primary p-4 gap-3"',
        'className="w-[320px] h-[568px] top-[12px] max-w-[9rem]"',
        '// see #123 and #abc\n/* #fff rgba( */ const x = 1;',
        '{/* rounded-[4px] */}',
        "const url = 'https://example.com/a';",
        "const label = '日向坂 🌸';",
    ])('ignores %s', (source) => {
        expect(countViolations(source)).toBe(0);
    });
});

describe('isScanned', () => {
    it.each([
        ['features/messages/components/MessageBubble.tsx', true],
        ['shell/App.tsx', true],
        ['design/primitives/Card.tsx', true],
        ['design/DesignPage.tsx', true],
        ['design/tokens/groups.ts', false],
        ['design/guard.ts', false],
        ['config/serviceThemes.ts', false],
        ['config/colors/palette.ts', false],
        ['shell/App.test.tsx', false],
        ['__tests__/mocks/handlers.ts', false],
        ['vite-env.d.ts', false],
        ['i18n/locales/en.json', false],
    ])('%s -> %s', (rel, want) => {
        expect(isScanned(rel)).toBe(want);
    });
});

describe('compareToBaseline', () => {
    const exists = () => true;

    it('passes when counts match', () => {
        expect(compareToBaseline({ 'a.tsx': 2 }, { 'a.tsx': 2 }, exists)).toEqual([]);
    });
    it('fails on a file that is not in the baseline', () => {
        expect(compareToBaseline({ 'new.tsx': 1 }, {}, exists)).toEqual([
            'new.tsx: 1 hard-coded style value(s) in a new file — use design tokens (docs/design/DESIGN_SYSTEM.md)',
        ]);
    });
    it('fails when a count goes up', () => {
        expect(compareToBaseline({ 'a.tsx': 3 }, { 'a.tsx': 2 }, exists)).toEqual([
            'a.tsx: 3 hard-coded style value(s), baseline allows 2 — use design tokens (docs/design/DESIGN_SYSTEM.md)',
        ]);
    });
    it('fails until a lower count is written back', () => {
        expect(compareToBaseline({ 'a.tsx': 1 }, { 'a.tsx': 2 }, exists)).toEqual([
            'a.tsx: improved to 1 (baseline 2) — lower it in src/design/guard-baseline.json',
        ]);
        expect(compareToBaseline({}, { 'a.tsx': 2 }, exists)).toEqual([
            'a.tsx: improved to 0 (baseline 2) — remove it from src/design/guard-baseline.json',
        ]);
    });
    it('fails on an entry whose file is gone', () => {
        expect(compareToBaseline({}, { 'gone.tsx': 2 }, () => false)).toEqual([
            'gone.tsx: listed in src/design/guard-baseline.json but the file no longer exists — remove the entry',
        ]);
    });
});

describe('repository', () => {
    it('matches src/design/guard-baseline.json', () => {
        const current = scanTree(SRC);
        if (process.env.UPDATE_GUARD_BASELINE) {
            writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n', 'utf-8');
            return;
        }
        const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8')) as Record<string, number>;
        expect(compareToBaseline(current, baseline, (rel) => existsSync(path.join(SRC, rel)))).toEqual([]);
    });

    it('has no design-system file in the baseline', () => {
        const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8')) as Record<string, number>;
        expect(Object.keys(baseline).filter((rel) => rel.startsWith('design/'))).toEqual([]);
    });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/design/guard.test.ts`
Expected: FAIL — `./guard` cannot be resolved.

- [ ] **Step 3: Implement**

Create `frontend/src/design/guard.ts`:

```ts
/**
 * Ratchet against hard-coded style values outside the design tokens.
 *
 * Counted per file: hex colours, rgb()/hsl() literals, and Tailwind arbitrary
 * values for radius, shadow, text and spacing. Width/height/position arbitrary
 * values are allowed (fixed layout sizes are legitimate). Comments are
 * stripped first. guard.test.ts compares the counts with guard-baseline.json:
 * new files must be clean, and existing counts may only go down.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PATTERNS: readonly RegExp[] = [
    /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g,
    /\b(?:rgba?|hsla?)\(/g,
    /(?<![\w-])-?(?:rounded(?:-[a-z]{1,2})?|shadow|text|[pm][trblxyse]?|gap(?:-[xy])?|space-[xy])-\[/g,
];

const EXCLUDED_PREFIXES = ['design/tokens/', 'config/colors/', '__tests__/'];
const EXCLUDED_FILES = new Set(['design/guard.ts', 'config/serviceThemes.ts']);

function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:\w"'`])\/\/.*$/gm, '$1');
}

export function countViolations(source: string): number {
    const code = stripComments(source);
    return PATTERNS.reduce((sum, pattern) => sum + (code.match(pattern)?.length ?? 0), 0);
}

export function isScanned(relPath: string): boolean {
    if (!/\.tsx?$/.test(relPath) || relPath.endsWith('.d.ts')) return false;
    if (/\.(test|spec)\.tsx?$/.test(relPath)) return false;
    if (EXCLUDED_FILES.has(relPath)) return false;
    return !EXCLUDED_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

export function scanTree(srcRoot: string): Record<string, number> {
    const result: Record<string, number> = {};
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            const rel = path.relative(srcRoot, full).split(path.sep).join('/');
            if (!isScanned(rel)) continue;
            const count = countViolations(readFileSync(full, 'utf-8'));
            if (count > 0) result[rel] = count;
        }
    };
    walk(srcRoot);
    return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

const HINT = 'use design tokens (docs/design/DESIGN_SYSTEM.md)';
const BASELINE_PATH = 'src/design/guard-baseline.json';

export function compareToBaseline(
    current: Record<string, number>,
    baseline: Record<string, number>,
    exists: (relPath: string) => boolean,
): string[] {
    const problems: string[] = [];
    for (const [file, count] of Object.entries(current)) {
        const allowed = baseline[file];
        if (allowed === undefined) {
            problems.push(`${file}: ${count} hard-coded style value(s) in a new file — ${HINT}`);
        } else if (count > allowed) {
            problems.push(`${file}: ${count} hard-coded style value(s), baseline allows ${allowed} — ${HINT}`);
        } else if (count < allowed) {
            problems.push(`${file}: improved to ${count} (baseline ${allowed}) — lower it in ${BASELINE_PATH}`);
        }
    }
    for (const [file, allowed] of Object.entries(baseline)) {
        if (file in current) continue;
        problems.push(
            exists(file)
                ? `${file}: improved to 0 (baseline ${allowed}) — remove it from ${BASELINE_PATH}`
                : `${file}: listed in ${BASELINE_PATH} but the file no longer exists — remove the entry`,
        );
    }
    return problems;
}
```

- [ ] **Step 4: Generate the baseline and run the tests**

```bash
echo '{}' > src/design/guard-baseline.json
UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts
npx vitest run src/design/guard.test.ts
node -e "const b=require('./src/design/guard-baseline.json');console.log(Object.keys(b).length,'files',Object.values(b).reduce((a,c)=>a+c,0),'violations')"
```

Expected: the second run PASSES. Roughly 30–60 files are listed. No path starts with `design/`. If a primitive or the style page shows up, fix that file — do not baseline it.

- [ ] **Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src/design/guard.ts frontend/src/design/guard.test.ts frontend/src/design/guard-baseline.json
uv run git commit -m "test(design): add ratchet against hard-coded style values

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Dev-only `/design` style page

**Files:**
- Create: `frontend/src/design/contrast.ts`, `frontend/src/design/designRoute.ts`, `frontend/src/design/DesignPage.tsx`
- Test: `frontend/src/design/contrast.test.ts`, `frontend/src/design/designRoute.test.ts`, `frontend/src/design/DesignPage.test.tsx`
- Modify: `frontend/src/shell/main.tsx`
- Modify: `frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json` (`designPage.*`)
- Modify: `frontend/src/i18n/designSystem.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–9; `serviceThemes[id].name` for the group switcher labels.
- Produces:
  - `parseHex(value: string): [number, number, number] | null`
  - `contrastRatio(a: string, b: string): number | null` (null when either side is not a plain hex colour)
  - `isDesignView(search: string): boolean`
  - `DesignPage: React.FC` (root has `data-testid="design-page"`)

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/design/contrast.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { contrastRatio, parseHex } from './contrast';

describe('contrast', () => {
    it('parses 3- and 6-digit hex', () => {
        expect(parseHex('#fff')).toEqual([255, 255, 255]);
        expect(parseHex('#7cc7e8')).toEqual([124, 199, 232]);
        expect(parseHex('rgba(0,0,0,1)')).toBeNull();
        expect(parseHex('linear-gradient(red, blue)')).toBeNull();
    });

    it('computes WCAG ratios', () => {
        expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
        expect(contrastRatio('#7cc7e8', '#FFFFFF')).toBeCloseTo(1.88, 2);
        expect(contrastRatio('#2b8cc4', '#FFFFFF')).toBeCloseTo(3.72, 2);
    });

    it('returns null for non-hex values', () => {
        expect(contrastRatio('rgba(124, 199, 232, 0.35)', '#FFFFFF')).toBeNull();
    });
});
```

Create `frontend/src/design/designRoute.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isDesignView } from './designRoute';

describe('isDesignView', () => {
    it.each([
        ['?view=design', true],
        ['?view=design&x=1', true],
        ['?view=call-popup', false],
        ['', false],
    ])('%s -> %s', (search, want) => {
        expect(isDesignView(search)).toBe(want);
    });
});
```

Create `frontend/src/design/DesignPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));

import i18n from '../i18n';
import { serviceThemes } from '../config/serviceThemes';
import { GROUP_IDS, groupTokens } from './tokens';
import { DesignPage } from './DesignPage';

beforeAll(async () => {
    await i18n.changeLanguage('en');
});

const groupLabel = (id: (typeof GROUP_IDS)[number]) => serviceThemes[id].name || id;

describe('DesignPage', () => {
    it('renders every section', () => {
        render(<DesignPage />);
        expect(screen.getByTestId('design-page')).toBeInTheDocument();
        for (const name of ['Design system', 'Colours', 'Radius', 'Shadow', 'Type', 'Motion', 'Primitives', 'Rules']) {
            expect(screen.getByRole('heading', { name })).toBeInTheDocument();
        }
    });

    it('shows the Hinatazaka badge contrast', () => {
        render(<DesignPage />);
        expect(screen.getAllByText('White text 1.9:1').length).toBeGreaterThan(0);
    });

    it.each(GROUP_IDS)('switching to %s applies its tokens', async (id) => {
        render(<DesignPage />);
        await userEvent.click(screen.getByRole('button', { name: groupLabel(id) }));
        expect(screen.getByRole('button', { name: groupLabel(id) })).toHaveAttribute('aria-pressed', 'true');
        expect(document.documentElement.style.getPropertyValue('--ds-group-badge')).toBe(groupTokens[id].badge);
    });

    it('opens the sample modal', async () => {
        render(<DesignPage />);
        await userEvent.click(screen.getByRole('button', { name: 'Open modal' }));
        expect(await screen.findByRole('dialog', { name: 'Sample modal' })).toBeInTheDocument();
    });
});
```

Append to `frontend/src/i18n/designSystem.test.ts` (inside the file, after the existing `describe`):

```ts
const DESIGN_PAGE_KEYS = [
    'title', 'subtitle', 'group', 'colors', 'neutral', 'groupColors', 'contrast', 'contrastNA',
    'radius', 'shadow', 'type', 'sample', 'motion', 'animate', 'primitives', 'surfaces', 'pills',
    'filterAll', 'filterUnread', 'badges', 'avatars', 'datePills', 'buttons', 'primary', 'secondary',
    'ghost', 'disabled', 'close', 'rail', 'modal', 'openModal', 'modalTitle', 'modalBody', 'rules',
    'do', 'dont', 'do1', 'dont1', 'do2', 'dont2', 'do3', 'dont3',
] as const;

describe('design page strings', () => {
    it.each(Object.entries(locales))('%s has every designPage key', (_code, data) => {
        const page = (data as unknown as Tree).designPage;
        for (const key of DESIGN_PAGE_KEYS) expect(page?.[key], key).toBeTruthy();
        expect(page.contrast).toContain('{{ratio}}');
    });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/design/contrast.test.ts src/design/designRoute.test.ts src/design/DesignPage.test.tsx src/i18n/designSystem.test.ts`
Expected: FAIL — modules not found; `designPage` keys missing.

- [ ] **Step 3: Implement the helpers**

Create `frontend/src/design/contrast.ts`:

```ts
/** WCAG 2.x contrast ratio, used by the style page to label swatches. */
export function parseHex(value: string): [number, number, number] | null {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
    if (!match) return null;
    const hex = match[1].length === 3 ? match[1].split('').map((c) => c + c).join('') : match[1];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function channel(value: number): number {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: [number, number, number]): number {
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number | null {
    const pa = parseHex(a);
    const pb = parseHex(b);
    if (!pa || !pb) return null;
    const la = luminance(pa);
    const lb = luminance(pb);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
```

Create `frontend/src/design/designRoute.ts`:

```ts
/**
 * True when the page was opened as the dev-only style page (`?view=design`).
 * main.tsx only calls this behind `import.meta.env.DEV`, so production
 * builds never include the page.
 */
export function isDesignView(search: string): boolean {
    return new URLSearchParams(search).get('view') === 'design';
}
```

- [ ] **Step 4: Add the page strings**

Run from `SakaDesk/frontend` (same merge helper as Task 6):

```bash
cat > /tmp/ds-i18n-$$.mjs <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const add = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
for (const [loc, tree] of Object.entries(add)) {
  const file = `src/i18n/locales/${loc}.json`;
  const data = JSON.parse(readFileSync(file, 'utf-8'));
  for (const [ns, keys] of Object.entries(tree)) data[ns] = { ...(data[ns] ?? {}), ...keys };
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
EOF
cat > /tmp/ds-i18n-$$.json <<'EOF'
{
  "en": { "designPage": {
    "title": "Design system", "subtitle": "Tokens and primitives for every SakaDesk screen. Dev builds only.",
    "group": "Group", "colors": "Colours", "neutral": "Neutral roles", "groupColors": "Group colours",
    "contrast": "White text {{ratio}}:1", "contrastNA": "Not a solid colour",
    "radius": "Radius", "shadow": "Shadow", "type": "Type", "sample": "日向坂 SakaDesk あいう 🌸 123",
    "motion": "Motion", "animate": "Play", "primitives": "Primitives", "surfaces": "Levels",
    "pills": "Pills", "filterAll": "All", "filterUnread": "Unread", "badges": "Badges",
    "avatars": "Avatars", "datePills": "Date pills", "buttons": "Buttons", "primary": "Primary",
    "secondary": "Secondary", "ghost": "Ghost", "disabled": "Disabled", "close": "Close",
    "rail": "Feature rail", "modal": "Modal", "openModal": "Open modal", "modalTitle": "Sample modal",
    "modalBody": "A modal is a sheet: 20px corners, large soft shadow.", "rules": "Rules",
    "do": "Do", "dont": "Don't",
    "do1": "Separate blocks with spacing and levels.", "dont1": "Draw straight divider lines.",
    "do2": "Use token classes such as rounded-card and text-body.", "dont2": "Hard-code #hex colours or arbitrary values such as rounded-[10px].",
    "do3": "Use group colour only in the four places, plus one primary button per screen.", "dont3": "Colour any other element with the group colour."
  } },
  "ja": { "designPage": {
    "title": "デザインシステム", "subtitle": "SakaDesk の全画面で使うトークンと基本コンポーネント。開発ビルドのみ。",
    "group": "グループ", "colors": "カラー", "neutral": "ニュートラル", "groupColors": "グループカラー",
    "contrast": "白文字 {{ratio}}:1", "contrastNA": "単色ではありません",
    "radius": "角丸", "shadow": "影", "type": "文字", "sample": "日向坂 SakaDesk あいう 🌸 123",
    "motion": "モーション", "animate": "再生", "primitives": "基本コンポーネント", "surfaces": "レイヤー",
    "pills": "ピル", "filterAll": "すべて", "filterUnread": "未読", "badges": "バッジ",
    "avatars": "アバター", "datePills": "日付ピル", "buttons": "ボタン", "primary": "プライマリ",
    "secondary": "セカンダリ", "ghost": "ゴースト", "disabled": "無効", "close": "閉じる",
    "rail": "機能レール", "modal": "モーダル", "openModal": "モーダルを開く", "modalTitle": "サンプルモーダル",
    "modalBody": "モーダルはシートです：角丸 20px、大きく柔らかい影。", "rules": "ルール",
    "do": "推奨", "dont": "禁止",
    "do1": "余白とレイヤーでブロックを分ける。", "dont1": "直線の区切り線を引く。",
    "do2": "rounded-card や text-body などのトークンクラスを使う。", "dont2": "#hex カラーや rounded-[10px] などの任意値を直書きする。",
    "do3": "グループカラーは4か所と、画面ごとに1つのプライマリボタンだけ。", "dont3": "それ以外の要素をグループカラーで塗る。"
  } },
  "zh-TW": { "designPage": {
    "title": "設計系統", "subtitle": "SakaDesk 所有畫面共用的 token 與基礎元件。僅限開發版。",
    "group": "團體", "colors": "顏色", "neutral": "中性角色", "groupColors": "團體色",
    "contrast": "白字 {{ratio}}:1", "contrastNA": "非單色",
    "radius": "圓角", "shadow": "陰影", "type": "字級", "sample": "日向坂 SakaDesk あいう 🌸 123",
    "motion": "動畫", "animate": "播放", "primitives": "基礎元件", "surfaces": "層級",
    "pills": "膠囊", "filterAll": "全部", "filterUnread": "未讀", "badges": "徽章",
    "avatars": "頭像", "datePills": "日期膠囊", "buttons": "按鈕", "primary": "主要",
    "secondary": "次要", "ghost": "透明", "disabled": "停用", "close": "關閉",
    "rail": "功能列", "modal": "對話框", "openModal": "開啟對話框", "modalTitle": "範例對話框",
    "modalBody": "對話框就是一張紙：20px 圓角、大而柔的陰影。", "rules": "規則",
    "do": "這樣做", "dont": "不要這樣",
    "do1": "用間距和層級區隔區塊。", "dont1": "畫直的分隔線。",
    "do2": "使用 rounded-card、text-body 等 token class。", "dont2": "寫死 #hex 顏色或 rounded-[10px] 這類任意值。",
    "do3": "團體色只用在 4 個地方，加上每個畫面最多一顆主要按鈕。", "dont3": "用團體色塗其他元素。"
  } },
  "zh-CN": { "designPage": {
    "title": "设计系统", "subtitle": "SakaDesk 所有页面共用的 token 与基础组件。仅限开发版。",
    "group": "团体", "colors": "颜色", "neutral": "中性角色", "groupColors": "团体色",
    "contrast": "白字 {{ratio}}:1", "contrastNA": "非纯色",
    "radius": "圆角", "shadow": "阴影", "type": "字号", "sample": "日向坂 SakaDesk あいう 🌸 123",
    "motion": "动画", "animate": "播放", "primitives": "基础组件", "surfaces": "层级",
    "pills": "胶囊", "filterAll": "全部", "filterUnread": "未读", "badges": "徽章",
    "avatars": "头像", "datePills": "日期胶囊", "buttons": "按钮", "primary": "主要",
    "secondary": "次要", "ghost": "透明", "disabled": "禁用", "close": "关闭",
    "rail": "功能栏", "modal": "对话框", "openModal": "打开对话框", "modalTitle": "示例对话框",
    "modalBody": "对话框就是一张纸：20px 圆角、大而柔和的阴影。", "rules": "规则",
    "do": "这样做", "dont": "不要这样",
    "do1": "用间距和层级区分区块。", "dont1": "画直的分隔线。",
    "do2": "使用 rounded-card、text-body 等 token class。", "dont2": "写死 #hex 颜色或 rounded-[10px] 之类的任意值。",
    "do3": "团体色只用在 4 个地方，加上每个页面最多一个主要按钮。", "dont3": "用团体色涂其他元素。"
  } },
  "yue": { "designPage": {
    "title": "設計系統", "subtitle": "SakaDesk 所有畫面共用嘅 token 同基礎元件。淨係開發版有。",
    "group": "團體", "colors": "顏色", "neutral": "中性角色", "groupColors": "團體色",
    "contrast": "白字 {{ratio}}:1", "contrastNA": "唔係單色",
    "radius": "圓角", "shadow": "陰影", "type": "字級", "sample": "日向坂 SakaDesk あいう 🌸 123",
    "motion": "動畫", "animate": "播放", "primitives": "基礎元件", "surfaces": "層級",
    "pills": "膠囊", "filterAll": "全部", "filterUnread": "未讀", "badges": "徽章",
    "avatars": "頭像", "datePills": "日期膠囊", "buttons": "按鈕", "primary": "主要",
    "secondary": "次要", "ghost": "透明", "disabled": "停用", "close": "關閉",
    "rail": "功能列", "modal": "對話框", "openModal": "打開對話框", "modalTitle": "示範對話框",
    "modalBody": "對話框就係一張紙：20px 圓角、大而柔嘅陰影。", "rules": "規則",
    "do": "噉做", "dont": "唔好噉做",
    "do1": "用間距同層級分開區塊。", "dont1": "畫直嘅分隔線。",
    "do2": "用 rounded-card、text-body 呢類 token class。", "dont2": "寫死 #hex 顏色或者 rounded-[10px] 呢類任意值。",
    "do3": "團體色淨係用喺 4 個地方，加每個畫面最多一粒主要按鈕。", "dont3": "用團體色塗其他元素。"
  } }
}
EOF
node /tmp/ds-i18n-$$.mjs /tmp/ds-i18n-$$.json && rm /tmp/ds-i18n-$$.mjs /tmp/ds-i18n-$$.json
```

- [ ] **Step 5: Implement the page**

Create `frontend/src/design/DesignPage.tsx`:

```tsx
/**
 * Dev-only living style page (`?view=design`). Shows every token and every
 * primitive state for the selected group. Never shipped: main.tsx loads it
 * only behind `import.meta.env.DEV`.
 */
import React, { useEffect, useState } from 'react';
import { BookOpen, MessageCircle, Newspaper, Search, Settings, X } from 'lucide-react';
import { useTranslation } from '../i18n';
import { serviceThemes } from '../config/serviceThemes';
import { cn } from '../utils/classnames';
import { applyGroupTokens } from './applyTokens';
import { contrastRatio } from './contrast';
import { GROUP_IDS, color, groupTokens, radius, shadow, typeScale, type GroupId, type RadiusStep, type ShadowStep, type TypeStep } from './tokens';
import {
    Avatar, Badge, Button, Canvas, Card, DatePill, IconButton, Modal, Pill, RailItem, Sheet,
} from './primitives';

// Full class names so Tailwind's scanner generates them.
const RADIUS_CLASS: Record<RadiusStep, string> = {
    none: 'rounded-none', card: 'rounded-card', sheet: 'rounded-sheet', pill: 'rounded-pill',
};
const SHADOW_CLASS: Record<ShadowStep, string> = {
    none: 'shadow-none', pill: 'shadow-pill', card: 'shadow-card', sheet: 'shadow-sheet',
};
const TYPE_CLASS: Record<TypeStep, string> = {
    caption: 'text-caption', small: 'text-small', body: 'text-body', title: 'text-title', heading: 'text-heading',
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section className="flex flex-col gap-4">
        <h2 className="text-heading font-semibold text-primary">{title}</h2>
        {children}
    </section>
);

const Swatch: React.FC<{ name: string; value: string }> = ({ name, value }) => {
    const { t } = useTranslation();
    const ratio = contrastRatio(value, color.text.inverse);
    return (
        <Card className="flex w-44 flex-col overflow-hidden">
            <div className="h-14" style={{ background: value }} />
            <div className="flex flex-col gap-1 p-3">
                <span className="text-small font-semibold text-primary">{name}</span>
                <span className="break-all text-caption text-muted">{value}</span>
                <span className="text-caption text-secondary">
                    {ratio === null ? t('designPage.contrastNA') : t('designPage.contrast', { ratio: ratio.toFixed(1) })}
                </span>
            </div>
        </Card>
    );
};

function daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}

export const DesignPage: React.FC = () => {
    const { t } = useTranslation();
    const [group, setGroup] = useState<GroupId>('hinatazaka');
    const [filter, setFilter] = useState<'all' | 'unread'>('all');
    const [rail, setRail] = useState<'talk' | 'blog' | 'news'>('talk');
    const [moved, setMoved] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);

    useEffect(() => applyGroupTokens(group), [group]);

    const g = groupTokens[group];
    const neutral = Object.entries(color).flatMap(([role, values]) =>
        Object.entries(values).map(([name, value]) => [`${role}.${name}`, value] as const),
    );
    const groupSwatches = [
        ['accent', g.accent], ['badge', g.badge], ['bubbleBorder', g.bubbleBorder], ['ring', g.ring],
        ['glow', g.glow], ['title.text', g.title.text], ['title.bar', g.title.bar],
        ['canvas', `linear-gradient(to bottom, ${g.canvas.join(', ')})`],
    ] as const;

    return (
        <Canvas data-testid="design-page" className="min-h-screen p-6">
            <Sheet className="mx-auto flex max-w-5xl flex-col gap-10 p-8">
                <header className="flex flex-col gap-3">
                    <h1 className="text-heading font-semibold text-primary">{t('designPage.title')}</h1>
                    <p className="text-body text-secondary">{t('designPage.subtitle')}</p>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-small text-muted">{t('designPage.group')}</span>
                        {GROUP_IDS.map((id) => (
                            <Pill key={id} selected={id === group} onClick={() => setGroup(id)}>
                                {serviceThemes[id].name || id}
                            </Pill>
                        ))}
                    </div>
                </header>

                <Section title={t('designPage.colors')}>
                    <h3 className="text-title text-secondary">{t('designPage.neutral')}</h3>
                    <div className="flex flex-wrap gap-3">
                        {neutral.map(([name, value]) => <Swatch key={name} name={name} value={value} />)}
                    </div>
                    <h3 className="text-title text-secondary">{t('designPage.groupColors')}</h3>
                    <div className="flex flex-wrap gap-3">
                        {groupSwatches.map(([name, value]) => <Swatch key={name} name={name} value={value} />)}
                    </div>
                </Section>

                <Section title={t('designPage.radius')}>
                    <div className="flex flex-wrap gap-4">
                        {(Object.keys(radius) as RadiusStep[]).map((step) => (
                            <div key={step} className="flex flex-col items-center gap-2">
                                <div className={cn('h-16 w-24 bg-sunken', RADIUS_CLASS[step])} />
                                <span className="text-caption text-muted">{step} · {radius[step]}</span>
                            </div>
                        ))}
                    </div>
                </Section>

                <Section title={t('designPage.shadow')}>
                    <div className="flex flex-wrap gap-6 bg-elevated p-6 rounded-card">
                        {(Object.keys(shadow) as ShadowStep[]).map((step) => (
                            <div key={step} className={cn('flex h-16 w-28 items-center justify-center bg-card rounded-card text-caption text-muted', SHADOW_CLASS[step])}>
                                {step}
                            </div>
                        ))}
                    </div>
                </Section>

                <Section title={t('designPage.type')}>
                    <div className="flex flex-col gap-2">
                        {(Object.keys(typeScale) as TypeStep[]).map((step) => (
                            <div key={step} className="flex items-baseline gap-4">
                                <span className="w-32 text-caption text-muted">{step} · {typeScale[step].size}/{typeScale[step].leading}</span>
                                <span className={cn('text-primary', TYPE_CLASS[step])}>{t('designPage.sample')}</span>
                            </div>
                        ))}
                    </div>
                </Section>

                <Section title={t('designPage.motion')}>
                    <div className="flex items-center gap-4">
                        <Button size="sm" onClick={() => setMoved((m) => !m)}>{t('designPage.animate')}</Button>
                        {(['duration-fast', 'duration-base'] as const).map((d) => (
                            <div key={d} className="flex w-48 flex-col gap-1">
                                <span className="text-caption text-muted">{d}</span>
                                <div className="h-8 bg-sunken rounded-pill">
                                    <div className={cn('h-8 w-8 bg-group-accent rounded-pill transition-transform ease-standard', d, moved && 'translate-x-40')} />
                                </div>
                            </div>
                        ))}
                    </div>
                </Section>

                <Section title={t('designPage.primitives')}>
                    <h3 className="text-title text-secondary">{t('designPage.surfaces')}</h3>
                    <Canvas className="p-4 rounded-card">
                        <Sheet className="p-4">
                            <Card className="p-4 text-body text-primary">Canvas › Sheet › Card</Card>
                        </Sheet>
                    </Canvas>

                    <h3 className="text-title text-secondary">{t('designPage.pills')}</h3>
                    <div className="flex gap-2">
                        <Pill selected={filter === 'all'} onClick={() => setFilter('all')}>{t('designPage.filterAll')}</Pill>
                        <Pill selected={filter === 'unread'} onClick={() => setFilter('unread')}>{t('designPage.filterUnread')}</Pill>
                    </div>

                    <h3 className="text-title text-secondary">{t('designPage.badges')}</h3>
                    <div className="flex items-center gap-3">
                        {[0, 1, 99, 100].map((n) => <Badge key={n} count={n} />)}
                    </div>

                    <h3 className="text-title text-secondary">{t('designPage.avatars')}</h3>
                    <div className="flex items-center gap-4">
                        <Avatar src="/logo-192.png" name="SakaDesk" size="sm" />
                        <Avatar src="/logo-192.png" name="SakaDesk" size="md" />
                        <Avatar src="/logo-192.png" name="SakaDesk" size="lg" selected />
                        <Avatar name="日向坂" size="xl" />
                    </div>

                    <h3 className="text-title text-secondary">{t('designPage.datePills')}</h3>
                    <div className="flex flex-wrap gap-2">
                        {[0, 1, 10, 400].map((n) => <DatePill key={n} date={daysAgo(n)} />)}
                    </div>

                    <h3 className="text-title text-secondary">{t('designPage.buttons')}</h3>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="primary">{t('designPage.primary')}</Button>
                        <Button>{t('designPage.secondary')}</Button>
                        <Button variant="ghost">{t('designPage.ghost')}</Button>
                        <Button disabled>{t('designPage.disabled')}</Button>
                        <Button size="sm">{t('designPage.secondary')}</Button>
                        <IconButton aria-label={t('designPage.close')} icon={<X />} />
                        <IconButton aria-label={t('designPage.close')} icon={<Settings />} variant="secondary" size="sm" />
                    </div>

                    <h3 className="text-title text-secondary">{t('designPage.rail')}</h3>
                    <div className="flex w-24 flex-col gap-1 bg-group-canvas p-2 rounded-card">
                        <RailItem icon={<MessageCircle />} label={t('features.messages')} selected={rail === 'talk'} onClick={() => setRail('talk')} />
                        <RailItem icon={<BookOpen />} label={t('features.blogs')} selected={rail === 'blog'} onClick={() => setRail('blog')} />
                        <RailItem icon={<Newspaper />} label={t('features.news')} selected={rail === 'news'} onClick={() => setRail('news')} />
                        <RailItem icon={<Search />} label={t('designPage.filterAll')} />
                    </div>

                    <h3 className="text-title text-secondary">{t('designPage.modal')}</h3>
                    <div>
                        <Button onClick={() => setModalOpen(true)}>{t('designPage.openModal')}</Button>
                    </div>
                    <Modal
                        isOpen={modalOpen}
                        onClose={() => setModalOpen(false)}
                        title={t('designPage.modalTitle')}
                        footer={<Button variant="primary" onClick={() => setModalOpen(false)}>{t('designPage.close')}</Button>}
                    >
                        {t('designPage.modalBody')}
                    </Modal>
                </Section>

                <Section title={t('designPage.rules')}>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {(['1', '2', '3'] as const).map((n) => (
                            <React.Fragment key={n}>
                                <Card className="flex flex-col gap-1 p-4">
                                    <span className="text-caption font-semibold text-secondary">{t('designPage.do')}</span>
                                    <span className="text-body text-primary">{t(`designPage.do${n}`)}</span>
                                </Card>
                                <Card className="flex flex-col gap-1 p-4">
                                    <span className="text-caption font-semibold text-muted">{t('designPage.dont')}</span>
                                    <span className="text-body text-primary">{t(`designPage.dont${n}`)}</span>
                                </Card>
                            </React.Fragment>
                        ))}
                    </div>
                </Section>
            </Sheet>
        </Canvas>
    );
};
```

Note: the swatch `style={{ background: value }}` reads a token variable, not a literal, so the guard stays at 0 for this file.

- [ ] **Step 6: Route `?view=design` in `main.tsx` (DEV only)**

In `frontend/src/shell/main.tsx`, add `import { isDesignView } from '../design/designRoute'` with the other imports, and change the routing `if` chain to start with the design page:

```tsx
// Dev-only style page. `import.meta.env.DEV` is the literal `false` in production
// builds, so this whole branch — including the chunk import — is dropped.
if (import.meta.env.DEV && isDesignView(window.location.search)) {
    import('../design/DesignPage').then(({ DesignPage }) => {
        root.render(
            <React.StrictMode>
                <DesignPage />
            </React.StrictMode>,
        )
    }).catch(() => clientLog('app_load_failed', { error_type: 'design_page' }))
} else if (isCallPopupView(window.location.search)) {
```

(The existing `if (isCallPopupView(...)) { … } else { … }` becomes `else if … else …`; nothing else changes.)

- [ ] **Step 7: Run the tests, the guard and the type check**

Run: `npx vitest run src/design src/i18n src/shell && npx tsc --noEmit`
Expected: PASS. The guard test still passes, which means the page and primitives have no hard-coded values.

- [ ] **Step 8: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src/design frontend/src/shell/main.tsx frontend/src/i18n
uv run git commit -m "feat(design): add dev-only living style page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Design-system docs and the agent rule

**Files:**
- Create: `docs/design/DESIGN_SYSTEM.md`
- Modify: `CLAUDE.md` (SakaDesk)

**Interfaces:**
- Consumes: the names from Tasks 2–11 (must match exactly; this is the Zero-Drift rule).

- [ ] **Step 1: Write `docs/design/DESIGN_SYSTEM.md`**

```markdown
# SakaDesk design system

Every screen uses one design language. This file says what it is and how to
use it. **Read it before you add or change any UI.**

- Tokens live in `frontend/src/design/tokens/`. They are the only place style
  values are defined.
- Primitives live in `frontend/src/design/primitives/`.
- See everything live at `http://localhost:5173/?view=design` (dev server
  only; `npm run dev` in `frontend/`). The page has a group switcher and
  contrast labels.

## The four levels

| Level | Primitive | Corners | Shadow | Holds |
|---|---|---|---|---|
| 0 Background | `Canvas` | none | none | rails, the space around the sheet |
| 1 Sheet | `Sheet`, `Modal` | `rounded-sheet` (20px) | `shadow-sheet` | the one content area: chat, blog, dialogs |
| 2 Card | `Card` | `rounded-card` (14px) | `shadow-card` | bubbles, photos, info cards |
| 3 Pill | `Pill`, `Badge`, `DatePill`, `Button` | `rounded-pill` | `shadow-pill` | tabs, filters, dates, badges, buttons |

A level sits on the level below it. Do not put a sheet on a card.

## Where group colour may appear

Group colour comes from `groupTokens` and follows the active service
automatically through CSS variables. A primitive never takes a group id.

1. **Title gradient:** `bg-group-title-bar`, `text-group-title`, `--ds-group-title-*`
2. **Selection ring and glow:** `Avatar selected`, `shadow-group-glow`, `ring-group` for keyboard focus
3. **Bubble border:** `border-group-bubble`
4. **Badge:** `Badge`, `bg-group-badge`

**Exception:** at most **one** `Button variant="primary"` per screen, which
uses `bg-group-accent` (e.g. the call screen's "answer", a dialog's "save").

The level-0 background (`Canvas`, `bg-group-canvas`) is the official sidebar
gradient. Everything else is neutral: `bg-sheet/card/pill/elevated/sunken`
and `text-primary/secondary/muted/inverse`.

## Scales

| Scale | Utilities | Values |
|---|---|---|
| Text | `text-caption` `text-small` `text-body` `text-title` `text-heading` | 11/16, 13/20, 14/22, 16/24, 20/28 px |
| Radius | `rounded-card` `rounded-sheet` `rounded-pill` (and `rounded-none`) | 14px, 20px, full |
| Shadow | `shadow-pill` `shadow-card` `shadow-sheet` | faint, small, large-soft |
| Spacing | Tailwind default scale (`p-4` = 16px) | multiples of 4px only |
| Motion | `duration-fast` `duration-base` `ease-standard` | 150ms, 200ms, `cubic-bezier(0.2, 0, 0, 1)` |

framer-motion reads numbers from `design/tokens/motion.ts`:
`transition={{ duration: motion.duration.base / 1000, ease: motion.easing.standard }}`.

Token colours are CSS variables, so Tailwind opacity modifiers such as
`bg-sheet/50` do not work. Add a token instead.

## Which primitive when

| Need | Use |
|---|---|
| Group background behind everything | `Canvas` |
| Main content area or dialog body | `Sheet` / `Modal` |
| A boxed item on a sheet | `Card` |
| Tab or filter | `Pill` (`selected` is neutral, never group colour) |
| Unread count | `Badge count={n}` (hidden at 0, `99+` cap) |
| Person or member | `Avatar` (`selected` for the current member) |
| Timeline date | `DatePill` (`sticky` inside scrolling timelines) |
| Action | `Button` (`primary` max once per screen, else `secondary` / `ghost`) |
| Icon-only action | `IconButton` (`aria-label` is required) |
| Feature-rail entry | `RailItem` |

Screen-specific components (message bubble, member grid cell, chat header)
are composed from these in the feature folder. They are not primitives.

## Do / Don't

| Do | Don't |
|---|---|
| Separate blocks with spacing and levels | Draw straight divider lines (`border-b` between list items, `<hr>`) |
| Use token classes (`rounded-card`, `text-body`, `bg-sheet`) | Hard-code `#hex`, `rgb()`, or arbitrary `rounded-[..]`, `shadow-[..]`, `text-[..]`, `p-[..]` |
| Keep group colour in the four places, plus one primary button | Colour any other element with the group colour |
| Translate every visible string (`t('…')`) | Put text in primitives; callers pass translated labels |
| Use role names for new tokens (`surface.x`) | Name tokens after hues (`lightBlue`) — dark mode will reuse the names |

## Adding or changing a token

1. Edit the right file in `frontend/src/design/tokens/`.
2. Expose it in `frontend/src/design/cssVars.ts`, and in `tailwind.config.js`
   if it needs a utility (and in `utils/classnames.ts` if the utility uses a
   `text-`, `rounded-`, `shadow-`, `duration-` or `ease-` prefix).
3. Show it on `DesignPage.tsx`.
4. Document it here.
5. Changing a pre-D1 value changes pixels on existing screens. Update
   `design/__fixtures__/legacy-theme-values.json` only when that change is
   intended, and say so in the PR.

## The guard (ratchet)

`frontend/src/design/guard.test.ts` counts hard-coded style values per file:
hex colours, `rgb()`/`hsl()`, and arbitrary radius / shadow / text / spacing
values. Width, height and position arbitrary values are allowed. It compares
the counts with `guard-baseline.json`:

- A new file must have 0.
- An existing file may not go up.
- When a file goes down, the test fails until you lower its number (or
  remove the entry at 0).

To rewrite the baseline after converting screens:

    UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts

Review the diff: numbers should only go down.

## Dark mode

Not built yet. Token names are roles so a dark value set can be added
later without renaming anything.
```

- [ ] **Step 2: Add the agent rule to `SakaDesk/CLAUDE.md`**

Append after the "Documentation formats" section:

```markdown
## UI design system (MUST follow)

New or changed UI must use the design-system tokens and primitives in
`frontend/src/design/`. Read `docs/design/DESIGN_SYSTEM.md` before touching UI:
it defines the four levels, the only places group colour may appear, and the
Do/Don't list. Never hard-code colours or arbitrary radius / shadow / text /
spacing values — `frontend/src/design/guard.test.ts` fails the build on new
ones. Preview tokens and primitives at `?view=design` on the dev server.
```

- [ ] **Step 3: Check that the docs name only things that exist**

Run from `SakaDesk`:

```bash
for name in Canvas Sheet Card Pill Badge Avatar DatePill Button IconButton RailItem Modal; do
  grep -q "export const $name\b" frontend/src/design/primitives/*.tsx || echo "MISSING $name"
done
for cls in bg-group-title-bar text-group-title shadow-group-glow ring-group border-group-bubble bg-group-badge bg-group-accent bg-group-canvas; do
  key=${cls#*-}; grep -q "'${key#group-}'\|'group-${key#group-}'\|${key}:" frontend/tailwind.config.js || echo "CHECK $cls"
done
```

Expected: no `MISSING` lines. For any `CHECK` line, confirm by hand that the utility exists in `tailwind.config.js` (`textColor['group-title']`, `ringColor.group`, `boxShadow['group-glow']`, and so on). The grep is a coarse helper; the reading is what counts.

- [ ] **Step 4: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add docs/design/DESIGN_SYSTEM.md CLAUDE.md
uv run git commit -m "docs(design): document the design system and agent rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Verify everything, prove zero pixels, open the PR

**Files:** none new (fixes only if a check fails).

- [ ] **Step 1: Full frontend checks**

Run from `SakaDesk/frontend`:

```bash
npx vitest run
npx tsc --noEmit
npm run lint
```

Expected: all pass; lint warnings ≤ 20 (the `--max-warnings 20` limit). Record the vitest test count for the PR.

- [ ] **Step 2: Full backend checks**

Run from `SakaDesk`:

```bash
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
uv run mypy backend/
```

Expected: all pass. A keyring-related error in a headless WSL run is a known pre-existing issue. If one appears, confirm that it also fails on `dev` and mention it in the PR instead of "fixing" it. Record the pytest count.

- [ ] **Step 3: The production build excludes the style page**

Run from `SakaDesk/frontend`:

```bash
npm run build
grep -l "design-page" dist/assets/*.js || echo "style page not in production bundle"
```

Expected: `style page not in production bundle`. `design-page` is the page's root test id, so it appears only if the page chunk was built. (The `designPage.*` i18n strings are bundled with the locales on purpose.) If a file matches, the DEV guard in `main.tsx` is wrong. Fix it before continuing.

- [ ] **Step 4: Zero-pixel comparison**

Run from `SakaDesk/frontend` (uses the `dist` just built and the Task 1 baselines):

```bash
npx playwright test e2e/visual-zero-pixel.spec.ts --reporter=line
```

Expected: `3 passed`. A failure means a pixel changed. Open `playwright-report/` (`npx playwright show-report` serves it; open the URL in the Windows browser with `powershell.exe -NoProfile -Command "Start-Process '<url>'"`). Find the cause and fix it. **Never** run `--update-snapshots` here.

- [ ] **Step 5: Show the style page to the user**

Start the dev server from `SakaDesk/frontend` in the background:

```bash
npm run dev -- --port 5173
```

Then open it in the **Windows** browser (never Playwright/WSLg):

```bash
powershell.exe -NoProfile -Command "Start-Process 'http://localhost:5173/?view=design'"
```

Ask the user to check:
- (a) the page looks right in all five groups;
- (b) the Hinatazaka badge contrast label reads 1.9:1, and whether they want it darkened later (default: no change);
- (c) the normal app at `http://localhost:5173/` looks unchanged.

Stop the dev server afterwards.

- [ ] **Step 6: Push and open the PR**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
uv run git push -u origin feat/d1-design-system
cat > /tmp/d1-pr-$$.md <<'EOF'
## Why
SakaDesk had no shared design language: colours were spread over two config
sources plus hard-coded hex in 32 components, and radii/shadows were mixed.
D1 lays the foundation for the D2 screen redesign without changing any pixel.

## What
**Frontend**
- Design tokens in `src/design/tokens/` (role-named neutral colours, per-group colours, radius, shadow, type, motion) as the single source; `serviceThemes.ts` and `config/colors/` now read them.
- `applyStaticTokens` / `applyGroupTokens` write `--ds-*` CSS variables (plus the unchanged legacy `--color-*`); Tailwind utilities and `cn` know the token classes.
- Primitives: Canvas, Sheet, Card, Pill, Badge, Avatar, DatePill, Button, IconButton, RailItem, Modal; `formatDatePillLabel`.
- Dev-only `?view=design` style page (dropped from production builds).
- Ratchet guard test with a baseline of today's hard-coded values; new files must be clean.
- Breadcrumbs: `design_tokens_applied`, `design_tokens_fallback`, `avatar_fallback`.

**Backend**
- `client_log` whitelists the three new events and the `theme` / `size` fields.

**Docs**
- `docs/design/DESIGN_SYSTEM.md`; CLAUDE.md rule that new UI must use the system.

## Testing
- frontend <N> · backend <M> · tsc / eslint / ruff / mypy clean (fill in from Steps 1–2)
- Token values pinned against a fixture captured from `dev` before the change.
- Playwright headless pixel comparison (home, member chat, group chat in backend test mode): identical.
- Not covered by the pixel test: blog, modals, call screen (not reachable in test mode) — covered by the value-equality tests and a manual check in the dev build.

## Changelog
No user-facing change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Replace `<N>` and `<M>` with the real counts in the file, then:

```bash
gh pr create --base dev --title "feat(design): add design-system foundation" --body-file /tmp/d1-pr-$$.md && rm /tmp/d1-pr-$$.md
```

Expected: the PR URL. The PreToolUse hook validates the format; if it blocks, fix the body per `docs/DOC_FORMATS.md` and rerun.

---

## Self-review notes (for the plan author)

- **Spec coverage:**

| Spec item | Task |
|---|---|
| Tokens | 2 |
| Legacy reads tokens | 3 |
| CSS variables, `main.tsx` / `App.tsx` wiring, removal of `applyThemeToDocument` | 4 |
| Tailwind utilities, `cn` | 5 |
| Date label | 6 |
| Primitives | 7–9 |
| Guard | 10 |
| `/design` page, prod exclusion | 11, 13.3 |
| Docs, CLAUDE.md | 12 |
| Logging, frontend and backend | 4 (events), 8 (`avatar_fallback`) |
| Testing list | per task, plus 13 |
| Zero-pixel | 1, 13.4 |
| PR, Changelog | 13.6 |

- **Type names used across tasks:** `GroupId`, `GROUP_IDS`, `groupTokens`, `GroupTokens`, `color`, `radius`, `shadow`, `typeScale`, `motion`, `easingCss`, `staticTokenVars`, `groupTokenVars`, `applyStaticTokens`, `applyGroupTokens`, `formatDatePillLabel`, `DatePillKey`, `isDesignView`, `contrastRatio`, `parseHex`, `countViolations`, `isScanned`, `scanTree`, `compareToBaseline`.
