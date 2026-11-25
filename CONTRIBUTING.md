# Contributing to SakaDesk

Thank you for your interest in contributing to SakaDesk! This document outlines our development workflow, branching strategy, and contribution guidelines.

## Table of Contents

- [Git Flow Strategy](#git-flow-strategy)
- [Branch Naming Conventions](#branch-naming-conventions)
- [Development Workflow](#development-workflow)
- [The Changelog Rule](#the-changelog-rule)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Code Quality Standards](#code-quality-standards)
- [Release Process](#release-process)

---

## Git Flow Strategy

We follow a modified Git Flow branching model with `dev` as our integration branch.

```
main ─────●─────────────────────●─────────────────●──────► Production
           \                   /                 /
            \    release/v1.0 /                 /
             \       ●───────●                 /
              \     /         \               /
dev ───────────●───●───●───●───●───●───●───●───●──────► Integration
                \     /   \     /       \   /
                 feat/a    feat/b        hotfix/x
```

### Branch Types

| Branch | Purpose | Branch From | Merge To |
|--------|---------|-------------|----------|
| `main` | Production-ready code. Strictly versioned. Tagged releases only. | - | - |
| `dev` | Main integration branch for ongoing development. | `main` (initial) | - |
| `feat/<name>` | New features and enhancements | `dev` | `dev` via PR |
| `fix/<name>` | Bug fixes (non-urgent) | `dev` | `dev` via PR |
| `release/vX.Y.Z` | Release preparation and stabilization | `dev` | `main` AND `dev` |
| `hotfix/<name>` | Urgent production fixes | `main` | `main` AND `dev` |

### Branch Protection Rules

- **`main`**: Protected. Requires PR, passing CI, and maintainer approval.
- **`dev`**: Protected. Requires PR and passing CI.
- Direct pushes to `main` and `dev` are prohibited.

---

## Branch Naming Conventions

Use lowercase with hyphens. Be descriptive but concise.

```
feat/multi-service-support
feat/voice-transcription
fix/unread-indicator
fix/token-refresh-timing
release/v1.2.0
hotfix/session-expired-crash
```

**Prefixes:**
- `feat/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring (no behavior change)
- `docs/` - Documentation only
- `test/` - Test additions or fixes
- `build/` - Build system or CI changes
- `release/` - Release preparation
- `hotfix/` - Urgent production fixes

---

## Development Workflow

### Starting a New Feature

```bash
# 1. Ensure dev is up to date
git checkout dev
git pull origin dev

# 2. Create feature branch
git checkout -b feat/your-feature-name

# 3. Make changes, commit frequently
git add .
git commit -m "feat: add initial implementation"

# 4. Push branch and create PR
git push -u origin feat/your-feature-name
# Then create PR via GitHub UI or CLI
```

### Creating a Release

```bash
# 1. Create release branch from dev
git checkout dev
git pull origin dev
git checkout -b release/v1.2.0

# 2. Update version numbers and changelog
# - Update version in pyproject.toml
# - Move [Unreleased] items to [1.2.0] section in CHANGELOG.md
# - Add release date

# 3. Final testing and fixes on release branch

# 4. Merge to main
git checkout main
git merge --no-ff release/v1.2.0
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin main --tags

# 5. Merge back to dev
git checkout dev
git merge --no-ff release/v1.2.0
git push origin dev

# 6. Delete release branch
git branch -d release/v1.2.0
git push origin --delete release/v1.2.0
```

### Hotfix Process

```bash
# 1. Create hotfix branch from main
git checkout main
git pull origin main
git checkout -b hotfix/critical-bug-fix

# 2. Fix the issue, update changelog

# 3. Merge to main
git checkout main
git merge --no-ff hotfix/critical-bug-fix
git tag -a v1.2.1 -m "Hotfix v1.2.1"
git push origin main --tags

# 4. Merge to dev
git checkout dev
git merge --no-ff hotfix/critical-bug-fix
git push origin dev

# 5. Delete hotfix branch
git branch -d hotfix/critical-bug-fix
```

---

## The Changelog Rule

> **Every Pull Request MUST update the `[Unreleased]` section of `CHANGELOG.md`.**

This is non-negotiable. The changelog is our historical record and release notes source.

### How to Update the Changelog

1. Open `CHANGELOG.md`
2. Find the `## [Unreleased]` section
3. Add your change under the appropriate category:

```markdown
## [Unreleased]

### Added
- New feature description (#PR-number)

### Changed
- Modified behavior description (#PR-number)

### Fixed
- Bug fix description (#PR-number)

### Deprecated
- Feature being phased out (#PR-number)

### Removed
- Removed feature description (#PR-number)

### Security
- Security fix description (#PR-number)
```

### What Makes a Good Changelog Entry

**Good:**
```markdown
- Add multi-service support for Nogizaka and Sakurazaka (#42)
- Fix session expiration not redirecting to login page (#38)
```

**Bad:**
```markdown
- Fixed stuff
- Updated code
- PR #42
```

---

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Code style (formatting, semicolons, etc.) |
| `refactor` | Code refactoring (no behavior change) |
| `test` | Adding or updating tests |
| `build` | Build system or dependencies |
| `ci` | CI/CD configuration |
| `chore` | Maintenance tasks |
| `perf` | Performance improvements |

### Scope (Optional)

Common scopes for SakaDesk:
- `backend` - Python backend
- `frontend` - React frontend
- `auth` - Authentication
- `sync` - Sync functionality
- `ui` - User interface
- `api` - API endpoints

### Examples

```bash
feat(backend): add TEST_MODE for E2E testing
fix(auth): handle session expiration gracefully
docs: update ROADMAP with transcription feature
refactor(frontend): extract ChatList component
test(api): add comprehensive progress endpoint tests
build: add mypy type checking to CI pipeline
```

### Multi-line Commits

For complex changes:

```bash
git commit -m "feat(sync): add randomized sync intervals

Implement adaptive sync frequency based on member activity patterns.
This helps avoid detection by varying the sync timing.

- Add activity-based multiplier
- Add time-of-day adjustment
- Add random jitter (±20%)

Closes #45"
```

---

## Pull Request Process

### Before Creating a PR

1. **Update your branch** with latest `dev`:
   ```bash
   git checkout dev
   git pull origin dev
   git checkout your-branch
   git rebase dev
   ```

2. **Run all tests**:
   ```bash
   # Backend
   uv run pytest -v
   uv run mypy backend/

   # Frontend
   cd frontend && npm test
   ```

3. **Update CHANGELOG.md** under `[Unreleased]`

### PR Requirements

- [ ] Branch is up to date with `dev`
- [ ] All tests pass
- [ ] CHANGELOG.md is updated
- [ ] Code follows project style guidelines
- [ ] New code has appropriate test coverage
- [ ] Documentation is updated if needed

### PR Review Process

1. Create PR with descriptive title and body
2. Fill out the PR template completely
3. Request review from maintainers
4. Address review feedback
5. Squash and merge when approved

---

## Code Quality Standards

### Python (Backend)

- **Formatter/Linter**: `ruff` (format and check)
- **Type Hints**: Required for all public functions
- **Type Checker**: `mypy` must pass
- **Tests**: Maintain coverage (20% enforced in CI, 50% target)
- **Docstrings**: Required for public modules, classes, and functions

### TypeScript (Frontend)

- **Formatter**: Prettier
- **Linter**: ESLint
- **Tests**: Vitest + React Testing Library
- **Types**: Strict TypeScript, no `any` without justification

### General

- No secrets or credentials in code
- No commented-out code in PRs
- Keep functions focused and small
- Prefer composition over inheritance
- Write self-documenting code, add comments for "why" not "what"

---

## Release Process

### Version Numbering

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (X.0.0): Breaking changes
- **MINOR** (0.X.0): New features, backward compatible
- **PATCH** (0.0.X): Bug fixes, backward compatible

### Release Checklist

> **Rule: Nothing gets pushed until all tests pass locally. No exceptions.**

#### Phase 1: Pre-Release Verification (on `dev`)

Before creating the release branch, verify everything works:

```bash
# Backend tests
uv run pytest -v --tb=short --ignore=tests/test_startup.py

# Frontend tests (use UTC for deterministic snapshots)
cd frontend && TZ=UTC npx vitest run

# TypeScript check
cd frontend && npx tsc --noEmit
```

All tests must pass. Fix any failures before proceeding.

#### Phase 2: Version Bump (on `release/vX.Y.Z`)

```bash
git checkout dev && git pull origin dev
git checkout -b release/vX.Y.Z
```

Update version in **2 locations**:

| File | Field |
|------|-------|
| `pyproject.toml` | `version = "X.Y.Z"` |
| `pyproject.toml` | `pysaka>=X.Y.Z` (dependency — must match published pysaka) |
| `frontend/package.json` | `"version": "X.Y.Z"` |

> **Note:** Backend `APP_VERSION` is read automatically from `pyproject.toml` via `backend/version.py`. The About modal fetches it from `/api/version/current` at runtime. No other files need manual version updates.

Update `CHANGELOG.md`:
- Move `[Unreleased]` entries to `[X.Y.Z] - YYYY-MM-DD`
- Add comparison link: `[X.Y.Z]: https://github.com/...`
- Update `[Unreleased]` link to compare from new tag

Commit: `chore(release): bump version to X.Y.Z`

#### Phase 3: Final Test Run (on `release/vX.Y.Z`)

Run the **full** test suite again after version bump:

```bash
# Backend
uv run pytest -v --tb=short --ignore=tests/test_startup.py

# Frontend (UTC for CI parity)
cd frontend && TZ=UTC npx vitest run

# TypeScript
cd frontend && npx tsc --noEmit
```

#### Phase 4: Release Order (pysaka first, then SakaDesk)

**Important**: pysaka must be published to PyPI before SakaDesk CI runs,
because SakaDesk CI installs pysaka from PyPI (`uv sync --no-sources`).

```bash
# 1. pysaka: merge, tag, push
cd pysaka
git checkout main && git merge --no-ff release/vX.Y.Z -m "Release vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin main --tags   # CI publishes to PyPI
git checkout dev && git merge --no-ff release/vX.Y.Z -m "Merge release back into dev"
git push origin dev

# 2. Verify pysaka is on PyPI (wait ~60s)
uv pip install pysaka==X.Y.Z --dry-run

# 3. SakaDesk: merge, tag, push
cd SakaDesk
git checkout main && git merge --no-ff release/vX.Y.Z -m "Release vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin main --tags   # CI builds installer + creates GitHub Release
git checkout dev && git merge --no-ff release/vX.Y.Z -m "Merge release back into dev"
git push origin dev
```

#### Phase 5: Verify

- [ ] pysaka: Check PyPI page shows new version
- [ ] SakaDesk: Check GitHub Actions — build should be green
- [ ] SakaDesk: Check GitHub Releases page — `SakaDesk-X.Y.Z-Setup.exe`, `SakaDesk-X.Y.Z-manifest.json` and `checksums-sha256.txt` attached (see [Release signing](#release-signing))
- [ ] Download and smoke-test the installer

#### CI/CD Behavior

| Trigger | What happens |
|---------|-------------|
| Push to `main` | Lint + tests, plus the Windows installer build (artifact only, no release) |
| Push to `dev` | Lint + tests only (no Windows build, no release) |
| Push tag `v*.*.*` | Lint + tests + Windows build, then `sign` (environment `release`) signs the update manifest, `verify-manifest` checks it with no secrets, and `release` publishes the installer, the manifest and checksums |
| Manual run (`gh workflow run build.yml --ref <branch>`) | Lint + tests + Windows installer build (artifact only). `sign`, `verify-manifest` and `release` never run, even on a tag ref |
| Pull request | Lint + tests only (no Windows build) |

### Release signing

Every release carries `SakaDesk-X.Y.Z-manifest.json`: the installer's name,
size and SHA-256, signed with the SakaDesk release key (Ed25519). The in-app
updater installs a release only when that signature checks out against a
public key built into the app (`backend/services/release_keys.py`), and it
hashes the installer again right before starting it. Format and checks:
`backend/services/release_signing.py`.

**Where the key lives.** The private key is the secret
`SAKADESK_RELEASE_SIGNING_KEY` of the `release` GitHub environment, which only
`v*.*.*` tags may use, plus one offline backup kept by the maintainer. It is
never committed, pasted into an issue or a chat, or printed by any script.
The key is only as safe as the right to push `v*` tags: anyone who can push
such a tag together with a modified workflow can make the `release`
environment hand them the secret. Only admins may push `v*` tags (the tag
ruleset).

**What CI does on a tag.** The lint and test jobs that `build` needs run the
tests; `build` then installs the locked build tools (the `build` dependency
group), builds the installer, runs the built app's updater self-check
(`SakaDesk.exe --self-check-updater`: a known Ed25519 test vector must
verify, or the build fails), and reports the installer's SHA-256 and the
version as job outputs. Later jobs download artifacts by their exact names
and attest exactly two files, with no globs.

- `sign` (environment `release`, read-only token) checks that the tag commit is
  on `main`, checks the downloaded installer matches the hash `build`
  reported, and signs the manifest with the runner's own `python3` (standard
  library) and OpenSSL. Nothing is installed in the `sign` job, because any
  step in a job can read all of that job's secrets. It reports the manifest's
  SHA-256.
- `verify-manifest` (no environment, no secrets, read-only token) first checks
  the downloaded installer and manifest against the hashes `build` and `sign`
  reported, then runs the app's own checker against the keys of the release being built **and** of the
  previous release.
- `release` checks the installer and the manifest against the hashes `build`
  and `sign` reported, attests both, attaches them and `checksums-sha256.txt`
  to a draft, then publishes it (immutable releases need the draft step).

The previous-release check is skipped only when the previous `v*.*.*` tag is
below 0.5.0 (the first signed release). A missing previous tag, or a missing
`backend/services/release_keys.py` at a tag from 0.5.0 on, fails the release.
So if a tag from 0.5.0 on was pushed but its release failed, and that tag's
trusted keys are wrong or missing, delete the tag (locally and on GitHub)
before tagging again; otherwise the next release's check runs against it.

If the `release` job fails after creating the draft, the draft stays: delete
it (keeping the tag) with
`gh release delete vX.Y.Z --repo xebjhm/SakaDesk --yes` before re-running the
job.

**Check a release by hand:**

```bash
D="$(mktemp -d)"
gh release download vX.Y.Z --repo xebjhm/SakaDesk --pattern 'SakaDesk-*' --dir "$D"
uv run python -m backend.services.release_signing \
  --manifest "$D/SakaDesk-X.Y.Z-manifest.json" \
  --installer "$D/SakaDesk-X.Y.Z-Setup.exe" --version X.Y.Z
gh attestation verify "$D/SakaDesk-X.Y.Z-Setup.exe" --repo xebjhm/SakaDesk
```

The checker prints `manifest OK: ...` and exits 0, or prints `ERROR: <code>`
and exits 1. Add `--keys-file <release_keys.py>` to check against another
version's trusted keys.

**First-time setup (done once, before the first 0.5.0 tag).**
`uv run python scripts/generate_release_key.py --out ~/sakadesk-release-key.pem`,
add the printed line to `TRUSTED_RELEASE_KEYS`, create the `release`
environment with its `v*.*.*` tag policy **first** (a workflow job that names
an environment that does not exist creates it without any protection rules),
then
`gh secret set SAKADESK_RELEASE_SIGNING_KEY --env release --repo xebjhm/SakaDesk < ~/sakadesk-release-key.pem`,
back the file up offline and `shred -u` it.

**Users on older versions.** Versions up to 0.4.2 do not check signatures and
install the first signed release (0.5.0) the old way. From then on only signed
releases install in-app. If a release ever lacks a valid manifest, the app says
the update could not be verified and keeps the current version; people can
still install it by hand.

**Rotating the key (planned).**

1. Generate the new key with the script (a new `--out` file). Add its line to
   `TRUSTED_RELEASE_KEYS` next to the current one (at most two), store it as
   `SAKADESK_RELEASE_SIGNING_KEY_NEXT` in the `release` environment, back the
   file up offline, then `shred -u` it.
2. Release as usual for a few versions (a few months): every manifest is signed
   by both keys, and installed apps learn the new public key.
3. Make the new key current, in one release: before tagging it, read the
   offline backup from step 1 back and run
   `gh secret set SAKADESK_RELEASE_SIGNING_KEY --env release --repo xebjhm/SakaDesk < new-key.pem` and
   `gh secret delete SAKADESK_RELEASE_SIGNING_KEY_NEXT --env release --repo xebjhm/SakaDesk`,
   and in that same release remove the old line from `TRUSTED_RELEASE_KEYS`.
   That release's manifest is signed by the new key only; `verify-manifest`
   accepts it because the previous release (from step 1 or 2) already trusts
   the new key. The check refuses a release the previous release could not
   verify, so a step taken too early fails the release instead of stranding
   users. People who skipped every release since step 1 must install by hand.

**If the key leaks.**

1. Generate a new key with the script, store it as
   `SAKADESK_RELEASE_SIGNING_KEY_NEXT`, back the file up offline, then
   `shred -u` it. Leave the leaked key as `SAKADESK_RELEASE_SIGNING_KEY` for
   now.
2. Make `TRUSTED_RELEASE_KEYS` hold only the new key (drop the leaked line)
   and tag a recovery release. It is signed by the leaked key (as current) and
   the new key (as `_NEXT`): the previous release still trusts only the leaked
   key, so the previous-release check passes, while the app in this release
   trusts only the new key.
3. Once that release is published, do rotation step 3's two commands: set the
   new key as `SAKADESK_RELEASE_SIGNING_KEY` and delete
   `SAKADESK_RELEASE_SIGNING_KEY_NEXT`. Later releases are signed by the new
   key only.

Apps older than the recovery release still trust the leaked key until they
update: say so in the release notes.

**If the key is lost (no backup).** Installed apps can never verify another
update. Set up a new key (first-time setup), trust and sign with it only, and
for that one release run
`gh variable set SAKADESK_ALLOW_KEY_RESET --body yes --repo xebjhm/SakaDesk`
so `verify-manifest` skips the previous-release check; delete it right after with
`gh variable delete SAKADESK_ALLOW_KEY_RESET --repo xebjhm/SakaDesk`. Everyone
must install that release by hand: say so in the release notes.

### Lessons Learned (v0.2.0)

These are common pitfalls to avoid:

1. **Run tests locally before pushing** — CI failures cause noisy fix-push cycles
2. **Use `TZ=UTC` for frontend tests** — snapshots with timestamps break across timezones
3. **Mock `AudioContext`** — jsdom doesn't provide Web Audio API
4. **Mock `useAppStore.getState()`** — if hooks call `getState()` directly, tests need it
5. **Build-only tools are a locked group** — PyInstaller and pywebview live in the `build` dependency group (`uv.lock`); CI installs them with `uv sync --no-sources --group build`, a plain `uv sync` / `uv run` does not
6. **E2E tests need Python/uv** — they must run after Python setup, not after Node setup
7. **Windows PowerShell env syntax** — `VAR=value cmd` doesn't work, use Playwright's `env` option
8. **pysaka must be on PyPI first** — SakaDesk CI pulls from PyPI, not local path

---

## Questions?

If you have questions about contributing, please open an issue or reach out to the maintainers.

Thank you for contributing to SakaDesk!
