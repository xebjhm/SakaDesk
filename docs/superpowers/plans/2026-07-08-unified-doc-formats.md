# Unified Doc Formats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize commit messages, PR titles/bodies, CHANGELOG entries, and GitHub release notes across SakaDesk and pysaka, with in-repo specs as guidance and a user-level Claude Code PreToolUse hook as enforcement.

**Architecture:** Each repo gets a canonical `docs/DOC_FORMATS.md`, a short `CLAUDE.md` pointer, and a rewritten PR template (guidance layer). A single PowerShell hook script at `C:\Users\xebjhm\.claude\hooks\saka-doc-format.ps1`, registered user-level, validates `git commit` / `gh pr create` / `gh release create|edit` commands at call time and blocks violations with corrective stderr (enforcement layer). The `/release` command is updated to reference the spec.

**Tech Stack:** Markdown, PowerShell 7 (`pwsh`), Claude Code hooks (PreToolUse, stdin JSON protocol), git/gh CLI.

**Spec:** `C:\D\repos\SakaDesk\docs\superpowers\specs\2026-07-08-unified-doc-formats-design.md`

## Global Constraints

- Repo paths: `C:\D\repos\SakaDesk` and `C:\D\repos\pysaka`. User config: `C:\Users\xebjhm\.claude`.
- Both repos are currently on branch `fix/code-review-2026-07-07`. Commit ONLY the files each task names (`git add <explicit paths>`); pysaka has an unrelated modified `tests/test_manager.py` that must NOT be staged.
- Commit messages written during this plan must themselves follow the new convention, and end with the footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Conventional-subject rule (used verbatim everywhere): regex `^(feat|fix|docs|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: .+$`, plus whole subject line ≤ 72 characters, plus no trailing period. Exempt subjects: starting with `Merge `, `Revert `, `fixup!`, `squash!` (and `chore(release):` matches the regex anyway).
- Required PR body sections, exact spellings, in order: `## Why`, `## What`, `## Testing`, `## Changelog`.
- Required release-note markers: `## Highlights` and `Full Changelog` (SakaDesk notes additionally use an `## Install` section per the template, but the hook checks only the two markers).
- Release PR titles use `chore(release): vX.Y.Z` (changed from the old `Release vX.Y.Z` so no hook exemption is needed).
- The hook is fail-open: malformed stdin, unrecognized command shapes, out-of-scope paths, `SAKA_DOCFMT_SKIP=1` → exit 0. Exit 2 = block, stderr fed to the agent.
- `~/.claude` is not a git repository — hook-script tasks have no commit steps.
- The hook takes effect in NEW Claude Code sessions only; in-session verification is done by piping payloads to the script directly.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `C:\D\repos\SakaDesk\docs\DOC_FORMATS.md` | Create | Canonical spec, SakaDesk (end-user changelog audience) |
| `C:\D\repos\SakaDesk\CLAUDE.md` | Create | Always-in-context pointer to the spec |
| `C:\D\repos\SakaDesk\.github\PULL_REQUEST_TEMPLATE.md` | Rewrite | Human-facing template matching the canonical PR body |
| `C:\D\repos\pysaka\docs\DOC_FORMATS.md` | Create | Canonical spec, pysaka (API-consumer changelog audience) |
| `C:\D\repos\pysaka\CLAUDE.md` | Create | Always-in-context pointer to the spec |
| `C:\D\repos\pysaka\.github\PULL_REQUEST_TEMPLATE.md` | Rewrite | Human-facing template matching the canonical PR body |
| `C:\Users\xebjhm\.claude\hooks\saka-doc-format.ps1` | Create | The validating PreToolUse hook |
| `C:\Users\xebjhm\.claude\hooks\saka-doc-format.tests.ps1` | Create | Self-contained test harness for the hook |
| `C:\Users\xebjhm\.claude\settings.json` | Modify | Register the hook (merge, don't clobber) |
| `C:\Users\xebjhm\.claude\commands\release.md` | Modify | Reference the spec instead of inline ad-hoc templates |
| `C:\Users\xebjhm\.claude\projects\C--D-repos\memory\saka-doc-formats.md` + `MEMORY.md` | Create/Modify | Persistent memory of the new convention locations |

---

### Task 1: SakaDesk guidance docs

**Files:**
- Create: `C:\D\repos\SakaDesk\docs\DOC_FORMATS.md`
- Create: `C:\D\repos\SakaDesk\CLAUDE.md`
- Rewrite: `C:\D\repos\SakaDesk\.github\PULL_REQUEST_TEMPLATE.md`

**Interfaces:**
- Produces: the exact section names `## Why` / `## What` / `## Testing` / `## Changelog` and the release-note markers `## Highlights` / `Full Changelog` that Task 3's hook validates. Do not rename them.

- [ ] **Step 1: Create `docs/DOC_FORMATS.md`** with exactly this content:

````markdown
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
````

- [ ] **Step 2: Create `CLAUDE.md`** with exactly this content:

````markdown
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
````

- [ ] **Step 3: Overwrite `.github/PULL_REQUEST_TEMPLATE.md`** (replace the whole file) with exactly this content:

````markdown
## Why

<!-- Symptom/problem being solved; root cause if a bug. One short paragraph. -->

## What

<!-- Bulleted changes. Group under **Backend** / **Frontend** when both are touched. -->

-

## Testing

<!-- Suites run with counts (e.g. "backend 986 · frontend 288 · tsc/ruff/mypy clean").
     Gates: uv run python -m pytest backend/tests/ tests/ · (cd frontend) npm run test:run ·
     npx tsc --noEmit · uv run ruff check . · uv run mypy backend/
     Flag manual-only verification honestly; state what is NOT covered. -->

## Changelog

<!-- Quote the CHANGELOG.md [Unreleased] entry this PR adds (see docs/DOC_FORMATS.md
     for entry style — end-user language), or write: No user-facing change. -->

```markdown

```

<!-- Optional sections below: ## Depends on · ## Screenshots · ## Notes -->
````

- [ ] **Step 4: Verify the three files**

Run (Bash tool, from `C:\D\repos\SakaDesk`):
```bash
grep -c "^## " docs/DOC_FORMATS.md && grep -n "## Why\|## What\|## Testing\|## Changelog" .github/PULL_REQUEST_TEMPLATE.md && grep -n "DOC_FORMATS" CLAUDE.md
```
Expected: DOC_FORMATS.md has 5 `## ` headings; the template shows all four required sections in order; CLAUDE.md references DOC_FORMATS.

- [ ] **Step 5: Commit (SakaDesk, explicit paths only)**

```bash
cd /c/D/repos/SakaDesk
git add docs/DOC_FORMATS.md CLAUDE.md .github/PULL_REQUEST_TEMPLATE.md
git commit -m "docs: add DOC_FORMATS spec, CLAUDE.md, align PR template

Canonical formats for commits, PRs, changelog entries, and release
notes per docs/superpowers/specs/2026-07-08-unified-doc-formats-design.md.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
Expected: commit succeeds with exactly 3 files changed (pre-commit hooks run; if `uv.lock` churns, `git checkout -- uv.lock`).

---

### Task 2: pysaka guidance docs

**Files:**
- Create: `C:\D\repos\pysaka\docs\DOC_FORMATS.md`
- Create: `C:\D\repos\pysaka\CLAUDE.md`
- Rewrite: `C:\D\repos\pysaka\.github\PULL_REQUEST_TEMPLATE.md`

**Interfaces:**
- Produces: the same hook-validated section names as Task 1 (`## Why`/`## What`/`## Testing`/`## Changelog`, `## Highlights`, `Full Changelog`). Do not rename them.

**Do NOT stage** the pre-existing modified `tests/test_manager.py`.

- [ ] **Step 1: Create `docs/DOC_FORMATS.md`** with exactly this content:

````markdown
# Documentation Formats

Canonical formats for every human-facing document this repo produces: commit
messages, PR titles and bodies, CHANGELOG entries, and GitHub release notes.
AI agents and humans alike: follow these exactly. On the maintainer's machine
a Claude Code hook enforces the commit/PR/release formats at the moment of
`git commit` / `gh pr create` / `gh release`. Release *process* (CI, PyPI
publishing) is documented separately in `docs/RELEASE_GUIDE.md`.

## Commit messages

Conventional Commits:

```
type(scope)!: subject
```

- **Types:** `feat` `fix` `docs` `refactor` `perf` `test` `build` `ci`
  `chore` `revert`.
- **Scope:** optional, lowercase kebab-case (e.g. `auth`, `sync`, `blog`).
- **Subject:** imperative mood ("add", not "added"); the whole first line is
  ≤ 72 characters; no trailing period.
- **Body (optional):** explains *why*, wrapped at 72 columns.
- **Breaking changes:** `!` after the type/scope plus a `BREAKING CHANGE:`
  footer.
- Exempt from the rule: merge commits, `Revert …`, `fixup!`, `squash!`, and
  `chore(release): …`.

Examples:

```
feat(auth): capture refresh_token from mobile signin response
fix(sync): hold cursor behind messages with unconfirmed media
chore(release): prepare v0.4.3 changelog
```

## Pull requests

**Title:** same convention as a commit subject
(e.g. `fix(sync): prevent media loss on interrupted sync`).
Release PRs: `chore(release): vX.Y.Z`.

**Body:** four required sections, in this order:

```markdown
## Why
<!-- Symptom/problem being solved; root cause if a bug. One short paragraph. -->

## What
<!-- Bulleted changes: APIs added/changed in backticks, behavior before/after. -->

## Testing
<!-- Suites run with counts (e.g. "pytest 412 passed · ruff/mypy clean").
     Flag manual-only verification honestly; state what is NOT covered. -->

## Changelog
<!-- Quote the CHANGELOG.md [Unreleased] entry this PR adds, in a fenced block.
     Or the single line: No user-facing change. -->
```

Optional sections, after the required four: `## Depends on` (cross-repo
dependencies, e.g. paired SakaDesk PRs), `## Notes`.

Always pass the body via `--body-file` or a heredoc so tooling can validate
it. Keep the `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
footer when an agent authors the PR.

## CHANGELOG.md

Keep a Changelog skeleton (categories `Added` / `Changed` / `Fixed` /
`Security` / `Deprecated` / `Removed`; `[Unreleased]` on top; compare-links
footer) and Semantic Versioning.

- **Audience: API consumers (developers).** Name the API in backticks
  (`get_messages`, `scan_member_media`); state before/after behavior.
- **Breaking changes:** bold `**Breaking:**` prefix plus a one-line migration
  hint.
- One entry per **user-visible change** (visible to a developer using the
  library), not per commit.
- Entries are added under `[Unreleased]` **in the same PR** as the change
  (quote them in the PR's `## Changelog` section).
- Wrap at ~80 columns.

Example (good):

> **Breaking:** package renamed from `pyhako` to `pysaka`; update imports
> and dependency pins.

## GitHub release notes

Normally automatic: CI's `github-release` job creates the release titled
`pysaka X.Y.Z` with notes pulled from the matching CHANGELOG.md section.
Verify it exists; do not rewrite it.

Manual fallback (only if CI fails to create the release):

```markdown
## Highlights

- **<Developer-visible change>.** <One sentence of detail.>
<!-- 2–5 bullets from the CHANGELOG section. -->

Published to PyPI: https://pypi.org/project/pysaka/X.Y.Z/

**Full Changelog:** [CHANGELOG.md](https://github.com/xebjhm/pysaka/blob/main/CHANGELOG.md#xyz---yyyy-mm-dd)
```
````

- [ ] **Step 2: Create `CLAUDE.md`** with exactly this content:

````markdown
# pysaka — agent instructions

## Documentation formats (MUST follow)

Before writing any of these, read `docs/DOC_FORMATS.md` and follow it exactly:

- **Commit messages** — Conventional Commits: `type(scope)!: subject`,
  imperative, whole line ≤ 72 chars, no trailing period.
- **PR title + body** — title like a commit subject; body sections `## Why`,
  `## What`, `## Testing`, `## Changelog` in that order (all four required).
  Release PRs are titled `chore(release): vX.Y.Z`.
- **CHANGELOG.md** — Keep a Changelog categories; entries written for
  **API consumers** (APIs in backticks, before/after behavior,
  bold `**Breaking:**` prefix + migration hint for breaking changes);
  added under `[Unreleased]` in the same PR.
- **GitHub release notes** — CI-generated from the CHANGELOG section; verify,
  don't rewrite. Manual fallback template lives in `docs/DOC_FORMATS.md`.

A PreToolUse hook on this machine blocks `git commit` / `gh pr create` /
`gh release` calls that violate these formats — if a call is blocked, fix the
content per `docs/DOC_FORMATS.md` and re-run it.
````

- [ ] **Step 3: Overwrite `.github/PULL_REQUEST_TEMPLATE.md`** (replace the whole file) with exactly this content:

````markdown
## Why

<!-- Symptom/problem being solved; root cause if a bug. One short paragraph. -->

## What

<!-- Bulleted changes: APIs added/changed in backticks, behavior before/after. -->

-

## Testing

<!-- Suites run with counts (e.g. "pytest 412 passed · ruff/mypy clean").
     Gates: uv run pytest · uv run ruff check . · uv run mypy .
     Flag manual-only verification honestly; state what is NOT covered. -->

## Changelog

<!-- Quote the CHANGELOG.md [Unreleased] entry this PR adds (see docs/DOC_FORMATS.md
     for entry style — API-consumer language), or write: No user-facing change. -->

```markdown

```

<!-- Optional sections below: ## Depends on · ## Notes -->
````

- [ ] **Step 4: Verify the three files**

Run (Bash tool):
```bash
cd /c/D/repos/pysaka
grep -c "^## " docs/DOC_FORMATS.md && grep -n "## Why\|## What\|## Testing\|## Changelog" .github/PULL_REQUEST_TEMPLATE.md && grep -n "DOC_FORMATS" CLAUDE.md && git status --porcelain
```
Expected: 5 `## ` headings; four sections in order; CLAUDE.md references DOC_FORMATS; `git status` shows the 3 new/changed doc files plus the pre-existing ` M tests/test_manager.py` (leave it).

- [ ] **Step 5: Commit (pysaka, explicit paths only)**

```bash
cd /c/D/repos/pysaka
git add docs/DOC_FORMATS.md CLAUDE.md .github/PULL_REQUEST_TEMPLATE.md
git commit -m "docs: add DOC_FORMATS spec, CLAUDE.md, align PR template

Canonical formats for commits, PRs, changelog entries, and release
notes; shared convention with SakaDesk (spec lives in SakaDesk's
docs/superpowers/specs/2026-07-08-unified-doc-formats-design.md).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
Expected: commit succeeds with exactly 3 files changed; `tests/test_manager.py` remains modified-unstaged.

---

### Task 3: Validation hook — tests first, then implementation

**Files:**
- Create: `C:\Users\xebjhm\.claude\hooks\saka-doc-format.tests.ps1`
- Create: `C:\Users\xebjhm\.claude\hooks\saka-doc-format.ps1`

**Interfaces:**
- Consumes: Claude Code PreToolUse stdin JSON: `{ "cwd": "...", "tool_name": "Bash"|"PowerShell", "tool_input": { "command": "..." } }`.
- Produces: exit 0 (allow) or exit 2 + corrective stderr (block). Task 4 registers this script path in settings.json.

No git steps — `~/.claude` is not a repository.

- [ ] **Step 1: Create the hooks directory and write the failing test harness**

Create `C:\Users\xebjhm\.claude\hooks\saka-doc-format.tests.ps1` with exactly this content:

```powershell
# saka-doc-format.tests.ps1 — self-contained tests for the saka-doc-format hook.
# Run: pwsh -NoProfile -File saka-doc-format.tests.ps1   (exit 0 = all pass)
$ErrorActionPreference = 'Stop'
$hookPath = Join-Path $PSScriptRoot 'saka-doc-format.ps1'
$script:passed = 0
$script:failed = 0

function Invoke-Hook {
    param(
        [string]$Command,
        [string]$Cwd = 'C:\D\repos\SakaDesk',
        [string]$Skip = '',
        [string]$RawPayload = ''
    )
    $payload = if ($RawPayload) { $RawPayload } else {
        @{ cwd = $Cwd; tool_name = 'Bash'; tool_input = @{ command = $Command } } |
            ConvertTo-Json -Depth 5
    }
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = (Get-Command pwsh).Source
    $psi.Arguments = '-NoProfile -File "{0}"' -f $hookPath
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardOutput = $true
    $psi.UseShellExecute = $false
    $psi.EnvironmentVariables['SAKA_DOCFMT_SKIP'] = $Skip
    $p = [System.Diagnostics.Process]::Start($psi)
    try { $p.StandardInput.Write($payload); $p.StandardInput.Close() } catch {}
    $err = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    [pscustomobject]@{ Exit = $p.ExitCode; Stderr = $err }
}

function Assert-Case {
    param([string]$Name, $Result, [int]$ExpectExit, [string]$StderrContains = '')
    $ok = ($Result.Exit -eq $ExpectExit) -and
          ($StderrContains -eq '' -or $Result.Stderr.Contains($StderrContains))
    if ($ok) { $script:passed++; Write-Host "PASS  $Name" }
    else {
        $script:failed++
        Write-Host "FAIL  $Name (exit=$($Result.Exit) want=$ExpectExit stderr=$($Result.Stderr.Trim()))"
    }
}

# --- git commit --------------------------------------------------------------
Assert-Case 'valid conventional commit' `
    (Invoke-Hook 'git commit -m "feat(sync): add verify button"') 0
Assert-Case 'invalid commit subject blocked' `
    (Invoke-Hook 'git commit -m "added some stuff"') 2 'type(scope)'
Assert-Case 'subject over 72 chars blocked' `
    (Invoke-Hook ('git commit -m "feat: ' + ('x' * 70) + '"')) 2
Assert-Case 'trailing period blocked' `
    (Invoke-Hook 'git commit -m "fix(blog): retry locked index."') 2
Assert-Case 'merge commit exempt' `
    (Invoke-Hook 'git commit -m "Merge branch dev into main"') 0
Assert-Case 'chore(release) allowed' `
    (Invoke-Hook 'git commit -m "chore(release): prepare v0.3.2 changelog"') 0
Assert-Case 'fixup! exempt' `
    (Invoke-Hook 'git commit -m "fixup! feat(sync): add verify button"') 0
Assert-Case 'combined -am flag validated' `
    (Invoke-Hook 'git commit -am "bad message here"') 2
Assert-Case 'multiline double-quoted: first line only' `
    (Invoke-Hook ('git commit -m "feat(sync): add button' + "`n`n" + 'long body text"')) 0
$heredoc = @'
git commit -m "$(cat <<'EOF'
fix(auth): close browser exactly once

Body explaining why.
EOF
)"
'@
Assert-Case 'bash heredoc commit valid' (Invoke-Hook $heredoc) 0
$hereString = "git commit -m @'`nfeat(api): add mark_group_read`n`nbody`n'@"
Assert-Case 'pwsh here-string commit valid' (Invoke-Hook $hereString) 0
Assert-Case 'commit without -m allowed (editor/-F path)' `
    (Invoke-Hook 'git commit --amend --no-edit') 0

# --- gh pr create -------------------------------------------------------------
$goodBody = 'gh pr create --title "feat(sync): add verify button" --body "## Why
x
## What
y
## Testing
z
## Changelog
No user-facing change."'
Assert-Case 'pr with all sections + good title' (Invoke-Hook $goodBody) 0
$missingBody = 'gh pr create --title "feat(sync): add verify button" --body "## Why
x
## What
y
## Changelog
n"'
Assert-Case 'pr missing ## Testing blocked' (Invoke-Hook $missingBody) 2 '## Testing'
$badTitle = 'gh pr create --title "My cool change" --body "## Why
x
## What
y
## Testing
z
## Changelog
n"'
Assert-Case 'pr bad title blocked' (Invoke-Hook $badTitle) 2 'title'
$tmpBody = Join-Path $env:TEMP 'saka-docfmt-test-body.md'
Set-Content -Path $tmpBody -Value "## Why`nx`n## What`ny`n## Testing`nz`n## Changelog`nn"
Assert-Case 'pr --body-file with valid file' `
    (Invoke-Hook ('gh pr create --title "fix(sync): hold cursor" --body-file "' + $tmpBody + '"')) 0
Remove-Item $tmpBody -Force

# --- gh release ---------------------------------------------------------------
$goodNotes = 'gh release edit v0.3.2 --notes "SakaDesk 0.3.2 — fixes.
## Highlights
- **X.** y
## Install
z
**Full Changelog:** link"'
Assert-Case 'release notes with markers' (Invoke-Hook $goodNotes) 0
Assert-Case 'release notes missing Highlights blocked' `
    (Invoke-Hook 'gh release edit v0.3.2 --notes "just some text"') 2 'Highlights'
Assert-Case 'release create without notes flags allowed' `
    (Invoke-Hook 'gh release create v0.3.2 --verify-tag --title "SakaDesk 0.3.2"') 0

# --- scoping / fail-open --------------------------------------------------------
Assert-Case 'out-of-scope cwd ignored' `
    (Invoke-Hook 'git commit -m "bad message"' -Cwd 'C:\Other\project') 0
Assert-Case 'in-scope via command path (parent cwd)' `
    (Invoke-Hook 'cd /c/D/repos/pysaka && git commit -m "bad message"' -Cwd 'C:\D\repos') 2
Assert-Case 'SAKA_DOCFMT_SKIP=1 bypasses' `
    (Invoke-Hook 'git commit -m "bad message"' -Skip '1') 0
Assert-Case 'malformed stdin fail-open' (Invoke-Hook -RawPayload 'this is not json') 0
Assert-Case 'non-git command ignored' (Invoke-Hook 'ls -la') 0

Write-Host ''
Write-Host "$script:passed passed, $script:failed failed"
if ($script:failed -gt 0) { exit 1 }
```

- [ ] **Step 2: Run the harness to verify it fails (no hook script yet)**

Run: `pwsh -NoProfile -File C:\Users\xebjhm\.claude\hooks\saka-doc-format.tests.ps1`
Expected: every case FAILs or the run errors (hook script missing) — confirms the harness actually exercises the script.

- [ ] **Step 3: Write the hook script**

Create `C:\Users\xebjhm\.claude\hooks\saka-doc-format.ps1` with exactly this content:

```powershell
# saka-doc-format.ps1 — Claude Code PreToolUse hook (matcher: Bash|PowerShell).
# Validates commit messages, PR bodies, and release notes for the SakaDesk and
# pysaka repos per each repo's docs/DOC_FORMATS.md.
# Fail-open by design: anything unrecognized exits 0. Exit 2 blocks the tool
# call and feeds stderr back to the agent. Escape hatch: SAKA_DOCFMT_SKIP=1.
# Known limitation: in a compound command (a && b), a -m flag anywhere in the
# text is attributed to git commit; rare false blocks are acceptable (the
# stderr explains, and the escape hatch exists).

$ErrorActionPreference = 'Stop'

function Deny([string]$Message) {
    [Console]::Error.WriteLine($Message)
    exit 2
}

# Read stdin BEFORE any early exit so the caller never writes to a closed pipe.
try {
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
} catch { exit 0 }

if ($env:SAKA_DOCFMT_SKIP -eq '1') { exit 0 }

$command = [string]$payload.tool_input.command
if ([string]::IsNullOrWhiteSpace($command)) { exit 0 }
$cwd = [string]$payload.cwd

function Test-InScope([string]$text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return $false }
    $n = ($text -replace '\\', '/').ToLowerInvariant()
    return $n.Contains('d/repos/sakadesk') -or $n.Contains('d/repos/pysaka')
}
if (-not ((Test-InScope $cwd) -or (Test-InScope $command))) { exit 0 }

