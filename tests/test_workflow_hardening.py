"""Release pipeline guards (security audit 2026-11-13: N6, hardening #1-6, #9; Plan E)."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"
WORKFLOW = WORKFLOWS / "build.yml"


def _workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _steps(job: str) -> list[dict]:
    return _workflow()["jobs"][job]["steps"]


def _names(job: str) -> list[str]:
    return [step.get("name", "") for step in _steps(job)]


def _run_text(job: str) -> str:
    return "\n".join(step.get("run", "") for step in _steps(job))


PUSH_TAG_ONLY = "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')"


def test_only_the_sign_job_can_read_the_signing_key():
    jobs = _workflow()["jobs"]
    sign = jobs["sign"]
    assert sign["environment"] == "release"
    assert sign["permissions"] == {"contents": "read"}
    assert sign["needs"] == ["build"]
    assert sign["if"] == PUSH_TAG_ONLY
    assert "env" not in sign
    for name, job in jobs.items():
        if name != "sign":
            assert "secrets." not in yaml.safe_dump(job), name
            assert "environment" not in job, name
    (step,) = [s for s in sign["steps"] if s.get("name") == "Sign the update manifest"]
    assert set(step["env"]) == {
        "SAKADESK_RELEASE_SIGNING_KEY",
        "SAKADESK_RELEASE_SIGNING_KEY_NEXT",
    }
    assert "python3 -I tooling/release/sign_manifest.py" in step["run"]
    for other in sign["steps"]:
        if other is not step:
            assert "secrets." not in yaml.safe_dump(other)


SIGN_ALLOWED_ACTIONS = (
    "actions/checkout",
    "actions/download-artifact",
    "actions/upload-artifact",
)
FORBIDDEN_COMMAND = re.compile(
    r"(^|[\s;&|(])(uv|uvx|pip|pip3|pipx|curl|wget|npm|npx|apt-get|apt|ensurepip|brew|choco)"
    r"(\s|$)|python3?\s+-m\s+(pip|ensurepip)\b|--with\b"
)


def test_the_sign_job_installs_nothing():
    for step in _steps("sign"):
        uses = step.get("uses")
        if uses is not None:
            assert uses.startswith(SIGN_ALLOWED_ACTIONS), uses
        assert not FORBIDDEN_COMMAND.search(step.get("run", "")), step.get("name")
    assert FORBIDDEN_COMMAND.search("uv run x")
    assert FORBIDDEN_COMMAND.search("python3 -m pip install x")
    assert FORBIDDEN_COMMAND.search("uvx ruff check")
    assert FORBIDDEN_COMMAND.search("pipx run x")
    for command in (
        "curl -O x",
        "wget x",
        "npm ci",
        "npx y",
        "apt-get update",
        "apt x",
    ):
        assert FORBIDDEN_COMMAND.search(command), command
    assert FORBIDDEN_COMMAND.search("python3 -m ensurepip")
    assert FORBIDDEN_COMMAND.search("x && brew install y")
    assert FORBIDDEN_COMMAND.search("choco install z")
    assert not FORBIDDEN_COMMAND.search("set -euo pipefail")
    assert not FORBIDDEN_COMMAND.search("echo applying")
    (signing,) = [
        s for s in _steps("sign") if s.get("name") == "Sign the update manifest"
    ]
    assert "python3 -I tooling/release/sign_manifest.py" in signing["run"]


def _index(job: str, needle: str) -> int:
    (index,) = [
        i
        for i, step in enumerate(_steps(job))
        if needle in "".join(str(v) for v in step.get("env", {}).values())
    ]
    return index


def test_files_are_bound_to_the_hashes_the_trusted_jobs_produced():
    jobs = _workflow()["jobs"]
    assert "installer_sha256" in jobs["build"]["outputs"]
    assert "manifest_sha256" in jobs["sign"]["outputs"]
    build_hash = "needs.build.outputs.installer_sha256"
    assert _index("sign", build_hash) < _names("sign").index("Sign the update manifest")
    attest = _names("release").index("Attest Build Provenance")
    assert _index("release", build_hash) < attest
    assert _index("release", "needs.sign.outputs.manifest_sha256") < attest
    for job in ("sign", "release"):
        for step in _steps(job):
            assert "needs." not in step.get("run", "")
    # The build job's hash step precedes the upload and writes the output.
    names = _names("build")
    (hash_step,) = [s for s in _steps("build") if s.get("id") == "installer_hash"]
    assert names.index(hash_step["name"]) < names.index("Upload Build Artifact")
    assert "Get-FileHash -Algorithm SHA256" in hash_step["run"]
    assert "installer_sha256=" in hash_step["run"]


def test_the_verifier_dependencies_are_pinned():
    runs = [
        s["run"]
        for s in _steps("verify-manifest")
        if "release_signing" in s.get("run", "")
    ]
    assert len(runs) == 2
    for run in runs:
        for pin in ("cryptography==46.0.3", "cffi==2.0.0", "pycparser==2.23"):
            assert f'--with "{pin}"' in run


def test_the_tag_must_be_on_main_before_signing():
    names = _names("sign")
    assert names.index("Verify the tag commit is on main") < names.index(
        "Sign the update manifest"
    )
    assert "git merge-base --is-ancestor" in _run_text("sign")
    assert _steps("sign")[0]["with"]["fetch-depth"] == 0


def _previous_keys_step() -> dict:
    (step,) = [
        s
        for s in _steps("verify-manifest")
        if s.get("name") == "Verify the manifest with the previous release's keys"
    ]
    return step


def test_the_manifest_is_verified_outside_the_signing_job():
    job = _workflow()["jobs"]["verify-manifest"]
    assert "environment" not in job
    assert job["permissions"] == {"contents": "read"}
    assert job["needs"] == ["build", "sign"]
    assert job["if"] == PUSH_TAG_ONLY
    assert _steps("verify-manifest")[0]["with"]["fetch-depth"] == 0
    run = _run_text("verify-manifest")
    assert run.count("python -m backend.services.release_signing") == 2
    assert "--keys-file" in run
    assert "release_signing" not in _run_text("sign")
    previous = _previous_keys_step()
    assert previous["if"] == "vars.SAKADESK_ALLOW_KEY_RESET != 'yes'"
    assert previous["env"]["FIRST_SIGNED_VERSION"] == "0.5.0"
    assert "|| true" not in previous["run"]
    assert "2>/dev/null" not in previous["run"]


def _git(repo: Path, *args: str) -> None:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.invalid",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.invalid",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_SYSTEM": os.devnull,
    }
    subprocess.run(["git", *args], cwd=repo, env=env, check=True, capture_output=True)


def _run_previous_check(tmp_path: Path, previous_tag: str | None, keys: bool):
    """Run the previous-keys step script in a throwaway repo; return (proc, uv calls)."""
    if shutil.which("bash") is None or shutil.which("git") is None:
        pytest.skip("bash and git are required")
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    (repo / "backend" / "services").mkdir(parents=True)
    if keys:
        (repo / "backend" / "services" / "release_keys.py").write_text(
            "KEYS = {}\n", encoding="utf-8"
        )
    (repo / "README").write_text("one\n", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "previous")
    if previous_tag:
        _git(repo, "tag", previous_tag)
    (repo / "README").write_text("two\n", encoding="utf-8")
    _git(repo, "commit", "-q", "-am", "release")
    sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    calls = tmp_path / "uv-calls.txt"
    fake = bin_dir / "uv"
    fake.write_text(f'#!/bin/sh\necho "$@" >> "{calls}"\n', encoding="utf-8")
    fake.chmod(0o755)
    runner_temp = tmp_path / "runner"
    runner_temp.mkdir()

    env = {
        **os.environ,
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "GITHUB_SHA": sha,
        "GITHUB_REF_NAME": "v0.5.1",
        "RUNNER_TEMP": str(runner_temp),
        "FIRST_SIGNED_VERSION": _previous_keys_step()["env"]["FIRST_SIGNED_VERSION"],
    }
    script = tmp_path / "step.sh"
    script.write_text(_previous_keys_step()["run"], encoding="utf-8")
    proc = subprocess.run(
        ["bash", str(script)], cwd=repo, env=env, capture_output=True, text=True
    )
    called = calls.read_text(encoding="utf-8") if calls.exists() else ""
    return proc, called


def test_previous_keys_check_skips_only_below_the_first_signed_release(tmp_path):
    proc, called = _run_previous_check(tmp_path, "v0.4.2", keys=False)
    assert proc.returncode == 0, proc.stderr
    assert "::notice::" in proc.stdout
    assert called == ""


def test_previous_keys_check_verifies_at_the_first_signed_release(tmp_path):
    proc, called = _run_previous_check(tmp_path, "v0.5.0", keys=True)
    assert proc.returncode == 0, proc.stderr
    assert "--keys-file" in called
    assert "previous_release_keys.py" in called


def test_previous_keys_check_fails_when_the_keys_file_is_missing(tmp_path):
    proc, called = _run_previous_check(tmp_path, "v0.5.0", keys=False)
    assert proc.returncode != 0
    assert "::error::" in proc.stdout
    assert called == ""


def test_previous_keys_check_fails_without_a_previous_tag(tmp_path):
    proc, called = _run_previous_check(tmp_path, None, keys=True)
    assert proc.returncode != 0
    assert "::error::" in proc.stdout
    assert called == ""


def test_release_waits_for_verification_and_publishes_a_complete_draft():
    release = _workflow()["jobs"]["release"]
    assert release["needs"] == ["build", "sign", "verify-manifest"]
    assert release["if"] == PUSH_TAG_ONLY
    run = _run_text("release")
    assert "--draft" in run and "--verify-tag" in run and "--draft=false" in run
    assert "SakaDesk-${TAG_VERSION}-manifest.json" in run
    (attest,) = [
        s for s in _steps("release") if s.get("name") == "Attest Build Provenance"
    ]
    version = "${{ needs.build.outputs.version }}"
    assert attest["with"]["subject-path"].splitlines() == [
        f"SakaDesk-{version}-Setup/SakaDesk-{version}-Setup.exe",
        f"SakaDesk-{version}-manifest.json",
    ]


def test_no_run_block_expands_github_expressions():
    """Hardening #5: values reach scripts through env:, never template expansion."""
    for path in sorted(WORKFLOWS.glob("*.yml")):
        workflow = yaml.safe_load(path.read_text(encoding="utf-8"))
        for name, job in workflow["jobs"].items():
            for step in job.get("steps", []):
                assert "${{" not in step.get("run", ""), (
                    f"{path.name}:{name}:{step.get('name')}"
                )


