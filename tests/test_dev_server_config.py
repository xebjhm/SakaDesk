"""Dev-server guards (security audit 2026-11-13).

The Vite dev server proxies the local API. Bound to 0.0.0.0 with
changeOrigin it handed the whole API to the LAN; it must stay on loopback and
forward the browser's own Host so the backend's checks still apply. It must
also hold no token: a proxy that adds the token hands the whole API (with the
developer's real data and sign-ins) to every local process that can reach
the dev port. The page authenticates itself with the ``#t=`` URL that dev.sh
and dev.ps1 build, as SakaDesk's own windows do.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _read(*parts: str) -> str:
    return ROOT.joinpath(*parts).read_text(encoding="utf-8")


def test_vite_dev_server_stays_on_loopback_and_keeps_host():
    text = _read("frontend", "vite.config.ts")
    assert "0.0.0.0" not in text
    assert "changeOrigin" not in text
    # 127.0.0.1, not localhost: Node on Windows resolves localhost to ::1 only.
    assert "host: '127.0.0.1'" in text


def test_vite_dev_proxy_holds_no_token():
    text = _read("frontend", "vite.config.ts")
    assert "X-SakaDesk-Token" not in text
    assert "SAKADESK_API_TOKEN" not in text


def test_dev_scripts_share_one_api_token():
    for script in ("dev.sh", "dev.ps1"):
        assert "SAKADESK_API_TOKEN" in _read(script)


def test_dev_scripts_open_the_app_with_the_token_in_the_fragment():
    assert "http://127.0.0.1:$FRONTEND_PORT/#t=$SAKADESK_API_TOKEN" in _read("dev.sh")
    ps1 = _read("dev.ps1")
    assert "http://127.0.0.1:$FrontendPort/#t=$($env:SAKADESK_API_TOKEN)" in ps1
    assert "Start-Process $AppUrl" in ps1


def test_dev_ps1_locks_the_token_file_to_the_current_user():
    ps1 = _read("dev.ps1")
    assert "icacls $TokenFile /inheritance:r /grant:r" in ps1
    assert "$LASTEXITCODE -ne 0" in ps1
    # The ACL goes on the empty file, before the token is written into it.
    assert ps1.index("icacls $TokenFile") < ps1.index("Set-Content -Path $TokenFile")


def test_dev_scripts_draw_a_new_token_per_launch():
    sh = _read("dev.sh")
    ps1 = _read("dev.ps1")
    # No reuse of an existing token file: it is always removed and rewritten.
    assert 'rm -f "$TOKEN_FILE"\n        if ! (umask 077' in sh
    assert "Get-Content $TokenFile" not in ps1
    assert "Remove-Item $TokenFile -Force" in ps1
    # Drawn once per start/restart, not again by each server starter.
    assert sh.count("ensure_api_token ||") == 1
    assert ps1.count("Initialize-ApiToken  #") == 2


def test_dev_scripts_probe_the_frontend_on_ipv4_loopback():
    assert "http://127.0.0.1:$FRONTEND_PORT/" in _read("dev.sh")
    assert 'Test-HttpOk "http://127.0.0.1:$FrontendPort"' in _read("dev.ps1")


def test_dev_api_token_file_is_gitignored():
    lines = _read(".gitignore").splitlines()
    assert ".dev-api-token" in [line.strip() for line in lines]


def test_e2e_sends_the_api_token():
    text = _read("frontend", "playwright.config.ts")
    assert "X-SakaDesk-Token" in text and "SAKADESK_API_TOKEN" in text
    # One token for the config and launch-auth.spec.ts, never two literals.
    assert "from './e2e/apiToken'" in text
    assert "process.env.SAKADESK_API_TOKEN" in _read("frontend", "e2e", "apiToken.ts")
    spec = _read("frontend", "e2e", "launch-auth.spec.ts")
    assert "from './apiToken'" in spec
    assert "extraHTTPHeaders: {}" in spec
