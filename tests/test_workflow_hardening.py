"""Release pipeline guards (security audit 2026-11-13: N6, hardening #1-6, #9; Plan E)."""

from __future__ import annotations

from pathlib import Path

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


def test_only_the_sign_job_can_read_the_signing_key():
    jobs = _workflow()["jobs"]
    sign = jobs["sign"]
    assert sign["environment"] == "release"
    assert sign["permissions"] == {"contents": "read"}
    assert sign["needs"] == ["build"]
    assert sign["if"] == "startsWith(github.ref, 'refs/tags/v')"
    for name, job in jobs.items():
        if name != "sign":
            assert "secrets." not in yaml.safe_dump(job), name
    (step,) = [s for s in sign["steps"] if s.get("name") == "Sign the update manifest"]
    assert set(step["env"]) == {
        "SAKADESK_RELEASE_SIGNING_KEY",
        "SAKADESK_RELEASE_SIGNING_KEY_NEXT",
    }
    assert "uv run --no-project python tooling/release/sign_manifest.py" in step["run"]


def test_nothing_from_pypi_runs_up_to_the_signing_step():
    steps = _steps("sign")
    upto = steps[: _names("sign").index("Sign the update manifest") + 1]
    for step in upto:
        run = step.get("run", "")
        assert "--with" not in run and "uv sync" not in run and "pip" not in run


def test_the_tag_must_be_on_main_before_signing():
    names = _names("sign")
    assert names.index("Verify the tag commit is on main") < names.index(
        "Sign the update manifest"
    )
    assert "git merge-base --is-ancestor" in _run_text("sign")
    assert _steps("sign")[0]["with"]["fetch-depth"] == 0


def test_the_manifest_is_checked_with_this_and_the_previous_release_keys():
    run = _run_text("sign")
    assert run.count("python -m backend.services.release_signing") == 2
    assert "--keys-file" in run
    assert "git describe --tags --abbrev=0" in run
    (previous,) = [
        s
        for s in _steps("sign")
        if s.get("name") == "Verify the manifest with the previous release's keys"
    ]
    assert previous["if"] == "vars.SAKADESK_ALLOW_KEY_RESET != 'yes'"


def test_release_waits_for_sign_and_publishes_a_complete_draft():
    release = _workflow()["jobs"]["release"]
    assert release["needs"] == ["build", "sign"]
    run = _run_text("release")
    assert "--draft" in run and "--verify-tag" in run and "--draft=false" in run
    assert "SakaDesk-${TAG_VERSION}-manifest.json" in run
    (attest,) = [
        s for s in _steps("release") if s.get("name") == "Attest Build Provenance"
    ]
    assert "SakaDesk-*-manifest.json" in attest["with"]["subject-path"]


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