def test_the_windows_build_can_be_dry_run_by_hand():
    assert (
        "github.event_name == 'workflow_dispatch'" in _workflow()["jobs"]["build"]["if"]
    )


_USES = re.compile(r"^\s*(?:-\s*)?uses:\s*(\S+)(.*)$")


def _uses_lines():
    for path in sorted(WORKFLOWS.glob("*.yml")):
        for line in path.read_text(encoding="utf-8").splitlines():
            match = _USES.match(line)
            if match:
                yield path.name, match.group(1), match.group(2)


def test_every_action_is_pinned_to_a_full_commit_sha():
    """Hardening #1."""
    found = list(_uses_lines())
    assert found
    for name, ref, comment in found:
        assert re.fullmatch(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}", ref), f"{name}: {ref}"
        assert re.fullmatch(r"\s+# v\d+(\.\d+)*", comment), (
            f"{name}: {ref} needs '# vX.Y.Z'"
        )


def test_uv_and_inno_setup_are_pinned():
    """Hardening #3 (uv) and #4 (Inno Setup)."""
    text = WORKFLOW.read_text(encoding="utf-8")
    assert 'version: "latest"' not in text
    assert text.count('version: "0.9.21"') == text.count("astral-sh/setup-uv@")
    assert "choco install innosetup --version=6.7.1" in text
    assert "DisplayVersion" in text
    assert '$found -ne "6.7.1"' in text


