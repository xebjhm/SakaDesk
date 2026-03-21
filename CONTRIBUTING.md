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
- [ ] SakaDesk: Check GitHub Releases page — installer exe attached
- [ ] Download and smoke-test the installer

#### CI/CD Behavior

| Trigger | What happens |
|---------|-------------|
| Push to `main`/`dev` | Build + test (artifact only, no release) |
| Push tag `v*.*.*` | Build + test + create GitHub Release with installer |
| Pull request | Build + test |

### Lessons Learned (v0.2.0)

These are common pitfalls to avoid:

1. **Run tests locally before pushing** — CI failures cause noisy fix-push cycles
2. **Use `TZ=UTC` for frontend tests** — snapshots with timestamps break across timezones
3. **Mock `AudioContext`** — jsdom doesn't provide Web Audio API
4. **Mock `useAppStore.getState()`** — if hooks call `getState()` directly, tests need it
5. **`uv add --dev` in CI is fragile** — use `uv pip install` for build-only tools
6. **E2E tests need Python/uv** — they must run after Python setup, not after Node setup
7. **Windows PowerShell env syntax** — `VAR=value cmd` doesn't work, use Playwright's `env` option
8. **pysaka must be on PyPI first** — SakaDesk CI pulls from PyPI, not local path

---

## Questions?

If you have questions about contributing, please open an issue or reach out to the maintainers.

Thank you for contributing to SakaDesk!
