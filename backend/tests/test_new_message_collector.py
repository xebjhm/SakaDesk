"""Tests for NewMessageCollector (genuinely new on-disk messages per sync run)."""

from pathlib import Path

from structlog.testing import capture_logs

from backend.services.new_message_collector import (
    CollectedChat,
    NewMessageCollector,
)


def _info(gid=34, mid=58, initial=False, **extra):
    info = {
        "group_id": gid,
        "group_name": "Group",
        "member_id": mid,
        "member_name": "Member",
        "member_dir": Path("/tmp/x/member"),
        "phone_image": None,
        "initial_sync": initial,
    }
    info.update(extra)
    return info


def _msg(mid, ts, **extra):
    m = {"id": mid, "timestamp": ts, "type": "text", "content": "hi"}
    m.update(extra)
    return m


def test_initial_sync_is_ignored_and_logged():
    c = NewMessageCollector("hinatazaka46")
    with capture_logs() as logs:
        c.on_new_messages(_info(initial=True), [_msg(1, "t1"), _msg(2, "t2")])
    assert c.counts() == {}
    assert c.entries() == []
    skip = [e for e in logs if e["event"] == "notify_collect_skip"]
    assert len(skip) == 1
    assert skip[0]["reason"] == "initial_sync"
    assert skip[0]["group_id"] == "34"
    assert skip[0]["member_id"] == "58"
    assert skip[0]["count"] == 2


def test_hidden_rows_dropped_and_logged():
    c = NewMessageCollector("hinatazaka46")
    msgs = [
        _msg(1, "t1"),
        _msg(2, "t2", state="canceled"),
        _msg(3, "t3", state="published"),
    ]
    with capture_logs() as logs:
        c.on_new_messages(_info(), msgs)
    assert c.counts() == {("34", "58"): 2}
    skip = [e for e in logs if e["event"] == "notify_collect_skip"]
    assert len(skip) == 1
    assert skip[0]["reason"] == "hidden"
    assert skip[0]["count"] == 1


def test_all_hidden_creates_no_entry():
    c = NewMessageCollector("hinatazaka46")
    c.on_new_messages(_info(), [_msg(1, "t1", state="canceled")])
    assert c.counts() == {}
    assert c.entries() == []


def test_newest_by_timestamp_then_id():
    c = NewMessageCollector("hinatazaka46")
    c.on_new_messages(
        _info(), [_msg(5, "2026-01-01T00:00:00Z"), _msg(9, "2026-01-02T00:00:00Z")]
    )
    c.on_new_messages(_info(), [_msg(11, "2026-01-02T00:00:00Z")])
    (entry,) = c.entries()
    assert isinstance(entry, CollectedChat)
    assert entry.newest["id"] == 11
    assert entry.count == 3


def test_merging_adds_counts_older_batch_does_not_win():
    c = NewMessageCollector("hinatazaka46")
    c.on_new_messages(_info(), [_msg(9, "2026-01-02T00:00:00Z")])
    c.on_new_messages(_info(), [_msg(2, "2026-01-01T00:00:00Z")])
    assert c.counts() == {("34", "58"): 2}
    assert c.entries()[0].newest["id"] == 9


def test_separate_members_kept_apart_and_ids_are_str():
    c = NewMessageCollector("hinatazaka46")
    c.on_new_messages(_info(34, 58), [_msg(1, "t")])
    c.on_new_messages(_info(34, 0), [_msg(2, "t"), _msg(3, "t")])
    assert c.counts() == {("34", "58"): 1, ("34", "0"): 2}
    e = {x.member_id: x for x in c.entries()}
    assert e["58"].group_id == "34"
    assert e["58"].member_name == "Member"
    assert e["58"].group_name == "Group"
    assert e["58"].member_dir == Path("/tmp/x/member")


