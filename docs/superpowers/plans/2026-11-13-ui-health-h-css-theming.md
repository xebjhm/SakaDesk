# UI Health H — CSS, CJK Typography and Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Third of three plans for the UI-health findings of the 0.5.0 audit (`/home/xtorker/repos/Project-Saka/audits/2026-11-13-sakadesk-0.5.0/ui/UI-HEALTH-REPORT.md` and `report-css-theming.md`). It is independent of **F** (performance) and **G** (accessibility); where they edit the same element each task says how to merge. Recommended order F → G → H. Task 2 styles the ARIA states that G adds (`aria-current` on conversations, `aria-selected` on search options and tabs); it adds `aria-current` to the conversation tiles itself when G has not run. **This plan owns `InlineTranslation.tsx`** (Task 3: contrast, `aria-expanded`, `lang`), so G does not touch it.

**What this plan closes** (`#n` = UI-HEALTH-REPORT priority; `C-xx` = row of Appendix A, from `report-css-theming.md`):

| Task | Closes |
|---|---|
| 1 | #4, C-Y1: message, memory and letter text clipped (`whitespace-pre-wrap` without `overflow-wrap`) |
| 2 | #6, C-F1 (+ A-D5 underline, A-S1 ring, A-C2 check): no `forced-colors` support |
| 3 | #10, C-Y2, C-T3 (+ #12 / A-C1 / A-S4 translation parts): translations in Japanese glyphs, italic CJK, duplicated JP stack, low-contrast toggle |
| 4 | C-L1, C-L4, C-L5: centred scrollers clip; Button labels squeezed; Settings content shifts with its scrollbar |
| 5 | C-Y6, C-Y5: no `tabular-nums` on times/counts; no `text-wrap` / phrase breaking on headings |
| 6 | C-I1, C-I2: crash screen in English with palette classes; numbers follow the Windows locale |
| 7 | C-F3, C-T2: no `color-scheme`; unused legacy `--color-*` layer rewritten on every group switch |
| 8 | C-T5: tailwind-merge registry stale |
| 9 | #14, C-T1 (+ C-T4, C-L6 z-index): the guard misses palette classes, `z-40/50`, arbitrary values and CSS files |
| 10 | CHANGELOG and final verification |

**Goal:** Text never clips, translations look like their own language, High Contrast keeps every state visible, and the design guard catches the drift it missed — without changing the accepted look.

**Architecture:** One `@media (forced-colors: active)` block in `index.css` keyed on existing ARIA state; `overflow-wrap` on every pre-wrapped text with a source-scan test; per-language font stacks written once as CSS variables by `design/fonts.ts` and used by `[lang]` content rules; a second guard ratchet (`drift-guard-baseline.json`) for palette classes, layering classes, Tailwind default sizes, arbitrary values and CSS colour literals.

**Tech Stack:** Tailwind 3.4 (`forced-colors:` / plugin utilities), plain CSS in `frontend/src/index.css`, React 18.3, TypeScript 5, i18next; vitest 4 + Testing Library; Playwright 1.57 (`emulateMedia({ forcedColors })`). No new dependencies.

## Global Constraints

- Worktree: `/home/xtorker/repos/Project-Saka/SakaDesk-hardening`, branch `fix/050-security-hardening`. **Re-read every file before editing it and match code by text, not line number.** Where another plan already changed the element a step edits, keep its changes and add this step's classes/attributes (both are needed).
- Runtime: WebView2 (evergreen Chromium) only; current stable Chromium features without fallbacks (UI-HEALTH-REPORT §4) — `text-wrap`, `word-break: auto-phrase`, `forced-colors`, `safe` alignment are all fine.
- **UI design system is mandatory** (`SakaDesk-hardening/CLAUDE.md`, `docs/design/DESIGN_SYSTEM.md`): tokens and primitives only; new utilities go through `tailwind.config.js` plugins and are registered in `frontend/src/utils/classnames.ts`; `frontend/src/design/guard.test.ts` stays green, and when a task removes literals it lowers the baselines (`UPDATE_GUARD_BASELINE=1` / after Task 9 also `UPDATE_DRIFT_BASELINE=1 npx vitest run src/design/guard.test.ts`; the diff only goes down). **No visual change** except where the Decisions section names one; document changed rules in `docs/design/DESIGN_SYSTEM.md` in the same task.
- i18n: new strings in all five locales (`frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json`, 2-space JSON, `ensure_ascii=False`, trailing newline), listed in `frontend/src/i18n/uiHealthTheming.test.ts`.
- Japanese content keeps `lang="ja"`; translated text carries its own language; UI chrome is never marked.
- Breadcrumbs: new decision/failure paths call `clientLog` with codes only.
- Frontend commands from `frontend/`: `npx vitest run <path>`, `npx tsc --noEmit`, `npm run lint`; snapshot updates with `-u` and a review of the `.snap` diff. E2E: `npm run build && npx playwright test <spec> --reporter=line`, port 8000 free.
- Python: `uv run`, never pip.
- Commits: Conventional Commits `type(scope): subject`, imperative, ≤ 72 chars, no trailing period; `uv run git commit`; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- CHANGELOG under `## [Unreleased]` (`### Changed` / `### Fixed`), end-user wording, **bold lead-in**, ≤ 3 sentences, no code identifiers.
- WSL safety: never `find /` or scan `/mnt/*`; limit searches to the worktree with `-xdev`, exclude `node_modules`; wrap long searches in `timeout 60`.

## Decisions (reviewers: these are deliberate; the owner confirms the ones marked ⚑)

1. **`break-words` (`overflow-wrap: break-word`) on every `whitespace-pre-wrap` / `pre-line` text**, enforced by a source scan. Unbreakable runs (`wwwww`, `〜〜〜`, `……`, `！！！`) now wrap inside the bubble instead of being cut off. No change for normal text.
2. **High Contrast = one `forced-colors` block** in `index.css`: the Switch gets a `ButtonText` border and thumb, `Highlight` track when on (`forced-color-adjust: none` only there: it carries the state); selection drawn only by a tint or a shadow ring (`aria-pressed`, `aria-current`, `aria-selected`, checked menu radios) gets a 2 px `Highlight` outline; sheet/card/pill/dialog/menu edges get a 1 px `CanvasText` outline (inset, so no layout change), except the full-screen dark viewer (a dialog inside `data-surface="dark"`), which would otherwise get a frame round the whole window; the scrollbar thumb is `CanvasText`, including on hover and on dark surfaces (whose own thumb rules are more specific and would otherwise lose the thumb). Users with "more contrast" also get a darker scrollbar thumb. Normal mode is unchanged. The white captions on light gradient ends (§12 accepted deviation) need nothing: forced colours replace both the gradient and the text colour (Windows owner check 1).
3. **Translations carry their own language:** message translations get `lang` = the translation target language, injected blog lines too; `[lang="zh-TW"|"zh-CN"|"yue"|"en"]` content rules switch the font variables (like the existing `ja` rule; one `:is(…)` companion rule per face keeps `.font-display` / `.font-reading` on marked elements in every one of these languages, not only `ja`), and the target language's faces load when a translation shows. ⚑ CJK translations are upright (no fake italic); English blog translations stay italic. ⚑ The translation toggle and re-run icon move from `#94a3b8`/`#cbd5e1` to `text-muted` (4.8:1), the message translation text to `text-muted` and the blog translation line to `text-secondary` with the same `border-l-2 border-strong` as the injected blog lines (was a 1.5 px `#d1d5db` line). Per-language stacks are written once by `design/fonts.ts` as `--ds-font-sans-<lang>` / `--ds-font-serif-<lang>`, so `index.css` no longer copies the JP stack.
4. **Safe alignment:** named utilities `justify-safe-center` / `items-safe-center` (plugin, registered in `cn()`) replace centring inside scrollers (FilmStrip, Gacha). Visible only where content overflowed (the oldest film frame is reachable again).
5. ⚑ **Button labels never squeeze:** `Button` uses `min-h-8`/`min-h-10` and `whitespace-nowrap` (a CJK label can no longer shrink to one character per line). Identical for every single-line label today. Risk: in a narrow footer (the crash card's two `flex-1` buttons, ConfirmDialog footers) a long Japanese or Cantonese label now overflows its button instead of wrapping; Windows owner check 4 looks for it. Default: apply.
6. ⚑ **Settings' content pane reserves its scrollbar gutter** (`scrollbar-gutter: stable`): switching between a short and a long tab no longer moves the content by 10 px. The shared `Modal` body is left as is (reserving a gutter in every dialog narrows the accepted layouts on the right).
7. ⚑ **`tabular-nums` on message times, unread badges and the chat header's unread pill** (DESIGN_SYSTEM §8 asks for it); ⚑ **`text-wrap: balance`** on EmptyState and landing headings, **`text-wrap: pretty`** on blog post bodies, and **`word-break: auto-phrase`** (named utility `phrase-break`) on Japanese blog titles in the reader and on the feed cards: line breaks change slightly (no orphans, no phrase split mid-word).
8. ⚑ **Crash screen on the design system:** translated (5 locales), brand scope, `bg-window` page, a `Sheet`-like card with a plain header: the error-state danger icon tile (`bg-semantic-danger-icon` + `text-semantic-danger`, as `StatusBlock kind="error"` draws it) beside the title in `text-primary` (no solid danger header: DESIGN_SYSTEM "Semantic colours" keeps the solid step for destructive buttons and finished-step marks), `Button secondary` "Try again" and `Button primary` "Report issue", safe-centred, and a `clientLog` breadcrumb. Seen only after a render crash. Default: apply. It uses the `Button` primitive and `brandScopeStyle` like any new UI (plain `<button>`s would survive a crash inside those primitives, but a crash there already breaks most of the app; the primitives rule wins).
9. **Numbers follow the UI language** (`toLocaleString(i18n.language)` in the sync views). The hand-built `YYYY/MM/DD HH:mm` (`formatDateTime`, 18 call sites) and the gallery's `YYYY / MM` month labels are won't-fix: they are unambiguous in all five UI languages and changing them is a visible format change across the app.
10. **Legacy colour layer removed:** the `--color-*` block in `index.css`, the `theme-*`/`surface-*`/`text-*`/`feedback-*`/`brand-*` colours and `theme-gradient*` images in `tailwind.config.js` (no usage anywhere), and its write on every group switch (`applyGroupTokens`). `generateThemeCSSVariables` stays for the pre-D1 equality tests. ⚑ `body` text moves from `text-gray-900` (#111827) to `text-primary` (#1f2937) — only text without its own colour class. `<meta name="color-scheme" content="light">` + `:root { color-scheme: light }`: form controls and scrollbars stay light whatever Windows' theme (the app has no dark mode yet). The `#F0F2F5` body background stays (it must match pywebview's window colour).
10a. ⚑ **`cn()` merges two classes of the newly registered `animate-*` / `shadow-*` keys** (Task 8): where both are passed, only the last one stays, as with every other utility group. A grep of every non-test `cn(…)` and `className` found no call site that passes two of them today (the keys are used alone: `shadow-memories-polaroid` in the Memories paper surfaces, `animate-progress-indeterminate` in `ProgressBar`, `animate-star-fall` / `animate-fan-in` / `animate-petal-fall` in the recap slides), so nothing changes on screen. Default: apply.
11. **Second guard ratchet ("drift")** in `design/guard.ts`: named palette classes (incl. `black`/`white`), `z-40`/`z-50`/`z-[…]`, Tailwind default font sizes (`text-xs`…`text-9xl`), arbitrary `leading/tracking/duration/delay/ease/bg/border/ring/outline/fill/stroke/from/via/to/decoration/blur-[…]`, plus hex/`rgb()`/`hsl()` literals in `*.css` and `tailwind.config.js`. Baseline `drift-guard-baseline.json` (same rules: new files 0, counts only go down, no `design/` entries). The three existing `z-40`/`z-50` sites (TimelineRail tooltip, VideoPlayer clipboard toast, Postcard caption) and `callScreen.css`'s 57 literals are ratcheted, not restyled (the call screen's glass look was accepted; recolouring it is a redesign).
12. **Won't-fix here** (Appendix A has each reason): container queries for pane layouts (C-L2), a bubble width cap (C-L3), JS layout in MemberSelectModal (C-L6 part), a `ClampText` primitive (C-Y3), MemberPane title-only names (C-Y7), the px type scale (C-Y8), a darker default scrollbar thumb (C-Y9), translating Developer Diagnostics (C-I1 part, owner ⚑).

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/src/features/messages/components/MessageBubble.tsx`, `frontend/src/features/memories/shared/MemoryText.tsx`, letter/favourite/recap/confirm text files | modify (Tasks 1, 5) | wrapping, tabular times |
| `frontend/src/design/textWrap.test.ts` | create (Task 1) | source scan: pre-wrap needs break-words |
| `frontend/src/index.css` | modify (Tasks 2, 3, 7) | forced colours, `[lang]` rules, color-scheme, legacy block removed |
| `frontend/src/design/forcedColors.test.ts` | create (Task 2) | CSS contract |
| `frontend/src/design/fonts.ts` | modify (Task 3) | `writeLanguageStacks`, `loadLanguageFaces`, `isCjkLanguage` |
| `frontend/src/core/common/InlineTranslation.tsx`, `frontend/src/features/blogs/hooks/useInlineBlogTranslations.ts`, `frontend/src/features/blogs/components/BlogReader.tsx` | modify (Tasks 3, 5) | translation lang, tokens, phrase-break title |
| `frontend/tailwind.config.js`, `frontend/src/utils/classnames.ts` | modify (Tasks 4, 5, 7, 8) | plugin utilities, legacy colours removed, merge registry |
| `frontend/src/features/memories/favorites/FilmStrip.tsx`, `frontend/src/features/memories/gacha/GachaPage.tsx`, `frontend/src/design/primitives/Button.tsx`, `frontend/src/shell/components/SettingsModal.tsx` | modify (Task 4) | safe centring, label wrap, gutter |
| `frontend/src/design/primitives/{Badge,EmptyState}.tsx`, `frontend/src/pages/LandingPage.tsx`, `frontend/src/features/blogs/components/{BlogCard,BlogBody}.tsx`, `frontend/src/features/messages/MessagesFeature.tsx` | modify (Task 5) | numerals, wrapping |
| `frontend/src/core/common/ErrorBoundary.tsx`, sync views | modify (Task 6) | crash screen, locale numbers |
| `frontend/index.html`, `frontend/src/design/applyTokens.ts` | modify (Task 7) | color-scheme meta, no legacy write |
| `frontend/src/design/guard.ts`, `frontend/src/design/guard.test.ts`, `frontend/src/design/drift-guard-baseline.json` | modify / create (Task 9) | drift ratchet |
| `docs/design/DESIGN_SYSTEM.md` | modify (Tasks 2–5, 9) | rules |
| `frontend/e2e/theming.spec.ts` | create (Tasks 1, 2) | real-browser wrap and forced colours |

---

### Task 1: Her words are never clipped

**Files:**
- Create: `frontend/src/design/textWrap.test.ts`
- Modify: `frontend/src/features/messages/components/MessageBubble.tsx`, `frontend/src/features/memories/shared/MemoryText.tsx`, `frontend/src/core/modals/FavoritesModal.tsx`, `frontend/src/features/messages/components/LetterRow.tsx`, `frontend/src/core/modals/LetterViewerModal.tsx`, `frontend/src/core/modals/SentLettersModal.tsx`, `frontend/src/features/memories/recap/slides/S07Letter.tsx`, `frontend/src/features/memories/thenNow/ThenNowPair.tsx`, `frontend/src/features/memories/recap/slides/common.tsx`, `frontend/src/shell/components/ConfirmDialog.tsx`, `frontend/src/core/modals/DiagnosticsModal.tsx`
- Modify: `frontend/src/features/messages/components/__snapshots__/MessageBubble.test.tsx.snap`
- Create: `frontend/e2e/theming.spec.ts`

- [ ] **Step 1: Write the failing source scan**

Create `frontend/src/design/textWrap.test.ts`:

```ts
// Runs in jsdom like guard.test.ts (node:fs works there too).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');

function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return sources(full);
        return /\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) ? [full] : [];
    });
}