$conventional = '^(feat|fix|docs|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: .+$'

function Test-ConventionalSubject([string]$subject) {
    if ($subject -cmatch '^(Merge |Revert |fixup!|squash!)') { return $true }
    if ($subject -cnotmatch $conventional) { return $false }
    if ($subject.Length -gt 72) { return $false }
    if ($subject.EndsWith('.')) { return $false }
    return $true
}

function Get-CommitSubject([string]$cmd) {
    $mFlag = '(?:--message|-[a-zA-Z]*m)'
    # PowerShell here-string: -m @'<nl>...<nl>'@ (or @"..."@)
    $m = [regex]::Match($cmd, ('(?s){0}\s+@[''"]\r?\n(.*?)\r?\n[''"]@' -f $mFlag))
    if ($m.Success) { return ($m.Groups[1].Value -split '\r?\n')[0] }
    # bash heredoc: -m "$(cat <<'EOF' ... EOF)"
    $m = [regex]::Match($cmd, ('(?s){0}\s+"\$\(cat\s+<<[''"]?EOF[''"]?\r?\n(.*?)\r?\nEOF' -f $mFlag))
    if ($m.Success) { return ($m.Groups[1].Value -split '\r?\n')[0] }
    # double-quoted: -m "..."
    $m = [regex]::Match($cmd, ('(?s){0}(?:=|\s+)"((?:[^"\\]|\\.)*)"' -f $mFlag))
    if ($m.Success) { return ($m.Groups[1].Value -split '\r?\n|\\n')[0] }
    # single-quoted: -m '...'
    $m = [regex]::Match($cmd, ('(?s){0}(?:=|\s+)''([^'']*)''' -f $mFlag))
    if ($m.Success) { return ($m.Groups[1].Value -split '\r?\n')[0] }
    return $null
}