def test_exceptions_swallowed_and_logged_without_content():
    c = NewMessageCollector("hinatazaka46")
    with capture_logs() as logs:
        c.on_new_messages({"initial_sync": False}, [_msg(1, "t")])  # no group_id
        c.on_new_messages(_info(), None)  # type: ignore[arg-type]
    failed = [e for e in logs if e["event"] == "notify_collect_failed"]
    assert len(failed) == 2
    assert failed[0]["error_type"] == "KeyError"
    assert failed[1]["error_type"] == "TypeError"
    assert c.counts() == {}


def test_log_summary():
    c = NewMessageCollector("hinatazaka46")
    c.on_new_messages(_info(34, 58), [_msg(1, "t"), _msg(2, "t", state="canceled")])
    c.on_new_messages(_info(34, 59, initial=True), [_msg(3, "t"), _msg(4, "t")])
    c.on_new_messages(_info(34, 60), [_msg(5, "t")])
    with capture_logs() as logs:
        c.log_summary()
    (s,) = [e for e in logs if e["event"] == "notify_collected"]
    assert s["members"] == 2
    assert s["messages"] == 2
    assert s["skipped_initial"] == 2
    assert s["skipped_hidden"] == 1
    assert s["service"] == "hinatazaka46"


def test_failed_call_leaves_no_partial_hidden_counter():
    """A swallowed failure after the hidden filter must not move skipped_hidden."""
    c = NewMessageCollector("hinatazaka46")
    info = _info()
    del info["member_dir"]  # visible rows present -> KeyError while recording
    with capture_logs() as logs:
        c.on_new_messages(info, [_msg(1, "t"), _msg(2, "t", state="canceled")])
        c.log_summary()
    assert [e for e in logs if e["event"] == "notify_collect_failed"]
    assert not [e for e in logs if e["event"] == "notify_collect_skip"]
    (s,) = [e for e in logs if e["event"] == "notify_collected"]
    assert s["skipped_hidden"] == 0
    assert c.counts() == {}


def _voice(mid, ts, **extra):
    return _msg(mid, ts, type="voice", content=None, **extra)


def test_newest_voice_is_the_newest_visible_voice():
    c = NewMessageCollector("hinatazaka46")
    c.on_new_messages(
        _info(),
        [
            _voice(1, "2026-11-04T10:00:00Z"),
            _voice(2, "2026-11-04T11:00:00Z"),
            _msg(3, "2026-11-04T12:00:00Z"),
        ],
    )
    (chat,) = c.entries()
    assert chat.newest["id"] == 3
    assert chat.newest_voice is not None and chat.newest_voice["id"] == 2


def test_hidden_voice_never_counts():
    c = NewMessageCollector("hinatazaka46")
    # is_hidden_message: any set state other than "published" is hidden (withdrawn).
    hidden = _voice(5, "2026-11-04T13:00:00Z", state="unpublished")
    c.on_new_messages(_info(), [_voice(1, "2026-11-04T10:00:00Z"), hidden])
    newest_voice = c.entries()[0].newest_voice
    assert newest_voice is not None and newest_voice["id"] == 1


def test_newest_voice_is_none_without_a_voice():
    c = NewMessageCollector("hinatazaka46")
    c.on_new_messages(_info(), [_msg(1, "2026-11-04T10:00:00Z")])
    assert c.entries()[0].newest_voice is None


def test_merge_keeps_the_newer_voice_and_a_voiceless_call_keeps_it():
    c = NewMessageCollector("hinatazaka46")
    c.on_new_messages(_info(), [_voice(1, "2026-11-04T10:00:00Z")])
    c.on_new_messages(_info(), [_voice(9, "2026-11-04T09:00:00Z")])  # older
    c.on_new_messages(_info(), [_msg(4, "2026-11-04T14:00:00Z")])  # no voice
    first = c.entries()[0].newest_voice
    assert first is not None and first["id"] == 1
    c.on_new_messages(_info(), [_voice(7, "2026-11-04T15:00:00Z")])  # newer
    latest = c.entries()[0].newest_voice
    assert latest is not None and latest["id"] == 7
