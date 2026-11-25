"""Pin GitHub Actions and pre-commit hooks to full commit SHAs (hardening #1, #9).

    uv run python tooling/ci/pin_actions.py           # rewrite the files in place
    uv run python tooling/ci/pin_actions.py --check   # exit 1 when anything is unpinned

``uses: owner/repo@ref`` in ``.github/workflows/*.yml`` becomes
``uses: owner/repo@<sha> # <tag>``, where ``<tag>`` is the most specific
``vX.Y.Z`` tag on the same commit (else ``ref`` itself), so the pin runs
exactly what the moving tag runs today. A pre-commit ``rev: <ref>`` becomes
``rev: <sha>  # frozen: <ref>``, the form ``pre-commit autoupdate --freeze``
writes, without changing the version. Lines already pinned to a 40-hex SHA,
local actions (``./``) and ``docker://`` images are left alone. Tags are
resolved with ``git ls-remote`` (public, read-only, no credentials).
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
PRE_COMMIT = ROOT / ".pre-commit-config.yaml"

SHA = re.compile(r"[0-9a-f]{40}")
SEMVER_TAG = re.compile(r"v?\d+\.\d+\.\d+")
USES = re.compile(
    r"^(?P<lead>\s*(?:-\s*)?uses:\s*)"
    r"(?P<action>[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9_.-]+)"
    r"(?P<sub>/[^@\s]*)?@(?P<ref>[^\s#]+)(?P<rest>.*)$"
)
REPO = re.compile(r"^\s*-\s*repo:\s*(?P<url>\S+)")
REV = re.compile(r"^(?P<lead>\s*rev:\s*)(?P<ref>[^\s#]+)(?P<rest>.*)$")

Resolver = Callable[[str, str], tuple[str, str]]


def parse_ls_remote(text: str) -> dict[str, str]:
    """{tag: commit sha} from ``git ls-remote --tags`` output; peeled ``^{}`` lines win."""
    tags: dict[str, str] = {}
    peeled: dict[str, str] = {}
    for line in text.splitlines():
        sha, _, ref = line.partition("\t")
        if not ref.startswith("refs/tags/") or not SHA.fullmatch(sha):
            continue
        name = ref[len("refs/tags/") :]
        if name.endswith("^{}"):
            peeled[name[:-3]] = sha
        else:
            tags[name] = sha
    tags.update(peeled)
    return tags


def _semver_key(tag: str) -> tuple[int, ...]:
    return tuple(int(part) for part in tag.lstrip("v").split("."))


def pick(tags: dict[str, str], ref: str) -> tuple[str, str]:
    """(commit sha, comment tag) for ``ref``. Raises KeyError for an unknown ref."""
    sha = tags[ref]
    same = [t for t, s in tags.items() if s == sha and SEMVER_TAG.fullmatch(t)]
    return sha, (max(same, key=_semver_key) if same else ref)


def git_resolver() -> Resolver:
    """A resolver that asks ``git ls-remote`` once per repository."""
    cache: dict[str, dict[str, str]] = {}

    def resolve(repo_url: str, ref: str) -> tuple[str, str]:
        if repo_url not in cache:
            done = subprocess.run(
                ["git", "ls-remote", "--tags", repo_url],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=60,
                check=True,
            )
            cache[repo_url] = parse_ls_remote(done.stdout)
        return pick(cache[repo_url], ref)

    return resolve


def _lines(text: str):
    for line in text.splitlines(keepends=True):
        body = line.rstrip("\r\n")
        yield body, line[len(body) :]


def pin_workflow(text: str, resolve: Resolver | None) -> tuple[str, list[str]]:
    """(``text`` with every ``uses:`` pinned, the refs found unpinned). No resolver: report only."""
    out: list[str] = []
    unpinned: list[str] = []
    for body, ending in _lines(text):
        match = USES.match(body)
        if match and not SHA.fullmatch(match["ref"]):
            unpinned.append(f"{match['action']}@{match['ref']}")
            if resolve is not None:
                sha, tag = resolve(
                    f"https://github.com/{match['action']}", match["ref"]
                )
                body = f"{match['lead']}{match['action']}{match['sub'] or ''}@{sha} # {tag}"
        out.append(body + ending)
    return "".join(out), unpinned


def pin_pre_commit(text: str, resolve: Resolver | None) -> tuple[str, list[str]]:
    """(``text`` with every remote hook ``rev:`` frozen, the revs found unpinned)."""
    out: list[str] = []
    unpinned: list[str] = []
    repo_url: str | None = None
    for body, ending in _lines(text):
        repo = REPO.match(body)
        if repo:
            repo_url = repo["url"]
        rev = REV.match(body)
        if (
            rev
            and repo_url not in (None, "local", "meta")
            and not SHA.fullmatch(rev["ref"])
        ):
            unpinned.append(f"{repo_url}@{rev['ref']}")
            if resolve is not None:
                sha, _tag = resolve(str(repo_url), rev["ref"])
                body = f"{rev['lead']}{sha}  # frozen: {rev['ref']}"
        out.append(body + ending)
    return "".join(out), unpinned


def main(
    argv: Sequence[str] | None = None,
    resolve_factory: Callable[[], Resolver] = git_resolver,
) -> int:
    parser = argparse.ArgumentParser(
        description="Pin actions and pre-commit hooks to SHAs."
    )
    parser.add_argument(
        "--check", action="store_true", help="report only; exit 1 if unpinned"
    )
    args = parser.parse_args(argv)
    resolve = None if args.check else resolve_factory()
    found: list[str] = []
    targets = [(p, pin_workflow) for p in sorted(WORKFLOWS.glob("*.yml"))]
    targets.append((PRE_COMMIT, pin_pre_commit))
    for path, pin in targets:
        text = path.read_text(encoding="utf-8")
        new, unpinned = pin(text, resolve)
        found += [f"{path.relative_to(ROOT).as_posix()}: {item}" for item in unpinned]
        if resolve is not None and new != text:
            path.write_text(new, encoding="utf-8")
    if args.check and found:
        for item in found:
            sys.stderr.write(f"UNPINNED: {item}\n")
        return 1
    sys.stdout.write(
        f"{'checked' if args.check else 'pinned'}: {len(found)} unpinned reference(s)\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
