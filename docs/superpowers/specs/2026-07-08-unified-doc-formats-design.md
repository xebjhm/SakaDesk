# Unified Documentation Formats for SakaDesk + pysaka — Design

**Date:** 2026-07-08
**Status:** Approved (brainstorming session with maintainer)
**Scope:** Both repos (`C:\D\repos\SakaDesk`, `C:\D\repos\pysaka`) plus user-level
Claude Code configuration on the maintainer's machine.

## Problem

User-facing documents produced during development — PR descriptions, CHANGELOG
entries, GitHub release notes, and commit messages — are each invented ad hoc by
whichever AI agent (or human) writes them:

- Recent PRs use four different body structures (`Why/What/Tests`,
  `Problem/Fix/Testing`, `Removes/Keeps`, headerless) and mix
  conventional-commit titles with plain sentences.
- CHANGELOG entries swing between terse commit-log bullets (0.2.x) and long
  user-facing narratives (0.3.x) in the same document.
- The two most recent SakaDesk release notes share a `## Highlights` heading but
  order their sections differently.
- Both repos have detailed `.github/PULL_REQUEST_TEMPLATE.md` files that agents
  bypass entirely, because `gh pr create --body` never sees the template.

## Decisions (from brainstorming)

1. **Scope:** all four artifact types — commit messages, PR titles/bodies,
   CHANGELOG entries, GitHub release notes.
2. **Changelog audience is per-repo:** SakaDesk = end users (plain language,
   symptom first); pysaka = API consumers (code identifiers welcome).
3. **Delivery = guidance + Claude-side enforcement:** in-repo spec docs and
   CLAUDE.md pointers, plus a Claude Code PreToolUse hook that validates
   `gh pr create` / `gh release create|edit` / `git commit` at call time.
   No repo-side commitlint or CI gates.
4. **The hook also validates `git commit` messages** (conventional commits).
5. **Canonical spec lives per-repo** (`docs/DOC_FORMATS.md` in each repo), not
   in a user-level skill — visible on GitHub, travels with the repo,
   audience-tailored.

## Components

### 1. `docs/DOC_FORMATS.md` (one per repo, canonical spec)

Self-contained file with four sections. The commit and PR sections are
identical in both repos; the changelog and release-note sections are
repo-specific.

#### 1a. Commit messages (both repos, identical)

Conventional Commits:

```
type(scope)!: subject
```

- Types: `feat` `fix` `docs` `refactor` `perf` `test` `build` `ci` `chore`
  `revert`. Scope optional, lowercase, kebab-case.
- Subject: imperative mood, ≤ 72 characters, no trailing period.
- Body (optional): explains *why*, wrapped at 72 columns.
- Breaking changes: `!` after type/scope plus a `BREAKING CHANGE:` footer.
- Exempt from validation: merge commits, `revert`/`fixup!`/`squash!` prefixes,
  and release-please's `chore(release): …` commits.
- Rationale: consistency, plus release-please (already configured in SakaDesk)
  parses conventional commits.

#### 1b. PR title + body (both repos, identical)

- **Title:** same convention as the commit subject
  (e.g. `feat(sync): verify & fix media button`).
- **Body:** four required sections, in this order:

```markdown
## Why
<!-- Symptom/problem being solved; root cause if a bug. One short paragraph. -->

## What
<!-- Bulleted changes. Group under **Backend** / **Frontend** when both are touched. -->

## Testing
<!-- Suites run with counts (e.g. "backend 986 · frontend 288 · tsc/ruff/mypy clean").
     Flag manual-only verification honestly; state what is NOT covered. -->

## Changelog
<!-- Quote the CHANGELOG.md [Unreleased] entry this PR adds, in a ```markdown block.
     Or the single line: No user-facing change. -->
```

- Optional sections (after the required four): `## Depends on` (cross-repo
  dependencies, e.g. paired pysaka PRs), `## Screenshots`, `## Notes`.
- The required `## Changelog` section is the changelog-discipline mechanism:
  the hook checks for the section header, so a PR cannot be opened without an
  explicit changelog decision.
