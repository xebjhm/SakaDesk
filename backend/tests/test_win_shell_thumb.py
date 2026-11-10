"""``backend.services.win_shell_thumb``: Shell thumbnails through injected fakes.

The real ctypes binding only loads on Windows (exercised during the Windows
acceptance run, M9); every value it would return is simulated here.
"""

from __future__ import annotations

import ctypes
import threading
from pathlib import Path
from unittest.mock import patch

import pytest
from structlog.testing import capture_logs

from backend.services import win_shell_thumb as wst

SECRET = "秘密の動画"
PATH = Path("C:/out") / SECRET / "video" / "1.mp4"


class FakeShell:
    """Records every call; returns a synthetic BGRX bitmap of ``w`` x ``h``."""

    def __init__(
        self,
        w: int = 4,
        h: int = 2,
        pixels: bytes | None = None,
        create_hr: int = 0,
        image_hr: int = 0,
        object_result: int | None = None,
        dib_lines: int | None = None,
        raise_in: str | None = None,
    ):
        self.w, self.h = w, h
        self.pixels = pixels if pixels is not None else bytes([90, 60, 30, 0]) * (w * h)
        self.create_hr, self.image_hr = create_hr, image_hr
        self.object_result, self.dib_lines = object_result, dib_lines
        self.raise_in = raise_in
        self.calls: list[str] = []
        self.created: list[tuple[str, object, bytes]] = []
        self.image_args: list[tuple[int, int]] = []

    def _maybe_raise(self, name: str) -> None:
        if self.raise_in == name:
            raise OSError(name)

    def create(self, path, pbc, riid, out):
        self.calls.append("create")
        self._maybe_raise("create")
        self.created.append((path, pbc, bytes(riid._obj)))
        out._obj.value = 0x1000
        return self.create_hr

    def get_image(self, factory, size, flags):
        self.calls.append("get_image")
        self._maybe_raise("get_image")
        self.image_args.append((size, flags))
        return self.image_hr, (0x2000 if self.image_hr >= 0 else None)

    def release(self, factory):
        self.calls.append("release")
        assert factory.value == 0x1000

    def get_object(self, hbmp, cb, out):
        self.calls.append("get_object")
        assert cb == ctypes.sizeof(wst.BITMAP)
        if self.object_result is not None:
            return self.object_result
        out._obj.bmWidth = self.w
        out._obj.bmHeight = self.h
        out._obj.bmBitsPixel = 32
        return cb

    def create_dc(self, hdc):
        self.calls.append("create_dc")
        return 0x3000

    def delete_dc(self, hdc):
        self.calls.append("delete_dc")
        assert hdc == 0x3000
        return 1

    def get_dibits(self, hdc, hbmp, start, lines, buf, bmi, usage):
        self.calls.append("get_dibits")
        self._maybe_raise("get_dibits")
        header = bmi._obj.bmiHeader
        assert (start, lines, usage) == (0, self.h, wst.DIB_RGB_COLORS)
        assert header.biWidth == self.w and header.biHeight == -self.h
        assert header.biBitCount == 32 and header.biCompression == wst.BI_RGB
        assert header.biPlanes == 1 and header.biSize == ctypes.sizeof(header)
        if self.dib_lines is not None:
            return self.dib_lines
        ctypes.memmove(buf, self.pixels, len(self.pixels))
        return self.h

    def delete_object(self, hbmp):
        self.calls.append("delete_object")
        assert hbmp == 0x2000
        return 1

    def api(self) -> wst.ShellApi:
        return wst.ShellApi(
            SHCreateItemFromParsingName=self.create,
            GetObjectW=self.get_object,
            GetDIBits=self.get_dibits,
            DeleteObject=self.delete_object,
            CreateCompatibleDC=self.create_dc,
            DeleteDC=self.delete_dc,
            get_image=self.get_image,
            release=self.release,
        )


@pytest.fixture(autouse=True)
def _fresh():
    wst.reset_for_tests()
    yield
    wst.reset_for_tests()


def _no_path(logs: list[dict]) -> None:
    text = repr(logs)
    assert SECRET not in text and "1.mp4" not in text and "C:/out" not in text


def test_a_bgrx_buffer_becomes_rgb_pixels():
    # 4 x 2: each pixel's B, G, R, X differ so a channel swap would show
    pixels = b"".join(bytes([b, g, r, 255]) for b, g, r in [(10, 20, 30)] * 4) + (
        b"".join(bytes([b, g, r, 7]) for b, g, r in [(200, 150, 100)] * 4)
    )
    fake = FakeShell(pixels=pixels)
    img = wst.shell_thumbnail(PATH, 640, fake.api())
    assert img is not None
    assert img.mode == "RGB" and img.size == (4, 2)
    assert img.getpixel((0, 0)) == (30, 20, 10)
    assert img.getpixel((3, 1)) == (100, 150, 200)
    assert fake.created[0][0] == str(PATH) and fake.created[0][1] is None
    assert fake.created[0][2] == bytes(wst.IID_IShellItemImageFactory)
    assert fake.image_args == [
        (640, wst.SIIGBF_THUMBNAILONLY | wst.SIIGBF_BIGGERSIZEOK)
    ]
    assert fake.calls == [
        "create",
        "get_image",
        "get_object",
        "create_dc",
        "get_dibits",
        "delete_dc",
        "delete_object",
        "release",
    ]


