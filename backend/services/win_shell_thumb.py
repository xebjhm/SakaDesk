"""Video poster frames from the Windows Shell thumbnail API (``IShellItemImageFactory``).

The Shell's thumbnail providers decode a frame of a video with the OS Media
Foundation codecs (the same family WebView2 plays with) in about 20-80 ms,
with no browser and no network. This module wraps that through ``ctypes``
(stdlib; no pythonnet, no new dependency):

1. ``SHCreateItemFromParsingName(path, NULL, IID_IShellItemImageFactory, &factory)``;
2. ``factory->GetImage(SIZE(size, size), SIIGBF_THUMBNAILONLY | SIIGBF_BIGGERSIZEOK, &hbitmap)``
   (vtable slot 3; ``THUMBNAILONLY`` so a file without a frame gives an error,
   never its file-type icon);
3. ``GetObjectW`` for the ``BITMAP`` size, then ``GetDIBits`` into a top-down
   32 bpp ``BI_RGB`` buffer, read as ``BGRX`` (the alpha byte of video
   providers is unreliable, so it is ignored).

The ``HBITMAP`` is always freed (``DeleteObject``) and the factory always
released, in ``finally``. :func:`shell_thumbnail` returns ``None`` (with a
``video_poster`` breadcrumb: ``source=shell``, ``outcome=failed``,
``reason``, ``error_type``) for an ``HRESULT`` failure (``no_frame``; the
code as hex only), a path over :data:`MAX_SHELL_PATH` characters
(``long_path``: the Shell parser does not take ``\\\\?\\`` paths), a bitmap
over :data:`MAX_SIDE` px on a side (``too_large``), a bitmap it cannot read
(``unreadable``), a near-black frame (mean luminance under
:data:`BLACK_LUMA`, ``black_frame``: the client capture at 10% of the video
gets its chance instead) or any unexpected exception (``error``). It never
raises and never logs a path.

**Windows only.** Nothing touches ``ctypes.WinDLL`` at import time.
:func:`available` is ``False`` off Windows or when the binding fails to load
(cached either way). The calling thread must initialise COM
(:func:`com_init`, once per thread; :func:`shell_thumbnail` does it when it
uses the real binding). Tests inject a fake :class:`ShellApi`; the real one
is built by :func:`_load_api`, which only runs on Windows.

Logs carry codes only: ``video_poster`` (above) and ``win_shell_thumb_failed``
(``op=load|com_init``, ``error_type``).
"""

from __future__ import annotations

import ctypes
import sys
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import structlog
from PIL import Image, ImageStat

logger = structlog.get_logger(__name__)

# shobjidl_core.h: SIIGBF flags of IShellItemImageFactory::GetImage.
SIIGBF_RESIZETOFIT = 0x00
SIIGBF_BIGGERSIZEOK = 0x01
SIIGBF_THUMBNAILONLY = 0x08
GET_IMAGE_FLAGS = SIIGBF_THUMBNAILONLY | SIIGBF_BIGGERSIZEOK
# wingdi.h: GetDIBits usage and BITMAPINFOHEADER compression.
DIB_RGB_COLORS = 0
BI_RGB = 0
# objbase.h: CoInitializeEx apartment model; winerror.h: the accepted results.
COINIT_APARTMENTTHREADED = 0x2
S_OK = 0
S_FALSE = 1
RPC_E_CHANGED_MODE = 0x80010106

MAX_SHELL_PATH = 259
"""Longest path the Shell parser takes (MAX_PATH - 1; it refuses ``\\\\?\\`` paths)."""
MAX_SIDE = 4096
"""Largest bitmap side accepted from a Shell provider."""
BLACK_LUMA = 8
"""A frame whose mean luminance (0-255) is below this is treated as black."""


class GUID(ctypes.Structure):
    """``guiddef.h`` ``GUID``."""

    _fields_ = [
        ("Data1", ctypes.c_uint32),
        ("Data2", ctypes.c_uint16),
        ("Data3", ctypes.c_uint16),
        ("Data4", ctypes.c_ubyte * 8),
    ]


