"""Eval-free host→page scripts for pywebview 5.3.2's raw mode (security audit 2026-11-13).

The app CSP kept 'unsafe-eval' only because pywebview's evaluate_js wraps every
script in eval("..."). Raw mode skips the wrapper but (1) still passes the
script through escape_string and (2) JSON-decodes the result twice on
EdgeChromium, hanging the caller when the second decode fails. These tests run
the generated scripts in Node with string code generation disabled (as a CSP
without 'unsafe-eval' does) and decode the result the way pywebview does.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

import host_js
from hostjs_page import shape

HOSTILE = [
    '"',
    "\\",
    "\n",
    "\r",
    "</script>",
    "\u2028",
    "'",
    "%",
    "🌸",
    "金村",
    "${x}",
    "`",
]
FORBIDDEN = ('"', "\\", "\n", "\r")

NODE_RUNNER = r"""
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(process.argv[2], 'utf8');
const received = [];
const sandbox = { window: {
  __open(p) { received.push(p); return true; },
  __boom() { throw new TypeError('boom'); },
} };
const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
const completion = vm.runInContext(source, context);
process.stdout.write(JSON.stringify({ result: JSON.stringify(completion), received }));
"""


def _escape_string(script: str) -> str:
    """pywebview 5.3.2 webview/util.py escape_string, which raw mode still applies."""
    return (
        script.replace("\\", "\\\\")
        .replace('"', r"\"")
        .replace("\n", r"\n")
        .replace("\r", r"\r")
    )


def test_values_need_no_quote_backslash_or_newline():
    for value in [*HOSTILE, {"path": "".join(HOSTILE)}, [1, None, True, 2.5]]:
        assert not any(ch in host_js.js_value(value) for ch in FORBIDDEN)


def test_raw_mode_leaves_every_generated_script_unchanged():
    script = host_js.script(
        "window.__open(" + host_js.js_value({"p": "".join(HOSTILE)}) + ")"
    )
    assert _escape_string(script) == script


@pytest.mark.parametrize("ch", FORBIDDEN)
def test_script_refuses_characters_raw_mode_would_corrupt(ch):
    with pytest.raises(ValueError):
        host_js.script("f(" + ch + ")")


class _Window:
    def __init__(self, result):
        self.result, self.calls = result, []

    def evaluate_js(self, script, callback=None, raw=False):
        self.calls.append((script, raw))
        return self.result


def test_run_uses_raw_mode_and_returns_the_value():
    window = _Window({"v": True})
    assert host_js.run(window, "window.x ? true : false") is True
    ((script, raw),) = window.calls
    assert raw is True and shape(script) == "window.x ? true : false"


@pytest.mark.parametrize("result", [None, {}, "x", 5, {"v": None}, {"other": 1}])
def test_run_without_a_value_returns_none(result):
    assert host_js.run(_Window(result), "1") is None


def test_run_raises_for_a_page_error():
    with pytest.raises(host_js.HostScriptError) as exc:
        host_js.run(_Window({"e": "TypeError"}), "1")
    assert exc.value.name == "TypeError"


@pytest.fixture
def node():
    path = shutil.which("node")
    if path is None:
        if os.environ.get("CI"):
            pytest.fail("node is required on CI for the eval-free script check")
        pytest.skip("node is not installed")
    return path


def _run_like_webview2(node, tmp_path, script):
    (tmp_path / "script.js").write_text(script, encoding="utf-8")
    (tmp_path / "runner.js").write_text(NODE_RUNNER, encoding="utf-8")
    out = subprocess.run(
        [node, str(tmp_path / "runner.js"), str(tmp_path / "script.js")],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
        check=True,
    )
    data = json.loads(out.stdout)
    # ExecuteScriptAsync returns JSON of the completion value; pywebview's
    # EdgeChromium backend json.loads it, then json.loads the result again.
    first = json.loads(data["result"])
    result = None if first is None or first == "" else json.loads(first)
    return result, data["received"]


def test_scripts_run_with_string_code_generation_disabled(node, tmp_path):
    payload = {"path": "".join(HOSTILE), "id": 12}
    result, received = _run_like_webview2(
        node,
        tmp_path,
        host_js.script(
            "window.__open ? (window.__open("
            + host_js.js_value(payload)
            + "), true) : false"
        ),
    )
    assert result == {"v": True}
    assert received == [payload]


def test_a_page_error_comes_back_as_its_name(node, tmp_path):
    result, _ = _run_like_webview2(node, tmp_path, host_js.script("window.__boom()"))
    assert result == {"e": "TypeError"}


def test_a_missing_bridge_is_null_and_eval_itself_is_refused(node, tmp_path):
    assert _run_like_webview2(
        node, tmp_path, host_js.script("window.__missing ? 1 : null")
    )[0] == {"v": None}
    # The sandbox really forbids eval, so the scripts above do not depend on it.
    assert _run_like_webview2(node, tmp_path, host_js.script("eval('1')"))[0] == {
        "e": "EvalError"
    }


def test_js_value_survives_a_lone_surrogate():
    """An ill-formed Windows file name can hold one; quote() of raw UTF-8 would raise."""
    import host_js

    expr = host_js.js_value({"name": "a\ud800b"})
    assert '"' not in expr and "\\" not in expr and "\n" not in expr


# ---- the six production scripts, run in Node under a no-eval sandbox ----------

BRIDGES = [
    "__sakadeskOpenChat",
    "__sakadeskOpenLogin",
    "__sakadeskOpenMemories",
    "__sakadeskCallPopup",
    "__sakadeskMarkVoiceHeard",
]
PAGE_RUNNER = r"""
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(process.argv[2], 'utf8');
const mode = process.argv[3];
const names = JSON.parse(process.argv[4]);
const win = {};
if (mode !== 'missing') {
  for (const n of names) {
    const fn = mode === 'throws'
      ? () => { throw new TypeError('boom'); }
      : () => true;
    win[n] = n === '__sakadeskCallPopup' ? { start: fn, cancel: fn } : fn;
  }
}
const context = vm.createContext({ window: win }, { codeGeneration: { strings: false, wasm: false } });
process.stdout.write(JSON.stringify(vm.runInContext(source, context)));
"""


class _Recorder:
    """A window whose evaluate_js records the script and answers like a page."""

    def __init__(self):
        self.scripts: list[str] = []
        self.native = type("N", (), {"Handle": 1})()

    def show(self):
        pass

    def evaluate_js(self, script, callback=None, raw=False):
        self.scripts.append(script)
        return {"v": True}


def _production_scripts() -> dict[str, str]:
    import desktop
    from backend.services.desktop_bridge import HeardTarget
    from backend.services.notification_planner import ChatTarget
    from test_call_popup_window import FakeWindow, make

    out: dict[str, str] = {}
    for name, build, args in (
        (
            "open_chat",
            desktop.make_open_chat_handler,
            (ChatTarget("hinatazaka46", 'p"\\', "n", False), 5),
        ),
        ("open_login", desktop.make_open_login_handler, ('s"\\',)),
        (
            "open_memories",
            desktop.make_open_memories_handler,
            ("s", {"page": "memoir", "x": 'q"\\\n'}),
        ),
    ):
        win = _Recorder()
        build(win, lambda _h: None)(*args)
        (out[name],) = win.scripts
    popup, main = FakeWindow(), FakeWindow()
    w, _, _ = make([popup], main=main)
    assert w.start(7) is True
    w.cancel(7)
    w.deliver_heard(HeardTarget("hinatazaka46", 'p"\\金', 3))
    out["call_start"], out["call_cancel"] = popup.js
    (out["voice_heard"],) = main.js
    return out


@pytest.mark.parametrize(
    "name",
    [
        "open_chat",
        "open_login",
        "open_memories",
        "call_start",
        "call_cancel",
        "voice_heard",
    ],
)
@pytest.mark.parametrize("mode", ["missing", "true", "throws"])
def test_every_production_script_runs_under_a_no_eval_page(node, tmp_path, name, mode):
    script = _production_scripts()[name]
    (tmp_path / "script.js").write_text(script, encoding="utf-8")
    (tmp_path / "runner.js").write_text(PAGE_RUNNER, encoding="utf-8")
    out = subprocess.run(
        [
            node,
            str(tmp_path / "runner.js"),
            str(tmp_path / "script.js"),
            mode,
            json.dumps(BRIDGES),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
        check=True,
    )
    result = json.loads(json.loads(out.stdout))
    if mode == "throws":
        assert result == {"e": "TypeError"}
    else:
        # A missing bridge may complete with no value at all ({}), never with an error.
        assert "e" not in result


def test_error_fields_keep_only_a_plain_error_name():
    assert host_js.error_fields(host_js.HostScriptError("TypeError")) == {
        "js_error": "TypeError"
    }
    for hostile in ["", "a" * 33, "Type Error", "T\u00e9", "x:金村", "a.b"]:
        assert host_js.error_fields(host_js.HostScriptError(hostile)) == {
            "js_error": "other"
        }
    assert host_js.error_fields(RuntimeError("x")) == {}