def test_the_iid_and_flags_match_the_sdk():
    assert str(wst.IID_STR) == "bcc18b79-ba16-442f-80c4-8a59c30c463b"
    g = wst.IID_IShellItemImageFactory
    assert g.Data1 == 0xBCC18B79 and g.Data2 == 0xBA16 and g.Data3 == 0x442F
    assert bytes(g.Data4) == bytes.fromhex("80c48a59c30c463b")
    assert wst.SIIGBF_BIGGERSIZEOK == 0x1 and wst.SIIGBF_THUMBNAILONLY == 0x8
    assert wst.DIB_RGB_COLORS == 0 and wst.BI_RGB == 0


def test_bitmap_and_factory_are_freed_when_getdibits_fails():
    fake = FakeShell(dib_lines=0)
    with capture_logs() as logs:
        assert wst.shell_thumbnail(PATH, 640, fake.api()) is None
    assert "delete_object" in fake.calls and "release" in fake.calls
    assert "delete_dc" in fake.calls
    assert logs[-1]["reason"] == "unreadable"


def test_bitmap_and_factory_are_freed_when_getdibits_raises():
    fake = FakeShell(raise_in="get_dibits")
    with capture_logs() as logs:
        assert wst.shell_thumbnail(PATH, 640, fake.api()) is None
    assert fake.calls[-3:] == ["delete_dc", "delete_object", "release"]
    assert logs[-1] == {
        "event": "video_poster",
        "source": "shell",
        "outcome": "failed",
        "reason": "error",
        "error_type": "OSError",
        "log_level": "info",
    }
    _no_path(logs)


def test_getobject_failing_is_unreadable_and_frees():
    fake = FakeShell(object_result=0)
    with capture_logs() as logs:
        assert wst.shell_thumbnail(PATH, 640, fake.api()) is None
    assert logs[-1]["reason"] == "unreadable"
    assert fake.calls[-2:] == ["delete_object", "release"]


@pytest.mark.parametrize("hr", [-2147467259, 0x80004005])
def test_create_hresult_failure_is_no_frame(hr):
    fake = FakeShell(create_hr=hr)
    with capture_logs() as logs:
        assert wst.shell_thumbnail(PATH, 640, fake.api()) is None
    assert logs[-1]["reason"] == "no_frame"
    assert logs[-1]["error_type"] == "0x80004005"
    assert fake.calls == ["create"]  # nothing to release: no factory came back
    _no_path(logs)


def test_get_image_hresult_failure_is_no_frame_and_releases():
    fake = FakeShell(image_hr=-2147221164)  # 0x80040154 REGDB_E_CLASSNOTREG
    with capture_logs() as logs:
        assert wst.shell_thumbnail(PATH, 640, fake.api()) is None
    assert logs[-1]["reason"] == "no_frame"
    assert logs[-1]["error_type"] == "0x80040154"
    assert fake.calls == ["create", "get_image", "release"]


def test_a_missing_factory_is_no_frame():
    fake = FakeShell()

    def create(path, pbc, riid, out):  # S_OK but a null pointer
        return 0

    api = fake.api()
    api = wst.ShellApi(**{**api.__dict__, "SHCreateItemFromParsingName": create})
    with capture_logs() as logs:
        assert wst.shell_thumbnail(PATH, 640, api) is None
    assert logs[-1]["reason"] == "no_frame" and logs[-1]["error_type"] == "0x00000000"


def test_a_long_path_makes_no_call():
    fake = FakeShell()
    long_path = Path("C:/" + "a" * 300 + ".mp4")
    with capture_logs() as logs:
        assert wst.shell_thumbnail(long_path, 640, fake.api()) is None
    assert fake.calls == []
    assert logs[-1]["reason"] == "long_path"
    assert "aaaa" not in repr(logs)
    assert wst.MAX_SHELL_PATH == 259


def test_a_path_of_exactly_the_limit_is_tried():
    fake = FakeShell()
    p = Path("C:/" + "a" * (259 - 7) + ".mp4")
    assert len(str(p)) == 259
    assert wst.shell_thumbnail(p, 640, fake.api()) is not None


def test_a_black_frame_is_refused():
    fake = FakeShell(pixels=bytes([7, 7, 7, 0]) * 8)
    with capture_logs() as logs:
        assert wst.shell_thumbnail(PATH, 640, fake.api()) is None
    assert logs[-1]["reason"] == "black_frame"
    assert fake.calls[-2:] == ["delete_object", "release"]
    assert wst.BLACK_LUMA == 8


def test_a_dark_but_not_black_frame_is_kept():
    fake = FakeShell(pixels=bytes([9, 9, 9, 0]) * 8)
    assert wst.shell_thumbnail(PATH, 640, fake.api()) is not None


