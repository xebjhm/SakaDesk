"""Pure planner: decides which toasts to send for one sync run.

Takes the per-member records from ``NewMessageCollector.entries()`` and returns
one :class:`ToastPlan` per 1:1 member or per room, plus :class:`Skip` records
for everything that was suppressed. It never logs and reads no settings; the
caller logs the skips. The only I/O is :func:`find_avatar`, which lists a
directory.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.services.chat_kind import is_group_chat
from backend.services.new_message_collector import CollectedChat, newest_key
from backend.services.nickname import apply_nickname

PREVIEW_MAX_CHARS = 80
ROOM_MEMBER_ID = "0"
AVATAR_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".jfif"})
AVATAR_DIRS = ("thumbnail", "phone_image")

_MEDIA_STRING_KEYS = {
    "picture": "sent_photo",
    "video": "sent_video",
    "voice": "sent_voice",
}


@dataclass(frozen=True)
class ChatTarget:
    """Identifies a chat the way the frontend addresses it."""

    service: str
    path: str  # "<service display>/messages/<group dir>[/<member dir>]", POSIX
    name: str  # member name (1:1) or room name (room)
    is_group_chat: bool


@dataclass(frozen=True)
class ToastPlan:
    """One toast to show."""

    target: ChatTarget
    group_id: str
    member_id: str  # "0" for a room toast
    title: str
    body: str
    avatar: Path | None
    count: int  # visible new messages in this chat
    newest_type: str  # text|picture|video|voice (as stored)
    newest_id: str  # id of the newest message ("" when it has none)


@dataclass(frozen=True)
class MemoryToastPlan:
    """One Memories toast (spec 15), built by ``memories.notify_content``."""

    kind: str  # on_this_day | birthday | birthday_soon | anniversary | recap | card
    service: str  # the service the click opens (never "*")
    subject: str  # ledger subject
    occasion: str  # ledger occasion
    title: str
    body: str
    avatar: Path | None  # AppLogo image (find_avatar of her newest room)
    hero: Path | None  # Hero image (On This Day photo), None when hidden
    route: Mapping[str, str | int]  # the Memories route, camelCase keys
    member_id: str | None  # for logs


@dataclass(frozen=True)
class Skip:
    """A chat that was suppressed. ``reason``: diverted|disabled|viewing."""

    reason: str
    group_id: str
    member_id: str
    count: int


@dataclass(frozen=True)
class UiState:
    """What the user is looking at. ``member_id`` is ``"0"`` for a room."""

    service: str | None
    group_id: str | None
    member_id: str | None
    focused: bool


def clip_text(text: str, limit: int = PREVIEW_MAX_CHARS) -> str:
    """``text`` whitespace-collapsed, cut to ``limit`` characters plus ``…``."""
    text = " ".join(text.split())
    return text[:limit] + "…" if len(text) > limit else text


def preview_text(
    message: dict[str, Any], strings: dict[str, str], nickname: str | None = None
) -> str:
    """One-line preview of ``message``.

    The nickname placeholder (``%%%`` / ``％％％``) is replaced by ``nickname``
    first (left as is when ``nickname`` is empty); then :func:`clip_text`
    whitespace-collapses it and cuts it to 80 characters (plus ``…``).
    Pictures, videos and voice use their localized label; empty text and
    unknown types use ``sent_message``.
    """
    kind = message.get("type")
    media_key = _MEDIA_STRING_KEYS.get(str(kind))
    if media_key is not None:
        return strings[media_key]
    if kind == "text":
        text = clip_text(apply_nickname(str(message.get("content") or ""), nickname))
        if text:
            return text
    return strings["sent_message"]


def find_avatar(member_dir: Path) -> Path | None:
    """Newest (by file name) image in ``profile_images/thumbnail``, else ``phone_image``."""
    for sub in AVATAR_DIRS:
        folder = member_dir / "profile_images" / sub
        try:
            images = [
                p
                for p in folder.iterdir()
                if p.suffix.lower() in AVATAR_SUFFIXES and p.is_file()
            ]
        except OSError:
            continue
        if images:
            return max(images, key=lambda p: p.name)
    return None


def _chat_path(chat_dir: Path, output_service_dir: Path, service_display: str) -> str:
    """Path relative to the output root (the dir holding the service folder), POSIX."""
    try:
        return chat_dir.relative_to(output_service_dir.parent).as_posix()
    except ValueError:
        # Outside the output root: rebuild from the folder names under the LAST
        # "messages" component (a parent folder may be called "messages" too).
        parts = chat_dir.parts
        last = (
            len(parts) - 1 - parts[::-1].index("messages")
            if "messages" in parts
            else -1
        )
        tail = parts[last + 1 :] if last >= 0 else parts[-1:]
        return "/".join((service_display, "messages", *tail))


def _room_name(group_dir: Path, group_id: str) -> str:
    return group_dir.name.removeprefix(f"{group_id} ")


def plan_toasts(
    chats: list[CollectedChat],
    *,
    service: str,
    service_display: str,
    output_service_dir: Path,
    ui_state: UiState,
    enabled: bool,
    hide_content: bool,
    strings: dict[str, str],
    avatar_for: Callable[[Path], Path | None],
    divert: Callable[[ToastPlan], bool],
    member_count_for: Callable[[str], int],
    nickname: str | None = None,
) -> tuple[list[ToastPlan], list[Skip]]:
    """Plan one toast per 1:1 member or room, and report what was skipped.

    Rules apply per chat in this order: diverted (the C3 hook, which receives
    every fully built :class:`ToastPlan`, even when notifications are off, and
    returns True to suppress it), disabled, viewing (focused app on that
    chat). ``member_count_for(group_id)``
    is the number of member folders in the group, which together with
    ``GROUP_CHAT_IDS`` decides whether a chat is a room. ``nickname`` replaces
    the nickname placeholder in text previews.
    """
    # Group: a room is one chat keyed by group_id; a 1:1 member is its own chat.
    grouped: dict[tuple[str, str], list[CollectedChat]] = {}
    room_groups: dict[str, bool] = {}
    for c in chats:
        if c.group_id not in room_groups:
            room_groups[c.group_id] = is_group_chat(
                service, c.group_id, member_count_for(c.group_id)
            )
        key = (c.group_id, ROOM_MEMBER_ID if room_groups[c.group_id] else c.member_id)
        grouped.setdefault(key, []).append(c)

    plans: list[ToastPlan] = []
    skips: list[Skip] = []
    for (group_id, member_id), members in grouped.items():
        is_room = member_id == ROOM_MEMBER_ID and room_groups[group_id]
        count = sum(m.count for m in members)
        newest_chat = max(members, key=lambda m: newest_key(m.newest))
        newest = newest_chat.newest

        if is_room:
            group_dir = newest_chat.member_dir.parent
            name = _room_name(group_dir, group_id)
            path = _chat_path(group_dir, output_service_dir, service_display)
        else:
            name = newest_chat.member_name
            path = _chat_path(
                newest_chat.member_dir, output_service_dir, service_display
            )
        target = ChatTarget(
            service=service, path=path, name=name, is_group_chat=is_room
        )

        if hide_content:
            body = strings["hidden_body"]
        else:
            body = preview_text(newest, strings, nickname)
            if is_room:
                body = f"{newest_chat.member_name}: {body}"
        if count > 1:
            body = f"{body}\n{strings['more'].format(n=count - 1)}"

        plan = ToastPlan(
            target=target,
            group_id=group_id,
            member_id=member_id,
            title=name,
            body=body,
            avatar=avatar_for(newest_chat.member_dir),
            count=count,
            newest_type=str(newest.get("type", "")),
            newest_id=str(newest.get("id", "")),
        )
        if divert(plan):
            skips.append(Skip("diverted", group_id, member_id, count))
            continue
        if not enabled:
            skips.append(Skip("disabled", group_id, member_id, count))
            continue
        if (
            ui_state.focused
            and ui_state.service == service
            and ui_state.group_id == group_id
            and ui_state.member_id == member_id
        ):
            skips.append(Skip("viewing", group_id, member_id, count))
            continue
        plans.append(plan)
    return plans, skips