# --- gh pr create -------------------------------------------------------------
if ($command -match '\bgh\s+pr\s+create\b') {
    $content = $command
    $bf = [regex]::Match($command, '(?:--body-file|-F)(?:=|\s+)"?([^\s"]+)"?')
    if ($bf.Success -and (Test-Path -LiteralPath $bf.Groups[1].Value)) {
        $content = Get-Content -Raw -LiteralPath $bf.Groups[1].Value
    }
    $required = @('## Why', '## What', '## Testing', '## Changelog')
    $missing = @($required | Where-Object { $content -notmatch [regex]::Escape($_) })
    if ($missing.Count -gt 0) {
        Deny ("PR body is missing required section(s): {0}`nFollow docs/DOC_FORMATS.md (Pull requests): sections ## Why, ## What, ## Testing, ## Changelog in that order (## Changelog quotes the [Unreleased] entry or says 'No user-facing change.'). Compose the full body, then re-run gh pr create." -f ($missing -join ', '))
    }
    $t = [regex]::Match($command, '(?s)(?:--title|-t)(?:=|\s+)(?:"([^"]*)"|''([^'']*)'')')
    if ($t.Success) {
        $title = if ($t.Groups[1].Success) { $t.Groups[1].Value } else { $t.Groups[2].Value }
        if (-not (Test-ConventionalSubject $title)) {
            Deny ("PR title '{0}' must follow 'type(scope): subject' (imperative, <=72 chars, no trailing period; release PRs: 'chore(release): vX.Y.Z'). See docs/DOC_FORMATS.md (Pull requests)." -f $title)
        }
    }
    exit 0
}