- Keep the existing `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
  footer behavior.

#### 1c. CHANGELOG.md entries (per-repo audience)

Both repos keep the Keep a Changelog skeleton (categories `Added` / `Changed` /
`Fixed` / `Security` / `Deprecated` / `Removed`, `[Unreleased]` section on top,
compare-links footer) and Semantic Versioning.

Common rules:

- One entry per **user-visible change**, not per commit.
- Entries are added under `[Unreleased]` **in the same PR** as the change.
- Wrap at ~80 columns (matches existing files).

**SakaDesk** (audience: end users):

- Entry = symptom or benefit in user terms; start with a **bold lead-in
  phrase**, then ≤ 3 sentences.
- No code identifiers, file paths, or internal jargon
  (`connectedServices`, `AuthContext`, etc. belong in the PR, not here).
- Security-review codes (e.g. `SEC-1`) allowed only as a trailing
  parenthetical under `### Security`.
- Example (good):
  > **Window grew on every restart** at non-100% display scaling; window
  > geometry is now correct at any DPI scale.

**pysaka** (audience: API consumers / developers):

- Name the API in backticks (`get_messages`, `scan_member_media`); state
  before/after behavior.
- Breaking changes: bold `**Breaking:**` prefix + one-line migration hint.
- Example (good):
  > **Breaking:** package renamed from `pyhako` to `pysaka`; update imports
  > and dependency pins.

#### 1d. GitHub release notes (per-repo)

**SakaDesk** (curated by hand after CI creates the release):

```markdown
SakaDesk X.Y.Z — <one-line theme>. Requires pysaka ≥ A.B.C.

## Highlights

- **<User-visible benefit>.** <One sentence of detail.>
<!-- 3–7 bullets, user language, most important first. -->

## Install

Download `SakaDesk-X.Y.Z-Setup.exe` below. It's unsigned, so Windows
SmartScreen may prompt — choose **More info → Run anyway**. Verify integrity
against `checksums-sha256.txt`.

**Full Changelog:** [CHANGELOG.md](https://github.com/xebjhm/SakaDesk/blob/main/CHANGELOG.md#xyz---yyyy-mm-dd)
```

The tagline line, `## Highlights`, `## Install` (frozen wording), and the
`**Full Changelog:**` link are all required, in that order. Title is set by CI
(`SakaDesk X.Y.Z`) and never changed.

**pysaka:** CI's `github-release` job auto-generates notes from the matching
CHANGELOG section — that is the normal path and the spec documents it. Manual
fallback (only if CI fails): `## Highlights` bullets + PyPI link
(`https://pypi.org/project/pysaka/X.Y.Z/`) + `**Full Changelog:**` link,
title `pysaka X.Y.Z`.

### 2. `CLAUDE.md` (new, one per repo)

Short file whose core is a **Documentation formats** section: one-line summary
of each convention (commit format, PR sections, changelog audience,
release-note template) plus the pointer "full spec: `docs/DOC_FORMATS.md` —
read it before writing any of these." Auto-injected into every Claude Code
session inside that repo. Nothing else goes in CLAUDE.md for now (no build/dev
docs — YAGNI; can grow later).

### 3. `.github/PULL_REQUEST_TEMPLATE.md` (rewritten, both repos)

Replaced with the canonical `Why / What / Testing / Changelog` structure plus
the optional sections as HTML comments. The current 20-checkbox checklist is
dropped; the test-gate reminders move into a brief comment under `## Testing`.
Humans and agents converge on the same shape.

### 4. Validating hook (user-level Claude Code config)

**Registration** (`C:\Users\xebjhm\.claude\settings.json`):

- Event: `PreToolUse`, matcher: `Bash|PowerShell` (agents use both shells).
- Command: `pwsh -NoProfile -File C:\Users\xebjhm\.claude\hooks\saka-doc-format.ps1`
- PowerShell chosen because it is guaranteed on this machine and needs no env
  sync (a `uv run python` hook would churn project envs and depend on cwd).

