"""nav_guard: SakaDesk's windows stay on the app origin; other web URLs open in
the browser; nothing else is opened (security audit 2026-11-13,
desktop.py/main-window/unrestricted-navigation-from-blog-links)."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from structlog.testing import capture_logs

import nav_guard as ng

HOST = "127.0.0.1"
PORT = 8765
APP = f"http://{HOST}:{PORT}"
ROOT = Path(ng.__file__).resolve().parent


class FakeNavArgs:
    """CoreWebView2NavigationStartingEventArgs: ``Uri`` and a settable ``Cancel``."""

    def __init__(self, uri: str) -> None:
        self.Uri = uri
        self.Cancel = False


class BrokenNavArgs:
    Cancel = False

    @property
    def Uri(self) -> str:  # noqa: N802 (.NET property)
        raise RuntimeError("COM failure")


class FakeNewWindowArgs:
    """CoreWebView2NewWindowRequestedEventArgs as pywebview 5.3.2 uses it."""

    def __init__(self, uri: str) -> None:
        self._uri = uri
        self.handled: bool | None = None

    def get_Uri(self) -> str:  # noqa: N802 (.NET accessor)
        return self._uri

    def set_Handled(self, value: bool) -> None:  # noqa: N802 (.NET accessor)
        self.handled = value


def _backend_class() -> type:
    class EdgeChrome:  # stand-in for webview.platforms.edgechromium.EdgeChrome
        def on_navigation_start(self, sender, args):
            pass

        def on_new_window_request(self, sender, args):
            raise AssertionError("pywebview's own handler must have been replaced")

    return EdgeChrome


def _installed_backend(opened: list[str]):
    cls = _backend_class()
    assert ng.install(
        host=HOST,
        port=PORT,
        load_backend=lambda: cls,
        open_url=lambda url: opened.append(url) is None,
        version=lambda: ng.VALIDATED_PYWEBVIEW,
    )
    return cls()


class TestDecide:
    @pytest.mark.parametrize(
        "url,action,reason",
        [
            (f"{APP}/", ng.NavAction.ALLOW, "app_origin"),
            (f"{APP}/?view=call-popup#t=secret", ng.NavAction.ALLOW, "app_origin"),
            ("https://www.hinatazaka46.com/s/x", ng.NavAction.EXTERNAL, "external_web"),
            ("http://example.com", ng.NavAction.EXTERNAL, "external_web"),
            ("http://127.0.0.1:9999/", ng.NavAction.EXTERNAL, "external_web"),
            (f"https://{HOST}:{PORT}/", ng.NavAction.EXTERNAL, "external_web"),
            ("ms-settings:", ng.NavAction.BLOCK, "scheme"),
            ("file:///C:/Windows/", ng.NavAction.BLOCK, "scheme"),
            ("javascript:alert(1)", ng.NavAction.BLOCK, "scheme"),
            ("data:text/html,x", ng.NavAction.BLOCK, "scheme"),
            ("about:blank", ng.NavAction.BLOCK, "scheme"),
            ("", ng.NavAction.BLOCK, "invalid"),
            ("http://", ng.NavAction.BLOCK, "invalid"),
            ("http://exa mple.com", ng.NavAction.BLOCK, "invalid"),
            ("http://[::1", ng.NavAction.BLOCK, "invalid"),
            ("http://example.com:99999/", ng.NavAction.BLOCK, "invalid"),
            ("https://example.com/" + "a" * 9000, ng.NavAction.BLOCK, "invalid"),
        ],
    )
    def test_decision(self, url, action, reason):
        assert ng.decide(url, host=HOST, port=PORT) == ng.NavDecision(action, reason)


class TestNavigationStarting:
    def test_app_navigation_proceeds(self):
        opened: list[str] = []
        backend = _installed_backend(opened)
        args = FakeNavArgs(f"{APP}/#t=secret")
        backend.on_navigation_start(None, args)
        assert args.Cancel is False
        assert opened == []

    def test_external_web_navigation_moves_to_the_browser(self):
        opened: list[str] = []
        backend = _installed_backend(opened)
        args = FakeNavArgs("https://example.com/page")
        with capture_logs() as logs:
            backend.on_navigation_start(None, args)
        assert args.Cancel is True
        assert opened == ["https://example.com/page"]
        assert {
            "event": "navigation_refused",
            "reason": "external_web",
            "opened_externally": True,
            "log_level": "info",
        } in logs

    def test_other_schemes_are_cancelled_and_never_opened(self):
        opened: list[str] = []
        backend = _installed_backend(opened)
        args = FakeNavArgs("ms-settings:")
        with capture_logs() as logs:
            backend.on_navigation_start(None, args)
        assert args.Cancel is True
        assert opened == []
        assert {
            "event": "navigation_refused",
            "reason": "scheme",
            "opened_externally": False,
            "log_level": "info",
        } in logs

    def test_an_unreadable_url_is_cancelled(self):
        backend = _installed_backend([])
        args = BrokenNavArgs()
        with capture_logs() as logs:
            backend.on_navigation_start(None, args)
        assert args.Cancel is True
        assert logs[0]["reason"] == "unreadable"

    def test_logs_never_carry_the_url(self):
        backend = _installed_backend([])
        with capture_logs() as logs:
            backend.on_navigation_start(None, FakeNavArgs(f"{APP}/#t=secret-token"))
            backend.on_navigation_start(
                None, FakeNavArgs("https://example.com/?t=secret-token")
            )
        assert "secret-token" not in repr(logs)


class TestNewWindowRequested:
    def test_external_web_url_goes_to_the_browser(self):
        opened: list[str] = []
        backend = _installed_backend(opened)
        args = FakeNewWindowArgs("https://example.com/")
        backend.on_new_window_request(None, args)
        assert args.handled is True
        assert opened == ["https://example.com/"]

    @pytest.mark.parametrize(
        "url,reason",
        [
            ("ms-settings:", "scheme"),
            ("file:///C:/", "scheme"),
            (f"{APP}/api/x", "app_origin"),
        ],
    )
    def test_anything_else_is_dropped(self, url, reason):
        opened: list[str] = []
        backend = _installed_backend(opened)
        args = FakeNewWindowArgs(url)
        with capture_logs() as logs:
            backend.on_new_window_request(None, args)
        assert args.handled is True
        assert opened == []
        assert {
            "event": "new_window_refused",
            "reason": reason,
            "opened_externally": False,
            "log_level": "info",
        } in logs


class TestInstall:
    def test_load_failure_is_logged(self):
        def boom():
            raise ImportError("no pythonnet")

        with capture_logs() as logs:
            assert ng.install(host=HOST, port=PORT, load_backend=boom) is False
        assert logs == [
            {
                "event": "nav_guard",
                "installed": False,
                "reason": "load_failed",
                "error_type": "ImportError",
                "log_level": "warning",
            }
        ]

    def test_another_renderer_is_logged(self):
        with capture_logs() as logs:
            assert ng.install(host=HOST, port=PORT, load_backend=lambda: None) is False
        assert logs[0]["reason"] == "renderer"

    def test_a_changed_backend_is_left_alone(self):
        class Changed:
            pass

        with capture_logs() as logs:
            assert (
                ng.install(host=HOST, port=PORT, load_backend=lambda: Changed) is False
            )
        assert logs[0]["reason"] == "backend_changed"

    def test_an_unvalidated_version_still_installs_and_says_so(self):
        cls = _backend_class()
        with capture_logs() as logs:
            assert ng.install(
                host=HOST, port=PORT, load_backend=lambda: cls, version=lambda: "6.1"
            )
        assert logs == [
            {
                "event": "nav_guard",
                "installed": True,
                "pywebview": "6.1",
                "validated": False,
                "log_level": "info",
            }
        ]

    def test_the_build_pins_the_validated_pywebview(self):
        workflow = (ROOT / ".github" / "workflows" / "build.yml").read_text(
            encoding="utf-8"
        )
        pinned = re.search(r"pywebview==([0-9.]+)", workflow)
        assert pinned is not None
        assert pinned.group(1) == ng.VALIDATED_PYWEBVIEW


class TestOpenExternal:
    def test_web_urls_are_opened_off_the_calling_thread(self):
        calls: list[str] = []
        spawned: list = []
        assert ng.open_external(
            "https://example.com/", opener=calls.append, spawn=spawned.append
        )
        assert calls == []
        spawned[0]()
        assert calls == ["https://example.com/"]

    def test_other_urls_are_refused(self):
        calls: list[str] = []
        with capture_logs() as logs:
            assert not ng.open_external(
                "file:///C:/", opener=calls.append, spawn=lambda w: w()
            )
        assert calls == []
        assert logs == [
            {
                "event": "external_open_refused",
                "reason": "scheme",
                "log_level": "warning",
            }
        ]

    def test_an_opener_failure_is_logged_not_raised(self):
        def fail(_url: str) -> None:
            raise OSError("no browser")

        with capture_logs() as logs:
            assert ng.open_external(
                "https://example.com/", opener=fail, spawn=lambda w: w()
            )
        assert logs == [
            {
                "event": "external_open_failed",
                "error_type": "OSError",
                "log_level": "warning",
            }
        ]
