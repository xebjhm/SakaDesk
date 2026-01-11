# Contributing to HakoDesk

Thank you for your interest in contributing to HakoDesk! This document outlines our development workflow, branching strategy, and contribution guidelines.

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

Common scopes for HakoDesk:
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

- **Formatter**: Follow PEP 8 (use `black` if available)
- **Type Hints**: Required for all public functions
- **Type Checker**: `mypy` must pass
- **Tests**: Maintain >50% coverage
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

- [ ] All features for release are merged to `dev`
- [ ] Create `release/vX.Y.Z` branch from `dev`
- [ ] Update version in `pyproject.toml`
- [ ] Update version in `frontend/package.json`
- [ ] Move `[Unreleased]` changelog entries to `[X.Y.Z]`
- [ ] Add release date to changelog
- [ ] Final testing on release branch
- [ ] Merge to `main` with `--no-ff`
- [ ] Tag release: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
- [ ] Push tag: `git push origin vX.Y.Z`
- [ ] Merge back to `dev`
- [ ] Create GitHub Release with changelog excerpt
- [ ] Build and upload release artifacts

---

## Questions?

If you have questions about contributing, please open an issue or reach out to the maintainers.

Thank you for contributing to HakoDesk!