describe('pre-wrapped text can break long runs (UI health #4)', () => {
    it('every whitespace-pre-wrap / pre-line class list also has break-words or break-all', () => {
        const offenders: string[] = [];
        for (const file of sources(SRC)) {
            readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
                if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments describe, they do not style
                if (/whitespace-pre-(wrap|line)/.test(line) && !/break-(words|all)/.test(line)) {
                    offenders.push(`${path.relative(SRC, file).split(path.sep).join('/')}:${i + 1}`);
                }
            });
        }
        expect(offenders).toEqual([]);
    });
});
```

Run: `cd frontend && npx vitest run src/design/textWrap.test.ts`
Expected: FAIL listing about 14 lines (MessageBubble, MemoryText, FavoritesModal, LetterRow, LetterViewerModal, SentLettersModal ×2, S07Letter, ThenNowPair, recap `slides/common.tsx`, ConfirmDialog, DiagnosticsModal, InlineTranslation ×2, ErrorBoundary).

- [ ] **Step 2: Add `break-words` at each site**

Add `break-words` right after `whitespace-pre-wrap` / `whitespace-pre-line` in the class list at:
- `features/messages/components/MessageBubble.tsx` — the text div: `'whitespace-pre-wrap break-words text-body text-primary',`
- `features/memories/shared/MemoryText.tsx` — `className={cn('whitespace-pre-wrap break-words', className)}` (and update its doc comment: "line breaks kept (`whitespace-pre-wrap`) and long runs wrapped (`break-words`)")
- `core/modals/FavoritesModal.tsx`, `features/messages/components/LetterRow.tsx`, `core/modals/LetterViewerModal.tsx`, `core/modals/SentLettersModal.tsx` (both `<p>`s), `features/memories/recap/slides/S07Letter.tsx`, `features/memories/thenNow/ThenNowPair.tsx`, `features/memories/recap/slides/common.tsx` (the `Quote`), `shell/components/ConfirmDialog.tsx`, `core/modals/DiagnosticsModal.tsx` (the log block).

`InlineTranslation.tsx` is rewritten in Task 3 and `ErrorBoundary.tsx` in Task 6 (both add `break-words`); until then the scan lists them. To keep this task's test green on its own, add `break-words` to their pre-wrap lines now (Tasks 3 and 6 keep it).

- [ ] **Step 3: Refresh the bubble snapshot and run the tests**

Run: `cd frontend && npx vitest run src/features/messages/components/MessageBubble.test.tsx -u && git diff -- src/features/messages/components/__snapshots__ | grep '^[-+]' | grep -v '^[-+][-+]'`
Expected: only the text div's class lines change (`whitespace-pre-wrap` → `whitespace-pre-wrap break-words`).

Run: `cd frontend && npx vitest run src/design src/features src/core src/shell`
Expected: PASS.

- [ ] **Step 4: Real-browser check**

Create `frontend/e2e/theming.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, TZ, type FixtureMessage } from './fixtures/bigRoom'

// CSS contracts that need real layout (UI health plan H).

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

test.describe('theming', () => {
  let messages: { current: FixtureMessage[] }

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    messages = { current: buildBigRoom() }
  })

  test('an unbreakable run wraps inside its bubble instead of being cut off', async ({ page }) => {
    const last = messages.current[messages.current.length - 1]
    messages.current[messages.current.length - 1] = { ...last, content: `w${'w'.repeat(300)}〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜！！！！！！！！！！！！！！！！` }
    await pinBigRoom(page, { messages })
    await page.goto('/')
    await page.getByText('Big Room', { exact: true }).click()
    const text = page.locator(`#msg-${COUNT} [lang="ja"].whitespace-pre-wrap`)
    await expect(text).toBeVisible({ timeout: 10000 })
    const fits = await text.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    expect(fits).toBe(true)
  })
})
```

Run: `cd frontend && npm run build && npx playwright test e2e/theming.spec.ts --reporter=line`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src frontend/e2e/theming.spec.ts
uv run git commit -m "fix(chat): wrap long unbroken runs instead of clipping them" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Windows High Contrast keeps every state and edge visible

**Files:**
- Modify: `frontend/src/index.css`
- Create: `frontend/src/design/forcedColors.test.ts`
- Modify (only if Plan G Task 9 has not run): `frontend/src/features/messages/components/MemberList.tsx`
- Modify: `docs/design/DESIGN_SYSTEM.md` (new subsection under "Reference": "High Contrast (forced colours)")
- Modify: `frontend/e2e/theming.spec.ts`

- [ ] **Step 1: Write the failing contract test**

Create `frontend/src/design/forcedColors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf-8');
const block = (() => {
    const start = css.indexOf('@media (forced-colors: active)');
    return start === -1 ? '' : css.slice(start);
})();

describe('forced colours (UI health #6)', () => {
    it('has one forced-colours block', () => {
        expect(css.match(/@media \(forced-colors: active\)/g)).toHaveLength(1);
    });

    it.each([
        '[role="switch"]',
        '[role="switch"][aria-checked="true"]',
        '[aria-pressed="true"]',
        '[aria-current="page"]',
        '[aria-current="true"]',
        '[aria-selected="true"]',
        '.shadow-card',
        '[role="dialog"]:not([data-surface="dark"] *)',
        '::-webkit-scrollbar-thumb',
        '::-webkit-scrollbar-thumb:hover',
        '[data-surface="dark"] ::-webkit-scrollbar-thumb',
        '.sd-call-overlay ::-webkit-scrollbar-thumb:hover',
    ])('styles %s', (selector) => {
        expect(block).toContain(selector);
    });

    it('uses system colours only, and opts out of forcing only for the switch', () => {
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
        expect(block.match(/forced-color-adjust: none/g)?.length).toBe(2);
    });
});
```

Run: `cd frontend && npx vitest run src/design/forcedColors.test.ts`
Expected: FAIL — no block.

- [ ] **Step 2: Add the block**

Append to `frontend/src/index.css` (after the last `@layer base { … }`, outside any layer so it follows the utilities):

```css
/* Windows High Contrast (forced colours, UI health #6). The browser replaces colours with the
   theme's system colours and drops box-shadows and background images, so state drawn only with a
   background or a shadow ring disappears. These rules redraw it with system colours, keyed on the
   ARIA state the controls already carry. Normal mode is untouched. */
