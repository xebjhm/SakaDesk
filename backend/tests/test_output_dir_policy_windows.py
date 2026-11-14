"""``output_dir_policy`` under Windows path rules, simulated on any host.

The module's path class, ``os.path`` (``ntpath``), environment and home are
swapped for Windows ones and ``resolve`` reads a small table that stands for
what the Windows filesystem would answer (8.3 names, junctions, SUBST and
mapped drives). Nothing here touches the disk.
"""

from __future__ import annotations

import ntpath
import os
import types
from pathlib import PureWindowsPath

import pytest

from backend.services import output_dir_policy as policy

HOME = "C:\\Users\\Me"

# lower-cased prefix -> what GetFinalPathNameByHandle would return for it
RESOLVE = {
    "c:\\progra~1": "C:\\Program Files",
    "c:\\users\\me~1": "C:\\Users\\Me",
    "c:\\documents and settings": "C:\\Users",
    "z:\\sakadesk": "\\\\nas\\share\\SakaDesk",
    "s:\\appdata\\local\\sakadesk": "C:\\Users\\Me\\AppData\\Local\\SakaDesk",
    "s:\\roaming\\pysaka": "C:\\Users\\Me\\AppData\\Roaming\\pysaka",
    "c:\\windows.": "C:\\Windows",
    "e:\\link-to-root": "E:\\",
    "d:\\junction-to-home": "C:\\Users\\Me",
}


class WinPath(PureWindowsPath):
    """A Windows path whose ``resolve`` follows :data:`RESOLVE` (longest prefix)."""

    def resolve(self, strict: bool = False) -> "WinPath":
        text = ntpath.normpath(str(self))
        low = text.lower()
        best = None
        for key in RESOLVE:
            if low == key or low.startswith(key.rstrip("\\") + "\\"):
                if best is None or len(key) > len(best):
                    best = key
        if best is None:
            return WinPath(text)
        tail = text[len(best.rstrip("\\")) :]
        return WinPath(RESOLVE[best].rstrip("\\") + tail)

    @classmethod
    def home(cls) -> "WinPath":
        return cls(HOME)


@pytest.fixture(autouse=True)
def windows(monkeypatch):
    env = {
        "SystemRoot": "C:\\WINDOWS",
        "ProgramFiles": "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        "ProgramData": "C:\\ProgramData",
        "LOCALAPPDATA": HOME + "\\AppData\\Local",
        "APPDATA": HOME + "\\AppData\\Roaming",
    }
    monkeypatch.setattr(
        policy,
        "os",
        types.SimpleNamespace(
            path=ntpath, environ=env, close=os.close, unlink=os.unlink
        ),
    )
    monkeypatch.setattr(policy, "Path", WinPath)
    monkeypatch.setattr(policy, "_home", lambda: WinPath(HOME))
    monkeypatch.setattr(
        policy, "get_app_data_dir", lambda: WinPath(HOME + "\\AppData\\Local\\SakaDesk")
    )
    monkeypatch.setattr(policy, "_writable", lambda folder: True)


def _check(raw: str) -> str:
    try:
        policy.check_output_dir(raw)
    except policy.OutputDirRejected as e:
        return e.reason
    return "ok"


@pytest.mark.parametrize(
    "raw",
    [
        "D:\\SakaDesk Output",
        "D:/SakaDesk Output",  # forward slashes are normal
        "C:/D/SakaDesk Output",
        "C:\\Users\\Me\\Documents\\SakaDesk",
        "c:\\users\\me\\documents\\sakadesk\\",
        "C:\\Users\\Me\\OneDrive\\Documents\\SakaDesk",
        "E:\\Archive",
    ],
)
def test_ordinary_folders_are_accepted(raw):
    assert policy.lexical_problem(raw) is None
    assert _check(raw) == "ok"


@pytest.mark.parametrize("raw", ["C:/D/SakaDesk Output", "D:/x", "c:/Users/Me/x"])
def test_forward_slashes_are_not_unusual(raw):
    assert policy.lexical_problem(raw) is None


@pytest.mark.parametrize(
    "raw,reason",
    [
        ("E:\\", "root"),
        ("E:", "relative"),
        ("C:SakaDesk", "relative"),
        ("\\SakaDesk", "relative"),
        ("C:\\a\\..\\..", "root"),
        ("E:\\link-to-root", "root"),
    ],
)
def test_roots_and_relative_forms(raw, reason):
    assert _check(raw) == reason


@pytest.mark.parametrize(
    "raw",
    [
        "C:\\Users\\Me",
        "c:\\USERS\\me\\",  # letter case
        "C:\\Users",
        "C:\\Users\\ME~1",  # 8.3 name of the home folder
        "C:\\Documents and Settings",  # junction to C:\Users
        "D:\\junction-to-home",
    ],
)
def test_the_profile_is_refused_however_it_is_spelled(raw):
    assert _check(raw) == "profile"


