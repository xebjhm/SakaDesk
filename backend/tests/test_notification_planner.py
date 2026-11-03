"""Tests for the pure notification planner."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest

from backend.services.new_message_collector import CollectedChat
from backend.services.notification_planner import (
    ChatTarget,
    Skip,
    ToastPlan,
    UiState,
    find_avatar,
    plan_toasts,
    preview_text,
)

STRINGS = {
    "sent_photo": "Sent a photo",
    "sent_video": "Sent a video",
    "sent_voice": "Sent a voice message",
    "sent_message": "Sent a message",
    "hidden_body": "Sent a new message",
    "more": "+{n} more",
}
SERVICE = "hinatazaka46"
DISPLAY = "日向坂46"
IDLE = UiState(service=None, group_id=None, member_id=None, focused=False)


def msg(
    mid: int = 1,
    type_: str = "text",
    content: str | None = "hello",
    ts: str = "2026-11-04T10:00:00Z",
) -> dict[str, Any]:
    return {
        "id": mid,
        "timestamp": ts,
        "type": type_,
        "content": content,
        "state": "published",
    }


def chat(
    root: Path,
    *,
    group_id: str = "34",
    group_dir: str = "34 金村 美玖",
    member_id: str = "58",
    member_dir: str = "58 金村 美玖",
    member_name: str = "金村 美玖",
    group_name: str = "金村 美玖",
    count: int = 1,
    newest: dict[str, Any] | None = None,
) -> CollectedChat:
    return CollectedChat(
        group_id=group_id,
        group_name=group_name,
        member_id=member_id,
        member_name=member_name,
        member_dir=root / DISPLAY / "messages" / group_dir / member_dir,
        count=count,
        newest=newest if newest is not None else msg(),
    )


def run(
    chats: list[CollectedChat],
    root: Path,
    *,
    ui_state: UiState = IDLE,
    enabled: bool = True,
    hide_content: bool = False,
    avatar_for: Any = lambda _d: None,
    divert: Any = lambda _p: False,
    member_count_for: Any = lambda _g: 1,
) -> tuple[list[ToastPlan], list[Skip]]:
    return plan_toasts(
        chats,
        service=SERVICE,
        service_display=DISPLAY,
        output_service_dir=root / DISPLAY,
        ui_state=ui_state,
        enabled=enabled,
        hide_content=hide_content,
        strings=STRINGS,
        avatar_for=avatar_for,
        divert=divert,
        member_count_for=member_count_for,
    )


def room_chats(root: Path) -> list[CollectedChat]:
    kw: dict[str, Any] = {
        "group_id": "79",
        "group_dir": "79 日向坂46 ライブ",
        "group_name": "日向坂46 ライブ",
    }
    return [
        chat(
            root,
            member_id="1",
            member_dir="1 加藤 史帆",
            member_name="加藤 史帆",
            count=2,
            newest=msg(10, "text", "old", "2026-11-04T09:00:00Z"),
            **kw,
        ),
        chat(
            root,
            member_id="2",
            member_dir="2 齊藤 京子",
            member_name="齊藤 京子",
            count=3,
            newest=msg(11, "text", "newer", "2026-11-04T11:00:00Z"),
            **kw,
        ),
    ]


# ---------------------------------------------------------------- skip reasons


def test_disabled_skips_every_chat(tmp_path: Path) -> None:
    chats = [chat(tmp_path), *room_chats(tmp_path)]
    plans, skips = run(
        chats, tmp_path, enabled=False, member_count_for=lambda g: 2 if g == "79" else 1
    )
    assert plans == []
    assert [(s.reason, s.group_id, s.member_id, s.count) for s in skips] == [
        ("disabled", "34", "58", 1),
        ("disabled", "79", "0", 5),
    ]


def test_viewing_one_to_one_skipped_when_focused(tmp_path: Path) -> None:
    ui = UiState(service=SERVICE, group_id="34", member_id="58", focused=True)
    plans, skips = run([chat(tmp_path)], tmp_path, ui_state=ui)
    assert plans == []
    assert skips == [Skip("viewing", "34", "58", 1)]


def test_viewing_not_skipped_when_unfocused(tmp_path: Path) -> None:
    ui = UiState(service=SERVICE, group_id="34", member_id="58", focused=False)
    plans, skips = run([chat(tmp_path)], tmp_path, ui_state=ui)
    assert len(plans) == 1 and skips == []


@pytest.mark.parametrize(
    "ui",
    [
        UiState("nogizaka46", "34", "58", True),
        UiState(SERVICE, "35", "58", True),
        UiState(SERVICE, "34", "59", True),
        UiState(None, None, None, True),
    ],
)
def test_viewing_other_chat_not_skipped(tmp_path: Path, ui: UiState) -> None:
    plans, skips = run([chat(tmp_path)], tmp_path, ui_state=ui)
    assert len(plans) == 1 and skips == []


def test_viewing_room_uses_member_zero(tmp_path: Path) -> None:
    ui = UiState(service=SERVICE, group_id="79", member_id="0", focused=True)
    plans, skips = run(
        room_chats(tmp_path), tmp_path, ui_state=ui, member_count_for=lambda _g: 2
    )
    assert plans == []
    assert skips == [Skip("viewing", "79", "0", 5)]


def test_room_not_viewing_when_member_id_is_a_member(tmp_path: Path) -> None:
    ui = UiState(service=SERVICE, group_id="79", member_id="2", focused=True)
    plans, _ = run(
        room_chats(tmp_path), tmp_path, ui_state=ui, member_count_for=lambda _g: 2
    )
    assert len(plans) == 1


def test_divert_skips_and_receives_the_built_plan(tmp_path: Path) -> None:
    seen: list[ToastPlan] = []

    def divert(p: ToastPlan) -> bool:
        seen.append(p)
        return True

    plans, skips = run(
        [chat(tmp_path, newest=msg(7, type_="voice"))], tmp_path, divert=divert
    )
    assert plans == []
    assert skips == [Skip("diverted", "34", "58", 1)]
    (p,) = seen
    assert p.target == ChatTarget(
        SERVICE, "日向坂46/messages/34 金村 美玖/58 金村 美玖", "金村 美玖", False
    )
    assert p.newest_type == "voice" and p.newest_id == "7"
    assert p.body == "Sent a voice message"


def test_divert_false_keeps_the_same_plan(tmp_path: Path) -> None:
    seen: list[ToastPlan] = []

    def divert(p: ToastPlan) -> bool:
        seen.append(p)
        return False

    plans, skips = run([chat(tmp_path)], tmp_path, divert=divert)
    assert skips == [] and plans == seen


def test_rule_order_diverted_before_disabled_before_viewing(tmp_path: Path) -> None:
    seen: list[str] = []

    def yes(p: ToastPlan) -> bool:
        seen.append(p.member_id)
        return True

    def no(p: ToastPlan) -> bool:
        seen.append(p.member_id)
        return False

    _, skips = run([chat(tmp_path)], tmp_path, enabled=False, divert=yes)
    assert skips == [Skip("diverted", "34", "58", 1)] and seen == ["58"]
    seen.clear()
    _, skips = run([chat(tmp_path)], tmp_path, enabled=False, divert=no)
    assert skips == [Skip("disabled", "34", "58", 1)] and seen == ["58"]
    ui = UiState(SERVICE, "34", "58", True)
    _, skips = run([chat(tmp_path)], tmp_path, ui_state=ui, divert=no)
    assert skips == [Skip("viewing", "34", "58", 1)]


def test_disabled_still_offers_every_chat_to_divert(tmp_path: Path) -> None:
    offered: list[str] = []

    def divert(p: ToastPlan) -> bool:
        offered.append(p.member_id)
        return p.member_id == "58"

    other = chat(
        tmp_path,
        group_id="35",
        group_dir="35 小坂 菜緒",
        member_id="59",
        member_dir="59 小坂 菜緒",
        member_name="小坂 菜緒",
    )
    plans, skips = run([chat(tmp_path), other], tmp_path, enabled=False, divert=divert)
    assert plans == []
    assert offered == ["58", "59"]
    assert [s.reason for s in skips] == ["diverted", "disabled"]


def test_empty_input(tmp_path: Path) -> None:
    assert run([], tmp_path) == ([], [])


# -------------------------------------------------------------------- grouping


def test_one_to_one_plan_fields(tmp_path: Path) -> None:
    avatar = tmp_path / "a.jpg"
    seen: list[Path] = []

    def avatar_for(d: Path) -> Path | None:
        seen.append(d)
        return avatar

    plans, skips = run([chat(tmp_path, count=1)], tmp_path, avatar_for=avatar_for)
    assert skips == []
    (p,) = plans
    assert p.title == "金村 美玖"
    assert p.body == "hello"
    assert p.group_id == "34" and p.member_id == "58"
    assert p.count == 1 and p.newest_type == "text"
    assert p.newest_id == "1"
    assert p.avatar == avatar
    assert p.target == ChatTarget(
        SERVICE, "日向坂46/messages/34 金村 美玖/58 金村 美玖", "金村 美玖", False
    )
    assert seen == [tmp_path / DISPLAY / "messages" / "34 金村 美玖" / "58 金村 美玖"]


def test_two_one_to_one_members_stay_separate(tmp_path: Path) -> None:
    a = chat(tmp_path)
    b = chat(
        tmp_path,
        group_id="35",
        group_dir="35 加藤 史帆",
        member_id="59",
        member_dir="59 加藤 史帆",
        member_name="加藤 史帆",
    )
    plans, _ = run([a, b], tmp_path)
    assert [p.member_id for p in plans] == ["58", "59"]


def test_room_collapses_members_into_one_plan(tmp_path: Path) -> None:
    avatars: list[Path] = []

    def avatar_for(d: Path) -> Path | None:
        avatars.append(d)
        return d / "x.png"

    plans, skips = run(
        room_chats(tmp_path),
        tmp_path,
        member_count_for=lambda _g: 2,
        avatar_for=avatar_for,
    )
    assert skips == []
    (p,) = plans
    assert p.member_id == "0"
    assert p.group_id == "79"
    assert p.count == 5
    assert p.title == "日向坂46 ライブ"
    assert p.body == "齊藤 京子: newer\n+4 more"
    assert p.target == ChatTarget(
        SERVICE, "日向坂46/messages/79 日向坂46 ライブ", "日向坂46 ライブ", True
    )
    # avatar is the newest author's
    assert avatars == [
        tmp_path / DISPLAY / "messages" / "79 日向坂46 ライブ" / "2 齊藤 京子"
    ]
    assert p.avatar == avatars[0] / "x.png"


def test_room_newest_ties_broken_by_numeric_id(tmp_path: Path) -> None:
    kw: dict[str, Any] = {"group_id": "79", "group_dir": "79 R", "group_name": "R"}
    a = chat(
        tmp_path,
        member_id="1",
        member_dir="1 A",
        member_name="A",
        newest=msg(9, content="nine"),
        **kw,
    )
    b = chat(
        tmp_path,
        member_id="2",
        member_dir="2 B",
        member_name="B",
        newest=msg(10, content="ten"),
        **kw,
    )
    (p,), _ = run([a, b], tmp_path, member_count_for=lambda _g: 2)
    assert p.body == "B: ten\n+1 more"
    assert p.newest_id == "10"  # the room's newest, across members


def test_single_member_group_chat_id_is_a_room(tmp_path: Path) -> None:
    """Group 43 has one sender folder (count 1) but is still a room."""
    c = chat(
        tmp_path,
        group_id="43",
        group_dir="43 日向坂46",
        group_name="日向坂46",
        member_id="9",
        member_dir="9 日向坂46",
        member_name="日向坂46 公式",
        newest=msg(1, content="お知らせ"),
    )
    (p,), _ = run([c], tmp_path, member_count_for=lambda _g: 1)
    assert p.member_id == "0"
    assert p.target.is_group_chat is True
    assert p.target.path == "日向坂46/messages/43 日向坂46"
    assert p.title == "日向坂46"
    assert p.body == "日向坂46 公式: お知らせ"


def test_single_member_group_chat_id_viewing_uses_zero(tmp_path: Path) -> None:
    c = chat(tmp_path, group_id="43", group_dir="43 日向坂46", group_name="日向坂46")
    ui = UiState(SERVICE, "43", "0", True)
    _, skips = run([c], tmp_path, ui_state=ui)
    assert skips == [Skip("viewing", "43", "0", 1)]


def test_room_name_without_leading_id_only(tmp_path: Path) -> None:
    c = chat(tmp_path, group_id="43", group_dir="43 43 Special", group_name="ignored")
    (p,), _ = run([c], tmp_path)
    assert p.title == "43 Special"


def test_room_group_dir_without_id_prefix_kept(tmp_path: Path) -> None:
    c = chat(tmp_path, group_id="43", group_dir="NoId", group_name="ignored")
    (p,), _ = run([c], tmp_path)
    assert p.title == "NoId"


def test_member_count_for_called_with_group_id(tmp_path: Path) -> None:
    seen: list[str] = []

    def mc(g: str) -> int:
        seen.append(g)
        return 1

    run([chat(tmp_path)], tmp_path, member_count_for=mc)
    assert seen and set(seen) == {"34"}


def test_path_fallback_when_outside_output_root(tmp_path: Path) -> None:
    c = chat(tmp_path)
    plans, _ = plan_toasts(
        [c],
        service=SERVICE,
        service_display=DISPLAY,
        output_service_dir=tmp_path / "elsewhere" / DISPLAY,
        ui_state=IDLE,
        enabled=True,
        hide_content=False,
        strings=STRINGS,
        avatar_for=lambda _d: None,
        divert=lambda _p: False,
        member_count_for=lambda _g: 1,
    )
    assert plans[0].target.path == "日向坂46/messages/34 金村 美玖/58 金村 美玖"


def test_path_fallback_uses_last_messages_component(tmp_path: Path) -> None:
    """A parent folder that is itself called "messages" must not confuse the fallback."""
    c = chat(tmp_path / "messages" / "export")
    plans, _ = plan_toasts(
        [c],
        service=SERVICE,
        service_display=DISPLAY,
        output_service_dir=tmp_path / "elsewhere" / DISPLAY,
        ui_state=IDLE,
        enabled=True,
        hide_content=False,
        strings=STRINGS,
        avatar_for=lambda _d: None,
        divert=lambda _p: False,
        member_count_for=lambda _g: 1,
    )
    assert plans[0].target.path == "日向坂46/messages/34 金村 美玖/58 金村 美玖"


def test_newest_key_is_shared_with_the_collector() -> None:
    from backend.services import new_message_collector, notification_planner

    assert notification_planner.newest_key is new_message_collector.newest_key


# ---------------------------------------------------------------------- bodies


def test_body_hide_content(tmp_path: Path) -> None:
    (p,), _ = run([chat(tmp_path)], tmp_path, hide_content=True)
    assert p.body == "Sent a new message"
    assert "hello" not in p.body


def test_body_hide_content_room_has_no_author_prefix(tmp_path: Path) -> None:
    (p,), _ = run(
        room_chats(tmp_path), tmp_path, hide_content=True, member_count_for=lambda _g: 2
    )
    assert p.body == "Sent a new message\n+4 more"


def test_more_count_one_vs_three(tmp_path: Path) -> None:
    (p1,), _ = run([chat(tmp_path, count=1)], tmp_path)
    (p3,), _ = run([chat(tmp_path, count=3)], tmp_path)
    assert p1.body == "hello"
    assert p3.body == "hello\n+2 more"


@pytest.mark.parametrize(
    ("type_", "expected"),
    [
        ("picture", "Sent a photo"),
        ("video", "Sent a video"),
        ("voice", "Sent a voice message"),
    ],
)
def test_body_media(tmp_path: Path, type_: str, expected: str) -> None:
    (p,), _ = run([chat(tmp_path, newest=msg(type_=type_, content=None))], tmp_path)
    assert p.body == expected
    assert p.newest_type == type_


def test_body_room_media_prefix(tmp_path: Path) -> None:
    kw: dict[str, Any] = {
        "group_id": "43",
        "group_dir": "43 日向坂46",
        "group_name": "日向坂46",
    }
    c = chat(
        tmp_path, member_name="Mei", newest=msg(type_="picture", content=None), **kw
    )
    (p,), _ = run([c], tmp_path)
    assert p.body == "Mei: Sent a photo"


# --------------------------------------------------------------- preview_text


def test_preview_exactly_80_not_cut() -> None:
    text = "a" * 80
    assert preview_text(msg(content=text), STRINGS) == text


def test_preview_81_cut_with_ellipsis() -> None:
    assert preview_text(msg(content="a" * 81), STRINGS) == "a" * 80 + "…"


def test_preview_cjk_counts_characters() -> None:
    text = "日" * 81
    assert preview_text(msg(content=text), STRINGS) == "日" * 80 + "…"


def test_preview_emoji_text() -> None:
    assert preview_text(msg(content="おはよう😊"), STRINGS) == "おはよう😊"


def test_preview_multiline_collapsed() -> None:
    assert (
        preview_text(msg(content="line1\nline2\r\nline3"), STRINGS)
        == "line1 line2 line3"
    )


def test_preview_whitespace_runs_and_trim() -> None:
    assert preview_text(msg(content="  a \t\t b　　c  "), STRINGS) == "a b c"


def test_preview_cut_applies_after_collapse() -> None:
    text = (
        "a" * 40 + "\n\n\n   "
    ) * 2 + "b" * 5  # collapses to 40 + 1 + 40 + 1 + 5 = 87
    out = preview_text(msg(content=text), STRINGS)
    assert out == ("a" * 40 + " " + "a" * 39) + "…"


@pytest.mark.parametrize("content", [None, "", "   ", "\n\t"])
def test_preview_empty_text_falls_back(content: str | None) -> None:
    assert preview_text(msg(content=content), STRINGS) == "Sent a message"


@pytest.mark.parametrize("type_", ["sticker", "", "weird"])
def test_preview_unknown_type_falls_back(type_: str) -> None:
    assert preview_text(msg(type_=type_, content="hi"), STRINGS) == "Sent a message"


def test_preview_missing_type_falls_back() -> None:
    assert preview_text({"id": 1, "content": "hi"}, STRINGS) == "Sent a message"


@pytest.mark.parametrize(
    ("type_", "expected"),
    [
        ("picture", "Sent a photo"),
        ("video", "Sent a video"),
        ("voice", "Sent a voice message"),
    ],
)
def test_preview_media_ignores_content(type_: str, expected: str) -> None:
    assert preview_text(msg(type_=type_, content="caption"), STRINGS) == expected


def test_newest_type_unknown_is_passed_through(tmp_path: Path) -> None:
    (p,), _ = run([chat(tmp_path, newest=msg(type_="sticker"))], tmp_path)
    assert p.newest_type == "sticker"
    assert p.body == "Sent a message"


# ----------------------------------------------------------------- find_avatar


def _touch(path: Path, mtime: float | None = None) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def test_avatar_thumbnail_preferred(tmp_path: Path) -> None:
    _touch(tmp_path / "profile_images" / "phone_image" / "p.jpg")
    t = _touch(tmp_path / "profile_images" / "thumbnail" / "t.jpg")
    assert find_avatar(tmp_path) == t


def test_avatar_falls_back_to_phone_image(tmp_path: Path) -> None:
    p = _touch(tmp_path / "profile_images" / "phone_image" / "p.png")
    (tmp_path / "profile_images" / "thumbnail").mkdir(parents=True)
    assert find_avatar(tmp_path) == p


def test_avatar_none_when_nothing(tmp_path: Path) -> None:
    assert find_avatar(tmp_path) is None
    assert find_avatar(tmp_path / "does-not-exist") is None


def test_avatar_non_images_ignored_then_fallback(tmp_path: Path) -> None:
    _touch(tmp_path / "profile_images" / "thumbnail" / "notes.txt")
    _touch(tmp_path / "profile_images" / "thumbnail" / "icon.gif")
    (tmp_path / "profile_images" / "thumbnail" / "sub.jpg").mkdir()
    p = _touch(tmp_path / "profile_images" / "phone_image" / "p.jfif")
    assert find_avatar(tmp_path) == p


def test_avatar_none_when_only_non_images(tmp_path: Path) -> None:
    _touch(tmp_path / "profile_images" / "thumbnail" / "x.webp")
    _touch(tmp_path / "profile_images" / "phone_image" / "y.txt")
    assert find_avatar(tmp_path) is None


def test_avatar_newest_by_name(tmp_path: Path) -> None:
    d = tmp_path / "profile_images" / "thumbnail"
    _touch(d / "2024-01-01.jpg", mtime=3_000_000_000)  # newest mtime but oldest name
    new = _touch(d / "2025-06-01.jpeg", mtime=1_000_000_000)
    _touch(d / "2023-01-01.png")
    assert find_avatar(tmp_path) == new


def test_avatar_extension_case_insensitive(tmp_path: Path) -> None:
    f = _touch(tmp_path / "profile_images" / "thumbnail" / "A.JPG")
    assert find_avatar(tmp_path) == f
