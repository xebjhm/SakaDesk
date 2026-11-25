# SakaDesk — agent instructions

## Documentation formats (MUST follow)

Before writing any of these, read `docs/DOC_FORMATS.md` and follow it exactly:

- **Commit messages** — Conventional Commits: `type(scope)!: subject`,
  imperative, whole line ≤ 72 chars, no trailing period.
- **PR title + body** — title like a commit subject; body sections `## Why`,
  `## What`, `## Testing`, `## Changelog` in that order (all four required).
  Release PRs are titled `chore(release): vX.Y.Z`.
- **CHANGELOG.md** — Keep a Changelog categories; entries written for
  **end users** (bold symptom/benefit lead-in, ≤ 3 sentences, no code
  identifiers); added under `[Unreleased]` in the same PR.
- **GitHub release notes** — fixed template: tagline line, `## Highlights`,
  `## Install`, `**Full Changelog:**` link.

A PreToolUse hook on this machine blocks `git commit` / `gh pr create` /
`gh release` calls that violate these formats — if a call is blocked, fix the
content per `docs/DOC_FORMATS.md` and re-run it.

## UI design system (MUST follow)

New or changed UI must use the design-system tokens and primitives in
`frontend/src/design/`. Read `docs/design/DESIGN_SYSTEM.md` before touching UI:
it defines the contexts (brand vs group), the colour roles, the three expression
tiers, the four levels and the Do/Don't list. Use `*-accent-*` /
`*-expressive-*` utilities so components follow their context; brand screens and
app-level dialogs use `brandScopeStyle()` / `Modal scope="brand"`. Never
hard-code colours or arbitrary radius / shadow / text / spacing values.
`frontend/src/design/guard.test.ts` fails the build on new hex / `rgb()` /
`hsl()` literals, arbitrary radius / shadow / text / spacing values and more
uses of the superseded `*-group-*` role utilities; its drift ratchet fails it
on new uses of, e.g., named palette classes (`bg-gray-100`, `bg-black/40`),
`z-40` / `z-50`, Tailwind's default font sizes and CSS colour literals. Preview
tokens and primitives at `?view=design` on the dev server.