def test_a_junction_to_the_profile_only_refuses_the_profile_itself():
    # D:\junction-to-home\Documents\SakaDesk is C:\Users\Me\Documents\SakaDesk
    assert _check("D:\\junction-to-home\\Documents\\SakaDesk") == "ok"


@pytest.mark.parametrize(
    "raw",
    [
        "C:\\Users\\Me\\AppData\\Local\\SakaDesk",
        "c:\\users\\me\\appdata\\local\\SAKADESK\\logs",
        "C:\\Users\\Me\\AppData\\Local",
        "C:\\Users\\Me\\AppData",
        "S:\\AppData\\Local\\SakaDesk",  # SUBST drive onto the app folder
    ],
)
def test_the_app_data_folder_is_refused_inside_above_and_through_a_link(raw):
    assert _check(raw) == "app_data"


@pytest.mark.parametrize(
    "raw",
    [
        "C:\\Users\\Me\\AppData\\Local\\Programs\\SakaDesk",  # the install folder
        "C:\\Users\\Me\\AppData\\Local\\Programs\\SakaDesk\\_internal",
        "C:\\Users\\Me\\AppData\\Local\\Programs",
        "c:\\users\\me\\appdata\\roaming\\PYSAKA",  # the sign-in folder
        "C:\\Users\\Me\\AppData\\Roaming\\pysaka\\auth_data",
        "C:\\Users\\Me\\AppData\\Roaming",
        "S:\\Roaming\\pysaka",  # SUBST drive onto the sign-in folder
        "C:\\Users\\Me\\AppData\\Roaming\\pyzaka",  # the legacy sign-in folder
        "c:\\users\\me\\appdata\\roaming\\PYZAKA\\auth_data",
        "C:\\Users\\Me\\AppData\\Local\\zakadesk",  # the legacy data folder (setup.iss)
        "c:\\users\\me\\appdata\\local\\ZAKADESK\\logs",
    ],
)
def test_the_install_and_sign_in_folders_are_refused(raw):
    assert _check(raw) == "app_data"


def test_a_sibling_of_the_app_folders_is_accepted():
    assert _check("C:\\Users\\Me\\AppData\\Local\\Programs\\Other\\x") == "ok"
    assert _check("C:\\Users\\Me\\AppData\\Roaming\\pysaka-archive") == "ok"


@pytest.mark.parametrize(
    "raw",
    [
        "C:\\Windows",
        "C:\\windows\\System32",
        "C:\\Windows.",  # trailing dot is dropped by Windows
        "C:\\PROGRA~1",  # 8.3 name of Program Files
        "C:\\PROGRA~1\\Foo",
        "C:\\Program Files (x86)\\x",
        "C:\\ProgramData\\SakaDesk",
    ],
)
def test_system_folders_are_refused_however_they_are_spelled(raw):
    assert _check(raw) == "system"


@pytest.mark.parametrize(
    "raw,reason",
    [
        ("\\\\server\\share", "network"),
        ("//server/share/x", "network"),
        ("\\\\?\\C:\\SakaDesk", "device"),
        ("\\\\?\\UNC\\server\\share", "device"),
        ("\\\\.\\pipe\\x", "device"),
    ],
)
def test_typed_network_and_device_paths_are_refused_before_any_resolve(raw, reason):
    assert policy.lexical_problem(raw) == reason
    assert _check(raw) == reason


def test_a_mapped_drive_is_accepted_though_it_resolves_to_a_unc_path():
    assert policy.lexical_problem("Z:\\SakaDesk") is None
    assert WinPath("Z:\\SakaDesk").resolve() == WinPath("\\\\nas\\share\\SakaDesk")
    assert _check("Z:\\SakaDesk") == "ok"


@pytest.mark.parametrize(
    "a,b",
    [
        ("C:/x", "C:\\x"),
        ("C:/D/SakaDesk Output", "c:\\d\\sakadesk output\\"),
        ("C:\\a\\..\\x", "C:/x/"),
    ],
)
def test_same_dir_ignores_slashes_case_and_dots(a, b):
    assert policy.same_dir(a, b)
    assert policy.same_dir(b, a)


def test_same_dir_tells_different_folders_apart():
    assert not policy.same_dir("C:\\x", "C:\\y")
    assert not policy.same_dir("C:\\x", "D:\\x")


def test_the_64_bit_program_files_folder_is_refused():
    policy.os.environ["ProgramW6432"] = "D:\\Programs64"
    assert _check("D:\\Programs64\\Foo") == "system"
    assert _check("D:\\Programs64x") == "ok"