@media (forced-colors: active) {
  /* Surfaces whose edge is only a shadow: an inset hairline (no layout change). */
  .shadow-sheet,
  .shadow-card,
  .shadow-pill,
  [role="dialog"]:not([data-surface="dark"] *),
  [role="menu"],
  [role="listbox"] {
    /* Not the full-screen dark viewer (its backdrop is data-surface="dark"): no frame round the window. */
    outline: 1px solid CanvasText;
    outline-offset: -1px;
  }

  /* Switch: on and off were two background colours. The track gets a border and the thumb a
     colour; on is the Highlight track. forced-color-adjust is off only here: it carries the state. */
  [role="switch"] {
    border: 1px solid ButtonText;
  }
  [role="switch"] > span {
    forced-color-adjust: none;
    background-color: ButtonText;
  }
  [role="switch"][aria-checked="true"] {
    forced-color-adjust: none;
    background-color: Highlight;
    border-color: Highlight;
  }
  [role="switch"][aria-checked="true"] > span {
    background-color: HighlightText;
  }

  /* Selection shown only by a tint or a shadow ring: pills, rail items, the group rail, conversations,
     tabs, search options, checked menu radios. After the surface rule, so it wins on selected surfaces. */
  [aria-pressed="true"],
  [aria-current="page"],
  [aria-current="true"],
  [aria-selected="true"],
  [role="menuitemradio"][aria-checked="true"] {
    outline: 2px solid Highlight;
    outline-offset: 2px;
  }

  /* The hover and dark-surface thumb rules are more specific than the bare one: list them all, or
     their (forced-away) colours win and the thumb vanishes on hover and on dark surfaces. */
  ::-webkit-scrollbar-thumb,
  ::-webkit-scrollbar-thumb:hover,
  [data-surface="dark"] ::-webkit-scrollbar-thumb,
  [data-surface="dark"] ::-webkit-scrollbar-thumb:hover,
  .sd-call-overlay ::-webkit-scrollbar-thumb,
  .sd-call-overlay ::-webkit-scrollbar-thumb:hover {
    background-color: CanvasText;
  }
}

/* "More contrast": a darker scrollbar thumb (the at-rest thumb is a light ink veil). */
@media (prefers-contrast: more) {
  ::-webkit-scrollbar-thumb {
    background-color: var(--ds-text-secondary);
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: var(--ds-text-primary);
  }
}
```

If `MemberList.tsx`'s group `<button>` has no `aria-current` yet (Plan G Task 9 adds it), add `aria-current={isSelected ? 'true' : undefined}` to it now, so the selected conversation keeps a visible ring.

- [ ] **Step 3: Document it**

Add to `docs/design/DESIGN_SYSTEM.md`, after "### Layering":

```markdown
### High Contrast (forced colours)

