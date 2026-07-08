"""Tests for the release-build pysaka pin preflight (XREPO-01).

`tooling/windows/check_release_pin.py` is invoked by build.yml only on tag
builds; it must fail the build when pysaka is not pinned exactly so a release
artifact can never float to whatever pysaka is newest on PyPI.
"""

import importlib.util
from pathlib import Path

import pytest

_MODULE_PATH = (
    Path(__file__).parent.parent / "tooling" / "windows" / "check_release_pin.py"
)


def _load_module():
    spec = importlib.util.spec_from_file_location("check_release_pin", _MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_pyproject(tmp_path: Path, pysaka_spec: str | None) -> Path:
    deps = ['"fastapi"']
    if pysaka_spec is not None:
        deps.append(f'"{pysaka_spec}"')
    content = (
        "[project]\n"
        'name = "sakadesk"\n'
        'version = "0.3.2"\n'
        "dependencies = [\n" + "".join(f"    {d},\n" for d in deps) + "]\n"
    )
    path = tmp_path / "pyproject.toml"
    path.write_text(content, encoding="utf-8")
    return path


class TestGetPinnedVersion:
    def test_exact_pin_accepted(self, tmp_path):
        mod = _load_module()
        path = _write_pyproject(tmp_path, "pysaka==0.4.3")
        assert mod.get_pinned_version(path) == "0.4.3"

    def test_exact_pin_with_suffix(self, tmp_path):
        mod = _load_module()
        path = _write_pyproject(tmp_path, "pysaka==0.4.3rc1")
        assert mod.get_pinned_version(path) == "0.4.3rc1"

    def test_unbounded_floor_rejected(self, tmp_path):
        # This is the current default (pysaka>=0.4.2) -- must fail a release.
        mod = _load_module()
        path = _write_pyproject(tmp_path, "pysaka>=0.4.2")
        with pytest.raises(SystemExit) as exc:
            mod.get_pinned_version(path)
        assert exc.value.code == 1

    def test_range_rejected(self, tmp_path):
        mod = _load_module()
        path = _write_pyproject(tmp_path, "pysaka>=0.4.2,<0.5.0")
        with pytest.raises(SystemExit) as exc:
            mod.get_pinned_version(path)
        assert exc.value.code == 1

    def test_missing_pysaka_rejected(self, tmp_path):
        mod = _load_module()
        path = _write_pyproject(tmp_path, None)
        with pytest.raises(SystemExit) as exc:
            mod.get_pinned_version(path)
        assert exc.value.code == 1
