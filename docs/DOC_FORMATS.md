# Documentation Formats

Canonical formats for every human-facing document this repo produces: commit
messages, PR titles and bodies, CHANGELOG entries, and GitHub release notes.
AI agents and humans alike: follow these exactly. On the maintainer's machine
a Claude Code hook enforces the commit/PR/release formats at the moment of
`git commit` / `gh pr create` / `gh release`.

## Commit messages

Conventional Commits:

```
type(scope)!: subject
```

- **Types:** `feat` `fix` `docs` `refactor` `perf` `test` `build` `ci`
  `chore` `revert`.
- **Scope:** optional, lowercase kebab-case (e.g. `sync`, `blog`, `settings`).
- **Subject:** imperative mood ("add", not "added"); the whole first line is
  ≤ 72 characters; no trailing period.
- **Body (optional):** explains *why*, wrapped at 72 columns.
- **Breaking changes:** `!` after the type/scope plus a `BREAKING CHANGE:`
  footer.
- Exempt from the rule: merge commits, `Revert …`, `fixup!`, `squash!`, and
  release-please's `chore(release): …`.
- Why: one consistent history, and release-please (configured in this repo)
  parses conventional commits to build release PRs.

Examples:

```
feat(sync): add per-service verify & fix media button
fix(settings): warn when provider is set but no API key is stored
chore(release): prepare v0.3.2 changelog
```

## Pull requests

**Title:** same convention as a commit subject
(e.g. `feat(sync): verify & fix media button`).
Release PRs: `chore(release): vX.Y.Z`.

**Body:** four required sections, in this order:

```markdown
## Why
<!-- Symptom/problem being solved; root cause if a bug. One short paragraph. -->

## What
<!-- Bulleted changes. Group under **Backend** / **Frontend** when both are touched. -->

## Testing
<!-- Suites run with counts (e.g. "backend 986 · frontend 288 · tsc/ruff/mypy clean").
     Flag manual-only verification honestly; state what is NOT covered. -->

## Changelog
<!-- Quote the CHANGELOG.md [Unreleased] entry this PR adds, in a fenced block.
     Or the single line: No user-facing change. -->
```

Optional sections, after the required four: `## Depends on` (cross-repo
dependencies, e.g. paired pysaka PRs), `## Screenshots`, `## Notes`.

Always pass the body via `--body-file` or a heredoc so tooling can validate
it. Keep the `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
footer when an agent authors the PR.

## CHANGELOG.md

Keep a Changelog skeleton (categories `Added` / `Changed` / `Fixed` /
`Security` / `Deprecated` / `Removed`; `[Unreleased]` on top; compare-links
footer) and Semantic Versioning.

- **Audience: end users.** An entry states the symptom or benefit in user
  terms: a **bold lead-in phrase**, then at most 3 sentences.
- No code identifiers, file paths, or internal jargon — `connectedServices`
  and `AuthContext` belong in the PR, not here.
- Security-review codes (e.g. `SEC-1`) are allowed only as a trailing
  parenthetical under `### Security`.
- One entry per **user-visible change**, not per commit.
- Entries are added under `[Unreleased]` **in the same PR** as the change
  (quote them in the PR's `## Changelog` section).
- Wrap at ~80 columns.

Example (good):

> **Window grew on every restart** at non-100% display scaling; window
> geometry is now correct at any DPI scale.

## GitHub release notes

CI creates the release with auto-generated notes; replace the body with this
template (title stays `SakaDesk X.Y.Z` — never change it):

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
`**Full Changelog:**` link are all required, in that order.
