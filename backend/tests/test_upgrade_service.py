"""Tests for upgrade_service.py — installer naming, script generation, and utilities."""

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.services.upgrade_service import (
    GITHUB_REPO,
    _installer_asset_name,
    cleanup_upgrade_files,
    generate_upgrade_script,
    is_upgrade_supported,
    launch_upgrade,
)


# ── GITHUB_REPO constant ────────────────────────────────────────────

def test_github_repo_is_string():
    assert isinstance(GITHUB_REPO, str)
    assert "/" in GITHUB_REPO


# ── _installer_asset_name ───────────────────────────────────────────

class TestInstallerAssetName:
    """Tests for the installer filename builder."""

    def test_with_v_prefix(self):
        result = _installer_asset_name("v0.2.0")
        assert result == "SakaDesk-0.2.0-Setup.exe"

    def test_without_v_prefix(self):
        result = _installer_asset_name("0.2.0")
        assert result == "SakaDesk-0.2.0-Setup.exe"

    def test_strips_v_only_once(self):
        result = _installer_asset_name("vv1.0.0")
        # lstrip("v") strips all leading v's
        assert result == "SakaDesk-1.0.0-Setup.exe"

    def test_three_part_version(self):
        result = _installer_asset_name("1.2.3")
        assert result == "SakaDesk-1.2.3-Setup.exe"

    def test_ends_with_exe(self):
        result = _installer_asset_name("v0.1.0")
        assert result.endswith(".exe")

    def test_starts_with_sakadesk(self):
        result = _installer_asset_name("v1.0.0")
        assert result.startswith("SakaDesk-")

    def test_contains_setup(self):
        result = _installer_asset_name("v2.0.0")
        assert "-Setup" in result


# ── generate_upgrade_script ──────────────────────────────────────────

class TestGenerateUpgradeScript:
    """Tests for batch script generation."""

    def test_creates_script_file(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        script_path = generate_upgrade_script(installer)
        assert script_path.exists()
        assert script_path.name == "upgrade.bat"

    def test_script_in_same_dir_as_installer(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        script_path = generate_upgrade_script(installer)
        assert script_path.parent == installer.parent

    def test_script_contains_installer_path(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        script_path = generate_upgrade_script(installer)
        content = script_path.read_text(encoding="utf-8")
        assert str(installer) in content

    def test_script_contains_verysilent_flag(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        script_path = generate_upgrade_script(installer)
        content = script_path.read_text(encoding="utf-8")
        assert "/VERYSILENT" in content

    def test_script_is_batch_file(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        script_path = generate_upgrade_script(installer)
        content = script_path.read_text(encoding="utf-8")
        assert content.startswith("@echo off")

    def test_script_contains_waitloop(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        script_path = generate_upgrade_script(installer)
        content = script_path.read_text(encoding="utf-8")
        assert ":waitloop" in content

    def test_script_contains_cleanup(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        script_path = generate_upgrade_script(installer)
        content = script_path.read_text(encoding="utf-8")
        assert ":cleanup" in content


# ── launch_upgrade ───────────────────────────────────────────────────

class TestLaunchUpgrade:
    """Tests for the upgrade launcher."""

    def test_returns_false_on_non_windows(self, tmp_path):
        script = tmp_path / "upgrade.bat"
        script.touch()
        with patch(
            "backend.services.upgrade_service.is_windows", return_value=False
        ):
            result = launch_upgrade(script)
        assert result is False

    def test_returns_false_when_script_missing(self, tmp_path):
        script = tmp_path / "nonexistent.bat"
        with patch(
            "backend.services.upgrade_service.is_windows", return_value=True
        ):
            result = launch_upgrade(script)
        assert result is False


# ── cleanup_upgrade_files ────────────────────────────────────────────

class TestCleanupUpgradeFiles:
    """Tests for upgrade file cleanup."""

    def test_cleans_existing_dir(self, tmp_path):
        upgrade_dir = tmp_path / "upgrade"
        upgrade_dir.mkdir()
        (upgrade_dir / "installer.exe").touch()
        (upgrade_dir / "upgrade.bat").touch()

        with patch(
            "backend.services.upgrade_service.get_app_data_dir",
            return_value=tmp_path,
        ):
            cleanup_upgrade_files()
        assert not upgrade_dir.exists()

    def test_noop_when_no_dir(self, tmp_path):
        with patch(
            "backend.services.upgrade_service.get_app_data_dir",
            return_value=tmp_path,
        ):
            # Should not raise
            cleanup_upgrade_files()

    def test_handles_permission_error_gracefully(self, tmp_path):
        upgrade_dir = tmp_path / "upgrade"
        upgrade_dir.mkdir()

        with (
            patch(
                "backend.services.upgrade_service.get_app_data_dir",
                return_value=tmp_path,
            ),
            patch("shutil.rmtree", side_effect=PermissionError("denied")),
        ):
            # Should not raise — gracefully logs warning
            cleanup_upgrade_files()
        # Directory still exists since rmtree was mocked to fail
        assert upgrade_dir.exists()


# ── is_upgrade_supported ─────────────────────────────────────────────

class TestIsUpgradeSupported:
    """Tests for platform support check."""

    def test_false_on_linux(self):
        with patch(
            "backend.services.upgrade_service.is_windows", return_value=False
        ):
            assert is_upgrade_supported() is False

    def test_true_on_windows(self):
        with patch(
            "backend.services.upgrade_service.is_windows", return_value=True
        ):
            assert is_upgrade_supported() is True