IID_STR = uuid.UUID("bcc18b79-ba16-442f-80c4-8a59c30c463b")
"""``shobjidl_core.h``: ``IID_IShellItemImageFactory``."""
IID_IShellItemImageFactory = GUID.from_buffer_copy(IID_STR.bytes_le)


class BITMAP(ctypes.Structure):
    """``wingdi.h`` ``BITMAP``."""

    _fields_ = [
        ("bmType", ctypes.c_long),
        ("bmWidth", ctypes.c_long),
        ("bmHeight", ctypes.c_long),
        ("bmWidthBytes", ctypes.c_long),
        ("bmPlanes", ctypes.c_uint16),
        ("bmBitsPixel", ctypes.c_uint16),
        ("bmBits", ctypes.c_void_p),
    ]


class BITMAPINFOHEADER(ctypes.Structure):
    """``wingdi.h`` ``BITMAPINFOHEADER``."""

    _fields_ = [
        ("biSize", ctypes.c_uint32),
        ("biWidth", ctypes.c_long),
        ("biHeight", ctypes.c_long),
        ("biPlanes", ctypes.c_uint16),
        ("biBitCount", ctypes.c_uint16),
        ("biCompression", ctypes.c_uint32),
        ("biSizeImage", ctypes.c_uint32),
        ("biXPelsPerMeter", ctypes.c_long),
        ("biYPelsPerMeter", ctypes.c_long),
        ("biClrUsed", ctypes.c_uint32),
        ("biClrImportant", ctypes.c_uint32),
    ]


class BITMAPINFO(ctypes.Structure):
    """``wingdi.h`` ``BITMAPINFO`` (no colour table: 32 bpp ``BI_RGB``)."""

    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", ctypes.c_uint32 * 3)]


@dataclass(frozen=True)
class ShellApi:
    """The ctypes callables :func:`shell_thumbnail` uses (a fake in tests).

    The Win32 functions keep their names and signatures. ``get_image(factory,
    size, flags) -> (hresult, hbitmap or None)`` and ``release(factory)``
    wrap the COM vtable calls (``IShellItemImageFactory::GetImage``, slot 3,
    and ``IUnknown::Release``, slot 2).
    """

    SHCreateItemFromParsingName: Callable[..., int]
    GetObjectW: Callable[..., int]
    GetDIBits: Callable[..., int]
    DeleteObject: Callable[..., int]
    CreateCompatibleDC: Callable[..., Any]
    DeleteDC: Callable[..., int]
    get_image: Callable[[ctypes.c_void_p, int, int], tuple[int, Any]]
    release: Callable[[ctypes.c_void_p], Any]


class _Failed(Exception):
    """A refused frame: ``reason`` and ``error_type`` for the breadcrumb."""

    def __init__(self, reason: str, error_type: str | None = None):
        super().__init__(reason)
        self.reason, self.error_type = reason, error_type


def _hex(hr: int) -> str:
    """An HRESULT as its unsigned hex code (``0x80004005``), whatever its sign."""
    return f"0x{hr & 0xFFFFFFFF:08X}"


def _failed(hr: int) -> bool:
    return bool(hr & 0x80000000)


def _on_windows() -> bool:
    # A call, not an inline ``sys.platform`` test, so mypy checks the Windows path too.
    return sys.platform == "win32"


# --- the real binding (Windows only) ----------------------------------------------------


