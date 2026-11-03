"""Time the sidebar poll (per service) and the largest chat load on an archive COPY.

Never point this at the live archive folder: copy the JSON files first, e.g.
  rsync -a --include='*/' --include='*.json' --exclude='*' \
    "/mnt/c/D/SakaDesk Output/" /tmp/claude-bench-archive/
  uv run python scripts/bench_read_path.py /tmp/claude-bench-archive --runs 5

The sidebar workload mirrors the app: for each service, the groups listing is
fetched with the service filter, then unread counts are requested with read
states keyed like the frontend (member path for single-member rooms, group path
for group chats). Run 1 starts with a cold StatCache (the OS file cache is warm
from the copy); later runs hit the StatCache.
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
from backend.services import messages_cache  # noqa: E402
from backend.services.service_utils import get_service_identifier  # noqa: E402

log = logging.getLogger("bench")

MIB = 1048576


def _timed(fn: Callable[[], object], runs: int) -> list[float]:
    out = []
    for _ in range(runs):
        t0 = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t0) * 1000)
    return out


def _service_ids(root: Path) -> list[str]:
    ids = []
    for d in sorted(root.iterdir()):
        if d.is_dir() and (d / "messages").is_dir():
            sid = get_service_identifier(d.name)
            if sid:
                ids.append(sid)
    return ids


def _read_states_for(groups: list[dict]) -> dict[str, dict]:
    """Key read states like the frontend's getGroupDisplayInfo."""
    states: dict[str, dict] = {}
    for g in groups:
        if g["is_group_chat"] or g["member_count"] > 1:
            key = g["group_path"]
        else:
            member = g["members"][0] if g["members"] else None
            key = (member or {}).get("path") or g["group_path"]
        states[key] = {"lastReadId": 0, "revealedIds": []}
    return states


def _positive_runs(value: str) -> int:
    n = int(value)
    if n < 2:
        raise argparse.ArgumentTypeError("--runs must be >= 2 (cold run + warm runs)")
    return n


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("archive", type=Path)
    ap.add_argument("--runs", type=_positive_runs, default=5)
    args = ap.parse_args()
    root: Path = args.archive
    files = sorted(
        root.glob("*/messages/*/*/messages.json"), key=lambda p: p.stat().st_size
    )
    if not files:
        raise SystemExit("no messages.json under archive")

    services = _service_ids(root)
    plans: dict[str, dict[str, dict]] = {}
    for sid in services:
        groups = _collect_groups(root, sid)["groups"]
        plans[sid] = _read_states_for(groups)

    # Sanity before timing: every key resolves and counts are not all zero.
    total_keys = 0
    nonzero = 0
    for sid, states in plans.items():
        counts = _compute_unread_counts(root, states)
        if set(counts) != set(states):
            raise SystemExit(f"{sid}: unread result keys differ from request keys")
        for key in states:
            if not (root / key).exists():
                raise SystemExit(f"{sid}: key does not resolve to a path: {key}")
        total_keys += len(states)
        nonzero += sum(1 for c in counts.values() if c > 0)
    if total_keys == 0 or nonzero == 0:
        raise SystemExit("sanity check failed: no keys or all unread counts are zero")

    # Fresh cold-StatCache measurement: drop the caches populated by the sanity pass.
    messages_cache._MESSAGES_CACHE._entries.clear()

    log.info(
        "files=%d total=%.1fMiB largest=%.1fMiB services=%d rooms=%d (unread>0: %d)",
        len(files),
        sum(f.stat().st_size for f in files) / MIB,
        files[-1].stat().st_size / MIB,
        len(services),
        total_keys,
        nonzero,
    )

    all_first = 0.0
    all_rest = 0.0
    for sid in services:
        states = plans[sid]

        def poll(sid: str = sid, states: dict = states) -> None:
            _collect_groups(root, sid)
            _compute_unread_counts(root, states)

        ms = _timed(poll, args.runs)
        rest = statistics.median(ms[1:])
        all_first += ms[0]
        all_rest += rest
        log.info(
            "sidebar poll [%s, %d rooms]: first=%.0fms (cold StatCache, warm OS cache) "
            "median(rest)=%.1fms",
            sid,
            len(states),
            ms[0],
            rest,
        )
    log.info(
        "sidebar poll [all services summed]: first=%.0fms (cold StatCache, warm OS "
        "cache) median(rest)=%.1fms",
        all_first,
        all_rest,
    )

    largest = files[-1]
    chat_ms = _timed(
        lambda: _load_member_messages(largest, 0, 0, output_dir=root), args.runs
    )
    log.info(
        "largest chat load (%.1fMiB): first=%.0fms median=%.0fms",
        largest.stat().st_size / MIB,
        chat_ms[0],
        statistics.median(chat_ms),
    )


if __name__ == "__main__":
    main()
