"""App identity for Windows toasts: a Start Menu shortcut carrying the AUMID.

Windows only shows toast banners for an app whose Start Menu shortcut carries
``System.AppUserModel.ID``; registering the AUMID in the registry alone is not
enough. :func:`ensure_start_menu_shortcut` makes sure that shortcut exists
(frozen builds only) and :func:`set_process_aumid` groups the running process
with it on the taskbar.

Logs are ``app_identity`` events carrying an ``action`` and, on failure, an
``error_type``. Paths are never logged. Nothing here raises.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Protocol

import structlog

logger = structlog.get_logger(__name__)

AUMID = "SakaDesk"
SHORTCUT_NAME = "SakaDesk.lnk"

# IPersistFile.Load mode for an in-place edit (pythoncom has no constant).
_STGM_READWRITE = 2
# CoInitialize on a thread whose COM apartment was already set another way.
_RPC_E_CHANGED_MODE = -2147417850


class ShellLinks(Protocol):
    """Thin seam over pywin32 so the shortcut logic is testable."""

    def exists(self, path: Path) -> bool: ...

    def read_aumid(self, path: Path) -> str | None: ...

    def create(self, path: Path, target: Path, workdir: Path, aumid: str) -> None: ...

    def set_aumid(self, path: Path, aumid: str) -> None: ...


class PyWin32ShellLinks:
    """:class:`ShellLinks` backed by ``IShellLink`` + ``IPropertyStore`` (pywin32).

    Windows only; pywin32 is imported lazily in the constructor.
    """

    def __init__(self) -> None:
        import pythoncom
        from win32com.propsys import propsys, pscon
        from win32com.shell import shell

        self._pythoncom: Any = pythoncom
        self._propsys: Any = propsys
        self._pscon: Any = pscon
        self._shell: Any = shell
        # May run on a non-main thread; CoInitialize is idempotent per thread.
        try:
            pythoncom.CoInitialize()
        except pythoncom.com_error as e:
            # RPC_E_CHANGED_MODE: COM is already initialised on this thread
            # (another apartment model), which is fine for IShellLink.
            if not e.args or e.args[0] != _RPC_E_CHANGED_MODE:
                raise
            logger.info(
                "app_identity",
                action="com_already_initialized",
                hresult=_RPC_E_CHANGED_MODE,
            )

    def _new_link(self) -> Any:
        return self._pythoncom.CoCreateInstance(
            self._shell.CLSID_ShellLink,
            None,
            self._pythoncom.CLSCTX_INPROC_SERVER,
            self._shell.IID_IShellLink,
        )

    def _load(self, path: Path, *, writable: bool = False) -> Any:
        link = self._new_link()
        persist = link.QueryInterface(self._pythoncom.IID_IPersistFile)
        if writable:
            # The default (read) mode makes the later Save fail with
            # STG_E_ACCESSDENIED on an existing shortcut.
            persist.Load(str(path), _STGM_READWRITE)
        else:
            persist.Load(str(path))
        return link

    def _store(self, link: Any) -> Any:
        return link.QueryInterface(self._propsys.IID_IPropertyStore)

    def _save(self, link: Any, path: Path) -> None:
        link.QueryInterface(self._pythoncom.IID_IPersistFile).Save(str(path), 0)

    def exists(self, path: Path) -> bool:
        return path.exists()

    def read_aumid(self, path: Path) -> str | None:
        value = self._store(self._load(path)).GetValue(self._pscon.PKEY_AppUserModel_ID)
        current = value.GetValue()
        return current or None

    def create(self, path: Path, target: Path, workdir: Path, aumid: str) -> None:
        link = self._new_link()
        link.SetPath(str(target))
        link.SetWorkingDirectory(str(workdir))
        store = self._store(link)
        store.SetValue(
            self._pscon.PKEY_AppUserModel_ID, self._propsys.PROPVARIANTType(aumid)
        )
        store.Commit()
        path.parent.mkdir(parents=True, exist_ok=True)
        self._save(link, path)

    def set_aumid(self, path: Path, aumid: str) -> None:
        # Only the AUMID property changes: never SetPath on an existing link.
        link = self._load(path, writable=True)
        store = self._store(link)
        store.SetValue(
            self._pscon.PKEY_AppUserModel_ID, self._propsys.PROPVARIANTType(aumid)
        )
        store.Commit()
        self._save(link, path)


def ensure_start_menu_shortcut(
    *,
    frozen: bool,
    exe: Path,
    programs_dir: Path,
    links: ShellLinks | None = None,
) -> str:
    """Make sure the Start Menu shortcut exists and carries the AUMID.

    Returns (and logs as ``app_identity``) one of ``skipped_dev``, ``created``,
    ``updated``, ``ok`` or ``failed`` (with ``error_type``, plus ``hresult``
    for a pywin32 ``com_error``). An existing
    shortcut's target is never changed. Never raises.
    """
    if not frozen:
        logger.info("app_identity", action="skipped_dev")
        return "skipped_dev"
    try:
        if links is None:
            links = PyWin32ShellLinks()
        lnk = programs_dir / SHORTCUT_NAME
        if not links.exists(lnk):
            links.create(lnk, exe, exe.parent, AUMID)
            action = "created"
        elif links.read_aumid(lnk) != AUMID:
            links.set_aumid(lnk, AUMID)
            action = "updated"
        else:
            action = "ok"
    except Exception as e:
        fields: dict[str, Any] = {"error_type": type(e).__name__}
        # pywin32 com_error carries the HRESULT as args[0]; log the code only.
        if type(e).__name__ == "com_error" and e.args and isinstance(e.args[0], int):
            fields["hresult"] = e.args[0]
        logger.warning("app_identity", action="failed", **fields)
        return "failed"
    logger.info("app_identity", action=action)
    return action


def _ctypes() -> Any:
    import ctypes

    return ctypes


def set_process_aumid() -> None:
    """Set the process AUMID so the taskbar groups with the shortcut (Windows only)."""
    if sys.platform != "win32":
        return
    try:
        hresult = _ctypes().windll.shell32.SetCurrentProcessExplicitAppUserModelID(
            AUMID
        )
        if hresult:
            logger.warning(
                "app_identity", action="process_aumid_failed", error_type="HRESULT"
            )
            return
        logger.info("app_identity", action="process_aumid_set")
    except Exception as e:
        logger.warning(
            "app_identity", action="process_aumid_failed", error_type=type(e).__name__
        )