Windows High Contrast replaces colours with system colours and drops shadows and gradients. One
`@media (forced-colors: active)` block in `frontend/src/index.css` redraws what would vanish:
surface edges (`shadow-sheet`/`card`/`pill`, dialogs except the full-screen dark viewer, menus,
list boxes) get an inset 1 px `CanvasText` outline; the `Switch` gets a `ButtonText` border and thumb and a `Highlight` track when
on (the only `forced-color-adjust: none`); anything selected through ARIA (`aria-pressed`,
`aria-current`, `aria-selected`, checked `menuitemradio`) gets a 2 px `Highlight` outline. **So a
selected or current state must always carry its ARIA attribute**, not only a tint or a ring. Focus
rings keep working because Tailwind's `outline-none` is a transparent outline, which forced colours
paint. Users who ask for more contrast also get a darker scrollbar thumb (`prefers-contrast: more`).
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/design src/features/messages/components`
Expected: PASS.

- [ ] **Step 5: Real-browser check**

Append to `frontend/e2e/theming.spec.ts` inside the `describe`:

```ts
  test('in forced colours a switch shows on and off, and the selected group is outlined', async ({ page }) => {
    await page.route((url) => url.pathname === '/api/settings', (route) => route.fulfill({ json: {
      output_dir: '/fixture/out', auto_sync_enabled: true, sync_interval_minutes: 15, is_configured: true,
      incoming_call_enabled: true, notifications_enabled: false,
    } }))
    await pinBigRoom(page, { messages })
    await page.emulateMedia({ forcedColors: 'active' })
    await page.goto('/')
    await expect(page.getByText('Big Room', { exact: true })).toBeVisible({ timeout: 10000 })

    const group = page.locator('nav [aria-current="page"]').first()
    expect(await group.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')

    await page.getByTitle('Settings', { exact: true }).click()
    await page.getByText('Settings', { exact: true }).last().click()
    const on = page.locator('[role="switch"][aria-checked="true"]').first()
    const off = page.locator('[role="switch"][aria-checked="false"]').first()
    await expect(on).toBeVisible()
    const bg = (l: typeof on) => l.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(await bg(on)).not.toBe(await bg(off))
    expect(await off.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('solid')
  })

```

(It holds whether Chromium's emulation forces colours or only matches the media query: the rules apply either way. The §12 captions on light gradient ends are checked on Windows, owner check 1.)

Run: `cd frontend && npm run build && npx playwright test e2e/theming.spec.ts --reporter=line`
Expected: all passed. If the first test cannot find the Settings menu item, open Settings the way `e2e/dialogs-app.spec.ts` (`openRailMenu(page, 'Settings')`) does.

- [ ] **Step 6: Commit**

```bash
git add frontend/src docs/design/DESIGN_SYSTEM.md frontend/e2e/theming.spec.ts
uv run git commit -m "fix(ui): keep states and edges visible in High Contrast" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Translations are drawn as their own language, upright and readable

**Files:**
- Modify: `frontend/src/design/fonts.ts`, `frontend/src/design/fonts.test.ts`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/core/common/InlineTranslation.tsx`
- Modify: `frontend/src/features/messages/components/MessageBubble.tsx` (one prop)
- Modify: `frontend/src/features/blogs/hooks/useInlineBlogTranslations.ts`, `frontend/src/features/blogs/components/BlogReader.tsx`
- Modify: `frontend/src/design/guard-baseline.json`
- Create: `frontend/src/core/common/InlineTranslation.test.tsx` (or extend it if it exists), `frontend/src/design/langRules.test.ts`
- Modify: `docs/design/DESIGN_SYSTEM.md` ("Typography": the content rule)

**Interfaces:**
- Produces (`design/fonts.ts`): `langStackVar(lang: SupportedLanguage, face: 'sans' | 'serif'): string` (`--ds-font-sans-zh-tw` …), `writeLanguageStacks(doc?: Document): void`, `loadLanguageFaces(lang: string, loaders?: FaceLoaders): void`, `isCjkLanguage(lang: string | null | undefined): boolean`; `InlineTranslation` prop `lang?: string`; `useInlineBlogTranslations(containerRef, translations, enabled, targetLanguage: string)`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/design/fonts.test.ts` (add the new names to its import from `./fonts`):

```ts
describe('per-language stacks as variables (UI health #10)', () => {
    it('writes every language stack once on the root', () => {
        writeLanguageStacks(document);
        const style = document.documentElement.style;
        expect(style.getPropertyValue('--ds-font-sans-zh-tw')).toBe(fontStacks['zh-TW'].sans);
        expect(style.getPropertyValue('--ds-font-serif-yue')).toBe(fontStacks.yue.serif);
        expect(style.getPropertyValue('--ds-font-sans-ja')).toBe(fontStacks.ja.sans);
        expect(langStackVar('zh-CN', 'sans')).toBe('--ds-font-sans-zh-cn');
    });

    it('loads a translation language\'s faces on request, once per loader call, and ignores unknown codes', () => {
        const loader = vi.fn(() => Promise.resolve());
        const loaders = { ja: null, 'zh-TW': loader, yue: null, 'zh-CN': null, en: null };
        loadLanguageFaces('zh-TW', loaders);
        loadLanguageFaces('xx', loaders);
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it('knows which languages are CJK', () => {
        expect(['ja', 'zh-TW', 'zh-CN', 'yue', 'ko'].every(isCjkLanguage)).toBe(true);
        expect(isCjkLanguage('en')).toBe(false);
        expect(isCjkLanguage(null)).toBe(false);
    });
});
```

Create `frontend/src/design/langRules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf-8');

describe('content in another language keeps its glyphs (UI health #10)', () => {
    it.each([
        ['ja', 'ja'], ['zh-TW', 'zh-tw'], ['zh-CN', 'zh-cn'], ['yue', 'yue'], ['en', 'en'],
    ])('[lang="%s"] uses the %s stack variables', (lang, key) => {
        const rule = css.slice(css.indexOf(`[lang="${lang}"]:not(html) {`));
        expect(rule.slice(0, rule.indexOf('}'))).toContain(`var(--ds-font-sans-${key})`);
    });

    it('no longer copies the Japanese stack literally', () => {
        expect(css).not.toContain('"Noto Sans JP Variable", system-ui');
    });

    it('keeps the display and reading faces on marked elements in every content language', () => {
        const marked = ':is([lang="ja"], [lang="zh-TW"], [lang="zh-CN"], [lang="yue"], [lang="en"]):not(html)';
        expect(css).toContain(`${marked}.font-reading {`);
        expect(css).toContain(`${marked}.font-display {`);
        expect(css).not.toContain('[lang="ja"]:not(html).font-display');
    });
});
```

Create (or extend) `frontend/src/core/common/InlineTranslation.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { loadLanguageFaces } from '../../design/fonts';
import { InlineTranslation } from './InlineTranslation';

vi.mock('../../design/fonts', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../design/fonts')>()),
    loadLanguageFaces: vi.fn(),
}));

describe('InlineTranslation (UI health #10, #12)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('marks the translation with its language, upright for CJK, and loads its faces', async () => {
        render(<InlineTranslation translation="早安🌸" variant="message" lang="zh-TW" defaultExpanded />);
        const text = screen.getByText('早安🌸');
        expect(text).toHaveAttribute('lang', 'zh-TW');
        expect(text).not.toHaveClass('italic');
        expect(text).toHaveClass('break-words', 'text-muted');
        expect(vi.mocked(loadLanguageFaces)).toHaveBeenCalledWith('zh-TW');
    });

    it('keeps English blog translations italic', () => {
        render(<InlineTranslation translation="Good morning" variant="blog" lang="en" defaultExpanded />);
        expect(screen.getByText('Good morning')).toHaveClass('italic');
    });

    it('says whether it is open and names the re-run button', async () => {
        render(<InlineTranslation translation="Hello" variant="message" lang="en" onRerun={vi.fn()} />);
        const toggle = screen.getByRole('button', { name: /Translate/ });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', { name: 'Re-translate' })).toBeInTheDocument();
    });

    it('uses no hard-coded colours', () => {
        const { container } = render(<InlineTranslation translation="x" variant="blog" lang="en" defaultExpanded onRerun={vi.fn()} />);
        expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b|slate-|style="[^"]*color/i);
    });
});
```

Run: `cd frontend && npx vitest run src/design/fonts.test.ts src/design/langRules.test.ts src/core/common/InlineTranslation.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Fonts as variables, faces on request**

In `frontend/src/design/fonts.ts`, after `knownLanguage`, add:

```ts
/** The CSS variable holding one language's stack (`--ds-font-sans-zh-tw`, …): `[lang]` content rules read it. */
export function langStackVar(lang: SupportedLanguage, face: 'sans' | 'serif'): string {
    return `--ds-font-${face}-${lang.toLowerCase()}`;
}

/**
 * Writes every language's stacks on the root once (UI health #10), so `[lang="…"]` content rules in
 * index.css switch to them without copying the stacks (one source: `fontStacks`).
 */
export function writeLanguageStacks(doc: Document = document): void {
    const root = doc.documentElement;
    for (const lang of Object.keys(fontStacks) as SupportedLanguage[]) {
        root.style.setProperty(langStackVar(lang, 'sans'), fontStacks[lang].sans);
        root.style.setProperty(langStackVar(lang, 'serif'), fontStacks[lang].serif);
    }
}

/**
 * Requests a language's own faces for content shown in it (a translation) whatever the UI language.
 * Dynamic imports are cached, so repeated calls are free; an unknown code does nothing.
 */
export function loadLanguageFaces(lang: string, loaders: FaceLoaders = faceLoaders): void {
    const known = knownLanguage(lang);
    if (!known) return;
    loaders[known]?.().catch(() => clientLog('design_fonts_fallback', { target: known.toLowerCase().replace(/-/g, '_') }));
}

/** Chinese, Cantonese, Japanese and Korean: drawn upright (an italic ideograph is a fake slant). */
export function isCjkLanguage(lang: string | null | undefined): boolean {
    return !!lang && /^(zh|yue|ja|ko)\b/i.test(lang);
}
```

and make `installLanguageFonts` write them first:

```ts
export function installLanguageFonts(loaders: FaceLoaders = faceLoaders): void {
    writeLanguageStacks(document);
    applyLanguageFonts(i18n.language, document, loaders);
    i18n.on('languageChanged', (lng: string) => applyLanguageFonts(lng, document, loaders));
}
```

- [ ] **Step 3: Content rules read the variables**

In `frontend/src/index.css`, replace the Japanese content rule block (the one starting `/* Japanese content keeps Japanese glyphs …`) with:

```css
@layer base {
  /* Content in a language other than the UI keeps its own glyphs: Japanese content (spec §6) and
     translations (UI health #10). Scoped to marked content, not <html>, so the UI's own stacks and
     the serif/display utilities keep working. The stacks are written once on :root by
     design/fonts.ts (writeLanguageStacks, from fontStacks): no copies here. */
  [lang="ja"]:not(html) {
    --ds-font-family-sans: var(--ds-font-sans-ja);
    --ds-font-family-serif: var(--ds-font-serif-ja);
    font-family: var(--ds-font-family-sans);
  }
  [lang="zh-TW"]:not(html) {
    --ds-font-family-sans: var(--ds-font-sans-zh-tw);
    --ds-font-family-serif: var(--ds-font-serif-zh-tw);
    font-family: var(--ds-font-family-sans);
  }
  [lang="zh-CN"]:not(html) {
    --ds-font-family-sans: var(--ds-font-sans-zh-cn);
    --ds-font-family-serif: var(--ds-font-serif-zh-cn);
    font-family: var(--ds-font-family-sans);
  }
  [lang="yue"]:not(html) {
    --ds-font-family-sans: var(--ds-font-sans-yue);
    --ds-font-family-serif: var(--ds-font-serif-yue);
    font-family: var(--ds-font-family-sans);
  }
  [lang="en"]:not(html) {
    --ds-font-family-sans: var(--ds-font-sans-en);
    --ds-font-family-serif: var(--ds-font-serif-en);
    font-family: var(--ds-font-family-sans);
  }
  /* The rules above (0,1,1) outrank .font-reading / .font-display (0,1,0) on the same element, so a
     marked title (a Japanese blog title, the DesignPage language samples, a translated heading) would
     fall back to sans: restore their faces with a higher specificity (0,2,1), for every language. */
  :is([lang="ja"], [lang="zh-TW"], [lang="zh-CN"], [lang="yue"], [lang="en"]):not(html).font-reading {
    font-family: var(--ds-font-family-reading);
  }
  :is([lang="ja"], [lang="zh-TW"], [lang="zh-CN"], [lang="yue"], [lang="en"]):not(html).font-display {
    font-family: var(--ds-font-family-serif);
  }
}
```

- [ ] **Step 4: InlineTranslation on tokens, with its language**

Replace `frontend/src/core/common/InlineTranslation.tsx` with:

```tsx
import React, { useState, useCallback, useEffect } from 'react';
import { ChevronRight, ChevronDown, RefreshCw } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { useCollapseOnOutOfView } from '../../features/messages/hooks/useMessageVisibility';
import { isCjkLanguage, loadLanguageFaces } from '../../design/fonts';
import { cn } from '../../utils/classnames';

interface InlineTranslationProps {
    translation: string;
    variant: 'message' | 'blog';
    /** The translation's language (the target language setting): its glyphs, and upright when CJK. */
    lang?: string;
    defaultExpanded?: boolean;
    /** Called when user clicks the rerun button to re-translate */
    onRerun?: () => void;
    /**
     * Message ID for auto-collapse when scrolled out of the visible range.
     * Omit for non-virtualized usages (modals, blog reader).
     */
    messageId?: number;
}

/**
 * Collapsible inline translation display.
 *
 * - 'message': small muted text under a dashed hairline, a light touch inside the bubble.
 * - 'blog': a left line like the injected blog translation lines, italic only for non-CJK text.
 *
 * Colours are tokens (UI health #12: the toggle was 2.6:1, the re-run icon 1.5:1); the text carries
 * its own `lang` (UI health #10) and that language's faces load when it opens.
 */
export const InlineTranslation: React.FC<InlineTranslationProps> = ({
    translation,
    variant,
    lang,
    defaultExpanded = false,
    onRerun,
    messageId,
}) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(defaultExpanded);

    // Auto-collapse when message leaves the virtualized visible range.
    const collapse = useCallback(() => setExpanded(false), []);
    useCollapseOnOutOfView(messageId, expanded, collapse);

    useEffect(() => {
        if (expanded && lang) loadLanguageFaces(lang);
    }, [expanded, lang]);

    if (!translation) return null;

    const Chevron = expanded ? ChevronDown : ChevronRight;
    const upright = isCjkLanguage(lang);

    const header = (
        <div className="flex items-center gap-0.5">
            <button
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                aria-expanded={expanded}
                className="flex items-center gap-0.5 rounded-xs py-0.5 text-caption text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                type="button"
            >
                <Chevron aria-hidden="true" className="h-3 w-3" />
                {t('translation.translate')}
            </button>
            {onRerun && (
                <button
                    onClick={(e) => { e.stopPropagation(); onRerun(); }}
                    className="rounded-xs p-0.5 text-muted transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    type="button"
                    title={t('translation.rerun')}
                    aria-label={t('translation.rerun')}
                >
                    <RefreshCw aria-hidden="true" className="h-3 w-3" />
                </button>
            )}
        </div>
    );

    if (variant === 'message') {
        return (
            <div className="mt-2 border-t border-dashed border-subtle pt-1.5">
                {header}
                {expanded && (
                    <div lang={lang} className="mt-0.5 whitespace-pre-wrap break-words text-small leading-relaxed text-muted">
                        {translation}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="mb-3 mt-1">
            {header}
            {expanded && (
                <div
                    lang={lang}
                    className={cn('mt-0.5 whitespace-pre-wrap break-words border-l-2 border-strong pl-3 text-body leading-relaxed text-secondary', !upright && 'italic')}
                >
                    {translation}
                </div>
            )}
        </div>
    );
};
```

In `frontend/src/features/messages/components/MessageBubble.tsx`, pass `lang={translationTargetLanguage}` to `<InlineTranslation …>` (the bubble already reads `translationTargetLanguage` from the store).

- [ ] **Step 5: Injected blog lines carry the language**

In `frontend/src/features/blogs/hooks/useInlineBlogTranslations.ts`:
- change `TRANSLATION_LINE_CLASS` to `'blog-translation-inline inline-block border-l-2 border-strong pl-3 text-body text-secondary'` (no `italic`) and add `import { isCjkLanguage } from '../../../design/fonts';`;
- add a fourth parameter `targetLanguage: string` (doc: "The translations' language: set as `lang` on each line, italic only when not CJK") and include it in the effect's dependency list;
- in `injectTranslation`, after `span.className = TRANSLATION_LINE_CLASS;` add:

```ts
            span.lang = targetLanguage;
            if (!isCjkLanguage(targetLanguage)) span.classList.add('italic');
```

In `frontend/src/features/blogs/components/BlogReader.tsx`: call `useInlineBlogTranslations(blogContentRef, blogTranslations, translationsExpanded, translationTargetLanguage);` and add after it:

```tsx
    // The translation language's own faces (a Chinese translation in Noto Sans TC, not JP glyphs).
    useEffect(() => {
        if (translationsExpanded) loadLanguageFaces(translationTargetLanguage);
    }, [translationsExpanded, translationTargetLanguage]);
```

(import `loadLanguageFaces` from `'../../../design/fonts'`).

- [ ] **Step 6: Baseline, docs and tests**

Run: `cd frontend && UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff -- src/design/guard-baseline.json`
Expected: the `core/common/InlineTranslation.tsx` entry is removed (6 → 0); nothing else changes.

In `docs/design/DESIGN_SYSTEM.md` "§8 Typography", extend the "Japanese content rule" bullet: "The same content rule exists for `zh-TW`, `zh-CN`, `yue` and `en` (translations shown in their own glyphs). The stacks come from CSS variables `--ds-font-sans-<lang>` / `--ds-font-serif-<lang>` that `writeLanguageStacks` (`design/fonts.ts`) writes from `fontStacks`; index.css never copies a stack. A translation's faces load when it is shown (`loadLanguageFaces`). Translations are upright in CJK (`isCjkLanguage`); English blog translations stay italic."

Run: `cd frontend && npx vitest run src/design src/core/common src/features/blogs src/features/messages`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src docs/design/DESIGN_SYSTEM.md
uv run git commit -m "fix(i18n): show translations in their own language's glyphs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Scrollers never clip their start; labels never squeeze; Settings does not shift

**Files:**
- Modify: `frontend/tailwind.config.js`, `frontend/src/utils/classnames.ts`
- Modify: `frontend/src/features/memories/favorites/FilmStrip.tsx`, `frontend/src/features/memories/gacha/GachaPage.tsx`
- Modify: `frontend/src/design/primitives/Button.tsx`, `frontend/src/design/primitives/Controls.test.tsx`
- Modify: `frontend/src/shell/components/SettingsModal.tsx`
- Create: `frontend/src/design/layoutUtilities.test.ts`
- Modify: `docs/design/DESIGN_SYSTEM.md`

**Interfaces:**
- Produces: utilities `justify-safe-center`, `items-safe-center`, `scrollbar-stable` (Task 6 uses `items-safe-center`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/design/layoutUtilities.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cn } from '../utils/classnames';

const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

describe('layout utilities (UI health C-L1, C-L5)', () => {
    it('defines safe centring and a stable scrollbar gutter', () => {
        expect(config).toContain("'.justify-safe-center': { justifyContent: 'safe center' }");
        expect(config).toContain("'.items-safe-center': { alignItems: 'safe center' }");
        expect(config).toContain("'.scrollbar-stable': { scrollbarGutter: 'stable' }");
    });

    it('merges them with the plain centring classes', () => {
        expect(cn('justify-center', 'justify-safe-center')).toBe('justify-safe-center');
        expect(cn('items-center', 'items-safe-center')).toBe('items-safe-center');
    });
});
```

In `frontend/src/design/primitives/Controls.test.tsx`, change `expect(b).toHaveClass('bg-pill', 'h-10', 'rounded-md');` to `expect(b).toHaveClass('bg-pill', 'min-h-10', 'whitespace-nowrap', 'rounded-md');`.

Run: `cd frontend && npx vitest run src/design/layoutUtilities.test.ts src/design/primitives/Controls.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement**

`frontend/tailwind.config.js` — add a plugin after the existing ones:

```js
        // Safe centring for scrollers (UI health C-L1): centred while the content fits, start-aligned
        // when it overflows, so its first part is never pushed out of reach. And a stable gutter for
        // a scroller whose content changes height under the user (Settings' tabs, C-L5).
        ({ addUtilities }) => {
            addUtilities({
                '.justify-safe-center': { justifyContent: 'safe center' },
                '.items-safe-center': { alignItems: 'safe center' },
                '.scrollbar-stable': { scrollbarGutter: 'stable' },
            });
        },
```

`frontend/src/utils/classnames.ts` — add to `classGroups`:

```ts
            'justify-content': [{ justify: ['safe-center'] }],
            'align-items': [{ items: ['safe-center'] }],
```

`frontend/src/features/memories/favorites/FilmStrip.tsx` — the strip row: `'flex items-center justify-safe-center gap-3 overflow-x-auto rounded-lg bg-sunken p-4'` (was `justify-center`).

`frontend/src/features/memories/gacha/GachaPage.tsx` — the scrolling body: replace `items-center` with `items-safe-center` and `md:justify-center` with `md:justify-safe-center` in `'flex min-h-0 flex-1 flex-col items-center gap-8 overflow-y-auto overscroll-contain p-6 md:flex-row md:justify-center md:gap-12'`.

`frontend/src/design/primitives/Button.tsx` — `SIZE` becomes:

```ts
// min-h, not h, and no wrapping (UI health C-L4): a CJK label can no longer shrink to one character
// per line inside a fixed-height button; single-line labels look exactly as before.
const SIZE: Record<ButtonSize, string> = {
    sm: 'min-h-8 px-3 text-small whitespace-nowrap',
    md: 'min-h-10 px-5 text-body whitespace-nowrap',
};
```

`frontend/src/shell/components/SettingsModal.tsx` — the content pane `<div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6 pt-2">` gets `scrollbar-stable`.

`docs/design/DESIGN_SYSTEM.md` — in "§9 Buttons and states" add: "Buttons have a minimum height (`min-h-8` / `min-h-10`) and never wrap their label." and in "Scales" add a row: "| Layout helpers | `justify-safe-center`, `items-safe-center` (centre inside a scroller without clipping its start), `scrollbar-stable` (a scroller whose content height changes under the user) |".

- [ ] **Step 3: Run the tests**

Run: `cd frontend && npx vitest run src/design src/features/memories src/shell`
Expected: PASS (update any other assertion of `h-8`/`h-10` on a `Button` the same way; `IconButton` keeps `h-8 w-8` / `h-10 w-10`).

- [ ] **Step 4: Commit**

```bash
git add frontend/tailwind.config.js frontend/src docs/design/DESIGN_SYSTEM.md
uv run git commit -m "fix(ui): centre scrollers safely and keep button labels whole" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Steady numbers and better line breaks for headings and Japanese titles

**Files:**
- Modify: `frontend/tailwind.config.js`, `frontend/src/utils/classnames.ts` (if needed)
- Modify: `frontend/src/features/messages/components/MessageBubble.tsx`, `frontend/src/design/primitives/Badge.tsx`, `frontend/src/features/messages/MessagesFeature.tsx`
- Modify: `frontend/src/design/primitives/EmptyState.tsx`, `frontend/src/pages/LandingPage.tsx`, `frontend/src/features/blogs/components/BlogReader.tsx`, `frontend/src/features/blogs/components/BlogCard.tsx`, `frontend/src/features/blogs/components/blogProse.ts`
- Create: `frontend/src/design/typeDetails.test.tsx`
- Modify: `frontend/src/features/messages/components/__snapshots__/MessageBubble.test.tsx.snap`
- Modify: `docs/design/DESIGN_SYSTEM.md`

**Interfaces:**
- Produces: utility `phrase-break` (`word-break: auto-phrase`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/design/typeDetails.test.tsx`:

```tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n from '../i18n';
import { Badge, EmptyState } from './primitives';
import { BLOG_PROSE } from '../features/blogs/components/blogProse';

const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

describe('type details (UI health C-Y5, C-Y6)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('draws unread counts with tabular figures', () => {
        const { container } = render(<Badge count={18} />);
        expect(container.firstElementChild).toHaveClass('tabular-nums');
    });

    it('balances empty-state titles', () => {
        const { getByRole } = render(<EmptyState icon={null} title="まだメッセージはありません" />);
        expect(getByRole('heading')).toHaveClass('text-balance');
    });

    it('wraps blog bodies pretty and defines phrase breaking for Japanese titles', () => {
        expect(BLOG_PROSE).toContain('text-pretty');
        expect(config).toContain("'.phrase-break': { wordBreak: 'auto-phrase' }");
    });
});
```

Run: `cd frontend && npx vitest run src/design/typeDetails.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement**

`frontend/tailwind.config.js` — add to the plugin from Task 4 (or a new one):

```js
                // Japanese titles break between phrases, not mid-word (Chromium's auto-phrase, UI health C-Y5).
                '.phrase-break': { wordBreak: 'auto-phrase' },
```

Tabular figures (DESIGN_SYSTEM §8 "Use `tabular-nums` for stats, times and counters"):
- `MessageBubble.tsx`: both `<time …>` elements get `tabular-nums` (the run header's `className="text-caption text-muted"` and the trailing follow-up time; if Plan G already added `group-has-[:focus-visible]/row:opacity-100` there, keep it).
- `Badge.tsx`: the outer span's classes get `tabular-nums`.
- `MessagesFeature.tsx`: the unread `<ChatHeaderPill light={isLightHeader} className="font-semibold">` → `className="font-semibold tabular-nums"`.

Text wrapping:
- `EmptyState.tsx`: the `<h3>` gets `text-balance`.
- `LandingPage.tsx`: the hero `<h1 className="font-display text-display font-bold text-primary">` gets `text-balance`.
- `blogProse.ts`: the first entry becomes `'break-words text-pretty text-reading text-primary'`.
- `BlogReader.tsx`: the post title (`<h1>` with `font-reading`, `lang="ja"`) gets `phrase-break text-balance`.
- `BlogCard.tsx`: the caption title span (`'line-clamp-2 font-reading text-primary'`) gets `phrase-break`.

`docs/design/DESIGN_SYSTEM.md` §8: add "Headings that wrap use `text-balance` (EmptyState, landing); long prose `text-pretty` (blog bodies); Japanese titles `phrase-break` (`word-break: auto-phrase`, blog reader and feed cards). Never on `*`: both have a layout cost."

- [ ] **Step 3: Refresh the snapshot and run the tests**

Run: `cd frontend && npx vitest run src/features/messages/components/MessageBubble.test.tsx -u && git diff -- src/features/messages/components/__snapshots__ | grep '^[-+]' | grep -v '^[-+][-+]'`
Expected: only `<time>` class lines gain `tabular-nums`.

Run: `cd frontend && npx vitest run src/design src/features src/pages`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/tailwind.config.js frontend/src docs/design/DESIGN_SYSTEM.md
uv run git commit -m "fix(ui): use tabular figures and better breaks for titles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The crash screen speaks the UI language and uses the design system; numbers follow it too

**Files:**
- Modify: `frontend/src/core/common/ErrorBoundary.tsx`
- Modify: `frontend/src/core/common/SyncProgressPanel.tsx`, `frontend/src/shell/components/SyncModal.tsx`, `frontend/src/core/layout/InlineSyncView.tsx`
- Modify: `frontend/src/i18n/locales/*.json`
- Create: `frontend/src/i18n/uiHealthTheming.test.ts`, `frontend/src/core/common/ErrorBoundary.test.tsx` (or extend it)
- Modify: `frontend/src/core/dialogs.style.test.ts` (add `common/ErrorBoundary.tsx` to `FILES`)

**Interfaces:**
- Consumes: `items-safe-center` (Task 4).
- Produces: keys `errorBoundary.title`, `errorBoundary.body`, `errorBoundary.retry`, `errorBoundary.report`.

- [ ] **Step 1: Add the strings and their presence test**

Run from `frontend/`:

```bash
uv run python - <<'EOF'
import json, pathlib
ADD = {
    'en': {'errorBoundary.title': 'Something went wrong', 'errorBoundary.body': 'SakaDesk ran into an unexpected error. Your data is safe: only the screen failed to draw.',
           'errorBoundary.retry': 'Try again', 'errorBoundary.report': 'Report issue'},
    'ja': {'errorBoundary.title': '問題が発生しました', 'errorBoundary.body': '予期しないエラーが発生しました。データは無事です。画面の表示だけに失敗しました。',
           'errorBoundary.retry': 'もう一度試す', 'errorBoundary.report': '問題を報告'},
    'zh-TW': {'errorBoundary.title': '發生問題', 'errorBoundary.body': 'SakaDesk 發生未預期的錯誤。您的資料安全無虞，只是畫面無法顯示。',
              'errorBoundary.retry': '再試一次', 'errorBoundary.report': '回報問題'},
    'zh-CN': {'errorBoundary.title': '出现问题', 'errorBoundary.body': 'SakaDesk 遇到意外错误。您的数据是安全的，只是界面未能显示。',
              'errorBoundary.retry': '重试', 'errorBoundary.report': '报告问题'},
    'yue': {'errorBoundary.title': '出咗啲問題', 'errorBoundary.body': 'SakaDesk 遇到意料之外嘅錯誤。你啲資料冇事，只係畫面顯示唔到。',
            'errorBoundary.retry': '再試一次', 'errorBoundary.report': '回報問題'},
}
for lang, keys in ADD.items():
    p = pathlib.Path(f'src/i18n/locales/{lang}.json')
    d = json.loads(p.read_text(encoding='utf-8'))
    for dotted, value in keys.items():
        node = d
        *parents, leaf = dotted.split('.')
        for k in parents:
            node = node.setdefault(k, {})
        node[leaf] = value
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
EOF
```

Create `frontend/src/i18n/uiHealthTheming.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Strings of the UI-health theming plan (H). */
const KEYS: readonly string[] = ['errorBoundary.title', 'errorBoundary.body', 'errorBoundary.retry', 'errorBoundary.report'];

const lookup = (data: unknown, dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], data);

describe('UI health theming strings', () => {
    it.each(Object.entries(locales))('%s has every key', (_code, data) => {
        for (const dotted of KEYS) expect(lookup(data, dotted), dotted).toBeTruthy();
    });
});
```

- [ ] **Step 2: Write the failing crash-screen test**

Create (or extend) `frontend/src/core/common/ErrorBoundary.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { clientLog } from '../../utils/clientLog';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('../../utils/clientLog', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/clientLog')>()),
    clientLog: vi.fn(),
}));

const Boom = () => { throw new TypeError('boom'); };

describe('ErrorBoundary crash screen (UI health C-I1)', () => {
    beforeAll(async () => { await i18n.changeLanguage('ja'); });

    it('speaks the UI language, uses the design system and leaves a breadcrumb', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { container } = render(<ErrorBoundary onReportIssue={vi.fn()}><Boom /></ErrorBoundary>);
        expect(screen.getByRole('heading', { name: '問題が発生しました' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /もう一度試す/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /問題を報告/ })).toBeInTheDocument();
        expect(container.innerHTML).not.toMatch(/(bg|text)-(gray|red|blue|white)/);
        // The error-state tile, not a solid danger header (DESIGN_SYSTEM "Semantic colours").
        expect(container.innerHTML).not.toContain('bg-status-danger');
        expect(container.querySelector('.bg-semantic-danger-icon.text-semantic-danger')).not.toBeNull();
        expect(container.firstElementChild).toHaveClass('items-safe-center');
        expect(clientLog).toHaveBeenCalledWith('app_load_failed', { target: 'render', error_type: 'typeerror' });
    });
});
```

Run: `cd frontend && npx vitest run src/core/common/ErrorBoundary.test.tsx src/i18n/uiHealthTheming.test.ts`
Expected: the i18n test PASSES; the crash-screen test FAILS (English text, palette classes, no breadcrumb).

- [ ] **Step 3: Implement the crash screen**

Replace the imports and `componentDidCatch` / `render` of `frontend/src/core/common/ErrorBoundary.tsx`:

```tsx
import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Bug } from 'lucide-react';
import i18n from '../../i18n';
import { Button } from '../../design/primitives';
import { brandScopeStyle } from '../../design/brandScope';
import { breadcrumbCode, clientLog } from '../../utils/clientLog';
```

```tsx
    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.setState({ errorInfo });
        console.error('ErrorBoundary caught an error:', error, errorInfo);
        // The class name only (no message, no stack): a crash must be findable in debug.log.
        clientLog('app_load_failed', { target: 'render', error_type: breadcrumbCode(error) });
    }