def _load_api():  # pragma: no cover - Windows binding, exercised on Windows (M9)
    """The real :class:`ShellApi` (shell32 + gdi32 with typed signatures). Windows only."""
    from ctypes import wintypes

    winfunctype = ctypes.WINFUNCTYPE  # type: ignore[attr-defined,unused-ignore]
    shell32 = ctypes.WinDLL("shell32")  # type: ignore[attr-defined,unused-ignore]
    gdi32 = ctypes.WinDLL("gdi32")  # type: ignore[attr-defined,unused-ignore]
    create = shell32.SHCreateItemFromParsingName
    create.restype = ctypes.c_long
    create.argtypes = [
        wintypes.LPCWSTR,
        ctypes.c_void_p,
        ctypes.POINTER(GUID),
        ctypes.POINTER(ctypes.c_void_p),
    ]
    gdi32.GetObjectW.restype = ctypes.c_int
    gdi32.GetObjectW.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p]
    gdi32.CreateCompatibleDC.restype = wintypes.HDC
    gdi32.CreateCompatibleDC.argtypes = [wintypes.HDC]
    gdi32.DeleteDC.restype = wintypes.BOOL
    gdi32.DeleteDC.argtypes = [wintypes.HDC]
    gdi32.DeleteObject.restype = wintypes.BOOL
    gdi32.DeleteObject.argtypes = [wintypes.HANDLE]
    gdi32.GetDIBits.restype = ctypes.c_int
    gdi32.GetDIBits.argtypes = [
        wintypes.HDC,
        wintypes.HBITMAP,
        wintypes.UINT,
        wintypes.UINT,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.UINT,
    ]

    class SIZE(ctypes.Structure):
        _fields_ = [("cx", ctypes.c_long), ("cy", ctypes.c_long)]

    get_image_t = winfunctype(
        ctypes.c_long,
        ctypes.c_void_p,
        SIZE,
        ctypes.c_int,
        ctypes.POINTER(wintypes.HBITMAP),
    )
    release_t = winfunctype(ctypes.c_ulong, ctypes.c_void_p)

    def vtable(obj: ctypes.c_void_p) -> Any:
        return ctypes.cast(obj, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]

    def get_image(factory: ctypes.c_void_p, size: int, flags: int) -> tuple[int, Any]:
        hbmp = wintypes.HBITMAP()
        hr = get_image_t(vtable(factory)[3])(
            factory, SIZE(size, size), flags, ctypes.byref(hbmp)
        )
        return int(hr), hbmp.value

    def release(factory: ctypes.c_void_p) -> Any:
        return release_t(vtable(factory)[2])(factory)

    return ShellApi(
        SHCreateItemFromParsingName=create,
        GetObjectW=gdi32.GetObjectW,
        GetDIBits=gdi32.GetDIBits,
        DeleteObject=gdi32.DeleteObject,
        CreateCompatibleDC=gdi32.CreateCompatibleDC,
        DeleteDC=gdi32.DeleteDC,
        get_image=get_image,
        release=release,
    )


def _load_ole32():  # pragma: no cover - Windows binding, exercised on Windows (M9)
    """ole32 with a typed ``CoInitializeEx``. Windows only."""
    ole32 = ctypes.WinDLL("ole32")  # type: ignore[attr-defined,unused-ignore]
    ole32.CoInitializeEx.restype = ctypes.c_long
    ole32.CoInitializeEx.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    return ole32


_api_lock = threading.Lock()
_api_loaded = False
_api_cache: ShellApi | None = None
_tls = threading.local()


def reset_for_tests() -> None:
    """Forget the cached binding and this thread's COM state (tests)."""
    global _api_loaded, _api_cache
    with _api_lock:
        _api_loaded, _api_cache = False, None
    _tls.__dict__.clear()


def _api() -> ShellApi | None:
    """The real binding, loaded once (``None`` off Windows or when it fails to load)."""
    global _api_loaded, _api_cache
    with _api_lock:
        if not _api_loaded:
            _api_loaded = True
            if _on_windows():
                try:
                    _api_cache = _load_api()
                except Exception as e:  # noqa: BLE001 - no Shell: the client capture covers it
                    logger.warning(
                        "win_shell_thumb_failed", op="load", error_type=type(e).__name__
                    )
        return _api_cache


def available() -> bool:
    """True on Windows when the Shell binding loads (cached; never touches ``WinDLL`` elsewhere)."""
    return _api() is not None


