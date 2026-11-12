"""Time the warm Memories album open (server side) on a synthetic archive.

The album's second open sends ``/album/members``, ``/album/colors`` and
``/album/months`` at once, then ``/album/month/<newest>`` when the months
arrive. This harness builds a synthetic archive (in a temp dir, never the live
one), warms every view once, then times warm requests through the real
FastAPI app (``httpx`` + ASGI transport, so routing and JSON serialisation are
included):

- each endpoint alone (median of ``--runs``);
- the three opening requests concurrently, then the month (the open's chain).

  uv run python scripts/bench_album_warm.py --rooms 28 --messages 4000 --runs 7

Only timings are logged (no paths, no text).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import random
import statistics
import sys
import tempfile
import time
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import structlog

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from backend.main import app  # noqa: E402
from backend.services import app_state  # noqa: E402
from backend.services.memories import index as mi  # noqa: E402
from backend.services.memories import oshi as oshi_mod  # noqa: E402
from backend.services.memories import people  # noqa: E402

log = logging.getLogger("bench")

SERVICE = "hinatazaka46"
SVC_NAME = "日向坂46"
LINE = "今日はとても楽しかったです！また明日も頑張ります🌻 みんなありがとう。"


def _build(sdir: Path, rooms: int, messages: int, months: int) -> None:
    """``rooms`` rooms of ``messages`` rows; ~1 in 8 is a picture or a video."""
    rnd = random.Random(7)
    end = datetime(2026, 11, 10, tzinfo=timezone.utc)
    span = timedelta(days=30 * months)
    for r in range(rooms):
        room = f"messages/{100 + r} 部屋{r}/{200 + r} 名前{r}"
        d = sdir / room
        d.mkdir(parents=True, exist_ok=True)
        rows = []
        for i in range(messages):
            ts = end - span * (1 - i / messages)
            kind = rnd.random()
            row: dict = {
                "id": r * 1_000_000 + i,
                "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "type": "text",
                "content": LINE * rnd.randint(1, 4),
                "is_favorite": rnd.random() < 0.01,
            }
            if kind < 0.11:
                row["type"] = "picture"
                row["media_file"] = f"{room}/picture/{row['id']}.jpg".replace("/", "\\")
            elif kind < 0.125:
                row["type"] = "video"
                row["media_file"] = f"{room}/video/{row['id']}.mp4".replace("/", "\\")
            rows.append(row)
        (d / "messages.json").write_text(
            json.dumps({"member": {}, "messages": rows}, ensure_ascii=False),
            encoding="utf-8",
        )


async def _median(fn: Callable[[], Awaitable[object]], runs: int) -> float:
    out = []
    for _ in range(runs):
        t0 = time.perf_counter()
        await fn()
        out.append((time.perf_counter() - t0) * 1000)
    return statistics.median(out)


async def _run(args: argparse.Namespace, root: Path) -> None:
    mi.set_db_path(root / "idx.db")
    app_state.set_db_path(root / "app.db")
    app_state.init_db()
    out = root / "out"
    sdir = out / SVC_NAME
    t0 = time.perf_counter()
    _build(sdir, args.rooms, args.messages, args.months)
    size = sum(p.stat().st_size for p in sdir.rglob("messages.json"))
    log.info(
        "archive rooms=%d messages=%d json_mib=%.1f built_s=%.1f",
        args.rooms,
        args.messages,
        size / 1048576,
        time.perf_counter() - t0,
    )

    async def no_oshi(service: str) -> set[str]:
        return set()

    base = f"/api/memories/{SERVICE}/album"
    transport = httpx.ASGITransport(app=app)
    with (
        patch("backend.api.memories.get_output_dir", return_value=out),
        patch.object(people, "output_dir", lambda: out),
        patch.object(oshi_mod, "oshi_names", no_oshi),
    ):
        async with httpx.AsyncClient(
            transport=transport, base_url="http://127.0.0.1"
        ) as client:

            async def get(path: str) -> dict:
                r = await client.get(base + path)
                r.raise_for_status()
                return r.json()

            t0 = time.perf_counter()
            await get("/members")
            await get("/colors")
            newest = (await get("/months"))["months"][0]["month"]
            month_body = await get(f"/month/{newest}")
            log.info(
                "cold build_s=%.1f newest_items=%d",
                time.perf_counter() - t0,
                len(month_body["items"]),
            )
            for path in ("/members", "/colors", "/months", f"/month/{newest}"):
                ms = await _median(lambda p=path: get(p), args.runs)
                log.info("warm %-16s %7.1f ms", path.split("/")[1], ms)

            async def open_chain() -> None:
                await asyncio.gather(get("/members"), get("/colors"), get("/months"))
                await get(f"/month/{newest}")

            async def opening() -> None:
                await asyncio.gather(get("/members"), get("/colors"), get("/months"))

            log.info(
                "warm opening (members+colors+months at once) %7.1f ms",
                await _median(opening, args.runs),
            )
            log.info(
                "warm open chain (opening, then the month)    %7.1f ms",
                await _median(open_chain, args.runs),
            )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(logging.WARNING)
    )
    ap = argparse.ArgumentParser()
    ap.add_argument("--rooms", type=int, default=28)
    ap.add_argument("--messages", type=int, default=4000)
    ap.add_argument("--months", type=int, default=28)
    ap.add_argument("--runs", type=int, default=7)
    args = ap.parse_args()
    with tempfile.TemporaryDirectory(prefix="album-bench-") as tmp:
        asyncio.run(_run(args, Path(tmp)))


if __name__ == "__main__":
    main()
