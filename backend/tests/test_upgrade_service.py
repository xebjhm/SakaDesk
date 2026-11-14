"""Tests for upgrade_service.py — installer naming, launch, download, and utilities."""

import asyncio
import contextlib
import hashlib
import os
import sys
from unittest.mock import MagicMock, patch

import httpx
import pytest
import respx
from structlog.testing import capture_logs

from backend.services import release_keys, upgrade_service
from backend.services.release_signing import MAX_ENVELOPE_BYTES
from backend.services.upgrade_service import (
    GITHUB_REPO,
    MAX_INSTALLER_SIZE,
    InstallerInfo,
    UpdateNotVerified,
    _installer_asset_name,
    cleanup_upgrade_files,
    download_installer,
    get_installer_info,
    is_upgrade_supported,
    launch_installer,
    release_asset_url,
)
from backend.tests.signing_helpers import new_key, signed_manifest, trusted

_EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()


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
        # Exactly one leading "v", like get_installer_info.
        assert result == "SakaDesk-v1.0.0-Setup.exe"

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
            sha256="a" * 64,
        )
        assert info.url == "https://example.com/setup.exe"
        assert info.size == 1024
        assert info.digest == "sha256:abc123"
        assert info.sha256 == "a" * 64

    def test_creates_without_digest(self):
        info = InstallerInfo(
            url="https://example.com/setup.exe",
            size=0,
            digest=None,
            sha256="a" * 64,
        )
        assert info.digest is None


# ── launch_installer ────────────────────────────────────────────────


