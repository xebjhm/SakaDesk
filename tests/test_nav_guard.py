"""nav_guard: SakaDesk's windows stay on the app origin; other web URLs open in
the browser; nothing else is opened (security audit 2026-11-13,
desktop.py/main-window/unrestricted-navigation-from-blog-links)."""

from __future__ import annotations

import re
import sys
import types
from pathlib import Path
from types import SimpleNamespace

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
            ("http://127.0.0.1:9999/", ng.NavAction.BLOCK, "loopback"),
            ("http://localhost:8765/", ng.NavAction.BLOCK, "loopback"),
            ("http://LOCALHOST./", ng.NavAction.BLOCK, "loopback"),
            ("http://app.localhost/", ng.NavAction.BLOCK, "loopback"),
            ("http://127.1.2.3/", ng.NavAction.BLOCK, "loopback"),
            ("http://[::1]:8765/", ng.NavAction.BLOCK, "loopback"),
            ("http://[::ffff:127.0.0.1]/", ng.NavAction.BLOCK, "loopback"),
            ("http://0.0.0.0:8765/", ng.NavAction.BLOCK, "loopback"),
            ("http://2130706433/", ng.NavAction.BLOCK, "loopback"),
            ("http://127.1:8765/", ng.NavAction.BLOCK, "loopback"),
            ("http://0x7f.0.0.1/", ng.NavAction.BLOCK, "loopback"),
            ("http://0/", ng.NavAction.BLOCK, "loopback"),
            ("http://[0:0:0:0:0:0:0:1]/", ng.NavAction.BLOCK, "loopback"),
            ("http://2130706434/", ng.NavAction.BLOCK, "loopback"),
            ("http://134744072/", ng.NavAction.EXTERNAL, "external_web"),
            ("http://[2001:db8::1]/", ng.NavAction.EXTERNAL, "external_web"),
            (f"{APP}/api/settings", ng.NavAction.BLOCK, "app_api"),
            (f"{APP}/api", ng.NavAction.BLOCK, "app_api"),
            (f"{APP}/%61pi/settings", ng.NavAction.BLOCK, "app_api"),
            (f"{APP}/docs", ng.NavAction.BLOCK, "app_api"),
            (f"{APP}/redoc", ng.NavAction.BLOCK, "app_api"),
            (f"{APP}/openapi.json", ng.NavAction.BLOCK, "app_api"),
            (f"{APP}/apiary", ng.NavAction.ALLOW, "app_origin"),
            ("https://127.0.0.1:8765/", ng.NavAction.BLOCK, "loopback"),
            ("http://localhost.example.com/", ng.NavAction.EXTERNAL, "external_web"),
            ('https://example.com/a"b', ng.NavAction.EXTERNAL, "external_web"),
            ("https://example.com/<x>", ng.NavAction.EXTERNAL, "external_web"),
            (
                "https://finance.example.com/quote/^N225",
                ng.NavAction.EXTERNAL,
                "external_web",
            ),
            ("https://example.com/?q=a`b", ng.NavAction.EXTERNAL, "external_web"),
            ("https://example.com/a%22b%20c", ng.NavAction.EXTERNAL, "external_web"),
            ("https://example.com/a\tb", ng.NavAction.BLOCK, "invalid"),
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


class TestIsLoopbackHost:
    @pytest.mark.parametrize(
        "host",
        [
            "localhost", "a.localhost", "127.0.0.1", "127.255.255.254",
            "0.0.0.0", "2130706433", "127.1", "127.0.1", "0x7f.0.0.1",
            "0x7f000001", "017700000001", "0177.0.0.1", "0", "00", "0x0", "0x", "0x.0x.0x.0x",
            "127.0.0.1.", "::1", "::", "0:0:0:0:0:0:0:1", "0:0:0:0:0:0:0:0",
            "::ffff:127.0.0.1", "::ffff:7f00:1", "::127.0.0.1", "::bad:",
        ],
    )  # fmt: skip
    def test_loopback(self, host):
        assert ng.is_loopback_host(host)

    @pytest.mark.parametrize(
        "host",
        [
            "example.com", "128.0.0.1", "134744072", "8.8.8.8", "1.2.3",
            "4294967296", "256.0.0.1", "1.2.3.4.5", "09", "1..1",
            "127.0.0.1x", "2001:db8::1", "1::", "localhost.example.com",
            "",
        ],
    )  # fmt: skip
    def test_not_loopback(self, host):
        assert not ng.is_loopback_host(host)


MALFORMED_HOSTS = [
    "0x-1", "0-1", "0x+7f", "0x7_f.0.0.1", "0x0x7f.0.0.1", "١٢٧.0.0.1",
    "+1", "-1", "1_0", "0_7", "0b1", "0o7", "0x1g", "08.0.0.1",
]  # fmt: skip


