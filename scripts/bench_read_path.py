"""Time one sidebar poll cycle and the largest chat load on an archive COPY.

Never point this at the live archive folder: copy it first, e.g.
  cp -r "/mnt/c/D/SakaDesk Output" /tmp/claude-bench-archive
  uv run python scripts/bench_read_path.py /tmp/claude-bench-archive --runs 5
"""

import argparse
import logging
import statistics
import sys
import time
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.api.content import (  # noqa: E402
    _collect_groups,
    _compute_unread_counts,
    _load_member_messages,
)

log = logging.getLogger("bench")


def _timed(fn: Callable[[], object], runs: int) -> list[float]:
    out = []
    for _ in range(runs):
        t0 = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t0) * 1000)
    return out


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("archive", type=Path)
    ap.add_argument("--runs", type=int, default=5)
    args = ap.parse_args()
    root: Path = args.archive
    files = sorted(
        root.glob("*/messages/*/*/messages.json"), key=lambda p: p.stat().st_size
    )
    if not files:
        raise SystemExit("no messages.json under archive")
    read_states = {
        str(f.parent.relative_to(root)).replace("\\", "/"): {
            "lastReadId": 0,
            "revealedIds": [],
        }
        for f in files
    }

    def poll() -> None:
        _collect_groups(root, None)
        _compute_unread_counts(root, read_states)

    poll_ms = _timed(poll, args.runs)
    largest = files[-1]
    chat_ms = _timed(lambda: _load_member_messages(largest, 0, 0), args.runs)
    total_mb = sum(f.stat().st_size for f in files) / 1048576
    log.info(
        "files=%d total=%.1fMB largest=%.1fMB",
        len(files),
        total_mb,
        largest.stat().st_size / 1048576,
    )
    log.info(
        "sidebar poll: first=%.0fms median(rest)=%.1fms",
        poll_ms[0],
        statistics.median(poll_ms[1:] or poll_ms),
    )
    log.info("largest chat load: median=%.0fms", statistics.median(chat_ms))


if __name__ == "__main__":
    main()
