"""
In-place Upgrade Service for SakaDesk.

Handles downloading new versions and triggering the upgrade process on Windows.
The upgrade flow:
1. Download new installer to upgrade directory
2. Verify SHA-256 digest against GitHub release asset
3. Launch installer directly with /SILENT flag (Inno Setup handles close + relaunch)
"""

import hashlib
import structlog
import subprocess
from pathlib import Path
from typing import Optional, cast
from dataclasses import dataclass

import httpx

from backend.services.platform import is_windows, get_app_data_dir

logger = structlog.get_logger(__name__)

# GitHub release asset pattern
GITHUB_REPO = "xebjhm/SakaDesk"

# Maximum installer size (500 MB) — abort download if exceeded
MAX_INSTALLER_SIZE = 500 * 1024 * 1024


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

    except Exception as e:
        logger.error(f"Error fetching installer info: {e}")
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

    try:
        sha256 = hashlib.sha256()

        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            async with client.stream("GET", info.url) as response:
                if response.status_code != 200:
                    logger.error(f"Download failed with status: {response.status_code}")
                    return None

                total = int(response.headers.get("content-length", 0))
                downloaded = 0

                with open(installer_path, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        f.write(chunk)
                        sha256.update(chunk)
                        downloaded += len(chunk)
                        if downloaded > MAX_INSTALLER_SIZE:
                            logger.error(
                                f"Download exceeded {MAX_INSTALLER_SIZE} bytes — aborting"
                            )
                            f.close()
                            installer_path.unlink(missing_ok=True)
                            return None
                        if progress_callback:
                            progress_callback(downloaded, total)

        # Verify size matches content-length
        if total > 0 and downloaded != total:
            logger.error(f"Download incomplete: {downloaded}/{total} bytes")
            installer_path.unlink(missing_ok=True)
            return None

        # Verify size matches GitHub asset size
        if info.size > 0 and downloaded != info.size:
            logger.error(f"Size mismatch: got {downloaded}, expected {info.size} bytes")
            installer_path.unlink(missing_ok=True)
            return None

        # Verify SHA-256 against GitHub asset digest (mandatory)
        if not info.digest:
            logger.error(
                "No SHA-256 digest from GitHub — refusing unverified installer"
            )
            installer_path.unlink(missing_ok=True)
            return None

        expected_hex = info.digest.removeprefix("sha256:")
        actual_hex = sha256.hexdigest()
        if actual_hex != expected_hex:
            logger.error(
                "SHA-256 mismatch",
                expected=expected_hex[:16] + "...",
                actual=actual_hex[:16] + "...",
            )
            installer_path.unlink(missing_ok=True)
            return None
            logger.info("SHA-256 verified OK")

        logger.info(f"Installer downloaded to: {installer_path}")
        return installer_path

    except Exception as e:
        logger.error(f"Error downloading installer: {e}")
        # Clean up partial download
        if installer_path.exists():
            installer_path.unlink()
        return None


def launch_installer(installer_path: Path) -> bool:
    """
    Launch the Inno Setup installer directly and prepare for app exit.

    Inno Setup handles:
    - CloseApplications=yes → closes the running SakaDesk
    - /SILENT → shows a small progress dialog (not invisible like /VERYSILENT)
    - [Run] section → relaunches SakaDesk.exe after install

    No batch script needed — this removes timing/path edge cases.

    Args:
        installer_path: Path to the downloaded installer

    Returns:
        True if installer was launched successfully
    """
    if not is_windows():
        logger.error("In-place upgrade only supported on Windows")
        return False

    if not installer_path.exists():
        logger.error(f"Installer not found: {installer_path}")
        return False

    try:
        subprocess.Popen(
            [str(installer_path), "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART"],
            creationflags=subprocess.DETACHED_PROCESS  # type: ignore[attr-defined]
            | subprocess.CREATE_NEW_PROCESS_GROUP,  # type: ignore[attr-defined]
            close_fds=True,
        )

        logger.info("Installer launched successfully")
        return True

    except Exception as e:
        logger.error(f"Failed to launch installer: {e}")
        return False


def cleanup_upgrade_files():
    """Clean up any leftover upgrade files from a previous upgrade attempt."""
    upgrade_dir = get_app_data_dir() / "upgrade"
    if upgrade_dir.exists():
        try:
            import shutil

            shutil.rmtree(upgrade_dir)
            logger.info("Cleaned up upgrade directory")
        except Exception as e:
            logger.warning(f"Failed to clean up upgrade directory: {e}")


def is_upgrade_supported() -> bool:
    """Check if in-place upgrade is supported on this platform."""
    return cast(bool, is_windows())
