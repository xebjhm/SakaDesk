"""Collects the messages that were genuinely new on disk during one sync run.

pysaka's ``SyncManager.sync_member(..., on_new_messages=cb)`` calls
``cb(member_info, new_messages)`` once after a successful write when at least
one message was not on disk before. This collector is that callback target: it
drops first-sync history (``initial_sync``) and withdrawn rows, and keeps a
visible count and the newest visible message per ``(group_id, member_id)``.

Its counts are the only source of the "new messages" totals; the count that
``sync_member`` returns includes re-fetched overlap and is not a new-message
count. The notification planner reads :meth:`entries`.

Logs carry ids, counts and error types only, never names or message text.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import structlog

from backend.services.message_visibility import is_hidden_message

logger = structlog.get_logger(__name__)


@dataclass
class CollectedChat:
    """New visible messages collected for one member (or room author 0)."""

    group_id: str
    group_name: str
    member_id: str
    member_name: str
    member_dir: Path
    count: int
    newest: dict[str, Any]


def newest_key(message: dict[str, Any]) -> tuple[str, str]:
    """Sort key: timestamp, then id (zero-padded so numeric ids order right)."""
    return (str(message.get("timestamp") or ""), str(message.get("id", "")).zfill(20))


class NewMessageCollector:
    """Per-run accumulator of genuinely new, visible messages."""

    def __init__(self, service: str) -> None:
        self._service = service
        self._chats: dict[tuple[str, str], CollectedChat] = {}
        self._skipped_initial = 0
        self._skipped_hidden = 0

    def on_new_messages(
        self, member_info: dict[str, Any], new_messages: list[dict[str, Any]]
    ) -> None:
        """pysaka ``on_new_messages`` callback. Never raises."""
        try:
            self._collect(member_info, new_messages)
        except Exception as e:
            logger.warning(
                "notify_collect_failed",
                service=self._service,
                error_type=type(e).__name__,
            )

    def _collect(
        self, member_info: dict[str, Any], new_messages: list[dict[str, Any]]
    ) -> None:
        group_id = str(member_info["group_id"])
        member_id = str(member_info["member_id"])

        if member_info.get("initial_sync"):
            self._skipped_initial += len(new_messages)
            logger.info(
                "notify_collect_skip",
                service=self._service,
                reason="initial_sync",
                group_id=group_id,
                member_id=member_id,
                count=len(new_messages),
            )
            return

        visible = [m for m in new_messages if not is_hidden_message(m)]
        hidden = len(new_messages) - len(visible)
        # Everything that can raise happens before any counter moves, so a
        # swallowed failure leaves neither a partial counter nor a partial entry.
        newest = max(visible, key=newest_key) if visible else None
        member_dir = Path(member_info["member_dir"]) if visible else None

        if hidden:
            self._skipped_hidden += hidden
            logger.info(
                "notify_collect_skip",
                service=self._service,
                reason="hidden",
                group_id=group_id,
                member_id=member_id,
                count=hidden,
            )
        if newest is None or member_dir is None:
            return

        key = (group_id, member_id)
        existing = self._chats.get(key)
        if existing is None:
            self._chats[key] = CollectedChat(
                group_id=group_id,
                group_name=str(member_info.get("group_name") or ""),
                member_id=member_id,
                member_name=str(member_info.get("member_name") or ""),
                member_dir=member_dir,
                count=len(visible),
                newest=newest,
            )
            return
        existing.count += len(visible)
        if newest_key(newest) >= newest_key(existing.newest):
            existing.newest = newest

    def counts(self) -> dict[tuple[str, str], int]:
        """``{(group_id, member_id): visible new message count}``."""
        return {k: c.count for k, c in self._chats.items()}

    def entries(self) -> list[CollectedChat]:
        """The collected per-member records."""
        return list(self._chats.values())

    def log_summary(self) -> None:
        """Log ``notify_collected`` once per sync."""
        logger.info(
            "notify_collected",
            service=self._service,
            members=len(self._chats),
            messages=sum(c.count for c in self._chats.values()),
            skipped_initial=self._skipped_initial,
            skipped_hidden=self._skipped_hidden,
        )
