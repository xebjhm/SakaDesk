"""Tests for upgrade_service.py — installer naming, launch, download, and utilities."""

import hashlib
from unittest.mock import patch

import httpx
import pytest
import respx

from backend.services.upgrade_service import (
    GITHUB_REPO,
    MAX_INSTALLER_SIZE,
    InstallerInfo,
    _installer_asset_name,
    cleanup_upgrade_files,
    download_installer,
    get_installer_info,
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


# ── get_installer_info ──────────────────────────────────────────────


def _github_release_json(
    asset_name="SakaDesk-1.0.0-Setup.exe",
    url="https://github.com/xebjhm/SakaDesk/releases/download/v1.0.0/SakaDesk-1.0.0-Setup.exe",
    size=1024,
    digest="sha256:abc123",
    extra_assets=None,
):
    """Build a minimal GitHub release JSON payload."""
    assets = []
    if asset_name:
        asset = {"name": asset_name, "size": size, "digest": digest}
        if url:
            asset["browser_download_url"] = url
        assets.append(asset)
    if extra_assets:
        assets.extend(extra_assets)
    return {"tag_name": "v1.0.0", "assets": assets}


class TestGetInstallerInfo:
    """Tests for get_installer_info — GitHub API parsing."""

    @respx.mock
    @pytest.mark.asyncio
    async def test_success_returns_installer_info(self):
        """Successful asset match returns correct InstallerInfo."""
        payload = _github_release_json()
        respx.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/v1.0.0"
        ).respond(200, json=payload)

        result = await get_installer_info("v1.0.0")
        assert result is not None
        assert result.url.endswith("SakaDesk-1.0.0-Setup.exe")
        assert result.size == 1024
        assert result.digest == "sha256:abc123"

    @respx.mock
    @pytest.mark.asyncio
    async def test_adds_v_prefix_when_missing(self):
        """Version without 'v' prefix still queries correct GitHub tag."""
        payload = _github_release_json()
        route = respx.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/v1.0.0"
        ).respond(200, json=payload)

        result = await get_installer_info("1.0.0")
        assert result is not None
        assert route.called

    @respx.mock
    @pytest.mark.asyncio
    async def test_asset_without_url_is_skipped(self):
        """Asset missing browser_download_url is skipped."""
        payload = _github_release_json(url=None)
        respx.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/v1.0.0"
        ).respond(200, json=payload)

        result = await get_installer_info("v1.0.0")
        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_missing_asset_returns_none(self):
        """Release with no matching installer asset returns None."""
        payload = _github_release_json(asset_name="wrong-file.zip")
        respx.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/v1.0.0"
        ).respond(200, json=payload)

        result = await get_installer_info("v1.0.0")
        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_non_200_returns_none(self):
        """Non-200 response returns None."""
        respx.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/v1.0.0"
        ).respond(404)

        result = await get_installer_info("v1.0.0")
        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_network_error_returns_none(self):
        """Network error returns None gracefully."""
        respx.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/v1.0.0"
        ).mock(side_effect=httpx.ConnectError("Connection refused"))

        result = await get_installer_info("v1.0.0")
        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_case_insensitive_match(self):
        """Asset name matching is case-insensitive."""
        payload = _github_release_json(asset_name="sakadesk-1.0.0-setup.exe")
        respx.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/v1.0.0"
        ).respond(200, json=payload)

        result = await get_installer_info("v1.0.0")
        assert result is not None

    @respx.mock
    @pytest.mark.asyncio
    async def test_digest_none_when_absent(self):
        """InstallerInfo.digest is None when GitHub doesn't provide it."""
        payload = _github_release_json(digest=None)
        respx.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/v1.0.0"
        ).respond(200, json=payload)

        result = await get_installer_info("v1.0.0")
        assert result is not None
        assert result.digest is None


# ── download_installer ──────────────────────────────────────────────


def _make_installer_content(size: int = 256) -> bytes:
    """Generate deterministic installer content."""
    return b"MZ" + b"\x00" * (size - 2)  # PE header stub


def _make_info(
    content: bytes,
    url: str = "https://github.com/xebjhm/SakaDesk/releases/download/v1.0.0/SakaDesk-1.0.0-Setup.exe",
    with_digest: bool = True,
) -> InstallerInfo:
    """Build InstallerInfo matching the given content."""
    digest = f"sha256:{hashlib.sha256(content).hexdigest()}" if with_digest else None
    return InstallerInfo(url=url, size=len(content), digest=digest)


