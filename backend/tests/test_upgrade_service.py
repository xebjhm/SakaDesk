"""Tests for upgrade_service.py — installer naming, launch, and utilities."""

from unittest.mock import patch


from backend.services.upgrade_service import (
    GITHUB_REPO,
    InstallerInfo,
    _installer_asset_name,
    cleanup_upgrade_files,
    is_upgrade_supported,
    launch_installer,
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


# ── InstallerInfo ───────────────────────────────────────────────────


class TestInstallerInfo:
    """Tests for the InstallerInfo dataclass."""

    def test_creates_with_digest(self):
        info = InstallerInfo(
            url="https://example.com/setup.exe",
            size=1024,
            digest="sha256:abc123",
        )
        assert info.url == "https://example.com/setup.exe"
        assert info.size == 1024
        assert info.digest == "sha256:abc123"

    def test_creates_without_digest(self):
        info = InstallerInfo(
            url="https://example.com/setup.exe",
            size=0,
            digest=None,
        )
        assert info.digest is None


# ── launch_installer ────────────────────────────────────────────────


class TestLaunchInstaller:
    """Tests for the direct installer launcher."""

    def test_returns_false_on_non_windows(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        with patch("backend.services.upgrade_service.is_windows", return_value=False):
            result = launch_installer(installer)
        assert result is False

    def test_returns_false_when_installer_missing(self, tmp_path):
        installer = tmp_path / "nonexistent.exe"
        with patch("backend.services.upgrade_service.is_windows", return_value=True):
            result = launch_installer(installer)
        assert result is False


# ── cleanup_upgrade_files ────────────────────────────────────────────


class TestCleanupUpgradeFiles:
    """Tests for upgrade file cleanup."""

    def test_cleans_existing_dir(self, tmp_path):
        upgrade_dir = tmp_path / "upgrade"
        upgrade_dir.mkdir()
        (upgrade_dir / "installer.exe").touch()

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
        with patch("backend.services.upgrade_service.is_windows", return_value=False):
            assert is_upgrade_supported() is False

    def test_true_on_windows(self):
        with patch("backend.services.upgrade_service.is_windows", return_value=True):
            assert is_upgrade_supported() is True