class TestMalformedHosts:
    @pytest.mark.parametrize("host", MALFORMED_HOSTS)
    def test_not_loopback_and_no_crash(self, host):
        assert not ng.is_loopback_host(host)

    @pytest.mark.parametrize("host", MALFORMED_HOSTS)
    def test_decide_returns(self, host):
        d = ng.decide(f"http://{host}/", host=HOST, port=PORT)
        assert d.action in (ng.NavAction.EXTERNAL, ng.NavAction.BLOCK)

    def test_navigation_handler_fails_closed(self, monkeypatch):
        backend = _installed_backend([])
        monkeypatch.setattr(ng, "decide", _boom)
        args = FakeNavArgs("https://example.com/secret")
        with capture_logs() as logs:
            backend.on_navigation_start(None, args)
        assert args.Cancel is True
        assert {
            "event": "navigation_refused",
            "reason": "decide_failed",
            "error_type": "RuntimeError",
            "log_level": "warning",
        } in logs
        assert "secret" not in repr(logs)

    def test_new_window_handler_fails_closed(self, monkeypatch):
        opened: list[str] = []
        backend = _installed_backend(opened)
        monkeypatch.setattr(ng, "decide", _boom)
        args = FakeNewWindowArgs("https://example.com/secret")
        with capture_logs() as logs:
            backend.on_new_window_request(None, args)
        assert args.handled is True
        assert opened == []
        assert {
            "event": "new_window_refused",
            "reason": "decide_failed",
            "error_type": "RuntimeError",
            "log_level": "warning",
        } in logs
        assert "secret" not in repr(logs)


def _boom(*_a, **_k):
    raise RuntimeError("boom")


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
            "external_requested": True,
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
            "external_requested": False,
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
            (f"{APP}/api/x", "app_api"),
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
            "external_requested": False,
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
                "log_level": "warning",
            }
        ]

    @pytest.mark.parametrize("relative", [".github/workflows/build.yml", "build.ps1"])
    def test_the_build_pins_the_validated_pywebview(self, relative):
        text = (ROOT / relative).read_text(encoding="utf-8")
        pinned = re.findall(r"pywebview==([0-9.]+)", text)
        assert pinned, relative
        assert set(pinned) == {ng.VALIDATED_PYWEBVIEW}


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

    def test_shell_sensitive_characters_reach_the_browser_percent_encoded(self):
        """ShellExecute can misread these; percent-encoding is equivalent for HTTP."""
        calls: list[str] = []
        assert ng.open_external(
            'https://example.com/quote/^N225?q=a`b"<c>',
            opener=calls.append,
            spawn=lambda w: w(),
        )
        assert calls == ["https://example.com/quote/%5EN225?q=a%60b%22%3Cc%3E"]

    def test_the_success_is_logged_from_the_launch_not_before(self):
        spawned: list = []
        with capture_logs() as logs:
            assert ng.open_external(
                "https://example.com/", opener=lambda u: True, spawn=spawned.append
            )
            assert logs == []
            spawned[0]()
        assert logs == [{"event": "external_opened", "log_level": "info"}]

    def test_a_browser_that_declines_is_logged(self):
        with capture_logs() as logs:
            assert ng.open_external(
                "https://example.com/", opener=lambda u: False, spawn=lambda w: w()
            )
        assert logs == [
            {
                "event": "external_open_failed",
                "reason": "browser_refused",
                "log_level": "warning",
            }
        ]

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

    @pytest.mark.parametrize(
        ("url", "handed"),
        [
            ('https://e.com/"&calc', "https://e.com/%22&calc"),
            ("https://e.com/<x>", "https://e.com/%3Cx%3E"),
        ],
    )
    def test_shell_metacharacters_never_reach_the_shell_raw(self, url, handed):
        calls: list[str] = []
        assert ng.open_external(url, opener=calls.append, spawn=lambda w: w())
        assert calls == [handed]

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


class TestLoadEdgeChrome:
    """pywebview 5.3.2 rebinds ``webview.guilib`` to None at import, so the
    backend must be reached through ``from webview.guilib import initialize``."""

    @staticmethod
    def _fake_pywebview(monkeypatch, *, is_chromium, calls, edge):
        webview = types.ModuleType("webview")
        webview.__path__ = []
        webview.guilib = None
        guilib = types.ModuleType("webview.guilib")
        guilib.initialize = lambda *a: calls.append(a)
        platforms = types.ModuleType("webview.platforms")
        platforms.__path__ = []
        winforms = types.ModuleType("webview.platforms.winforms")
        winforms.is_chromium = is_chromium
        winforms.Chromium = SimpleNamespace(EdgeChrome=edge)
        platforms.winforms = winforms
        for name, mod in {
            "webview": webview,
            "webview.guilib": guilib,
            "webview.platforms": platforms,
            "webview.platforms.winforms": winforms,
        }.items():
            monkeypatch.setitem(sys.modules, name, mod)

    def test_returns_the_edge_class_after_initializing(self, monkeypatch):
        calls: list = []
        cls = _backend_class()
        self._fake_pywebview(monkeypatch, is_chromium=True, calls=calls, edge=cls)
        assert ng._load_edgechrome() is cls
        assert len(calls) == 1

    def test_another_renderer_returns_none(self, monkeypatch):
        calls: list = []
        self._fake_pywebview(
            monkeypatch, is_chromium=False, calls=calls, edge=_backend_class()
        )
        assert ng._load_edgechrome() is None
        assert len(calls) == 1
