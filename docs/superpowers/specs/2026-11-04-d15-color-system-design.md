# D1.5 — Unified colour system

Date: 2026-11-04
Status: approved in brainstorming (user: "D1合併 寫spec然後開工")
Branch: `feat/d15-color-system` → `dev`, cut from `dev` after D1 (PR #10) merges

## Context

D1 put every existing colour into design tokens without changing anything visible. The user now wants **one colour language for every group**:

- It should be professionally structured.
- It must stay faithful to each group's logo.
- It replaces the per-group grab-bag of hand-picked colours in `serviceThemes.ts`.

The user will review the whole app after this lands.

Colours in the official logos (extracted from the logo files the app hotlinks):

| Group | Logo colours |
|---|---|
| Hinatazaka46 | `#7CC7E8`, `#5BBEE4`, Sakamichi purple `#7F1083` |
| Sakurazaka46 | `#F19DB5`, white, `#7F1084` |
| Nogizaka46 | `#7F1083` |
| Yodel | logo is `#6060E0`, but the **user keeps the current green family** (`#5A8A6A`) |

All three Sakamichi logos share the Sakamichi purple `#7F1083`.

## Decisions (from brainstorming, with the visual companion)

| # | Decision |
|---|---|
| 1 | **Two layers.** The *official layer* keeps the colours the user originally copied from official-app screenshots verbatim. The *system layer* derives every other colour from a per-group 10-step scale using the same role→step rule for all groups. |
| 2 | Official layer: title gradients and the Sakurazaka thin bar and title text, the sidebar/canvas gradients, all unread-shelter colours, and `shelterStyle` / `headerStyle`. |
| 3 | Title gradients go from the group colour to the Sakamichi purple, as in the logos (option B). They are already official values and stay verbatim. Yodel is single-hue. |
| 4 | Sakurazaka is the one stylistic exception: a white base with pink accents (`headerStyle: 'light'`, `shelterStyle: 'light'`). |
| 5 | Hinatazaka step 600 is `#389DD1` (white text 3.0:1). The user rejected `#0A88B0` as too far from sky blue, and preferred `#389DD1` to the logo colour with white text. |
| 6 | Unused legacy fields are deleted. Off-logo colours (teal `#5dc2b5`, sunlight yellow `#fffacd`, grey-blue `#8B9DC3`, Sakurazaka voice purple `#d695ec`, …) are replaced by scale steps. |
| 7 | Dark mode is still reserved, not built. |
| 8 | Out of scope: the ~200 hard-coded *neutral* values in components (those are D2, watched by the guard). The 6 hard-coded *group* colours (`#6da0d4`) in 5 files are in scope. |

## The model

### Per-group scales

Steps run 50–900. The step marked † is the logo colour itself.

| Step | hinatazaka | sakurazaka | nogizaka | yodel |
|---|---|---|---|---|
| 50 | `#eff9fd` | `#fff3f6` | `#fef3fe` | `#f3f8f4` |
| 100 | `#dbf1fb` | `#ffe5eb` | `#fce4fc` | `#e5f0e8` |
| 200 | `#bbe4f7` | `#fecdda` | `#f9cbf8` | `#cde3d3` |
| 300 | `#7cc7e8` † | `#feacc3` | `#f1abf1` | `#afd1b9` |
| 400 | `#62bce2` | `#f19db5` † | `#e389e4` | `#90bc9e` |
| 500 | `#50acdf` | `#e76692` | `#d06ad2` | `#74a684` |
| 600 | `#389dd1` | `#c84575` | `#b24ab5` | `#5a8a6a` † |
| 700 | `#0d7aab` | `#a72f5d` | `#943397` | `#416f51` |
| 800 | `#025c83` | `#852048` | `#7f1083` † | `#30573e` |
| 900 | `#03425f` | `#641434` | `#57175a` | `#21402c` |

**`default`** (no group selected) uses the Tailwind grey scale: `#f9fafb #f3f4f6 #e5e7eb #d1d5db #9ca3af #6b7280 #4b5563 #374151 #1f2937 #111827`. Its logo colour is `#6B7280`.

**Sakamichi purple**, used only by the derived ambient orbs, is a shared constant `#7F1083` with step 100 `#fce4fc`.

The scales were generated in OKLCH:
- lightness is fixed per step;
- chroma is shaped per step;
- the logo colour is snapped into its nearest step;
- Hinatazaka 500/700/800/900 were re-fitted around the user's 600.

They are committed as literal values. Nothing is computed at runtime.

### Role mapping (system layer)

| Role | Step | Replaces legacy fields |
|---|---|---|
| `logo` (brand, logo colour) | logo | `primaryColor` |
| `action` (badge, primary button, play button, scroll button) | 600 | `unreadBadge`, `voicePlayerAccent`, `scrollButtonColor`, `modals.accentColor`, `secondaryColor` |
| `strong` (names, links, selected text, blog title, timeline) | 700 | `blog.memberNameColor`, `blog.linkColor`, `blog.headerTitleColor`, `blog.timelineIndicator` |
| `subtle` (selected / hover background) | 50 | `modals.accentColorLight`, theme `accentColor` |
| `subtleBorder` | 200 | `modals.accentColorMuted` |
| `linkUnderline` | 300 | `blog.linkUnderlineColor` |
| `bubbleBorder` | logo colour; Nogizaka 600 | `messages.bubbleBorder` |
| `glow` (selection glow) | logo colour at the legacy alpha | `interaction.hoverGlow` |
| `ring` (keyboard focus) | 600 | (was the D1 `ring`) |

In the code, `action` is written to `--ds-group-accent` and `--ds-group-badge`, and `logo` is written to `--ds-group-logo`.

The `bubbleBorder` row resolves to these values:

| Group | `bubbleBorder` | Why |
|---|---|---|
| hinatazaka | `#7cc7e8` | logo colour |
| sakurazaka | `#f19db5` | logo colour |
| nogizaka | `#b24ab5` | step 600; the logo purple is too dark for a border |
| yodel | `#5a8a6a` | logo colour, which is also step 600 |
| default | `#E5E7EB` | unchanged |

The `glow` row resolves to these values. Each is the logo colour at the legacy alpha:

| Group | `glow` |
|---|---|
| hinatazaka | `rgba(124, 199, 232, 0.35)` |
| sakurazaka | `rgba(241, 157, 181, 0.35)` |
| nogizaka | `rgba(127, 16, 131, 0.28)` |
| yodel | `rgba(90, 138, 106, 0.3)` |
| default | `rgba(107, 114, 128, 0.25)` |

Values derived from the roles:

| Derived value | Formula |
|---|---|
| `unreadShadow` | `0 0 12px <glow colour at alpha 0.4>` |
| `buttonGradient` | `linear-gradient(135deg, <logo> 0%, <600> 100%)` |

**Ambient orbs** (`DynamicBackground`): only the colours change. Opacity, position and size stay verbatim.

| Orb | Colour |
|---|---|
| orb1 | `radial-gradient(circle, <200> 0%, <100> 30%, transparent 70%)` |
| orb2 | `radial-gradient(circle, <purple100 for Sakamichi groups, else 100> 0%, <50> 40%, transparent 70%)` |
| orb3 | `radial-gradient(circle, <100> 0%, transparent 70%)` |

### Official layer (verbatim from today's values)

| Element | Legacy field | Source of truth |
|---|---|---|
| Title gradient, bar, title text | `messages.headerGradient`, `headerBarGradient`, `headerTextColor` | today's values (pinned by `legacy-theme-values.json`) |
| Canvas / sidebar gradient | `messages.sidebarGradient` | today's values (pinned by the fixture) |
| Unread shelters | `messages.shelterColors` | today's values, copied into tokens |
| Styles | `shelterStyle`, `headerStyle` | today's values |

### Deleted (no consumers)

These are deleted after the plan's `tsc` check confirms they have no consumers:

- `surface.card`, `surface.glass`, `surface.glassBorder`
- `text.primary`
- `interaction.focusRing`
- `messages.defaultBackground`
- `getServiceThemeCSSVariables`

Neutral fields that are still used stay unchanged in this step: `surface.background`, `text.secondary`, `text.muted`, `vibe`. Their per-group values move to `groupTokens[id].legacyNeutral` (`surfaceBackground`, `textSecondary`, `textMuted`), so `serviceThemes.ts` holds no colour literal.

## Architecture

- **`design/tokens/groups.ts`** holds per group:
  - `logo` and `scale` (10 steps);
  - `official` (title, canvas, shelter, styles);
  - `bubbleBorder` and `glow`.
- **`design/tokens/roles.ts`** (new) is a pure `groupRoles(id)` that returns every role value from `groups.ts`. It is the only place the role→step mapping lives.
- **`cssVars.ts`**:
  - `groupTokenVars` adds `--ds-group-strong`, `--ds-group-subtle`, `--ds-group-subtle-border` and `--ds-group-link-underline`.
  - `--ds-group-badge` and `--ds-group-accent` follow the roles.
  - `--ds-group-ring` becomes step 600.
- **`tailwind.config.js`** adds `text-group-strong`, `bg-group-subtle`, `border-group-subtle` and `decoration-group`. `cn` learns them.
- **`config/serviceThemes.ts`** keeps its public shape minus the deleted fields. Every colour field reads `groupRoles` or `official`, so the 23 existing consumers change colour without code changes.
- **Hard-coded group colours** are switched to the theme or tokens:
  - `features/messages/components/MessageBubble.tsx` (2)
  - `core/media/VoicePlayer.tsx` (1)
  - `core/media/TranscriptPanel.tsx`
  - `core/media/TranscribeButton.tsx`
  - `core/common/TranslateButton.tsx`

  `config/uiConstants.ts` is a neutral chat-background preset list, not a group colour, so it is out of scope. The replacement for the old `#6da0d4` fallback is `FALLBACK_ACTION_COLOR` in `design/tokens/roles.ts` (default group step 600).
- **`/design` page** shows each group's 10-step scale with the logo step marked, and the role table with contrast labels.
- **`DESIGN_SYSTEM.md`** gains a "Colour system" section: the two layers, the scale, the role table, and "add colours as roles, never as new hex".

## Testing

- **Official layer:**
  - title, bar, text and canvas still equal `legacy-theme-values.json`;
  - shelters and styles equal today's literal values, asserted in the test.
- **System layer:** a table test asserts every role value for all five groups equals this spec's tables. It also checks white-text contrast:
  - `action` ≥ 3.0:1;
  - `strong` ≥ 4.5:1.
- **Scale shape:** 10 steps per group, lightness decreasing monotonically (luminance strictly decreasing), and the logo colour present in the scale.
- **Legacy shape:** every remaining `serviceThemes` colour field resolves to a role or official value. A test enumerates the fields so that no hand-written hex survives in `serviceThemes.ts`.
- **Guard:** the 5 files lose their group hex literals, and their baseline counts drop accordingly.
- **Pixels:** the zero-pixel spec is expected to fail on intentional changes.
  - Baselines are recaptured after the change.
  - The PR attaches before and after screenshots.
  - The user reviews the whole app on Windows.

## Out of scope

- Hard-coded neutral values in components (D2).
- Layout and visual restructuring (D2).
- Dark mode.
- Any change to official-layer values.
