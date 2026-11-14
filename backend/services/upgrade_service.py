"""
In-place Upgrade Service for SakaDesk.

Handles downloading new versions and triggering the upgrade process on Windows.
The upgrade flow:
1. Look up the release and download its signed manifest
   (``SakaDesk-<version>-manifest.json``); it must be signed by a release key
   the app trusts and name exactly this version's installer
   (:mod:`backend.services.release_signing`), else :class:`UpdateNotVerified`
2. Download the installer from its pinned release URL into a private ``.part``
   file, every request (redirects included) over HTTPS on GitHub's release
   hosts; check its size and SHA-256 against the signed manifest (and
   GitHub's digest when present), then rename it to the installer name
3. Right before launch, hash the installer again through a handle that keeps
   writers, renames and deletes out, and start it with that handle inherited
   so it stays open until Setup's loader exits (retrying while Windows
   reports the file in use) with /SILENT /SUPPRESSMSGBOXES /NORESTART
   /LOG=<logs>/installer.log; the app then exits, Setup waits for it to exit,
   installs, and relaunches it
"""

import asyncio
import contextlib
import hashlib
import os
import sys
import uuid

import structlog
import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO, Optional, cast
from urllib.parse import urlparse
from dataclasses import dataclass

import httpx

from backend.services.platform import is_windows, get_app_data_dir, get_logs_dir
from backend.services import release_signing

logger = structlog.get_logger(__name__)

# GitHub release asset pattern
GITHUB_REPO = "xebjhm/SakaDesk"

# Maximum installer size (500 MB) — abort download if exceeded
MAX_INSTALLER_SIZE = release_signing.MAX_INSTALLER_BYTES

# Windows ERROR_SHARING_VIOLATION: the file is open in another process (or in
# a handle of ours that has not closed yet). Launching retries on it.
_ERROR_SHARING_VIOLATION = 32
LAUNCH_ATTEMPTS = 5
LAUNCH_RETRY_DELAY_SECONDS = 1.0

# Every updater request, redirects included, must stay on these hosts over
# HTTPS on the default port (SEC-4; hardening #61). No wildcard: a
# *.githubusercontent.com rule also admitted raw, gist and user-content hosts.
_ALLOWED_DOWNLOAD_HOSTS = frozenset(
    {
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    }
)
MAX_REDIRECTS = 5


class UpdateNotVerified(Exception):
    """The release has no manifest the app can trust, or the installer changed.

    ``reason`` is a log code. While looking the release up: ``manifest_missing``,
    ``manifest_too_large``, ``manifest_redirect_refused`` or a
    ``release_signing.ManifestRefused`` reason (the manifest is not signed by a
    trusted key for exactly this version's installer). Right before launch:
    ``hash_mismatch`` (the installer on disk is not the signed file).
    """

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class _HopRefused(Exception):
    """An updater request left the allowed hosts; ``host_class`` is a log code."""

    def __init__(self, host_class: str) -> None:
        super().__init__(host_class)
        self.host_class = host_class


def _is_allowed_download_url(url: str) -> bool:
    """True for ``https://<allowed host>/...`` on the default port, without user info."""
    try:
        parsed = urlparse(url)
        port = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and (parsed.hostname or "") in _ALLOWED_DOWNLOAD_HOSTS
        and port in (None, 443)
        and parsed.username is None
        and parsed.password is None
    )


def _host_class(url: str) -> str:
    """A log code for where ``url`` points; never the host itself."""
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return "unparsable"
    if host in _ALLOWED_DOWNLOAD_HOSTS:
        return "release_host"  # refused for its scheme, port or user info
    if host.endswith(".github.com") or host.endswith(".githubusercontent.com"):
        return "github_other"
    return "other"


async def _check_hop(request: httpx.Request) -> None:
    """httpx request hook: refuse any request, redirects included, off the allowed URLs."""
    url = str(request.url)
    if not _is_allowed_download_url(url):
        raise _HopRefused(_host_class(url))


def _download_client(timeout: float) -> httpx.AsyncClient:
    """An httpx client whose every request is checked by :func:`_check_hop`."""
    return httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        max_redirects=MAX_REDIRECTS,
        event_hooks={"request": [_check_hop]},
        # The signed size and SHA-256 are of the raw bytes: never let a
        # transparent content decoding change what is checked.
        headers={"User-Agent": "SakaDesk-Updater", "Accept-Encoding": "identity"},
    )


