"""Dev-server guards (security audit 2026-11-13).

The Vite dev server proxies the local API. Bound to 0.0.0.0 with
changeOrigin it handed the whole API to the LAN; it must stay on loopback and
forward the browser's own Host so the backend's checks still apply.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_vite_dev_server_stays_on_loopback_and_keeps_host():
    text = (ROOT / "frontend" / "vite.config.ts").read_text(encoding="utf-8")
    assert "0.0.0.0" not in text
    assert "changeOrigin" not in text
    assert "SAKADESK_API_TOKEN" in text


def test_dev_scripts_share_one_api_token():
    for script in ("dev.sh", "dev.ps1"):
        assert "SAKADESK_API_TOKEN" in (ROOT / script).read_text(encoding="utf-8")


def test_dev_api_token_file_is_gitignored():
    lines = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert ".dev-api-token" in [line.strip() for line in lines]


def test_e2e_sends_the_api_token():
    text = (ROOT / "frontend" / "playwright.config.ts").read_text(encoding="utf-8")
    assert "X-SakaDesk-Token" in text and "SAKADESK_API_TOKEN" in text