**Must be user-level, not per-repo `.claude/settings.json`:** the maintainer
routinely works from `C:\D\repos` (the non-git parent directory), where
repo-level hooks never fire. The script self-scopes instead.

**Script logic** (reads the hook JSON from stdin):

1. **Scope guard:** proceed only if the session `cwd` or the command text
   references the SakaDesk or pysaka repo paths (match both `C:\D\repos\…` and
   `/c/D/repos/…` spellings, case-insensitive). Otherwise exit 0.
2. **Escape hatch:** if env `SAKA_DOCFMT_SKIP=1`, exit 0.
3. **`git commit`** with an inline `-m`: extract the first message's subject
   line; validate the pattern
   `^(feat|fix|docs|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: .+$`
   plus two separate checks: whole subject line ≤ 72 characters, and no
   trailing period. Exempt: `Merge `, `Revert `, `fixup!`, `squash!`,
   `chore(release):`. Invalid → **exit 2**, stderr = expected format + a
   corrected example. (Exit 2 blocks the call and feeds stderr back to the
   agent, which retries with a fixed message.)
4. **`gh pr create`:** the full command text (heredocs included) — or, when a
   `--body-file <path>` is present and readable, that file's content — must
   contain all of `## Why`, `## What`, `## Testing`, `## Changelog`. If a
   `--title` is present, it must match the commit-subject convention. Missing →
   **exit 2**, stderr points to `docs/DOC_FORMATS.md` § PR format and lists the
   missing sections.
5. **`gh release create` / `gh release edit`** with `--notes`/`--notes-file`
   (or `-n`/`-F`): content must contain `## Highlights` and `Full Changelog`.
   Missing → **exit 2** with the release-note template pointer. A
   `gh release create` with no notes flags (CI-style) is allowed.
6. **Fail-open everywhere else:** stdin JSON parse errors, unrecognized command
   shapes, unreadable body files → exit 0. The hook must never block unrelated
   work; the guidance layer (CLAUDE.md + spec) is the backstop.

### 5. `/release` command update

`C:\Users\xebjhm\.claude\commands\release.md`:

- Phase 2 step 3 (PR body): replace "Summary of changes (from git log…)" with
  "follow the PR format in the repo's `docs/DOC_FORMATS.md`".
- Phase 4 step 2 (SakaDesk release notes): replace the inline 3-bullet
  Highlights template with a reference to the DOC_FORMATS release-note
  template (tagline + Highlights + Install + Full Changelog link).
- Phase 1 step 5 / Phase 3 step 2 (changelog): add a pointer to the per-repo
  entry-style rules.

### 6. Testing

- **Hook test harness:** `C:\Users\xebjhm\.claude\hooks\saka-doc-format.tests.ps1`
  pipes sample stdin JSON payloads to the hook script and asserts exit codes
  and stderr content. Cases: valid/invalid `git commit` subject, exempt commit
  shapes (merge, `chore(release):`), `gh pr create` with all/missing sections,
  `--body-file` variant, `gh release edit` with/without `## Highlights`,
  out-of-scope cwd (must exit 0), malformed stdin (must exit 0),
  `SAKA_DOCFMT_SKIP=1` (must exit 0).
- **Live dry-run:** in a scratch branch, a malformed `git commit -m "bad msg"`
  must be blocked with the corrective message; a conforming
  `chore: test doc-format hook` must pass. Undo the scratch commit afterwards.

## Out of scope (deliberate)

- Repo-side commitlint / CI enforcement (declined in favor of Claude-side).
- Backfilling historical CHANGELOG entries to the new style.
- Hook-watching `Edit`/`Write` calls on CHANGELOG.md (the required
  `## Changelog` PR section covers changelog discipline with less friction).
- The WSL copy of the release flow (this machine's hook is Windows-only;
  the in-repo spec still guides any agent there).

## Rollout order

1. `docs/DOC_FORMATS.md` in both repos.
2. `CLAUDE.md` in both repos.
3. Rewritten PR templates in both repos.
4. Hook script + tests + registration in user settings.
5. `/release` command update.
6. Memory entry recording the new convention locations.