# --- gh release create|edit ----------------------------------------------------
if ($command -match '\bgh\s+release\s+(create|edit)\b') {
    if ($command -notmatch '(?:^|\s)(--notes|--notes-file|-n|-F)(?:=|\s)') { exit 0 }
    $content = $command
    $nf = [regex]::Match($command, '(?:--notes-file|-F)(?:=|\s+)"?([^\s"]+)"?')
    if ($nf.Success -and (Test-Path -LiteralPath $nf.Groups[1].Value)) {
        $content = Get-Content -Raw -LiteralPath $nf.Groups[1].Value
    }
    $required = @('## Highlights', 'Full Changelog')
    $missing = @($required | Where-Object { $content -notmatch [regex]::Escape($_) })
    if ($missing.Count -gt 0) {
        Deny ("Release notes are missing: {0}`nFollow docs/DOC_FORMATS.md (GitHub release notes): tagline line, ## Highlights, ## Install (SakaDesk only), **Full Changelog:** link. Compose the notes, then re-run gh release." -f ($missing -join ', '))
    }
    exit 0
}

# --- git commit -----------------------------------------------------------------
if ($command -match '\bgit\b[^|;&]*\bcommit\b') {
    $subject = Get-CommitSubject $command
    if ($null -eq $subject) { exit 0 }  # editor / -F file / amend without -m
    if (-not (Test-ConventionalSubject $subject)) {
        Deny (@"
Commit subject does not follow the required format:
  type(scope)!: subject   (imperative, whole line <=72 chars, no trailing period)
Types: feat fix docs refactor perf test build ci chore revert
Your subject: $subject
Example:      feat(sync): add verify & fix media button
See docs/DOC_FORMATS.md (Commit messages). Re-run git commit with a corrected message.
"@)
    }
    exit 0
}

exit 0
```

- [ ] **Step 4: Run the harness to verify all cases pass**

Run: `pwsh -NoProfile -File C:\Users\xebjhm\.claude\hooks\saka-doc-format.tests.ps1`
Expected: `24 passed, 0 failed`, exit 0. If any case fails, fix the hook script (not the test expectations — they encode the spec) and re-run.

---

### Task 4: Register the hook in user settings

**Files:**
- Modify: `C:\Users\xebjhm\.claude\settings.json`

**Interfaces:**
- Consumes: `C:\Users\xebjhm\.claude\hooks\saka-doc-format.ps1` from Task 3.

- [ ] **Step 1: Edit settings.json — append the hooks key (merge, don't clobber)**

The file currently ends with:

```json
  "inputNeededNotifEnabled": true,
  "agentPushNotifEnabled": true
}
```

Use the Edit tool to replace that with:

```json
  "inputNeededNotifEnabled": true,
  "agentPushNotifEnabled": true,
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [
          {
            "type": "command",
            "command": "pwsh -NoProfile -File \"C:\\Users\\xebjhm\\.claude\\hooks\\saka-doc-format.ps1\""
          }
        ]
      }
    ]
  }
}
```

If the file no longer ends exactly like that (it may have changed), read it first and merge a top-level `"hooks"` key with the same content, preserving everything else. If a `"hooks"` key already exists, append the PreToolUse entry to it instead.

- [ ] **Step 2: Validate the JSON parses**

Run: `pwsh -NoProfile -Command "Get-Content 'C:\Users\xebjhm\.claude\settings.json' -Raw | ConvertFrom-Json | Out-Null; 'settings.json OK'"`
Expected: `settings.json OK`.

- [ ] **Step 3: Note the activation caveat**

The hook loads at session start — it will NOT fire in the current session. Verification within this session is the Task 3 harness (which invokes the script exactly as Claude Code will). Record in the final report: "end-to-end check = in the NEXT session, `git commit -m "bad message"` in SakaDesk must be blocked."

---

### Task 5: Update the /release command

**Files:**
- Modify: `C:\Users\xebjhm\.claude\commands\release.md`

**Interfaces:**
- Consumes: the DOC_FORMATS.md files from Tasks 1–2 (references them by path) and the release-PR title convention `chore(release): vX.Y.Z` from Global Constraints.

- [ ] **Step 1: Update Phase 2 step 3 (PR title + body)**

Edit `C:\Users\xebjhm\.claude\commands\release.md`. Replace:

```
3. Create PR to `main`:
   - Title: `Release vX.Y.Z`
   - Body: Summary of changes (from git log since last tag)