def com_init(ole32: Any = None) -> None:
    """Initialise COM (single-threaded apartment) once on the calling thread.

    ``S_OK``, ``S_FALSE`` (already initialised) and ``RPC_E_CHANGED_MODE``
    (initialised as multi-threaded by someone else; Shell still works) count
    as initialised and are remembered per thread. A failure is logged and
    retried on the next call. Off Windows (and no ``ole32`` given) it does
    nothing. Never raises.
    """
    if getattr(_tls, "com", False):
        return
    try:
        if ole32 is None:
            if not _on_windows():
                return
            ole32 = _load_ole32()
        hr = int(ole32.CoInitializeEx(None, COINIT_APARTMENTTHREADED))
    except Exception as e:  # noqa: BLE001 - logged; the Shell call then fails cleanly
        logger.warning(
            "win_shell_thumb_failed", op="com_init", error_type=type(e).__name__
        )
        return
    if hr & 0xFFFFFFFF in (S_OK, S_FALSE, RPC_E_CHANGED_MODE):
        _tls.com = True
    else:
        logger.warning("win_shell_thumb_failed", op="com_init", error_type=_hex(hr))


# --- the thumbnail ----------------------------------------------------------------------


def _log_failed(reason: str, error_type: str | None = None) -> None:
    logger.info(
        "video_poster",
        source="shell",
        outcome="failed",
        reason=reason,
        error_type=error_type,
    )


def shell_thumbnail(
    path: Path, size: int, api: ShellApi | None = None
) -> Image.Image | None:
    """An RGB frame of the video at ``path`` about ``size`` px (bigger allowed), or ``None``.

    ``api=None`` uses the real binding (and initialises COM on this thread).
    Blocking; call it from a worker thread only. Never raises; see the
    module docstring for the refusal reasons.
    """
    if len(str(path)) > MAX_SHELL_PATH:
        _log_failed("long_path")
        return None
    if api is None:
        api = _api()
        if api is None:
            _log_failed("unavailable")
            return None
        com_init()
    try:
        return _thumbnail(api, path, size)
    except _Failed as f:
        _log_failed(f.reason, f.error_type)
    except Exception as e:  # noqa: BLE001 - a broken provider must not fail the worker
        _log_failed("error", type(e).__name__)
    return None


def _thumbnail(api: ShellApi, path: Path, size: int) -> Image.Image:
    factory = ctypes.c_void_p()
    hr = int(
        api.SHCreateItemFromParsingName(
            str(path),
            None,
            ctypes.byref(IID_IShellItemImageFactory),
            ctypes.byref(factory),
        )
    )
    # COM: a failed call's out pointer is not ours to release (it should be NULL).
    if _failed(hr) or not factory.value:
        raise _Failed("no_frame", _hex(hr))
    try:
        hr, hbmp = api.get_image(factory, size, GET_IMAGE_FLAGS)
        if _failed(hr) or not hbmp:
            raise _Failed("no_frame", _hex(hr))
        try:
            img = _read_bitmap(api, hbmp)
        finally:
            api.DeleteObject(hbmp)
    finally:
        api.release(factory)
    luma = ImageStat.Stat(img.convert("L")).mean[0]
    if luma < BLACK_LUMA:
        raise _Failed("black_frame")
    return img


def _read_bitmap(api: ShellApi, hbmp: Any) -> Image.Image:
    bm = BITMAP()
    if not api.GetObjectW(hbmp, ctypes.sizeof(BITMAP), ctypes.byref(bm)):
        raise _Failed("unreadable")
    w, h = int(bm.bmWidth), abs(int(bm.bmHeight))
    if w <= 0 or h <= 0:
        raise _Failed("unreadable")
    if w > MAX_SIDE or h > MAX_SIDE:
        raise _Failed("too_large")
    bmi = BITMAPINFO()
    header = bmi.bmiHeader
    header.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    header.biWidth = w
    header.biHeight = -h  # negative: top-down rows
    header.biPlanes = 1
    header.biBitCount = 32
    header.biCompression = BI_RGB
    buf = (ctypes.c_ubyte * (w * h * 4))()
    hdc = api.CreateCompatibleDC(None)
    try:
        lines = api.GetDIBits(hdc, hbmp, 0, h, buf, ctypes.byref(bmi), DIB_RGB_COLORS)
    finally:
        api.DeleteDC(hdc)
    if lines != h:
        raise _Failed("unreadable")
    return Image.frombuffer("RGB", (w, h), bytes(buf), "raw", "BGRX", 0, 1)
