"""Tests for upgrade_service.py — installer naming, launch, download, and utilities."""

import asyncio
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
            result = asyncio.run(launch_installer(installer))
        assert result is False

    def test_returns_false_when_installer_missing(self, tmp_path):
        installer = tmp_path / "nonexistent.exe"
        with patch("backend.services.upgrade_service.is_windows", return_value=True):
            result = asyncio.run(launch_installer(installer))
        assert result is False

    def test_launches_silently_with_log_in_logs_dir(self, tmp_path):
        """Setup gets the silent flags plus /LOG into the app's logs dir, so a
        failed upgrade (which closes the app with no UI) leaves a log."""
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        logs_dir = tmp_path / "ログ"  # non-ASCII path must pass through intact
        logs_dir.mkdir()
        with (
            patch("backend.services.upgrade_service.is_windows", return_value=True),
            patch(
                "backend.services.upgrade_service.get_logs_dir", return_value=logs_dir
            ),
            patch("backend.services.upgrade_service.subprocess") as mock_subprocess,
        ):
            result = asyncio.run(launch_installer(installer))
        assert result is True
        args = mock_subprocess.Popen.call_args.args[0]
        assert args == [
            str(installer),
            "/SILENT",
            "/SUPPRESSMSGBOXES",
            "/NORESTART",
            f"/LOG={logs_dir / 'installer.log'}",
        ]

    def test_returns_false_when_popen_fails(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        with (
            patch("backend.services.upgrade_service.is_windows", return_value=True),
            patch(
                "backend.services.upgrade_service.get_logs_dir", return_value=tmp_path
            ),
            patch("backend.services.upgrade_service.subprocess") as mock_subprocess,
        ):
            mock_subprocess.Popen.side_effect = OSError("blocked")
            result = asyncio.run(launch_installer(installer))
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


# ── SEC-4: installer download URL allowlist ─────────────────────────


class TestDownloadUrlAllowlist:
    """SEC-4 — installer download is restricted to HTTPS GitHub hosts, before
    and after redirects."""

    def test_is_allowed_download_url(self):
        from backend.services.upgrade_service import _is_allowed_download_url

        # Allowed: HTTPS on GitHub-controlled hosts.
        assert _is_allowed_download_url("https://github.com/x/y/z.exe") is True
        assert (
            _is_allowed_download_url("https://objects.githubusercontent.com/a") is True
        )
        assert (
            _is_allowed_download_url("https://release-assets.githubusercontent.com/a")
            is True
        )
        assert _is_allowed_download_url("https://cdn.githubusercontent.com/a") is True
        # Rejected: non-HTTPS, foreign host, and look-alike host.
        assert _is_allowed_download_url("http://github.com/x") is False
        assert _is_allowed_download_url("https://evil.example.com/x.exe") is False
        assert _is_allowed_download_url("https://github.com.evil.com/x.exe") is False

    @respx.mock
    @pytest.mark.asyncio
    async def test_download_rejects_disallowed_url(self, tmp_path):
        """A non-GitHub info.url is refused before any network call (SEC-4)."""
        route = respx.get("https://evil.example.com/x.exe").respond(200, content=b"MZ")
        info = InstallerInfo(
            url="https://evil.example.com/x.exe",
            size=2,
            digest="sha256:" + hashlib.sha256(b"MZ").hexdigest(),
        )
        with patch(
            "backend.services.upgrade_service.get_app_data_dir", return_value=tmp_path
        ):
            result = await download_installer(info)
        assert result is None
        assert not route.called  # short-circuited before the network

    @respx.mock
    @pytest.mark.asyncio
    async def test_download_rejects_redirect_off_github(self, tmp_path):
        """A redirect that leaves GitHub is rejected after being followed (SEC-4).

        Without the fix, follow_redirects=True would fetch (and verify) the body
        from the redirected host; the post-redirect re-validation returns None.
        """
        payload = b"MZfake-installer-bytes"
        digest = "sha256:" + hashlib.sha256(payload).hexdigest()
        gh_url = (
            f"https://github.com/{GITHUB_REPO}/releases/download/v1/"
            "SakaDesk-1-Setup.exe"
        )
        respx.get(gh_url).respond(
            302, headers={"Location": "https://evil.example.com/x.exe"}
        )
        respx.get("https://evil.example.com/x.exe").respond(
            200,
            content=payload,
            headers={"content-length": str(len(payload))},
        )
        info = InstallerInfo(url=gh_url, size=len(payload), digest=digest)
        with patch(
            "backend.services.upgrade_service.get_app_data_dir", return_value=tmp_path
        ):
            result = await download_installer(info)
        assert result is None


# ── no user paths in logs (PII: the Windows account name) ────────────

_ACCOUNT = "金村美玖"


def _user_dir(tmp_path):
    d = tmp_path / "Users" / _ACCOUNT / "AppData"
    d.mkdir(parents=True)
    return d


class TestLogsCarryNoUserPaths:
    def test_launch_success_logs_no_path(self, tmp_path):
        from structlog.testing import capture_logs

        base = _user_dir(tmp_path)
        installer = base / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        with (
            patch("backend.services.upgrade_service.is_windows", return_value=True),
            patch("backend.services.upgrade_service.get_logs_dir", return_value=base),
            patch("backend.services.upgrade_service.subprocess"),
            capture_logs() as logs,
        ):
            assert asyncio.run(launch_installer(installer)) is True
        assert logs and _ACCOUNT not in repr(logs)
        (launched,) = [
            e for e in logs if e["event"] == "Installer launched successfully"
        ]
        assert launched["log_file"] == "installer.log"

    def test_launch_missing_installer_logs_no_path(self, tmp_path):
        from structlog.testing import capture_logs

        installer = _user_dir(tmp_path) / "missing.exe"
        with (
            patch("backend.services.upgrade_service.is_windows", return_value=True),
            capture_logs() as logs,
        ):
            assert asyncio.run(launch_installer(installer)) is False
        assert logs and _ACCOUNT not in repr(logs)

    def test_launch_failure_logs_error_type_not_message(self, tmp_path):
        from structlog.testing import capture_logs

        base = _user_dir(tmp_path)
        installer = base / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        with (
            patch("backend.services.upgrade_service.is_windows", return_value=True),
            patch("backend.services.upgrade_service.get_logs_dir", return_value=base),
            patch("backend.services.upgrade_service.subprocess") as mock_subprocess,
            capture_logs() as logs,
        ):
            mock_subprocess.Popen.side_effect = OSError(f"blocked {installer}")
            assert asyncio.run(launch_installer(installer)) is False
        assert logs and _ACCOUNT not in repr(logs)
        assert any(e.get("error_type") == "OSError" for e in logs)

    @respx.mock
    @pytest.mark.asyncio
    async def test_download_success_logs_file_name_only(self, tmp_path):
        from structlog.testing import capture_logs

        base = _user_dir(tmp_path)
        content = _make_installer_content()
        info = _make_info(content)
        respx.get(info.url).respond(
            200, content=content, headers={"content-length": str(len(content))}
        )
        with (
            patch(
                "backend.services.upgrade_service.get_app_data_dir", return_value=base
            ),
            capture_logs() as logs,
        ):
            result = await download_installer(info)
        assert result is not None
        assert _ACCOUNT not in repr(logs)
        (done,) = [e for e in logs if e["event"] == "Installer downloaded"]
        assert done["file_name"] == "SakaDesk-1.0.0-Setup.exe"

    @respx.mock
    @pytest.mark.asyncio
    async def test_download_os_error_logs_error_type_not_message(self, tmp_path):
        from structlog.testing import capture_logs

        base = _user_dir(tmp_path)
        info = _make_info(_make_installer_content())
        respx.get(info.url).respond(200, content=b"x")
        with (
            patch(
                "backend.services.upgrade_service.get_app_data_dir", return_value=base
            ),
            patch("builtins.open", side_effect=PermissionError(f"denied {base}")),
            capture_logs() as logs,
        ):
            assert await download_installer(info) is None
        assert logs and _ACCOUNT not in repr(logs)
        assert any(e.get("error_type") == "PermissionError" for e in logs)

    def test_cleanup_failure_logs_error_type_not_message(self, tmp_path):
        from structlog.testing import capture_logs

        base = _user_dir(tmp_path)
        (base / "upgrade").mkdir()
        with (
            patch(
                "backend.services.upgrade_service.get_app_data_dir", return_value=base
            ),
            patch("shutil.rmtree", side_effect=PermissionError(f"denied {base}")),
            capture_logs() as logs,
        ):
            cleanup_upgrade_files()
        assert logs and _ACCOUNT not in repr(logs)
        assert any(e.get("error_type") == "PermissionError" for e in logs)


# ── 0.4.1: overlapping downloads / locked installer ─────────────────


def _sharing_violation() -> OSError:
    err = OSError("in use")
    err.winerror = 32  # type: ignore[attr-defined]
    return err


class TestDownloadPartFile:
    """Each download writes a private .part file; only a verified one becomes the installer."""

    @respx.mock
    @pytest.mark.asyncio
    async def test_success_leaves_no_part_file(self, tmp_path):
        content = _make_installer_content()
        info = _make_info(content)
        respx.get(info.url).respond(200, content=content)
        with patch(
            "backend.services.upgrade_service.get_app_data_dir", return_value=tmp_path
        ):
            result = await download_installer(info)
        assert result == tmp_path / "upgrade" / "SakaDesk-1.0.0-Setup.exe"
        assert list((tmp_path / "upgrade").glob("*.part")) == []

    @respx.mock
    @pytest.mark.asyncio
    async def test_failed_verify_keeps_earlier_installer_untouched(self, tmp_path):
        """A bad download must not overwrite or delete an installer already in place."""
        upgrade_dir = tmp_path / "upgrade"
        upgrade_dir.mkdir()
        existing = upgrade_dir / "SakaDesk-1.0.0-Setup.exe"
        existing.write_bytes(b"MZ-earlier")
        content = _make_installer_content()
        info = InstallerInfo(
            url=_make_info(content).url, size=len(content), digest="sha256:" + "0" * 64
        )
        respx.get(info.url).respond(200, content=content)
        with patch(
            "backend.services.upgrade_service.get_app_data_dir", return_value=tmp_path
        ):
            assert await download_installer(info) is None
        assert existing.read_bytes() == b"MZ-earlier"
        assert list(upgrade_dir.glob("*.part")) == []

    @pytest.mark.asyncio
    async def test_cancel_mid_download_removes_part_file(self, tmp_path):
        content = _make_installer_content(64 * 1024)
        info = _make_info(content)
        started = asyncio.Event()

        async def slow_stream(request):
            async def body():
                yield content[:8192]
                started.set()
                await asyncio.sleep(30)
                yield content[8192:]

            return httpx.Response(200, content=body())

        with respx.mock:
            respx.get(info.url).mock(side_effect=slow_stream)
            with patch(
                "backend.services.upgrade_service.get_app_data_dir",
                return_value=tmp_path,
            ):
                task = asyncio.create_task(download_installer(info))
                await asyncio.wait_for(started.wait(), 5)
                await asyncio.sleep(0.05)
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
        upgrade_dir = tmp_path / "upgrade"
        assert list(upgrade_dir.glob("*.part")) == []
        assert list(upgrade_dir.glob("*.exe")) == []


class TestLaunchRetry:
    """A sharing violation (file in use) is retried; other errors fail at once."""

    def _run(self, tmp_path, side_effect, attempts=3):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        with (
            patch("backend.services.upgrade_service.is_windows", return_value=True),
            patch(
                "backend.services.upgrade_service.get_logs_dir", return_value=tmp_path
            ),
            patch("backend.services.upgrade_service.subprocess") as mock_subprocess,
        ):
            mock_subprocess.Popen.side_effect = side_effect
            result = asyncio.run(
                launch_installer(installer, attempts=attempts, retry_delay=0)
            )
        return result, mock_subprocess.Popen.call_count

    def test_retries_sharing_violation_then_launches(self, tmp_path):
        from structlog.testing import capture_logs

        with capture_logs() as logs:
            result, calls = self._run(
                tmp_path, [_sharing_violation(), _sharing_violation(), None]
            )
        assert (result, calls) == (True, 3)
        retries = [e for e in logs if e["event"] == "installer_launch_retry"]
        assert [e["attempt"] for e in retries] == [1, 2]

    def test_gives_up_after_attempts(self, tmp_path):
        result, calls = self._run(tmp_path, _sharing_violation())
        assert (result, calls) == (False, 3)

    def test_other_os_error_is_not_retried(self, tmp_path):
        result, calls = self._run(tmp_path, OSError("blocked"))
        assert (result, calls) == (False, 1)