```

with:

```
3. Create PR to `main`:
   - Title: `chore(release): vX.Y.Z`
   - Body: follow the repo's `docs/DOC_FORMATS.md` PR format. For a release PR:
     - `## Why` — one line on the release theme (what this version ships)
     - `## What` — the `[Unreleased]` CHANGELOG content being released
     - `## Testing` — the Phase 1 gate results (suites + counts)
     - `## Changelog` — "Entries already under `[Unreleased]` in CHANGELOG.md;
       moved to `[X.Y.Z]` in Phase 3."
```

- [ ] **Step 2: Update Phase 1 step 5 (changelog drafting pointer)**

Replace:

```
5. Check `[Unreleased]` section in CHANGELOG.md:
   - If it has content → use it for the release
   - If empty → draft changelog from `git log` since last tag
```

with:

```
5. Check `[Unreleased]` section in CHANGELOG.md:
   - If it has content → use it for the release
   - If empty → draft changelog from `git log` since last tag
   - Entry style rules: the repo's `docs/DOC_FORMATS.md` § CHANGELOG.md
     (SakaDesk = end-user language; pysaka = API-consumer language)
```

- [ ] **Step 3: Update Phase 3 step 2 (changelog entry style pointer)**

Replace:

```
2. Update CHANGELOG.md:
   - Move `[Unreleased]` content under new `## [X.Y.Z] - YYYY-MM-DD` heading
   - Or write new changelog from commit history if [Unreleased] was empty
   - Keep `## [Unreleased]` heading (empty) at the top