def test_checkouts_do_not_keep_the_token():
    for name, job in _workflow()["jobs"].items():
        for step in job["steps"]:
            if step.get("uses", "").startswith("actions/checkout@"):
                assert step["with"]["persist-credentials"] is False, name


def test_every_job_declares_its_permissions():
    workflow = _workflow()
    assert workflow["permissions"] == {}
    for name, job in workflow["jobs"].items():
        assert "permissions" in job, name


def test_release_please_is_gone():
    """Hardening #2: no dormant workflow with a standing write token."""
    for rel in (
        ".github/workflows/release-please.yml",
        ".github/release-please-config.json",
        ".github/.release-please-manifest.json",
    ):
        assert not (ROOT / rel).exists(), rel


def test_pre_commit_hooks_are_frozen_to_commits():
    """Hardening #9."""
    repo = None
    for line in (
        (ROOT / ".pre-commit-config.yaml").read_text(encoding="utf-8").splitlines()
    ):
        repo_match = re.match(r"^\s*-\s*repo:\s*(\S+)", line)
        if repo_match:
            repo = repo_match.group(1)
            continue
        rev = re.match(r"^\s*rev:\s*(\S+)(.*)$", line)
        if rev and repo not in ("local", "meta"):
            assert re.fullmatch(r"[0-9a-f]{40}", rev.group(1)), repo
            assert re.fullmatch(r"\s+# frozen: v[\d.]+", rev.group(2)), repo


def test_dependabot_keeps_the_action_pins_current():
    config = yaml.safe_load(
        (ROOT / ".github" / "dependabot.yml").read_text(encoding="utf-8")
    )
    (update,) = [
        u for u in config["updates"] if u["package-ecosystem"] == "github-actions"
    ]
    assert update["target-branch"] == "dev"