def release_asset_url(version: str, name: str) -> str:
    """The only URL the updater accepts for release asset ``name`` of ``version``."""
    return f"https://github.com/{GITHUB_REPO}/releases/download/v{version}/{name}"


@dataclass
class InstallerInfo:
    """A downloadable installer that a signed manifest vouches for.

    ``size`` and ``sha256`` come from the signed manifest; ``digest`` is
    GitHub's ``"sha256:<hex>"`` for the asset (a cross-check, may be None).
    """

    url: str
    size: int
    digest: Optional[str]
    sha256: str


def _installer_asset_name(version: str) -> str:
    """Build expected installer filename for a given version.

    Matches Inno Setup OutputBaseFilename: SakaDesk-{version}-Setup
    """
    bare = version[1:] if version.startswith("v") else version
    return release_signing.installer_asset_name(bare)


def _find_asset(assets: list, name: str, expected_url: str) -> Optional[dict]:
    """The asset named exactly ``name`` whose download URL is exactly ``expected_url``."""
    for asset in assets:
        if isinstance(asset, dict) and asset.get("name") == name:
            if asset.get("browser_download_url") == expected_url:
                return asset
            logger.warning("upgrade_asset_refused", reason="url_mismatch")
            return None
    return None


async def _fetch_small(url: str, limit: int) -> Optional[bytes]:
    """GET ``url`` (every hop checked) and return its body if at most ``limit`` bytes.

    Returns None on a non-200 status or a network error (worth retrying).

    Raises:
        UpdateNotVerified: the body is larger than ``limit``
            (``manifest_too_large``) or a hop left the allowed hosts
            (``manifest_redirect_refused``); both are logged first.
    """
    try:
        async with _download_client(30.0) as client:
            async with client.stream("GET", url) as response:
                if response.status_code != 200:
                    logger.error(
                        "upgrade_manifest_download_failed", status=response.status_code
                    )
                    return None
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > limit:
                        logger.error(
                            "upgrade_manifest_download_failed", reason="too_large"
                        )
                        raise UpdateNotVerified("manifest_too_large")
                return bytes(body)
    except _HopRefused as e:
        logger.error(
            "upgrade_manifest_download_failed",
            reason="redirect",
            host_class=e.host_class,
        )
        raise UpdateNotVerified("manifest_redirect_refused") from None
    except (httpx.HTTPError, httpx.StreamError) as e:
        logger.error("upgrade_manifest_download_failed", error_type=type(e).__name__)
    return None


async def get_installer_info(version: str) -> Optional[InstallerInfo]:
    """
    Get the installer for ``version`` ("v0.2.0" or "0.2.0"), vouched for by its signed manifest.

    Returns:
        InstallerInfo with the pinned URL, the signed size and SHA-256 and
        GitHub's digest; None when the version is not a plain release
        version, the release or its installer cannot be found, or the
        manifest cannot be downloaded because of a network failure or a
        non-200 status (worth retrying later).

    Raises:
        UpdateNotVerified: the release has no manifest, the manifest is too
            large or its download was redirected off the allowed hosts, or the
            manifest is not signed by a trusted key for exactly this version's
            installer.
    """
    bare = version[1:] if version.startswith("v") else version
    if not release_signing.is_valid_version(bare):
        logger.warning("upgrade_release_refused", reason="version_invalid")
        return None
    installer_name = release_signing.installer_asset_name(bare)
    manifest_name = release_signing.manifest_asset_name(bare)
    api_url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/v{bare}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                api_url,
                headers={
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "SakaDesk-Updater",
                },
            )
        if response.status_code != 200:
            logger.error("upgrade_release_lookup_failed", status=response.status_code)
            return None
        data = response.json()
    except (httpx.HTTPError, ValueError) as e:
        logger.error("upgrade_release_lookup_failed", error_type=type(e).__name__)
        return None

    assets = data.get("assets") if isinstance(data, dict) else None
    if not isinstance(assets, list):
        logger.error("upgrade_release_lookup_failed", reason="no_assets")
        return None
    installer = _find_asset(
        assets, installer_name, release_asset_url(bare, installer_name)
    )
    if installer is None:
        logger.error("upgrade_release_lookup_failed", reason="installer_missing")
        return None
    if (
        _find_asset(assets, manifest_name, release_asset_url(bare, manifest_name))
        is None
    ):
        logger.warning("upgrade_manifest_refused", reason="manifest_missing")
        raise UpdateNotVerified("manifest_missing")

    envelope = await _fetch_small(
        release_asset_url(bare, manifest_name), release_signing.MAX_ENVELOPE_BYTES
    )
    if envelope is None:
        return None
    try:
        manifest = release_signing.verify_update_manifest(envelope, version=bare)
    except release_signing.ManifestRefused as e:
        logger.warning("upgrade_manifest_refused", reason=e.reason)
        raise UpdateNotVerified(e.reason) from None

    digest = installer.get("digest")
    logger.info("upgrade_manifest_verified", size=manifest.size)
    return InstallerInfo(
        url=release_asset_url(bare, installer_name),
        size=manifest.size,
        digest=digest if isinstance(digest, str) else None,
        sha256=manifest.sha256,
    )