class TestLaunchInstaller:
    """Tests for the direct installer launcher."""

    def test_returns_false_on_non_windows(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        with patch("backend.services.upgrade_service.is_windows", return_value=False):
            result = asyncio.run(
                launch_installer(installer, expected_sha256=_EMPTY_SHA256)
            )
        assert result is False

    def test_returns_false_when_installer_missing(self, tmp_path):
        installer = tmp_path / "nonexistent.exe"
        with patch("backend.services.upgrade_service.is_windows", return_value=True):
            result = asyncio.run(
                launch_installer(installer, expected_sha256=_EMPTY_SHA256)
            )
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
            result = asyncio.run(
                launch_installer(installer, expected_sha256=_EMPTY_SHA256)
            )
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
            result = asyncio.run(
                launch_installer(installer, expected_sha256=_EMPTY_SHA256)
            )
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


_KEY = new_key()
_INSTALLER_BYTES = b"MZ" + b"\x00" * 1022  # 1024 bytes, the release JSON's size
_RELEASE_API = f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/v1.0.0"
_MANIFEST_URL = f"https://github.com/{GITHUB_REPO}/releases/download/v1.0.0/SakaDesk-1.0.0-manifest.json"


def _github_release_json(
    asset_name="SakaDesk-1.0.0-Setup.exe",
    url="https://github.com/xebjhm/SakaDesk/releases/download/v1.0.0/SakaDesk-1.0.0-Setup.exe",
    size=1024,
    digest="sha256:abc123",
    extra_assets=None,
    manifest=True,
):
    """Build a minimal GitHub release JSON payload (with the signed manifest asset)."""
    assets = []
    if asset_name:
        asset = {"name": asset_name, "size": size, "digest": digest}
        if url:
            asset["browser_download_url"] = url
        assets.append(asset)
    if manifest:
        assets.append(
            {
                "name": "SakaDesk-1.0.0-manifest.json",
                "size": 400,
                "browser_download_url": _MANIFEST_URL,
            }
        )
    if extra_assets:
        assets.extend(extra_assets)
    return {"tag_name": "v1.0.0", "assets": assets}


def _serve_manifest(data: bytes | None = None):
    """Serve the release's manifest (by default signed by the trusted test key)."""
    body = (
        data if data is not None else signed_manifest(_INSTALLER_BYTES, "1.0.0", _KEY)
    )
    return respx.get(_MANIFEST_URL).respond(200, content=body)


class TestGetInstallerInfo:
    """get_installer_info: the release lookup and the signed manifest gate."""

    @pytest.fixture(autouse=True)
    def _trust_test_key(self, monkeypatch):
        monkeypatch.setattr(release_keys, "TRUSTED_RELEASE_KEYS", trusted(_KEY))

    @respx.mock
    @pytest.mark.asyncio
    async def test_success_returns_the_signed_size_and_hash(self):
        respx.get(_RELEASE_API).respond(200, json=_github_release_json())
        _serve_manifest()
        result = await get_installer_info("v1.0.0")
        assert result == InstallerInfo(
            url=release_asset_url("1.0.0", "SakaDesk-1.0.0-Setup.exe"),
            size=1024,
            digest="sha256:abc123",
            sha256=hashlib.sha256(_INSTALLER_BYTES).hexdigest(),
        )

    @respx.mock
    @pytest.mark.asyncio
    async def test_success_logs_the_verifying_key_id(self):
        respx.get(_RELEASE_API).respond(200, json=_github_release_json())
        _serve_manifest()
        with capture_logs() as logs:
            await get_installer_info("v1.0.0")
        (event,) = [e for e in logs if e["event"] == "upgrade_manifest_verified"]
        assert event["key_id"] == next(iter(trusted(_KEY)))
        assert event["size"] == 1024

    @respx.mock
    @pytest.mark.asyncio
    async def test_adds_v_prefix_when_missing(self):
        route = respx.get(_RELEASE_API).respond(200, json=_github_release_json())
        _serve_manifest()
        assert await get_installer_info("1.0.0") is not None
        assert route.called

    @respx.mock
    @pytest.mark.asyncio
    async def test_asset_without_url_is_refused(self):
        respx.get(_RELEASE_API).respond(200, json=_github_release_json(url=None))
        assert await get_installer_info("v1.0.0") is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_missing_asset_returns_none(self):
        respx.get(_RELEASE_API).respond(
            200, json=_github_release_json(asset_name="wrong-file.zip")
        )
        assert await get_installer_info("v1.0.0") is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_non_200_returns_none(self):
        respx.get(_RELEASE_API).respond(404)
        assert await get_installer_info("v1.0.0") is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_network_error_returns_none(self):
        respx.get(_RELEASE_API).mock(
            side_effect=httpx.ConnectError("Connection refused")
        )
        assert await get_installer_info("v1.0.0") is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_asset_name_must_match_exactly(self):
        """Hardening #61: no case-insensitive match (the CI asserts the exact name)."""
        respx.get(_RELEASE_API).respond(
            200, json=_github_release_json(asset_name="sakadesk-1.0.0-setup.exe")
        )
        assert await get_installer_info("v1.0.0") is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_digest_none_when_absent(self):
        respx.get(_RELEASE_API).respond(200, json=_github_release_json(digest=None))
        _serve_manifest()
        result = await get_installer_info("v1.0.0")
        assert result is not None and result.digest is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_a_release_without_a_manifest_is_not_verified(self):
        respx.get(_RELEASE_API).respond(200, json=_github_release_json(manifest=False))
        with pytest.raises(UpdateNotVerified) as exc:
            await get_installer_info("v1.0.0")
        assert exc.value.reason == "manifest_missing"

    @respx.mock
    @pytest.mark.asyncio
    async def test_a_manifest_from_an_untrusted_key_is_not_verified(self):
        from structlog.testing import capture_logs

        respx.get(_RELEASE_API).respond(200, json=_github_release_json())
        _serve_manifest(signed_manifest(_INSTALLER_BYTES, "1.0.0", new_key()))
        with capture_logs() as logs, pytest.raises(UpdateNotVerified) as exc:
            await get_installer_info("v1.0.0")
        assert exc.value.reason == "unknown_key"
        (refused,) = [e for e in logs if e["event"] == "upgrade_manifest_refused"]
        assert refused["reason"] == "unknown_key"
        assert "github" not in repr(logs)

    @respx.mock
    @pytest.mark.asyncio
    async def test_an_empty_trust_store_refuses_every_update(self, monkeypatch):
        """Fail closed: with no embedded release key nothing can be verified."""
        monkeypatch.setattr(release_keys, "TRUSTED_RELEASE_KEYS", {})
        respx.get(_RELEASE_API).respond(200, json=_github_release_json())
        _serve_manifest()
        with pytest.raises(UpdateNotVerified) as exc:
            await get_installer_info("v1.0.0")
        assert exc.value.reason == "unknown_key"

    @respx.mock
    @pytest.mark.asyncio
    async def test_a_garbage_manifest_is_not_verified(self):
        respx.get(_RELEASE_API).respond(200, json=_github_release_json())
        _serve_manifest(b"not json at all")
        with pytest.raises(UpdateNotVerified) as exc:
            await get_installer_info("v1.0.0")
        assert exc.value.reason == "malformed"

    @respx.mock
    @pytest.mark.asyncio
    async def test_a_manifest_for_another_version_is_not_verified(self):
        respx.get(_RELEASE_API).respond(200, json=_github_release_json())
        _serve_manifest(signed_manifest(_INSTALLER_BYTES, "0.9.0", _KEY))
        with pytest.raises(UpdateNotVerified) as exc:
            await get_installer_info("v1.0.0")
        assert exc.value.reason == "wrong_version"

    @respx.mock
    @pytest.mark.asyncio
    async def test_an_installer_url_outside_this_release_is_refused(self):
        other = "https://github.com/someone/else/releases/download/v1.0.0/SakaDesk-1.0.0-Setup.exe"
        respx.get(_RELEASE_API).respond(200, json=_github_release_json(url=other))
        assert await get_installer_info("v1.0.0") is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_a_manifest_redirected_off_github_is_never_fetched(self):
        respx.get(_RELEASE_API).respond(200, json=_github_release_json())
        respx.get(_MANIFEST_URL).respond(
            302, headers={"Location": "https://evil.example.com/m.json"}
        )
        evil = respx.get("https://evil.example.com/m.json").respond(200, content=b"{}")
        with pytest.raises(UpdateNotVerified) as exc:
            await get_installer_info("v1.0.0")
        assert exc.value.reason == "manifest_redirect_refused"
        assert not evil.called

    @respx.mock
    @pytest.mark.asyncio
    async def test_the_manifest_request_asks_for_identity_encoding(self):
        respx.get(_RELEASE_API).respond(200, json=_github_release_json())
        route = _serve_manifest()
        await get_installer_info("v1.0.0")
        assert route.calls.last.request.headers["accept-encoding"] == "identity"

    @respx.mock
    @pytest.mark.asyncio
    async def test_a_manifest_behind_the_release_asset_redirect_is_fetched(self):
        """GitHub serves release assets through a 302 to release-assets.githubusercontent.com."""
        respx.get(_RELEASE_API).respond(200, json=_github_release_json())
        cdn = "https://release-assets.githubusercontent.com/github-production-release-asset/1/m?sig=x"
        respx.get(_MANIFEST_URL).respond(302, headers={"Location": cdn})
        hop = respx.get(cdn).respond(
            200, content=signed_manifest(_INSTALLER_BYTES, "1.0.0", _KEY)
        )
        result = await get_installer_info("v1.0.0")
        assert result is not None
        assert hop.called

    @respx.mock
    @pytest.mark.asyncio
    async def test_an_oversized_manifest_is_refused(self):
        respx.get(_RELEASE_API).respond(200, json=_github_release_json())
        _serve_manifest(b" " * (MAX_ENVELOPE_BYTES + 1))
        with pytest.raises(UpdateNotVerified) as exc:
            await get_installer_info("v1.0.0")
        assert exc.value.reason == "manifest_too_large"

    @respx.mock
    @pytest.mark.asyncio
    async def test_an_unsafe_version_never_reaches_the_network(self):
        anything = respx.route().respond(500)
        assert await get_installer_info("1.0.0/../../x") is None
        assert not anything.called


# ── download_installer ──────────────────────────────────────────────


def _make_installer_content(size: int = 256) -> bytes:
    """Generate deterministic installer content."""
    return b"MZ" + b"\x00" * (size - 2)  # PE header stub


def _make_info(
    content: bytes,
    url: str = "https://github.com/xebjhm/SakaDesk/releases/download/v1.0.0/SakaDesk-1.0.0-Setup.exe",
    with_digest: bool = True,
) -> InstallerInfo:
    """InstallerInfo as get_installer_info builds it for ``content`` (signed size and hash)."""
    sha = hashlib.sha256(content).hexdigest()
    digest = f"sha256:{sha}" if with_digest else None
    return InstallerInfo(url=url, size=len(content), digest=digest, sha256=sha)


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
        """A GitHub digest that disagrees with the signed hash is refused."""
        content = _make_installer_content()
        info = InstallerInfo(
            url="https://github.com/xebjhm/SakaDesk/releases/download/v1.0.0/SakaDesk-1.0.0-Setup.exe",
            size=len(content),
            digest="sha256:0000000000000000000000000000000000000000000000000000000000000000",
            sha256=hashlib.sha256(content).hexdigest(),
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
        # Neither an installer nor the partial .part file is left behind
        upgrade_dir = tmp_path / "upgrade"
        assert not any(upgrade_dir.glob("*.exe"))
        assert not any(upgrade_dir.glob("*.part"))

    @respx.mock
    @pytest.mark.asyncio
    async def test_missing_github_digest_is_fine_when_the_signed_hash_matches(
        self, tmp_path
    ):
        """The signed manifest's hash is authoritative; GitHub's digest is a cross-check."""
        content = _make_installer_content()
        info = _make_info(content, with_digest=False)
        respx.get(info.url).respond(
            200, content=content, headers={"content-length": str(len(content))}
        )
        with patch(
            "backend.services.upgrade_service.get_app_data_dir", return_value=tmp_path
        ):
            result = await download_installer(info)
        assert result is not None and result.read_bytes() == content

    @respx.mock
    @pytest.mark.asyncio
    async def test_signed_hash_mismatch_rejects_download(self, tmp_path):
        from structlog.testing import capture_logs

        content = _make_installer_content()
        info = InstallerInfo(
            url=_make_info(content).url, size=len(content), digest=None, sha256="0" * 64
        )
        respx.get(info.url).respond(200, content=content)
        with (
            capture_logs() as logs,
            patch(
                "backend.services.upgrade_service.get_app_data_dir",
                return_value=tmp_path,
            ),
        ):
            assert await download_installer(info) is None
        assert [
            e["reason"] for e in logs if e["event"] == "installer_download_refused"
        ] == ["hash_mismatch"]
        assert not any((tmp_path / "upgrade").glob("*.exe"))
        assert not any((tmp_path / "upgrade").glob("*.part"))

    @respx.mock
    @pytest.mark.asyncio
    async def test_a_body_longer_than_the_signed_size_stops_early(self, tmp_path):
        content = _make_installer_content(64 * 1024)
        info = _make_info(content)
        info = InstallerInfo(url=info.url, size=1024, digest=None, sha256=info.sha256)
        respx.get(info.url).respond(200, content=content)
        with (
            capture_logs() as logs,
            patch(
                "backend.services.upgrade_service.get_app_data_dir",
                return_value=tmp_path,
            ),
        ):
            assert await download_installer(info) is None
        assert [
            e["reason"] for e in logs if e["event"] == "installer_download_refused"
        ] == ["too_large"]

    @respx.mock
    @pytest.mark.asyncio
    async def test_the_installer_request_asks_for_identity_encoding(self, tmp_path):
        content = _make_installer_content(64)
        info = _make_info(content)
        installer = respx.get(info.url).respond(200, content=content)
        with patch(
            "backend.services.upgrade_service.get_app_data_dir", return_value=tmp_path
        ):
            assert await download_installer(info) is not None
        assert installer.calls.last.request.headers["accept-encoding"] == "identity"

    @respx.mock
    @pytest.mark.asyncio
    async def test_an_installer_behind_the_release_asset_redirect_downloads(
        self, tmp_path
    ):
        """GitHub serves release assets through a 302 to release-assets.githubusercontent.com."""
        content = _make_installer_content(64)
        info = _make_info(content)
        cdn = "https://release-assets.githubusercontent.com/github-production-release-asset/1/i?sig=x"
        respx.get(info.url).respond(302, headers={"Location": cdn})
        hop = respx.get(cdn).respond(200, content=content)
        with patch(
            "backend.services.upgrade_service.get_app_data_dir", return_value=tmp_path
        ):
            result = await download_installer(info)
        assert result is not None and result.read_bytes() == content
        assert hop.called

    @respx.mock
    @pytest.mark.asyncio
    async def test_an_unsigned_info_is_refused_before_the_network(self, tmp_path):
        anything = respx.route().respond(500)
        info = InstallerInfo(url=_make_info(b"MZ").url, size=2, digest=None, sha256="")
        with patch(
            "backend.services.upgrade_service.get_app_data_dir", return_value=tmp_path
        ):
            assert await download_installer(info) is None
        assert not anything.called

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
            sha256=hashlib.sha256(content).hexdigest(),
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
            sha256="0" * 64,
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
            sha256="0" * 64,
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

        assert _is_allowed_download_url("https://github.com/x/y/z.exe") is True
        assert (
            _is_allowed_download_url("https://objects.githubusercontent.com/a") is True
        )
        assert (
            _is_allowed_download_url("https://release-assets.githubusercontent.com/a")
            is True
        )
        # Hardening #61: no wildcard, no other ports, no user info, HTTPS only.
        for url in (
            "https://cdn.githubusercontent.com/a",
            "https://raw.githubusercontent.com/a",
            "https://gist.githubusercontent.com/a",
            "https://github.com:8443/x",
            "https://user@github.com/x",
            "http://github.com/x",
            "https://evil.example.com/x.exe",
            "https://github.com.evil.com/x.exe",
            "https://github.com:bad/x",
        ):
            assert _is_allowed_download_url(url) is False, url

    @respx.mock
    @pytest.mark.asyncio
    async def test_download_rejects_disallowed_url(self, tmp_path):
        """A non-GitHub info.url is refused before any network call (SEC-4)."""
        route = respx.get("https://evil.example.com/x.exe").respond(200, content=b"MZ")
        info = InstallerInfo(
            url="https://evil.example.com/x.exe",
            size=2,
            digest="sha256:" + hashlib.sha256(b"MZ").hexdigest(),
            sha256="0" * 64,
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
        """A redirect that leaves GitHub's release hosts is refused before the request is sent (hardening #61)."""
        payload = b"MZfake-installer-bytes"
        digest = "sha256:" + hashlib.sha256(payload).hexdigest()
        gh_url = (
            f"https://github.com/{GITHUB_REPO}/releases/download/v1/"
            "SakaDesk-1-Setup.exe"
        )
        respx.get(gh_url).respond(
            302, headers={"Location": "https://evil.example.com/x.exe"}
        )
        evil = respx.get("https://evil.example.com/x.exe").respond(
            200,
            content=payload,
            headers={"content-length": str(len(payload))},
        )
        info = InstallerInfo(
            url=gh_url,
            size=len(payload),
            digest=digest,
            sha256=hashlib.sha256(payload).hexdigest(),
        )
        from structlog.testing import capture_logs

        with (
            capture_logs() as logs,
            patch(
                "backend.services.upgrade_service.get_app_data_dir",
                return_value=tmp_path,
            ),
        ):
            result = await download_installer(info)
        assert result is None
        assert not evil.called  # refused before the request, not after
        (refused,) = [e for e in logs if e["event"] == "installer_download_refused"]
        assert (refused["reason"], refused["host_class"]) == ("redirect", "other")


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
            assert (
                asyncio.run(launch_installer(installer, expected_sha256=_EMPTY_SHA256))
                is True
            )
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
            assert (
                asyncio.run(launch_installer(installer, expected_sha256=_EMPTY_SHA256))
                is False
            )
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
            assert (
                asyncio.run(launch_installer(installer, expected_sha256=_EMPTY_SHA256))
                is False
            )
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
            url=_make_info(content).url,
            size=len(content),
            digest="sha256:" + "0" * 64,
            sha256=hashlib.sha256(content).hexdigest(),
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
                launch_installer(
                    installer,
                    expected_sha256=_EMPTY_SHA256,
                    attempts=attempts,
                    retry_delay=0,
                )
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


class TestReplaceFailure:
    """The rename of the verified .part file to the installer name."""

    @respx.mock
    @pytest.mark.asyncio
    async def test_locked_old_installer_returns_none_and_logs(self, tmp_path):
        from structlog.testing import capture_logs

        upgrade_dir = tmp_path / "upgrade"
        upgrade_dir.mkdir()
        existing = upgrade_dir / "SakaDesk-1.0.0-Setup.exe"
        existing.write_bytes(b"MZ-earlier")
        content = _make_installer_content()
        info = _make_info(content)
        respx.get(info.url).respond(200, content=content)
        denied = PermissionError("denied")
        denied.winerror = 5  # type: ignore[attr-defined]
        with (
            capture_logs() as logs,
            patch(
                "backend.services.upgrade_service.get_app_data_dir",
                return_value=tmp_path,
            ),
            patch("backend.services.upgrade_service.os.replace", side_effect=denied),
        ):
            assert await download_installer(info) is None
        assert existing.read_bytes() == b"MZ-earlier"
        assert list(upgrade_dir.glob("*.part")) == []
        (failed,) = [e for e in logs if e["event"] == "installer_replace_failed"]
        assert failed["winerror"] == 5

    @respx.mock
    @pytest.mark.asyncio
    async def test_sharing_violation_on_replace_is_retried(self, tmp_path):
        import os as _os

        content = _make_installer_content()
        info = _make_info(content)
        respx.get(info.url).respond(200, content=content)
        real_replace = _os.replace
        calls: list[int] = []

        def flaky(src, dst):
            calls.append(1)
            if len(calls) == 1:
                raise _sharing_violation()
            return real_replace(src, dst)

        with (
            patch(
                "backend.services.upgrade_service.get_app_data_dir",
                return_value=tmp_path,
            ),
            patch("backend.services.upgrade_service.os.replace", side_effect=flaky),
            patch("backend.services.upgrade_service.LAUNCH_RETRY_DELAY_SECONDS", 0),
        ):
            result = await download_installer(info)
        assert result is not None and result.read_bytes() == content
        assert len(calls) == 2


class TestLaunchLogsDirFailure:
    def test_logs_dir_error_returns_false(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.touch()
        with (
            patch("backend.services.upgrade_service.is_windows", return_value=True),
            patch(
                "backend.services.upgrade_service.get_logs_dir",
                side_effect=OSError("offline share"),
            ),
        ):
            assert (
                asyncio.run(launch_installer(installer, expected_sha256=_EMPTY_SHA256))
                is False
            )


@contextlib.contextmanager
def _plain_held(path):
    with open(path, "rb") as stream:
        yield stream


class TestLaunchReverifies:
    """Hardening #62: the installer is hashed again right before it is started."""

    def _patches(self, tmp_path):
        return (
            patch("backend.services.upgrade_service.is_windows", return_value=True),
            patch(
                "backend.services.upgrade_service.get_logs_dir", return_value=tmp_path
            ),
            patch("backend.services.upgrade_service.subprocess"),
        )

    def test_an_installer_changed_after_download_is_not_started(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.write_bytes(b"MZ-signed")
        signed = hashlib.sha256(b"MZ-signed").hexdigest()
        installer.write_bytes(b"MZ-swapped")
        win, logs_dir, sub = self._patches(tmp_path)
        with capture_logs() as logs, win, logs_dir, sub as mock_subprocess:
            with pytest.raises(UpdateNotVerified) as exc:
                asyncio.run(launch_installer(installer, expected_sha256=signed))
        assert exc.value.reason == "hash_mismatch"
        mock_subprocess.Popen.assert_not_called()
        assert [
            e["reason"] for e in logs if e["event"] == "installer_launch_refused"
        ] == ["hash_mismatch"]

    def test_setup_starts_while_the_checked_handle_is_held(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.write_bytes(b"MZ-signed")
        order: list[str] = []
        real = upgrade_service._held_for_launch

        @contextlib.contextmanager
        def recording(path):
            with real(path) as stream:
                order.append("held")
                yield stream
                # The digest came from this very stream, not from a re-open.
                assert stream.tell() == len(b"MZ-signed")
                order.append("released")

        win, logs_dir, sub = self._patches(tmp_path)
        with (
            win,
            logs_dir,
            sub as mock_subprocess,
            patch.object(upgrade_service, "_held_for_launch", recording),
        ):
            mock_subprocess.Popen.side_effect = lambda *a, **k: order.append("started")
            ok = asyncio.run(
                launch_installer(
                    installer, expected_sha256=hashlib.sha256(b"MZ-signed").hexdigest()
                )
            )
        assert ok is True
        assert order == ["held", "started", "released"]

    def test_handle_is_released_when_the_hash_does_not_match(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.write_bytes(b"MZ")
        seen = []
        real = upgrade_service._held_for_launch

        @contextlib.contextmanager
        def recording(path):
            with real(path) as stream:
                seen.append(stream)
                yield stream

        win, logs_dir, sub = self._patches(tmp_path)
        with (
            win,
            logs_dir,
            sub,
            patch.object(upgrade_service, "_held_for_launch", recording),
        ):
            with pytest.raises(UpdateNotVerified):
                asyncio.run(launch_installer(installer, expected_sha256=_EMPTY_SHA256))
        assert seen[0].closed

    def test_setup_inherits_only_the_held_handle(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.write_bytes(b"MZ-signed")
        fake_msvcrt = MagicMock()
        fake_msvcrt.get_osfhandle.return_value = 4242
        fake_sys = MagicMock(platform="win32")
        win, logs_dir, sub = self._patches(tmp_path)
        with (
            win,
            logs_dir,
            sub as mock_subprocess,
            patch.object(upgrade_service, "sys", fake_sys),
            patch.dict(sys.modules, {"msvcrt": fake_msvcrt}),
            patch.object(os, "set_handle_inheritable", create=True) as inheritable,
            patch.object(upgrade_service, "_held_for_launch", _plain_held),
        ):
            ok = asyncio.run(
                launch_installer(
                    installer, expected_sha256=hashlib.sha256(b"MZ-signed").hexdigest()
                )
            )
        assert ok is True
        inheritable.assert_called_once_with(4242, True)
        mock_subprocess.STARTUPINFO.assert_called_once_with(
            lpAttributeList={"handle_list": [4242]}
        )
        kwargs = mock_subprocess.Popen.call_args.kwargs
        assert kwargs["startupinfo"] is mock_subprocess.STARTUPINFO.return_value
        assert kwargs["close_fds"] is True

    def test_no_startupinfo_off_windows(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.write_bytes(b"MZ-signed")
        win, logs_dir, sub = self._patches(tmp_path)
        with win, logs_dir, sub as mock_subprocess:
            asyncio.run(
                launch_installer(
                    installer, expected_sha256=hashlib.sha256(b"MZ-signed").hexdigest()
                )
            )
        assert "startupinfo" not in mock_subprocess.Popen.call_args.kwargs

    @pytest.mark.skipif(sys.platform != "win32", reason="Windows share modes")
    def test_windows_refuses_writers_while_held(self, tmp_path):
        installer = tmp_path / "SakaDesk-1.0.0-Setup.exe"
        installer.write_bytes(b"MZ")
        decoy = tmp_path / "decoy.exe"
        decoy.write_bytes(b"EVIL")
        parent = tmp_path / "dir"
        parent.mkdir()
        inner = parent / "SakaDesk-1.0.0-Setup.exe"
        inner.write_bytes(b"MZ")
        with upgrade_service._held_for_launch(installer) as stream:
            assert stream.read() == b"MZ"
            with pytest.raises(PermissionError):
                open(installer, "ab").close()
            with pytest.raises(PermissionError):
                os.replace(decoy, installer)
            with pytest.raises(PermissionError):
                os.remove(installer)
            open(installer, "rb").close()  # readers are fine
        with upgrade_service._held_for_launch(inner):
            with pytest.raises(PermissionError):
                parent.rename(tmp_path / "dir2")
        open(installer, "ab").close()  # writable again once released
