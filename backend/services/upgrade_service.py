"""
In-place Upgrade Service for SakaDesk.

Handles downloading new versions and triggering the upgrade process on Windows.
The upgrade flow:
1. Download new installer to a private ``.part`` file in the upgrade directory
2. Verify size + SHA-256 digest against the GitHub release asset, then rename
   the ``.part`` file to the installer name
3. Launch installer (retrying while Windows reports the file in use) with /SILENT /SUPPRESSMSGBOXES /NORESTART /LOG=<logs>/installer.log,
   then the app exits; Setup waits for it to exit, installs, and relaunches it
"""

import asyncio
import hashlib
import os
import uuid

import structlog
import subprocess
from pathlib import Path
from typing import Optional, cast
from urllib.parse import urlparse
from dataclasses import dataclass

import httpx

from backend.services.platform import is_windows, get_app_data_dir, get_logs_dir

logger = structlog.get_logger(__name__)

# GitHub release asset pattern
GITHUB_REPO = "xebjhm/SakaDesk"

# Maximum installer size (500 MB) — abort download if exceeded
MAX_INSTALLER_SIZE = 500 * 1024 * 1024

# Windows ERROR_SHARING_VIOLATION: the file is open in another process (or in
# a handle of ours that has not closed yet). Launching retries on it.
_ERROR_SHARING_VIOLATION = 32
LAUNCH_ATTEMPTS = 5
LAUNCH_RETRY_DELAY_SECONDS = 1.0

# The installer URL comes from the GitHub release JSON; only fetch over HTTPS
# from GitHub-controlled hosts so a tampered/redirected URL can't point the
# download at an arbitrary origin (SEC-4).
_ALLOWED_DOWNLOAD_HOSTS = {
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
}


def _is_allowed_download_url(url: str) -> bool:
    """Return True if ``url`` is HTTPS on an allowlisted GitHub host."""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        return False
    host = parsed.hostname or ""
    return host in _ALLOWED_DOWNLOAD_HOSTS or host.endswith(".githubusercontent.com")


@dataclass
class InstallerInfo:
    """Metadata for a downloadable installer asset."""

    url: str
    size: int
    digest: Optional[str]  # "sha256:<hex>" from GitHub, or None


def _installer_asset_name(version: str) -> str:
    """Build expected installer filename for a given version.

    Matches Inno Setup OutputBaseFilename: SakaDesk-{version}-Setup
    """
    bare = version.lstrip("v")
    return f"SakaDesk-{bare}-Setup.exe"


async def get_installer_info(version: str) -> Optional[InstallerInfo]:
    """
    Get installer download info for a specific version.

    Args:
        version: Version tag (e.g., "v0.2.0" or "0.2.0")

    Returns:
        InstallerInfo with URL, expected size, and SHA-256 digest, or None
    """
    expected_name = _installer_asset_name(version)

    # Ensure version has 'v' prefix for GitHub tag
    tag = version if version.startswith("v") else f"v{version}"

    api_url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/{tag}"

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
                logger.error(f"Failed to fetch release info: {response.status_code}")
                return None

            data = response.json()
            assets = data.get("assets", [])

            # Find the installer asset (case-insensitive for robustness)
            for asset in assets:
                name = asset.get("name", "")
                if name == expected_name or name.lower() == expected_name.lower():
                    url = asset.get("browser_download_url")
                    if not url:
                        continue
                    return InstallerInfo(
                        url=url,
                        size=asset.get("size", 0),
                        digest=asset.get("digest"),
                    )

            logger.error(f"Installer asset '{expected_name}' not found in release")
            return None

    except (httpx.HTTPError, httpx.TimeoutException, KeyError, ValueError) as e:
        logger.error("Error fetching installer info", error=str(e), version=version)
        return None