async def download_installer(
    info: InstallerInfo, progress_callback=None
) -> Optional[Path]:
    """
    Download the installer and check it against the signed manifest.

    Args:
        info: InstallerInfo from get_installer_info (signed size and SHA-256)
        progress_callback: Optional callback(downloaded_bytes, total_bytes)

    Returns:
        Path to the checked installer, or None on failure (each failure is
        logged as ``installer_download_refused`` / ``installer_download_failed``
        with a reason code, or ``Error downloading installer`` with the error type)
    """
    if not _is_allowed_download_url(info.url):
        logger.error(
            "installer_download_refused", reason="url", host_class=_host_class(info.url)
        )
        return None
    if not release_signing.is_sha256_hex(info.sha256) or info.size <= 0:
        logger.error("installer_download_refused", reason="no_signed_hash")
        return None

    # Create upgrade directory in app data (survives reboot better than system temp)
    upgrade_dir = cast(Path, get_app_data_dir() / "upgrade")
    upgrade_dir.mkdir(parents=True, exist_ok=True)

    # Use only the URL's basename (the URL itself is pinned by get_installer_info).
    raw_name = info.url.rsplit("/", 1)[-1]
    filename = Path(raw_name).name
    if not filename.lower().endswith(".exe") or ".." in filename:
        logger.error("installer_download_refused", reason="filename")
        return None
    installer_path = upgrade_dir / filename
    # Each download writes its own .part file, so two downloads can never
    # write the same file; only a fully verified download is renamed to the
    # installer name. The finally block removes the .part file on every
    # failure path, including cancellation.
    part_path = upgrade_dir / f"{filename}.{uuid.uuid4().hex[:8]}.part"

    try:
        return await _download_to(info, part_path, installer_path, progress_callback)
    finally:
        try:
            part_path.unlink(missing_ok=True)
        except OSError as e:
            logger.warning("installer_part_cleanup_failed", error_type=type(e).__name__)