@pytest.mark.parametrize("w, h", [(4097, 10), (10, 4097), (0, 10), (10, 0)])
def test_a_bad_bitmap_size_is_refused(w, h):
    fake = FakeShell(w=w, h=h, pixels=b"")
    with capture_logs() as logs:
        assert wst.shell_thumbnail(PATH, 640, fake.api()) is None
    assert logs[-1]["reason"] == ("too_large" if max(w, h) > 4096 else "unreadable")
    assert "get_dibits" not in fake.calls
    assert fake.calls[-2:] == ["delete_object", "release"]


def test_a_negative_height_is_read_as_its_size():
    fake = FakeShell()
    orig = fake.get_object

    def get_object(hbmp, cb, out):
        n = orig(hbmp, cb, out)
        out._obj.bmHeight = -fake.h
        return n

    api = wst.ShellApi(**{**fake.api().__dict__, "GetObjectW": get_object})
    img = wst.shell_thumbnail(PATH, 640, api)
    assert img is not None and img.size == (4, 2)


def test_an_exception_before_the_factory_is_an_error():
    fake = FakeShell(raise_in="create")
    with capture_logs() as logs:
        assert wst.shell_thumbnail(PATH, 640, fake.api()) is None
    assert logs[-1]["reason"] == "error"
    assert "release" not in fake.calls


# --- availability and the real loader ---------------------------------------------------


def test_unavailable_on_linux_never_touches_windll():
    with (
        patch.object(wst.sys, "platform", "linux"),
        patch.object(ctypes, "WinDLL", side_effect=AssertionError, create=True),
        patch.object(wst, "_load_api", side_effect=AssertionError),
    ):
        assert wst.available() is False
        with capture_logs() as logs:
            assert wst.shell_thumbnail(PATH, 640) is None
    assert logs[-1]["reason"] == "unavailable"


def test_available_on_windows_when_the_binding_loads_and_is_cached():
    fake = FakeShell()
    with (
        patch.object(wst.sys, "platform", "win32"),
        patch.object(wst, "_load_api", return_value=fake.api()) as load,
        patch.object(wst, "com_init") as com,
    ):
        assert wst.available() is True
        assert wst.available() is True
        assert wst.shell_thumbnail(PATH, 640) is not None
    load.assert_called_once()
    com.assert_called_once_with()


def test_unavailable_when_the_binding_fails_to_load():
    with (
        patch.object(wst.sys, "platform", "win32"),
        patch.object(wst, "_load_api", side_effect=OSError("no shell32")) as load,
        capture_logs() as logs,
    ):
        assert wst.available() is False
        assert wst.available() is False
    load.assert_called_once()
    assert logs == [
        {
            "event": "win_shell_thumb_failed",
            "op": "load",
            "error_type": "OSError",
            "log_level": "warning",
        }
    ]


# --- COM initialisation -------------------------------------------------------------------


class FakeOle32:
    def __init__(self, hr: int = 0):
        self.hr = hr
        self.calls: list[tuple[object, int]] = []
        self.lock = threading.Lock()

    def CoInitializeEx(self, reserved, flags):  # noqa: N802 (Win32 name)
        with self.lock:
            self.calls.append((reserved, flags))
        return self.hr


def test_com_init_runs_once_per_thread():
    ole = FakeOle32()
    wst.com_init(ole)
    wst.com_init(ole)
    assert ole.calls == [(None, wst.COINIT_APARTMENTTHREADED)]
    t = threading.Thread(target=lambda: (wst.com_init(ole), wst.com_init(ole)))
    t.start()
    t.join()
    assert len(ole.calls) == 2


@pytest.mark.parametrize(
    "hr", [1, -2147417850, 0x80010106]
)  # S_FALSE, RPC_E_CHANGED_MODE
def test_com_init_accepts_already_initialised(hr):
    ole = FakeOle32(hr)
    wst.com_init(ole)
    wst.com_init(ole)
    assert len(ole.calls) == 1


def test_com_init_failure_is_logged_and_retried():
    ole = FakeOle32(-2147024882)  # E_OUTOFMEMORY
    with capture_logs() as logs:
        wst.com_init(ole)
    assert logs == [
        {
            "event": "win_shell_thumb_failed",
            "op": "com_init",
            "error_type": "0x8007000E",
            "log_level": "warning",
        }
    ]
    wst.com_init(ole)
    assert len(ole.calls) == 2


def test_com_init_exception_is_logged():
    class Boom:
        def CoInitializeEx(self, reserved, flags):  # noqa: N802
            raise OSError("x")

    with capture_logs() as logs:
        wst.com_init(Boom())
    assert logs[0]["error_type"] == "OSError"


def test_com_init_is_a_no_op_off_windows():
    with (
        patch.object(wst.sys, "platform", "linux"),
        patch.object(wst, "_load_ole32", side_effect=AssertionError),
    ):
        wst.com_init()


def test_com_init_loads_ole32_on_windows():
    ole = FakeOle32()
    with (
        patch.object(wst.sys, "platform", "win32"),
        patch.object(wst, "_load_ole32", return_value=ole),
    ):
        wst.com_init()
    assert len(ole.calls) == 1