async def download_installer(
    info: InstallerInfo, progress_callback=None
) -> Optional[Path]:
    """
    Download the installer and verify its integrity.

    Args:
        info: InstallerInfo with URL, expected size, and SHA-256 digest
        progress_callback: Optional callback(downloaded_bytes, total_bytes)

    Returns:
        Path to verified installer, or None on failure
    """
    # SEC-4: reject non-HTTPS / non-GitHub URLs before touching the network.
    if not _is_allowed_download_url(info.url):
        logger.error("Refusing installer download from disallowed URL", url=info.url)
        return None

    # Create upgrade directory in app data (survives reboot better than system temp)
    upgrade_dir = cast(Path, get_app_data_dir() / "upgrade")
    upgrade_dir.mkdir(parents=True, exist_ok=True)

    # Extract and sanitize filename — use only the basename to prevent path traversal
    raw_name = info.url.rsplit("/", 1)[-1] if "/" in info.url else "SakaDesk-Setup.exe"
    filename = Path(raw_name).name  # strips any directory components including ..
    if not filename.lower().endswith(".exe") or ".." in filename:
        logger.error(f"Suspicious installer filename from URL: {raw_name!r}")
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
    """Stream ``info.url`` into ``part_path``, verify it, rename to ``installer_path``."""
    try:
        sha256 = hashlib.sha256()

        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            async with client.stream("GET", info.url) as response:
                if response.status_code != 200:
                    logger.error(f"Download failed with status: {response.status_code}")
                    return None

                # SEC-4: redirects are followed, so re-validate the URL we
                # actually landed on before reading any bytes — a redirect off
                # GitHub must be rejected.
                if not _is_allowed_download_url(str(response.url)):
                    logger.error(
                        "Installer download redirected to disallowed URL",
                        final_url=str(response.url),
                    )
                    return None

                total = int(response.headers.get("content-length", 0))
                downloaded = 0

                with open(part_path, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        f.write(chunk)
                        sha256.update(chunk)
                        downloaded += len(chunk)
                        if downloaded > MAX_INSTALLER_SIZE:
                            logger.error(
                                f"Download exceeded {MAX_INSTALLER_SIZE} bytes — aborting"
                            )
                            return None
                        if progress_callback:
                            progress_callback(downloaded, total)

        # Verify size matches content-length
        if total > 0 and downloaded != total:
            logger.error(f"Download incomplete: {downloaded}/{total} bytes")
            return None

        # Verify size matches GitHub asset size
        if info.size > 0 and downloaded != info.size:
            logger.error(f"Size mismatch: got {downloaded}, expected {info.size} bytes")
            return None

        # Verify SHA-256 against GitHub asset digest (mandatory)
        if not info.digest:
            logger.error(
                "No SHA-256 digest from GitHub — refusing unverified installer"
            )
            return None

        expected_hex = info.digest.removeprefix("sha256:")
        actual_hex = sha256.hexdigest()
        if actual_hex != expected_hex:
            logger.error(
                "SHA-256 mismatch",
                expected=expected_hex[:16] + "...",
                actual=actual_hex[:16] + "...",
            )
            return None

        logger.info("SHA-256 verified OK")
        if not await _replace_with_retry(part_path, installer_path):
            return None
        # File name only: the full path holds the Windows account name.
        logger.info("Installer downloaded", file_name=installer_path.name)
        return installer_path

    except (httpx.HTTPError, httpx.StreamError, OSError) as e:
        # Error type only: an OSError message carries the (user) file path.
        logger.error(
            "Error downloading installer", error_type=type(e).__name__, url=info.url
        )
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


async def launch_installer(
    installer_path: Path,
    *,
    attempts: int = LAUNCH_ATTEMPTS,
    retry_delay: float = LAUNCH_RETRY_DELAY_SECONDS,
) -> bool:
    """
    Launch the Inno Setup installer directly and prepare for app exit.

    The caller (``/upgrade/install``) exits the app right after this returns.
    Inno Setup handles the rest:
    - PrepareToInstall → waits for the app's instance mutex to clear before
      replacing files
    - /SILENT → shows a small progress dialog (not invisible like /VERYSILENT)
    - /LOG → writes ``installer.log`` to the app's logs directory (overwritten
      on each upgrade), so a failed upgrade leaves evidence behind
    - [Run] section → relaunches SakaDesk.exe after install

    When Windows reports the installer in use (sharing violation, e.g. an
    antivirus scan of the fresh file), the launch is tried up to ``attempts``
    times in total, ``retry_delay`` seconds apart. Other errors fail at once.

    Args:
        installer_path: Path to the downloaded installer
        attempts: Maximum launch attempts on a sharing violation
        retry_delay: Seconds to wait between attempts

    Returns:
        True if installer was launched successfully
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
            )
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