async def _download_to(
    info: InstallerInfo, part_path: Path, installer_path: Path, progress_callback
) -> Optional[Path]:
    """Stream ``info.url`` into ``part_path``, check it, rename it to ``installer_path``."""
    try:
        sha256 = hashlib.sha256()

        async with _download_client(300.0) as client:
            async with client.stream("GET", info.url) as response:
                if response.status_code != 200:
                    logger.error(
                        "installer_download_failed", status=response.status_code
                    )
                    return None

                total = int(response.headers.get("content-length", 0))
                downloaded = 0

                with open(part_path, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        f.write(chunk)
                        sha256.update(chunk)
                        downloaded += len(chunk)
                        if downloaded > MAX_INSTALLER_SIZE or downloaded > info.size:
                            logger.error(
                                "installer_download_refused", reason="too_large"
                            )
                            return None
                        if progress_callback:
                            progress_callback(downloaded, total)

        if total > 0 and downloaded != total:
            logger.error("installer_download_failed", reason="incomplete")
            return None

        if downloaded != info.size:
            logger.error("installer_download_refused", reason="size_mismatch")
            return None

        actual_hex = sha256.hexdigest()
        if actual_hex != info.sha256:
            logger.error("installer_download_refused", reason="hash_mismatch")
            return None

        if info.digest is None:
            logger.info("installer_github_digest_absent")
        elif info.digest != f"sha256:{actual_hex}":
            logger.error("installer_download_refused", reason="github_digest_mismatch")
            return None

        logger.info("installer_verified", size=downloaded)
        if not await _replace_with_retry(part_path, installer_path):
            return None
        # File name only: the full path holds the Windows account name.
        logger.info("Installer downloaded", file_name=installer_path.name)
        return installer_path

    except _HopRefused as e:
        logger.error(
            "installer_download_refused", reason="redirect", host_class=e.host_class
        )
        return None
    except (httpx.HTTPError, httpx.StreamError, OSError, ValueError) as e:
        # Error type only: an OSError message carries the (user) file path.
        logger.error("Error downloading installer", error_type=type(e).__name__)
        # The caller's finally removes the partial .part file.
        return None


async def _replace_with_retry(part_path: Path, installer_path: Path) -> bool:
    """Rename the verified ``.part`` file to the installer name.

    ``os.replace`` is atomic on the same volume and replaces an installer left
    by an earlier attempt. If that old file is still open (sharing violation,
    e.g. an antivirus scan), the rename is tried up to ``LAUNCH_ATTEMPTS`` times
    in total, ``LAUNCH_RETRY_DELAY_SECONDS`` apart. Returns False on failure.
    """
    for attempt in range(1, LAUNCH_ATTEMPTS + 1):
        try:
            os.replace(part_path, installer_path)
            return True
        except OSError as e:
            winerror = getattr(e, "winerror", None)
            if winerror == _ERROR_SHARING_VIOLATION and attempt < LAUNCH_ATTEMPTS:
                logger.warning(
                    "installer_replace_retry", attempt=attempt, reason="file_in_use"
                )
                await asyncio.sleep(LAUNCH_RETRY_DELAY_SECONDS)
                continue
            # Error type and code only: the message carries the user path.
            logger.error(
                "installer_replace_failed",
                error_type=type(e).__name__,
                winerror=winerror,
                attempt=attempt,
            )
            return False
    return False  # pragma: no cover - the loop always returns


# CreateFile arguments for _held_for_launch (winnt.h / fileapi.h values).
_GENERIC_READ = 0x80000000
_FILE_SHARE_READ = 0x00000001
_OPEN_EXISTING = 3


@contextlib.contextmanager
def _held_for_launch(path: Path) -> Iterator[BinaryIO]:
    """``path`` open for reading; on Windows nobody can change it while a handle is open.

    The Windows handle shares read access only: writers, renames and deletes
    fail with a sharing violation, while starting the installer (which opens
    it for reading and executing) still works. A child that inherits the handle
    keeps it open past the block. Elsewhere a plain read handle.
    """
    if sys.platform == "win32":
        import _winapi
        import msvcrt

        handle = _winapi.CreateFile(
            str(path),
            _GENERIC_READ,
            _FILE_SHARE_READ,
            _winapi.NULL,
            _OPEN_EXISTING,
            0,
            _winapi.NULL,
        )
        try:
            fd = msvcrt.open_osfhandle(handle, os.O_RDONLY)
        except OSError:
            _winapi.CloseHandle(handle)
            raise
        stream: BinaryIO = os.fdopen(fd, "rb")
    else:
        stream = open(path, "rb")
    with stream:
        yield stream


def _verify_and_start(
    installer_path: Path, expected_sha256: str, log_path: Path
) -> None:
    """Hash the installer under a held handle and start it, handing Setup that handle.

    The handle is inherited by the new process (the only handle it inherits),
    so it stays open, read-only with writers, renames and deletes refused,
    until Setup's loader exits: the loader re-opens its own exe by path and
    runs ``setup.tmp``, which reads the setup header and data from that path
    again. Our copy closes when this function returns.

    Raises UpdateNotVerified("hash_mismatch") (nothing started) or OSError.
    """
    with _held_for_launch(installer_path) as stream:
        actual, _size = release_signing.stream_digest(stream)
        if actual != expected_sha256:
            raise UpdateNotVerified("hash_mismatch")
        extra: dict = {}
        if sys.platform == "win32":
            import msvcrt

            handle = msvcrt.get_osfhandle(stream.fileno())
            os.set_handle_inheritable(handle, True)
            extra["startupinfo"] = subprocess.STARTUPINFO(
                lpAttributeList={"handle_list": [handle]}
            )
        subprocess.Popen(
            [
                str(installer_path),
                "/SILENT",
                "/SUPPRESSMSGBOXES",
                "/NORESTART",
                f"/LOG={log_path}",
            ],
            creationflags=subprocess.DETACHED_PROCESS  # type: ignore[attr-defined]
            | subprocess.CREATE_NEW_PROCESS_GROUP,  # type: ignore[attr-defined]
            close_fds=True,
            **extra,
        )


async def launch_installer(
    installer_path: Path,
    *,
    expected_sha256: str,
    attempts: int = LAUNCH_ATTEMPTS,
    retry_delay: float = LAUNCH_RETRY_DELAY_SECONDS,
) -> bool:
    """
    Check the installer once more and launch it, then prepare for app exit.

    The installer is hashed through :func:`_held_for_launch`, and Setup is
    started with that very handle inherited (and no other), so on Windows the
    file stays read-only and cannot be written, renamed or deleted until
    Setup's loader exits, covering the loader's own re-open by path and
    ``setup.tmp``'s reads of the setup data (hardening #62). The handle pins
    the file, not the path: a directory junction planted earlier on a parent
    folder could still be repointed before the process starts (same-user
    attacker; not addressed).

    The caller (``/upgrade/install``) exits the app right after this returns.
    Inno Setup handles the rest:
    - PrepareToInstall → waits for the app's instance mutex to clear before
      replacing files
    - /SILENT → shows a small progress dialog (not invisible like /VERYSILENT)
    - /LOG → writes ``installer.log`` to the app's logs directory (overwritten
      on each upgrade), so a failed upgrade leaves evidence behind
    - [Run] section → relaunches SakaDesk.exe after install

    When Windows reports the installer in use (sharing violation, e.g. an
    antivirus scan of the fresh file), the attempt is repeated up to
    ``attempts`` times in total, ``retry_delay`` seconds apart. Other errors
    fail at once.

    Args:
        installer_path: Path to the downloaded installer
        expected_sha256: The signed SHA-256 (hex) the installer must have
        attempts: Maximum launch attempts on a sharing violation
        retry_delay: Seconds to wait between attempts

    Returns:
        True if installer was launched successfully

    Raises:
        UpdateNotVerified: the installer is not the signed file (``hash_mismatch``);
            nothing was started.
    """
    if not is_windows():
        logger.error("In-place upgrade only supported on Windows")
        return False

    if not installer_path.exists():
        logger.error("Installer not found", file_name=installer_path.name)
        return False

    try:
        log_path = get_logs_dir() / "installer.log"
    except OSError as e:
        logger.error(
            "Failed to launch installer", error_type=type(e).__name__, step="logs_dir"
        )
        return False
    for attempt in range(1, attempts + 1):
        try:
            await asyncio.to_thread(
                _verify_and_start, installer_path, expected_sha256, log_path
            )
        except UpdateNotVerified:
            logger.error("installer_launch_refused", reason="hash_mismatch")
            raise
        except OSError as e:
            in_use = getattr(e, "winerror", None) == _ERROR_SHARING_VIOLATION
            if in_use and attempt < attempts:
                logger.warning(
                    "installer_launch_retry",
                    attempt=attempt,
                    attempts=attempts,
                    reason="file_in_use",
                )
                await asyncio.sleep(retry_delay)
                continue
            logger.error(
                "Failed to launch installer",
                error_type=type(e).__name__,
                winerror=getattr(e, "winerror", None),
                attempt=attempt,
            )
            return False
        except Exception as e:
            logger.error(
                "Failed to launch installer",
                error_type=type(e).__name__,
                attempt=attempt,
            )
            return False

        # File name only: the logs dir path holds the Windows account name.
        logger.info(
            "Installer launched successfully", log_file=log_path.name, attempt=attempt
        )
        return True
    return False  # pragma: no cover - the loop always returns


def cleanup_upgrade_files():
    """Clean up any leftover upgrade files from a previous upgrade attempt."""
    upgrade_dir = get_app_data_dir() / "upgrade"
    if upgrade_dir.exists():
        try:
            import shutil

            shutil.rmtree(upgrade_dir)
            logger.info("Cleaned up upgrade directory")
        except Exception as e:
            logger.warning(
                "Failed to clean up upgrade directory", error_type=type(e).__name__
            )


def is_upgrade_supported() -> bool:
    """Check if in-place upgrade is supported on this platform."""
    return cast(bool, is_windows())