def test_ci_checks_the_environment_against_the_lock():
    """Hardening #3 / OD-7: in the test job, and in the build job after the build tools."""
    assert "python tooling/ci/check_locked_versions.py" in _run_text("test-backend")
    names = _names("build")
    sync = "Install Dependencies and the Build Tools"
    assert "uv sync --no-sources --group build" in _named_step("build", sync)["run"]
    assert names.index(sync) < names.index("Check the environment matches uv.lock")
    assert "uv pip" not in _run_text("build")


def _named_step(job: str, name: str) -> dict:
    (step,) = [s for s in _steps(job) if s.get("name") == name]
    return step


def _run_hash_check(tmp_path: Path, expected: str, content: bytes):
    """Run the `sign` installer hash-check step against a fake installer file."""
    if shutil.which("bash") is None or shutil.which("sha256sum") is None:
        pytest.skip("bash and sha256sum are required")
    step = _named_step("sign", "Check the installer matches the build job's hash")
    folder = tmp_path / "SakaDesk-0.5.1-Setup"
    folder.mkdir()
    (folder / "SakaDesk-0.5.1-Setup.exe").write_bytes(content)
    script = tmp_path / "step.sh"
    script.write_text(step["run"], encoding="utf-8")
    env = {
        **os.environ,
        "GITHUB_REF_NAME": "v0.5.1",
        "EXPECTED_INSTALLER_SHA256": expected,
    }
    return subprocess.run(
        ["bash", str(script)], cwd=tmp_path, env=env, capture_output=True, text=True
    )


def test_the_sign_installer_check_fails_without_an_expected_hash(tmp_path):
    proc = _run_hash_check(tmp_path, "", b"MZ installer")
    assert proc.returncode != 0
    assert "::error::" in proc.stdout


def test_the_sign_installer_check_fails_on_a_wrong_hash(tmp_path):
    proc = _run_hash_check(tmp_path, "0" * 64, b"MZ installer")
    assert proc.returncode != 0
    assert "::error::" in proc.stdout


def test_the_sign_installer_check_passes_on_the_right_hash(tmp_path):
    right = hashlib.sha256(b"MZ installer").hexdigest()
    proc = _run_hash_check(tmp_path, right, b"MZ installer")
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_the_sign_installer_check_fails_when_the_installer_is_missing(tmp_path):
    step = _named_step("sign", "Check the installer matches the build job's hash")
    if shutil.which("bash") is None:
        pytest.skip("bash is required")
    script = tmp_path / "step.sh"
    script.write_text(step["run"], encoding="utf-8")
    env = {**os.environ, "GITHUB_REF_NAME": "v0.5.1", "EXPECTED_INSTALLER_SHA256": "x"}
    proc = subprocess.run(
        ["bash", str(script)], cwd=tmp_path, env=env, capture_output=True, text=True
    )
    assert proc.returncode != 0


def test_the_new_hash_steps_fail_on_a_broken_pipe_stage():
    for job, name in (
        ("sign", "Check the installer matches the build job's hash"),
        ("sign", "Hash the signed manifest"),
        (
            "release",
            "Check the files match the hashes the build and sign jobs produced",
        ),
    ):
        assert "set -euo pipefail" in _named_step(job, name)["run"], name


def test_build_exposes_the_version_for_exact_names():
    assert (
        _workflow()["jobs"]["build"]["outputs"]["version"]
        == "${{ steps.version.outputs.VERSION }}"
    )


def test_artifacts_and_attestations_are_named_exactly():
    """OD-5: exact names, no `pattern:` and no glob in any `with:`."""
    version = "${{ needs.build.outputs.version }}"
    for job in ("sign", "verify-manifest", "release"):
        for step in _steps(job):
            with_ = step.get("with", {})
            assert "pattern" not in with_, (job, step.get("name"))
            for key, value in with_.items():
                assert "*" not in str(value), (job, step.get("name"), key)
            if "download-artifact" in step.get("uses", ""):
                assert with_["name"] in (
                    f"SakaDesk-{version}-Setup",
                    "SakaDesk-manifest",
                )
                if with_["name"] != "SakaDesk-manifest":
                    assert with_["path"] == f"SakaDesk-{version}-Setup"


def test_verify_manifest_checks_hashes_before_the_first_verifier_call():
    names = _names("verify-manifest")
    check = "Check the files match the hashes the build and sign jobs produced"
    assert check in names
    first_verifier = min(
        i
        for i, step in enumerate(_steps("verify-manifest"))
        if "backend.services.release_signing" in step.get("run", "")
    )
    assert names.index(check) < first_verifier
    step = _named_step("verify-manifest", check)
    assert "set -euo pipefail" in step["run"]
    assert "::error::" in step["run"]
    assert set(step["env"]) == {
        "EXPECTED_INSTALLER_SHA256",
        "EXPECTED_MANIFEST_SHA256",
    }