```

```tsx
    render() {
        if (this.state.hasError) {
            const { error, errorInfo } = this.state;
            // A class component: translate through i18n directly (the screen shows the UI language).
            const t = i18n.t.bind(i18n);

            return (
                <div style={brandScopeStyle()} className="flex h-screen items-safe-center justify-center overflow-y-auto bg-window p-4">
                    <div role="alert" className="w-full max-w-md overflow-hidden rounded-xl bg-sheet shadow-sheet">
                        {/* Plain header with the error-state tile (as StatusBlock kind="error"): the solid
                            danger step is only for destructive buttons (DESIGN_SYSTEM "Semantic colours"). */}
                        <div className="flex items-center gap-3 px-6 pt-6">
                            <span aria-hidden="true" className="flex shrink-0 rounded-card bg-semantic-danger-icon p-3 text-semantic-danger">
                                <AlertTriangle className="h-6 w-6" />
                            </span>
                            <h1 className="text-heading font-bold text-primary">{t('errorBoundary.title')}</h1>
                        </div>

                        <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
                            <p className="text-body text-secondary">{t('errorBoundary.body')}</p>

                            {error && (
                                <div className="max-h-32 overflow-auto rounded-lg bg-sunken p-4 font-mono text-caption text-secondary">
                                    <p className="break-words font-semibold text-status-danger">{error.name}: {error.message}</p>
                                    {errorInfo?.componentStack && (
                                        <p className="mt-2 whitespace-pre-wrap break-words text-muted">
                                            {errorInfo.componentStack.split('\n').slice(0, 5).join('\n')}
                                        </p>
                                    )}
                                </div>
                            )}

                            <div className="flex gap-3 pt-2">
                                <Button variant="secondary" className="flex-1" onClick={this.handleRetry}>
                                    <RefreshCw aria-hidden="true" className="h-4 w-4" />
                                    {t('errorBoundary.retry')}
                                </Button>
                                <Button variant="primary" className="flex-1" onClick={this.handleReport}>
                                    <Bug aria-hidden="true" className="h-4 w-4" />
                                    {t('errorBoundary.report')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
```

Add `'common/ErrorBoundary.tsx',` to `FILES` in `frontend/src/core/dialogs.style.test.ts`.

- [ ] **Step 4: Numbers in the UI language**

In `SyncProgressPanel.tsx`, `SyncModal.tsx` and `InlineSyncView.tsx` replace each `.toLocaleString()` with `.toLocaleString(i18n.language)` (import `i18n` from the i18n module if the file has only `useTranslation`; with `const { t, i18n } = useTranslation();` use that `i18n`).

- [ ] **Step 5: Run the tests**

Run: `cd frontend && npx vitest run src/core src/shell src/i18n src/design`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
uv run git commit -m "fix(ui): translate the crash screen and restyle it with tokens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Light colour scheme declared; the unused legacy colour layer removed

**Files:**
- Modify: `frontend/index.html`, `frontend/src/index.css`, `frontend/tailwind.config.js`, `frontend/src/design/applyTokens.ts`, `frontend/src/design/applyTokens.test.ts`
- Create: `frontend/src/design/legacyLayer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/design/legacyLayer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyGroupTokens } from './applyTokens';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

describe('legacy colour layer and colour scheme (UI health C-T2, C-F3)', () => {
    it('declares the light colour scheme', () => {
        expect(read('../../index.html')).toContain('<meta name="color-scheme" content="light" />');
        expect(read('../index.css')).toMatch(/:root\s*\{[^}]*color-scheme: light/);
    });

    it('has no --color-* variables or legacy theme utilities left', () => {
        expect(read('../index.css')).not.toContain('--color-');
        const config = read('../../tailwind.config.js');
        expect(config).not.toMatch(/var\(--color-|'theme-|'surface-base'|'feedback-|'brand-purple|'brand-blue'/);
    });

    it('no longer writes --color-* on a group switch', () => {
        applyGroupTokens('hinatazaka');
        expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('');
    });

    it('body text uses the primary text token', () => {
        expect(read('../index.css')).toMatch(/@apply antialiased text-primary;/);
    });
});
```

Run: `cd frontend && npx vitest run src/design/legacyLayer.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`frontend/index.html` — after the viewport meta add:

```html
  <!-- The app has no dark mode yet: form controls and scrollbars stay light whatever Windows' theme. -->
  <meta name="color-scheme" content="light" />
```

`frontend/src/index.css` — replace the first `@layer base { :root { /* Theme CSS variables … */ … } … }` `:root` block (the `--color-*` variables, from `/* Theme CSS variables - defaults to Hinatazaka colors */` to its closing `}`) with:

```css
  :root {
    /* No dark mode yet (DESIGN_SYSTEM "Dark mode"): native controls and scrollbars stay light. */
    color-scheme: light;
  }
```

and change `@apply antialiased text-gray-900;` to `@apply antialiased text-primary;`.

`frontend/tailwind.config.js` — delete, in `theme.extend.colors`, the entries `'theme-primary'`, `'theme-secondary'`, `'theme-accent'`, `'surface-base'`, `'surface-elevated'`, `'surface-sunken'`, `'text-primary'`, `'text-secondary'`, `'text-muted'`, `'text-inverse'`, `'feedback-success'`, `'feedback-warning'`, `'feedback-error'`, `'brand-purple-start'`, `'brand-purple-end'`, `'brand-blue'` and their comments (delete `colors` entirely if it becomes empty), and in `backgroundImage` the `'theme-gradient'` and `'theme-gradient-vertical'` entries with their comment. Confirm nothing used them:

```bash
cd frontend && timeout 60 grep -rnE "(bg|text|border|ring|from|to|via)-(theme-|surface-(base|elevated|sunken)|text-(primary|secondary|muted|inverse)|feedback-|brand-(purple|blue))" src --include=*.ts --include=*.tsx | grep -v "\.test\." || echo "unused"
```

Expected: `unused`.

`frontend/src/design/applyTokens.ts` — delete `write(root, generateThemeCSSVariables(groupId));` from `applyGroupTokens` and the now-unused import. (`generateThemeCSSVariables` stays in `config/colors/` for the pre-D1 equality tests.)

`frontend/src/design/applyTokens.test.ts` — the test that reads `--color-*` after `applyGroupTokens` (around its `changed = ['--color-success', …]` list) now expects those variables to be absent: replace its assertions with `for (const name of changed) expect(style().getPropertyValue(name)).toBe('');` and drop the two `--color-primary` / `--color-secondary` value checks (the equality of those values with the tokens stays covered by `config/colors/legacyEquality.test.ts`).

- [ ] **Step 3: Run the tests**

Run: `cd frontend && npx vitest run src/design src/config && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html frontend/tailwind.config.js frontend/src
uv run git commit -m "refactor(ui): declare light scheme and drop the legacy colour layer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `cn()` knows every design-system utility

**Files:**
- Modify: `frontend/src/utils/classnames.ts`
- Create: `frontend/src/utils/classnames.registry.test.ts`

**Interfaces:**
- Produces: `TW_MERGE_CLASS_GROUPS` (exported config object) in `utils/classnames.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/utils/classnames.registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TW_MERGE_CLASS_GROUPS, cn } from './classnames';

const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

/** Keys of one `theme.extend` section of tailwind.config.js (`name:` or `'name':` at the section's indent + 4). */
function keysOf(section: string): string[] {
    const start = config.indexOf(`            ${section}: {`);
    const end = config.indexOf('\n            },', start);
    return [...config.slice(start, end).matchAll(/^ {16}'?([a-z0-9-]+)'?:/gm)].map((m) => m[1]);
}

const registered = (group: keyof typeof TW_MERGE_CLASS_GROUPS, prefix: string): string[] =>
    (TW_MERGE_CLASS_GROUPS[group] as unknown as Record<string, string[]>[])[0][prefix];

describe('tailwind-merge registry (UI health C-T5)', () => {
    it.each([
        ['animation', 'animate', 'animate'],
        ['boxShadow', 'shadow', 'shadow'],
        ['transitionDuration', 'duration', 'duration'],
        ['transitionTimingFunction', 'ease', 'ease'],
    ] as const)('registers every %s key', (section, group, prefix) => {
        const keys = keysOf(section);
        expect(keys.length).toBeGreaterThan(1);
        expect(keys.filter((k) => !registered(group, prefix).includes(k))).toEqual([]);
    });

    it('keeps two different token shadows from collapsing into one', () => {
        expect(cn('shadow-card', 'shadow-memories-polaroid')).toBe('shadow-memories-polaroid');
        expect(cn('animate-reveal', 'animate-star-fall')).toBe('animate-star-fall');
    });
});
```

Run: `cd frontend && npx vitest run src/utils/classnames.registry.test.ts`
Expected: FAIL — `TW_MERGE_CLASS_GROUPS` is not exported; once exported, the lists show the missing keys (at least `star-fall`, `fan-in`, `petal-fall`, `progress-indeterminate` in `animate` and `memories-polaroid` in `shadow`).

- [ ] **Step 2: Implement**

In `frontend/src/utils/classnames.ts`, move the `classGroups` object literal out into an exported constant and pass it in:

```ts
/** The design-system class groups tailwind-merge must know (DESIGN_SYSTEM "Adding or changing a token", step 2). */
export const TW_MERGE_CLASS_GROUPS = {
    // … the existing groups, unchanged, plus the missing keys the test listed …
};

const twMerge = extendTailwindMerge<'mask-image'>({ extend: { classGroups: TW_MERGE_CLASS_GROUPS } });
```

and add every key the failing test lists to its group (`animate`: `'star-fall', 'fan-in', 'petal-fall', 'progress-indeterminate'` and any other listed; `shadow`: `'memories-polaroid'` and any other listed). If TypeScript narrows the literal too much for `extendTailwindMerge`, annotate it `as const` and keep the generic.

- [ ] **Step 3: Run the tests and re-check the call sites (⚑ Decision 10a)**

Run: `cd frontend && npx vitest run src/utils src/design`
Expected: PASS.

Run:

```bash
cd frontend && grep -rnoE "(^|[ \"'\`])(shadow|animate)-[a-z0-9-]+[^\"'\`]*[ ](shadow|animate)-[a-z0-9-]+" src --include=*.tsx --include=*.ts | grep -v "\.test\."
```

Expected: only pairs from different groups (`shadow-sheet animate-reveal`, `shadow-card animate-reveal`, `shadow-sheet animate-toast-in`) and, until Task 6 replaces it, `ErrorBoundary.tsx`'s `shadow-lg shadow-blue-500` (size + colour, two groups). If a pair of two `shadow-*` or two `animate-*` keys appears, `cn()` now keeps only the last: name it in the PR body.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
uv run git commit -m "fix(ui): register every token utility with tailwind-merge" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The guard catches palette classes, layering classes, default sizes and CSS literals

**Files:**
- Modify: `frontend/src/design/guard.ts`, `frontend/src/design/guard.test.ts`
- Create: `frontend/src/design/drift-guard-baseline.json` (written by the test)
- Modify: `docs/design/DESIGN_SYSTEM.md` ("The guard (ratchet)")

**Interfaces:**
- Produces: `DRIFT_PATTERNS`, `countDriftViolations(source: string, relPath?: string): number`, `isDriftScanned(relPath: string): boolean`, `DRIFT_LABELS`; `scanTree`'s `count` receives `(source, relPath)`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/design/guard.test.ts` (extend its import from `./guard` with `DRIFT_LABELS, countDriftViolations, isDriftScanned`):

```ts
const DRIFT_BASELINE = path.resolve(__dirname, 'drift-guard-baseline.json');
const TAILWIND_CONFIG = path.resolve(SRC, '../tailwind.config.js');

describe('countDriftViolations (UI health #14)', () => {
    it.each([
        ['className="bg-gray-100 text-white hover:bg-black/40 border-red-500"', 4],
        ['className="z-40 z-50 z-[60] -z-[1]"', 4],
        ['className="text-xs text-sm text-2xl"', 3],
        ['className="leading-[1.3] tracking-[2px] duration-[350ms] delay-[50ms] ease-[cubic-bezier(0,0,1,1)] bg-[url(x)] blur-[100px]"', 7],
    ])('counts %s as %i', (source, count) => {
        expect(countDriftViolations(source, 'a.tsx')).toBe(count);
    });

    it.each([
        'className="bg-sheet text-primary text-small z-10 z-20 shadow-card"',
        'className="w-[320px] max-w-[min(80%,42rem)] aspect-[3/4] min-w-[95px]"',
        'className="text-accent-strong text-semantic-star text-viewer-muted"',
        '// bg-gray-100 in a comment',
    ])('ignores %s', (source) => {
        expect(countDriftViolations(source, 'a.tsx')).toBe(0);
    });

    it('counts colour literals in CSS', () => {
        expect(countDriftViolations('a { color: #fff; background: rgba(0,0,0,.5) } /* #000 */', 'x.css')).toBe(2);
    });

    it('scans source and CSS files, not tests or token files', () => {
        expect(isDriftScanned('features/incomingCall/callScreen.css')).toBe(true);
        expect(isDriftScanned('core/media/VideoPlayer.tsx')).toBe(true);
        expect(isDriftScanned('core/media/VideoPlayer.test.tsx')).toBe(false);
        expect(isDriftScanned('design/tokens/color.ts')).toBe(false);
    });
});

describe('drift ratchet repository', () => {
    const current = () => {
        const found = scanTree(SRC, countDriftViolations, isDriftScanned);
        const configCount = countDriftViolations(readFileSync(TAILWIND_CONFIG, 'utf-8'), 'tailwind.config.js');
        return configCount > 0 ? { ...found, '../tailwind.config.js': configCount } : found;
    };

    it('matches src/design/drift-guard-baseline.json', () => {
        if (process.env.UPDATE_DRIFT_BASELINE) {
            writeFileSync(DRIFT_BASELINE, JSON.stringify(current(), null, 2) + '\n', 'utf-8');
            return;
        }
        const baseline = JSON.parse(readFileSync(DRIFT_BASELINE, 'utf-8')) as Record<string, number>;
        expect(compareToBaseline(current(), baseline, (rel) => existsSync(path.join(SRC, rel)), DRIFT_LABELS)).toEqual([]);
    });

    it('has no design-system file in the drift baseline', () => {
        const baseline = JSON.parse(readFileSync(DRIFT_BASELINE, 'utf-8')) as Record<string, number>;
        expect(Object.keys(baseline).filter((rel) => rel.startsWith('design/'))).toEqual([]);
    });

    it('accepts no drift in a file the UI-health plans F and G created', () => {
        // The baseline is written from the tree after F and G: drift they added would be accepted
        // silently. design/ files are never in it (checked above); listed so a move out is caught too.
        const createdByFAndG = [
            'core/layout/KeepMounted.tsx', 'design/featureActive.ts', 'core/layout/MemoriesChunkBoundary.tsx',
            'features/messages/components/SyncStatusPill.tsx', 'features/blogs/components/stagger.ts', 'hooks/useInert.ts',
            'core/media/StepButtons.tsx', 'shell/components/SkipLink.tsx', 'design/primitives/LiveRegion.tsx',
            'shell/components/SettingsErrorToast.tsx', 'design/dialog/useAnyDialogOpen.ts', 'hooks/useMediaQuery.ts',
        ];
        const baseline = JSON.parse(readFileSync(DRIFT_BASELINE, 'utf-8')) as Record<string, number>;
        expect(createdByFAndG.filter((rel) => rel in baseline)).toEqual([]);
    });
});
```

Run: `cd frontend && npx vitest run src/design/guard.test.ts`
Expected: FAIL — the new names are not exported.

- [ ] **Step 2: Implement the ratchet**

In `frontend/src/design/guard.ts`:

(a) Extend the header comment with: "A third ratchet (`countDriftViolations`, `isDriftScanned`, UI health #14) counts what the first one missed: named palette classes, `z-40`/`z-50`/`z-[…]`, Tailwind's default font sizes, arbitrary values for leading/tracking/duration/delay/ease and colour-like utilities, and hex/`rgb()`/`hsl()` literals in CSS files and `tailwind.config.js`. It is compared with drift-guard-baseline.json under the same rules."

(b) Add after `LOADING_PATTERNS`:

```ts
const PALETTE = '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';
const COLOUR_UTILITY = '(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|decoration|shadow)';

/** UI health #14: drift the style ratchet did not count. Width/height/position/aspect arbitrary values stay allowed. */
export const DRIFT_PATTERNS: readonly RegExp[] = [
    new RegExp(`(?<![\\w-])-?${COLOUR_UTILITY}-${PALETTE}-\\d{2,3}(?:\\/\\d{1,3})?(?![\\w-])`, 'g'),
    new RegExp(`(?<![\\w-])${COLOUR_UTILITY}-(?:black|white)(?:\\/\\d{1,3})?(?![\\w-])`, 'g'),
    /(?<![\w-])-?z-(?:40|50|\[)/g,
    /(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g,
    /(?<![\w-])(?:leading|tracking|duration|delay|ease|bg|border(?:-[trblxy])?|ring|outline|fill|stroke|from|via|to|decoration|blur)-\[/g,
];
/** Colour literals (the first two style PATTERNS), counted in CSS files and the Tailwind config. */
const COLOUR_LITERALS: readonly RegExp[] = [PATTERNS[0], PATTERNS[1]];

export function countDriftViolations(source: string, relPath = ''): number {
    return countPatterns(source, /\.css$|tailwind\.config\.js$/.test(relPath) ? COLOUR_LITERALS : DRIFT_PATTERNS);
}

/** The style ratchet's files plus every CSS file under src (index.css, callScreen.css, callPopup.css). */
export function isDriftScanned(relPath: string): boolean {
    if (relPath.endsWith('.css')) return true;
    return isScanned(relPath);
}

export const DRIFT_LABELS: BaselineLabels = {
    noun: 'palette / layering / arbitrary value(s) or CSS colour literal(s)',
    hint: 'use tokens, Z_INDEX and the type scale (docs/design/DESIGN_SYSTEM.md)',
    path: 'src/design/drift-guard-baseline.json',
};
```

(c) Let `scanTree` pass the path to the counter — change its signature and the call:

```ts
export function scanTree(
    srcRoot: string,
    count: (source: string, relPath: string) => number = countViolations,
    scanned: (relPath: string) => boolean = isScanned,
): Record<string, number> {
```

and inside: `const n = count(readFileSync(full, 'utf-8'), rel);` (the existing counters ignore the second argument).

- [ ] **Step 3: Write the baseline and review it**

Run: `cd frontend && UPDATE_DRIFT_BASELINE=1 npx vitest run src/design/guard.test.ts && cat src/design/drift-guard-baseline.json`
Expected: about a dozen entries, none under `design/`: `core/media/VideoPlayer.tsx`, `core/media/SubtitleOverlay.tsx`, `core/media/VoicePlayer.tsx`, `core/media/TranscriptPanel.tsx` (its `withBackdrop` classes; Plan G Task 10 moved its `text-xs` to `text-caption`), `core/media/TranscribeButton.tsx`, `core/common/TranslateButton.tsx`, `core/common/SafeImage.tsx`, `core/common/DynamicBackground.tsx` (its `blur-[100px]` unless Plan F Task 11 ran), `features/blogs/components/TimelineRail.tsx` (`z-50`, `border-l-[3px]`, both documented as deliberate), `features/memories/memoir/Postcard.tsx` (`z-40`), `features/incomingCall/callScreen.css` (57), `features/callPopup/callPopup.css` (1 colour literal; `isDriftScanned` scans every CSS file), `index.css` (the `#F0F2F5` body colour and the scrollbar fallbacks). No file created by Plan F or G may appear (the test above): if one does, replace its classes with tokens in this task. `core/common/ErrorBoundary.tsx` and `core/common/InlineTranslation.tsx` are absent (Tasks 6 and 3). If a `design/` file appears, replace its classes with tokens in this task.

Run: `cd frontend && npx vitest run src/design`
Expected: PASS.

- [ ] **Step 4: Document the ratchet**

Add to `docs/design/DESIGN_SYSTEM.md` under "### The guard (ratchet)" a subsection:

```markdown
#### The drift ratchet

The same test file runs a third ratchet (`countDriftViolations`, `isDriftScanned`) over what the
first one does not count: named palette classes (`bg-gray-100`, `text-white`, `bg-black/40`),
`z-40` / `z-50` / `z-[…]`, Tailwind's default font sizes (`text-xs` … `text-9xl`), arbitrary
`leading` / `tracking` / `duration` / `delay` / `ease` / colour-utility / `blur` values, and hex /
`rgb()` / `hsl()` literals in every CSS file under `src` and in `tailwind.config.js`. It compares
with `drift-guard-baseline.json` under the same rules (new files 0, counts only go down, no `design/`
entries). The entries left are deliberate or pre-token: the call screen's own stylesheet (accepted
glass look), the body colour that must match the native window, the media players' viewer chrome,
the blog rail's 3 px track and its tooltip layer, and the postcard caption's local stacking.
To rewrite it, from `frontend/`:

    UPDATE_DRIFT_BASELINE=1 npx vitest run src/design/guard.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src docs/design/DESIGN_SYSTEM.md
uv run git commit -m "test(design): ratchet palette, layering and CSS colour drift" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: CHANGELOG and final verification

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]`)

- [ ] **Step 1: Add the entries**

Under `## [Unreleased]` → `### Fixed`:

```markdown
- **Long laughs and dashes no longer get cut off.** A message, memory or letter
  with a long unbroken run such as "wwwww" or "〜〜〜" now wraps inside its
  bubble instead of running past the edge.
- **Windows High Contrast now shows what is on and what is selected.**
  Switches, the selected group, conversation, tab or filter, and the edges of
  dialogs and cards stay visible with every contrast theme.
- **Translations look like the language they are in.** Chinese and Cantonese
  translations now use Chinese characters' own shapes instead of Japanese ones,
  are no longer slanted, and their controls are easier to read.
- **The error screen is now in your language** and matches the rest of the app.
```

Under `### Changed`:

```markdown
- **Tidier text.** Message times and unread counts line up, headings and
  Japanese blog titles break at more natural places, and Settings no longer
  shifts sideways when you switch tabs.
```

- [ ] **Step 2: Full verification**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest run
npm run build && npx playwright test e2e/theming.spec.ts e2e/visual-zero-pixel.spec.ts e2e/r-a-screens.spec.ts e2e/r-b-screens.spec.ts --reporter=line
```

Expected: tsc clean; eslint 0 errors (≤ 20 warnings); vitest all pass (the three guard ratchets, the text-wrap scan and the forced-colours contract included); `theming.spec.ts` passes. The screenshot specs may report diffs only where the Decisions say pixels change (bubble times' figures, headings' breaks, crash screen); review each diff against Decisions 5–8 and record it in the PR, do not blindly update.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
uv run git commit -m "docs(changelog): note the text, contrast and translation fixes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Guidance used (modern-web-guidance)

- **`typography`** — Task 1 ("Use `overflow-wrap: break-word` (or `anywhere`) to contain long URLs" — and long kana/symbol runs); Task 5 ("Use `text-wrap: balance` for balanced headlines", "Use `text-wrap: pretty` for long-form body text", "**DO NOT** apply it on `*`"); Task 4's `min-h` buttons ("**DON'T** set a fixed `height` … on elements that contain text, such as buttons … with `min-block-size` if a minimum is needed").
- **`color`** — Task 2 ("Don't rely on `background-image`, `box-shadow`, or `border-image` to convey borders, separators, or state … ensure there's an alternative in forced colors mode, such as `outline` or `border` with system color keywords"; "Use `forced-color-adjust: none` only where color is essential information" — only the Switch); Task 3's tokens ("Maintain 4.5:1 for normal text").
- **`adapt-scrollbar-to-contrast-preferences`** — Task 2's `prefers-contrast: more` thumb ("Use an `@media (prefers-contrast: more)` block to define dark, distinct colors for the thumb"); the at-rest default stays (C-Y9 won't-fix) as the owner's accepted look.
- **`dark-mode`** / **`browser-ui-theming`** — Task 7 declares the light scheme on `:root` and in a meta tag ("MANDATORY: Apply the `color-scheme` property to the `html` element or the `:root` pseudo-class"; "Use `color-scheme` to have browser UI adapt to light/dark mode"), so UA-drawn controls do not follow a dark Windows theme while the app has no dark palette.
- **`css-layout`** — Task 4's safe centring ("Prefix positional alignment with `safe` (e.g., `align-items: safe center`) so focusable content isn't clipped when the container is narrower than its content") and the stable gutter only where content height changes under the user.
- **`improve-text-layout-and-legibility`** — Task 5 limits `balance` to short headings ("Apply `text-wrap: balance` specifically to short, multi-line elements such as headings"); `word-break: auto-phrase` for Japanese titles comes from the audit (Chromium-only, allowed by the runtime policy).
- **`visually-stable-mixed-fonts`** — read for Task 3; its `font-size-adjust` rule is not applied: Task 3 switches whole stacks per `lang` (one Noto family per run, with matching metrics across JP/TC/SC/HK), so there is no fallback swap inside a run to stabilise.
- **`size-aware-styling`** — read for C-L2; not applied (won't-fix: container queries would change accepted pane layouts at widths the app now shows them).
- **`single-line-overflow`** — read for C-Y7 (MemberPane names); not applied (won't-fix, Appendix A).

## Windows owner checks

Record results in `.superpowers/sdd/windows-acceptance.md` under "Plan H".

1. **High Contrast themes (Settings → Accessibility → Contrast themes): Aquatic, Desert, Dusk, Night sky.** In each: a Settings switch reads clearly on vs off; the selected group in the left rail, the selected conversation tile, the selected tab in Media and the highlighted search result have a visible outline; dialogs and menus have a visible edge, but the full-screen photo/video viewer has no frame round the window; scrollbar thumbs stay visible on hover and inside the viewer; focus rings show when tabbing; the chat header title is readable (no white-on-white).
2. **Translations (target 繁體中文, then 简体中文, then English), UI language Japanese.** Translate a message and a blog post: Chinese text uses Chinese glyph shapes (compare 骨, 角, 直 against Japanese), is upright, and the "Translate" toggle reads clearly; English blog lines stay italic.
3. **CJK IME.** Type in Search, the member filter and any Settings field with Microsoft IME (Japanese) and a Chinese IME: composition, candidate list and confirm work; no clipped candidate text.
4. **Scaling 100 / 125 / 150 / 200 %.** A message of 300 "w" and a long "〜〜〜" run wraps inside its bubble at every scale; Settings does not shift when switching tabs; the Memories film strip's oldest frame is reachable by scrolling left; buttons in the Settings footer and dialogs show their full labels on one line in Japanese and Cantonese.
5. **Dark Windows theme (Settings → Personalization → Colors → Dark).** Native scrollbars, the date inputs and selects in SakaDesk stay light.
6. **Crash screen.** In a dev build, throw from a component (the DesignPage error demo, if present, or a temporary throw) with UI language 粵語: the crash screen is in Cantonese, uses the app's colours (a red icon tile beside a dark title, no red header bar, ⚑ Decision 8), both buttons show their full labels and work; `debug.log` shows `app_load_failed target=render`.

## Self-review

- **Spec coverage:** every row of `report-css-theming.md` maps to a task here, to Plan B (fonts), to Plan G (menu focus ring, ShareDialog name) or to a won't-fix with reason (Appendix A). UI-HEALTH-REPORT #4, #6, #10, #14 and the CSS quick wins (`break-words`, safe centring, `tabular-nums`, `color-scheme`, `scrollbar-gutter` on Settings) are covered; the quick win "`scrollbar-gutter` on the Modal scroller" is a won't-fix (Decision 6).
- **Placeholders:** Task 8's list of missing registry keys is produced by the failing test (the step names the known ones and says to add every listed key).
- **Pre-flight review** (`.superpowers/sdd/ui-plans-preflight-review.md`) applied: H2-1 (forced thumb on hover and dark surfaces), H2-2 (no outline on the dark viewer), H3-1 (`:is(…)` companions for every content language), H4-1 (overflow risk in Decision 5), H6-1 (error-state tile instead of a solid danger header; ⚑ restated), H8-1 (⚑ 10a with the grep result), H9-1 (`callPopup.css` listed; no F/G file in the drift baseline). Not applied: H6-2 (plain `<button>`s on the crash screen) — it conflicts with the design-system primitives rule (Decision 8).
- **Names:** `langStackVar`, `writeLanguageStacks`, `loadLanguageFaces`, `isCjkLanguage`, `justify-safe-center`, `items-safe-center`, `scrollbar-stable`, `phrase-break`, `TW_MERGE_CLASS_GROUPS`, `DRIFT_PATTERNS`, `countDriftViolations`, `isDriftScanned`, `DRIFT_LABELS`, `drift-guard-baseline.json`, `UPDATE_DRIFT_BASELINE`, `createdByFAndG` are consistent across tasks and tests.

## Appendix A — Triage of `report-css-theming.md`

| Id | Finding (report section) | Status |
|---|---|---|
| C-F1 | No forced-colors handling: Switch, Pill, RailItem, Settings tabs, avatar selection, surface edges (Theming, Top 1) | task H2 (the dark viewer keeps no frame; the thumb rules cover hover and dark surfaces) |
| C-Y1 | Message/memory/letter text clipped: `whitespace-pre-wrap` without `overflow-wrap` (Typography, Top 2) | task H1 |
| C-Y2 | Translations in Japanese glyphs; italic CJK (Typography, Top 3) | task H3 (display / reading faces kept for every content language) |
| C-Y4 | Render-blocking Google Fonts; weight 300 loaded unused (Typography, Top 4) | closed — security Plan B Task 8 (bundled `@fontsource-variable/*`; CHANGELOG "Fonts now come with the app") |
| C-T1 | Guard scans only .ts/.tsx; misses palette classes, z-40/50, arbitrary values, default sizes, CSS literals (Token discipline, Top 5) | task H9 (no file created by Plan F or G may enter the baseline) |
| C-T2 | Legacy `--color-*` vars and utilities unused but rewritten; index.css defaults differ; body `text-gray-900` (Token discipline) | task H7 |
| C-T3 | JP font stacks duplicated in index.css, untested (Token discipline) | task H3 (stacks as variables from `fontStacks`) |
| C-T4 | `callScreen.css` separate style system; decline red not semantic danger (Token discipline) | task H9 ratchets its 57 literals; recolouring won't-fix (accepted glass call screen; a red change is a visible redesign) |
| C-T5 | tailwind-merge list stale (Token discipline) | task H8 (no current call site combines two of the new keys, ⚑ Decision 10a) |
| C-L1 | `justify-center` / vertical centring inside scrollers clip the start (FilmStrip, Gacha, ErrorBoundary) (Layout) | task H4 (FilmStrip, Gacha); ErrorBoundary in task H6 |
| C-L2 | Pane components use viewport breakpoints; md: always true at ≥960 px (Layout) | won't-fix: container queries would apply the narrow layouts at today's pane widths — a visible change to accepted Memories/chat layouts; the `max-md:` drawer is reachable with page zoom (Plan G Task 5 makes it inert when closed); revisit in a layout design round |
| C-L3 | Bubble only `max-w-[80%]` → ~110 JP chars per line at 2560 px (Layout) | won't-fix ⚑: a width cap changes the accepted bubble width at common window sizes too (80 % of a 900 px pane is 720 px > 42 rem); owner decision |
| C-L4 | Button fixed `h-8`/`h-10` without `whitespace-nowrap` (Layout) | task H4 |
| C-L5 | 10 px scrollbar shifts content (SettingsModal, Modal) (Layout) | task H4 for Settings; Modal won't-fix (Decision 6) |
| C-L6 | MemberSelectModal JS layout; TimelineRail tooltip magic clamp and `z-50` (Layout) | `z-50` ratcheted in task H9 (documented as the rail's local tooltip layer); the JS layout and the clamp won't-fix: no visible defect, the values copy the accepted e4e4118 look |
| C-Y3 | Postcard clamp wrapper vs direct clamps on flex items → one `ClampText` primitive (Typography) | won't-fix: no observed clamp failure at the three sites in WebView2 acceptance rounds; a primitive refactor of accepted Memories surfaces adds risk without a visible gain; revisit if a clamp fails |
| C-Y5 | No `text-wrap` anywhere; `word-break: auto-phrase` on ja titles (Typography) | task H5 |
| C-Y6 | Times and unread counts lack `tabular-nums` (Typography) | task H5 |
| C-Y7 | MemberPane truncated names readable only via `title` (Typography) | won't-fix: the full name is in the DOM (screen readers read it); a reveal-on-hover would change the accepted pane; low |
| C-Y8 | px type scale (Typography) | won't-fix: no in-app text size setting is planned; Chromium zoom scales px text |
| C-Y9 | Scrollbar thumb at rest ~1.8:1 (Typography) | won't-fix for the default (accepted subtle thumb); task H2 darkens it for "more contrast" and High Contrast users |
| C-I1 | Crash screen hard-coded English, palette classes, off-system button; Diagnostics English (i18n) | crash screen → task H6 (error-state tile, no solid danger header); Developer Diagnostics won't-fix ⚑: a hidden developer console by design (DESIGN_SYSTEM "Developer surfaces"); translate only if the owner decides it is user-facing |
| C-I2 | Hand-built YYYY/MM/DD; `toLocaleString()` without locale (i18n) | numbers → task H6; dates won't-fix (Decision 9) |
| C-F2 | Menu item focus `bg-sunken` ~1.1:1, outline removed (Theming) | task G7 (Plan G) |
| C-F3 | No `color-scheme` (Theming) | task H7 |
| C-DM | Dark-mode readiness blockers (`#F0F2F5`, callScreen literals, palette classes, legacy layer) (Theming) | legacy layer removed (H7) and the rest ratcheted (H9); dark mode itself is not built (DESIGN_SYSTEM "Dark mode") |
