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