```

with:

```
2. Update CHANGELOG.md:
   - Move `[Unreleased]` content under new `## [X.Y.Z] - YYYY-MM-DD` heading
   - Or write new changelog from commit history if [Unreleased] was empty
     (entry style: repo's `docs/DOC_FORMATS.md` § CHANGELOG.md)
   - Keep `## [Unreleased]` heading (empty) at the top
```

- [ ] **Step 4: Update Phase 4 step 2 (SakaDesk release-notes template)**

Replace:

```
2. FOR SAKADESK ONLY — Update release notes:
   - Wait for CI release job to finish (it creates the release with auto-generated notes)
   - Replace the body with curated summary:

     ## Highlights

     - Most important change
     - Second important change
     - Third important change

     **Full Changelog:** [CHANGELOG.md](https://github.com/xebjhm/SakaDesk/blob/main/CHANGELOG.md#XYZ---YYYY-MM-DD)

   - Remove the auto-generated commit list
   - Do NOT change the title (CI sets it correctly as "SakaDesk X.Y.Z")
   - Command: `gh release edit vX.Y.Z --notes "..."`
```

with:

```
2. FOR SAKADESK ONLY — Update release notes:
   - Wait for CI release job to finish (it creates the release with auto-generated notes)
   - Replace the body with the curated template from the repo's
     `docs/DOC_FORMATS.md` § GitHub release notes — required, in order:

     SakaDesk X.Y.Z — <one-line theme>. Requires pysaka ≥ A.B.C.

     ## Highlights

     - **<User-visible benefit>.** <One sentence of detail.>
       (3–7 bullets, user language, most important first)

     ## Install

     Download `SakaDesk-X.Y.Z-Setup.exe` below. It's unsigned, so Windows
     SmartScreen may prompt — choose **More info → Run anyway**. Verify
     integrity against `checksums-sha256.txt`.

     **Full Changelog:** [CHANGELOG.md](https://github.com/xebjhm/SakaDesk/blob/main/CHANGELOG.md#XYZ---YYYY-MM-DD)

   - Remove the auto-generated commit list
   - Do NOT change the title (CI sets it correctly as "SakaDesk X.Y.Z")
   - Command: write the notes to a temp file, then
     `gh release edit vX.Y.Z --notes-file <file>`
```

- [ ] **Step 5: Verify the edits**

Run: `grep -n "chore(release): vX.Y.Z\|DOC_FORMATS" /c/Users/xebjhm/.claude/commands/release.md`
Expected: the new title convention appears once in Phase 2; `DOC_FORMATS` appears 4 times (Phases 1, 2, 3, 4).

---

### Task 6: Memory entry

**Files:**
- Create: `C:\Users\xebjhm\.claude\projects\C--D-repos\memory\saka-doc-formats.md`
- Modify: `C:\Users\xebjhm\.claude\projects\C--D-repos\memory\MEMORY.md`

- [ ] **Step 1: Write the memory file** with exactly this content:

```markdown
---
name: saka-doc-formats
description: Unified doc formats (commits/PRs/changelog/release notes) for SakaDesk+pysaka — canonical spec in each repo's docs/DOC_FORMATS.md, enforced by a user-level PreToolUse hook.
metadata:
  type: project
---

Since 2026-07-08 both repos have a canonical `docs/DOC_FORMATS.md`
(conventional commits; PR body = ## Why / ## What / ## Testing / ## Changelog;
changelog audience: SakaDesk = end users, pysaka = API consumers; fixed
release-note templates). Each repo's `CLAUDE.md` points to it; PR templates
match it. A user-level PreToolUse hook
(`C:\Users\xebjhm\.claude\hooks\saka-doc-format.ps1`, matcher Bash|PowerShell,
registered in `~/.claude/settings.json`) blocks nonconforming `git commit` /
`gh pr create` / `gh release` calls in these repos; tests:
`saka-doc-format.tests.ps1` next to it; escape hatch `SAKA_DOCFMT_SKIP=1`.
Release PRs are now titled `chore(release): vX.Y.Z` (was `Release vX.Y.Z`) —
`/release` command updated accordingly. Design spec:
SakaDesk `docs/superpowers/specs/2026-07-08-unified-doc-formats-design.md`.
Related: [[saka-branch-topology]], [[sakadesk-dev-layout]].
```

- [ ] **Step 2: Add the index line to MEMORY.md**

Append to `C:\Users\xebjhm\.claude\projects\C--D-repos\memory\MEMORY.md`:

```markdown
- [Saka doc formats](saka-doc-formats.md) — canonical commit/PR/changelog/release-note formats in each repo's docs/DOC_FORMATS.md, enforced by user-level PreToolUse hook; release PRs now titled chore(release): vX.Y.Z.
```

---

### Task 7: Final verification

- [ ] **Step 1: Re-run the full hook harness**

Run: `pwsh -NoProfile -File C:\Users\xebjhm\.claude\hooks\saka-doc-format.tests.ps1`
Expected: `24 passed, 0 failed`.

- [ ] **Step 2: Confirm repo state**

```bash
cd /c/D/repos/SakaDesk && git log --oneline -3 && git status --porcelain
cd /c/D/repos/pysaka && git log --oneline -3 && git status --porcelain
```
Expected: each repo shows its `docs:` commit on `fix/code-review-2026-07-07`; SakaDesk tree clean; pysaka shows only the pre-existing ` M tests/test_manager.py`.

- [ ] **Step 3: Confirm settings + command files**

Run: `pwsh -NoProfile -Command "Get-Content 'C:\Users\xebjhm\.claude\settings.json' -Raw | ConvertFrom-Json | Select-Object -ExpandProperty hooks | ConvertTo-Json -Depth 6"`
Expected: the PreToolUse entry with matcher `Bash|PowerShell` and the hook path.

- [ ] **Step 4: Report**

Report to the user: what was created/changed (per repo + user-level), that the hook activates in the NEXT session, and the manual end-to-end check: in a fresh session inside SakaDesk, `git commit -m "bad message"` must be blocked with the corrective text, and `git commit -m "chore: test hook"` must pass (then undo the test commit if actually made).