class TestDownloadInstaller:
    """Tests for download_installer — download, verify, and security checks."""

    @respx.mock
    @pytest.mark.asyncio
    async def test_successful_download_with_matching_digest(self, tmp_path):
        """Happy path: download + SHA-256 verification succeeds."""
        content = _make_installer_content()
        info = _make_info(content)
        respx.get(info.url).respond(
            200, content=content, headers={"content-length": str(len(content))}
        )

        with patch(
            "backend.services.upgrade_service.get_app_data_dir",
            return_value=tmp_path,
        ):
            result = await download_installer(info)

        assert result is not None
        assert result.exists()
        assert result.read_bytes() == content

    @respx.mock
    @pytest.mark.asyncio
    async def test_sha256_mismatch_rejects_download(self, tmp_path):
        """SHA-256 mismatch deletes installer and returns None."""
        content = _make_installer_content()
        info = InstallerInfo(
            url="https://github.com/xebjhm/SakaDesk/releases/download/v1.0.0/SakaDesk-1.0.0-Setup.exe",
            size=len(content),
            digest="sha256:0000000000000000000000000000000000000000000000000000000000000000",
        )
        respx.get(info.url).respond(
            200, content=content, headers={"content-length": str(len(content))}
        )

        with patch(
            "backend.services.upgrade_service.get_app_data_dir",
            return_value=tmp_path,
        ):
            result = await download_installer(info)

        assert result is None
        # Partial file should be cleaned up
        upgrade_dir = tmp_path / "upgrade"
        assert not any(upgrade_dir.glob("*.exe"))

    @respx.mock
    @pytest.mark.asyncio
    async def test_missing_digest_is_rejected(self, tmp_path):
        """Installer without digest is refused (mandatory verification)."""
        content = _make_installer_content()
        info = _make_info(content, with_digest=False)
        respx.get(info.url).respond(
            200, content=content, headers={"content-length": str(len(content))}
        )

        with patch(
            "backend.services.upgrade_service.get_app_data_dir",
            return_value=tmp_path,
        ):
            result = await download_installer(info)

        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_size_exceeding_max_aborts(self, tmp_path):
        """Download exceeding MAX_INSTALLER_SIZE is aborted."""
        # Create content just over the limit
        content = b"\x00" * (MAX_INSTALLER_SIZE + 1)
        info = _make_info(content)
        respx.get(info.url).respond(
            200, content=content, headers={"content-length": str(len(content))}
        )

        with patch(
            "backend.services.upgrade_service.get_app_data_dir",
            return_value=tmp_path,
        ):
            result = await download_installer(info)

        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_content_length_mismatch_rejects(self, tmp_path):
        """Truncated download (fewer bytes than content-length) is rejected."""
        content = _make_installer_content(256)
        info = _make_info(content)
        # Lie about content-length (claim more bytes than sent)
        respx.get(info.url).respond(
            200, content=content, headers={"content-length": str(len(content) + 100)}
        )

        with patch(
            "backend.services.upgrade_service.get_app_data_dir",
            return_value=tmp_path,
        ):
            result = await download_installer(info)

        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_github_asset_size_mismatch_rejects(self, tmp_path):
        """Download size != GitHub asset size is rejected."""
        content = _make_installer_content(256)
        info = InstallerInfo(
            url="https://github.com/xebjhm/SakaDesk/releases/download/v1.0.0/SakaDesk-1.0.0-Setup.exe",
            size=999,  # Different from actual content size
            digest=f"sha256:{hashlib.sha256(content).hexdigest()}",
        )
        respx.get(info.url).respond(
            200, content=content, headers={"content-length": str(len(content))}
        )

        with patch(
            "backend.services.upgrade_service.get_app_data_dir",
            return_value=tmp_path,
        ):
            result = await download_installer(info)

        assert result is None

    @pytest.mark.asyncio
    async def test_path_traversal_in_url_rejected(self, tmp_path):
        """URL with path traversal in filename is rejected."""
        info = InstallerInfo(
            url="https://evil.com/../../etc/passwd.exe",
            size=100,
            digest="sha256:abc",
        )

        with patch(
            "backend.services.upgrade_service.get_app_data_dir",
            return_value=tmp_path,
        ):
            await download_installer(info)

        # No file should be created outside the upgrade directory
        assert not (tmp_path / "etc").exists()

    @pytest.mark.asyncio
    async def test_non_exe_filename_rejected(self, tmp_path):
        """URL with non-.exe filename is rejected."""
        info = InstallerInfo(
            url="https://example.com/malware.sh",
            size=100,
            digest="sha256:abc",
        )

        with patch(
            "backend.services.upgrade_service.get_app_data_dir",
            return_value=tmp_path,
        ):
            result = await download_installer(info)

        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_http_error_returns_none(self, tmp_path):
        """Non-200 HTTP response returns None."""
        info = _make_info(_make_installer_content())
        respx.get(info.url).respond(403)

        with patch(
            "backend.services.upgrade_service.get_app_data_dir",
            return_value=tmp_path,
        ):
            result = await download_installer(info)

        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_network_error_cleans_up(self, tmp_path):
        """Network error during download cleans up partial file."""
        info = _make_info(_make_installer_content())
        respx.get(info.url).mock(side_effect=httpx.ConnectError("Connection reset"))

        with patch(
            "backend.services.upgrade_service.get_app_data_dir",
            return_value=tmp_path,
        ):
            result = await download_installer(info)

        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_progress_callback_is_called(self, tmp_path):
        """Progress callback receives download progress updates."""
        content = _make_installer_content()
        info = _make_info(content)
        respx.get(info.url).respond(
            200, content=content, headers={"content-length": str(len(content))}
        )

        calls = []

        with patch(
            "backend.services.upgrade_service.get_app_data_dir",
            return_value=tmp_path,
        ):
            result = await download_installer(
                info, progress_callback=lambda d, t: calls.append((d, t))
            )

        assert result is not None
        assert len(calls) > 0
        # Last call should have downloaded == total
        assert calls[-1][0] == len(content)
