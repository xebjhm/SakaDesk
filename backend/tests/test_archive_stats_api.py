"""Tests for GET /api/archive/stats and the archive totals behind it (About, R-d)."""

import json
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.services.archive_stats import (
    ArchiveStats,
    FileStats,
    collect_archive_stats,
    summarize_messages,
)

client = TestClient(app)

HINATA = "日向坂46/messages/58 金村 美玖/58 金村 美玖"
SAKURA = "櫻坂46/messages/79 中川 智尋/134 中川 智尋"
GROUP_CHAT_MEMBER = "日向坂46/messages/1 日向坂46/58 金村 美玖"


def _msg(msg_id: int, timestamp: object, kind: str = "text", **extra: object) -> dict:
    return {
        "id": msg_id,
        "timestamp": timestamp,
        "type": kind,
        "content": "おはよう🌸",
        **extra,
    }


def _write(root: Path, member: str, messages: object) -> Path:
    member_dir = root / member
    member_dir.mkdir(parents=True, exist_ok=True)
    path = member_dir / "messages.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(
            {"member": {"id": 58, "name": "金村 美玖"}, "messages": messages},
            f,
            ensure_ascii=False,
        )
    return path


def test_summarize_counts_shown_messages_photos_and_the_earliest_time():
    stats = summarize_messages(
        {
            "messages": [
                _msg(1, "2024-03-01T10:00:00Z"),
                _msg(2, "2023-12-24T09:00:00Z", "picture"),
                _msg(
                    3, "2023-01-01T00:00:00Z", "picture", state="canceled"
                ),  # withdrawn: hidden
                _msg(4, None, "voice"),
                "not a row",
            ]
        }
    )
    assert stats == FileStats(messages=3, photos=1, first_at="2023-12-24T09:00:00Z")


def test_summarize_tolerates_files_without_a_message_list():
    assert summarize_messages([]) == FileStats(0, 0, None)
    assert summarize_messages({"messages": None}) == FileStats(0, 0, None)
    assert summarize_messages({}) == FileStats(0, 0, None)


def test_collect_sums_every_member_file_including_group_chat_members(tmp_path):
    _write(
        tmp_path,
        HINATA,
        [_msg(1, "2024-01-15T09:00:00Z"), _msg(2, "2024-01-16T09:00:00Z", "picture")],
    )
    _write(tmp_path, SAKURA, [_msg(1, "2022-05-01T00:00:00Z", "picture")])
    _write(tmp_path, GROUP_CHAT_MEMBER, [_msg(9, "2025-01-01T00:00:00Z")])
    (tmp_path / "日向坂46" / "blogs").mkdir()  # not a message folder
    assert collect_archive_stats(tmp_path) == ArchiveStats(
        messages=4,
        photos=2,
        first_message_at="2022-05-01T00:00:00Z",
        files=3,
        skipped=0,
    )


def test_collect_reads_a_changed_file_again(tmp_path):
    _write(tmp_path, HINATA, [_msg(1, "2024-01-15T09:00:00Z")])
    assert collect_archive_stats(tmp_path).messages == 1
    _write(
        tmp_path,
        HINATA,
        [_msg(1, "2024-01-15T09:00:00Z"), _msg(2, "2024-01-15T10:00:00Z")],
    )
    assert collect_archive_stats(tmp_path).messages == 2


def test_collect_without_an_output_folder_logs_the_skip(tmp_path):
    with capture_logs() as logs:
        stats = collect_archive_stats(tmp_path / "missing")
    assert stats == ArchiveStats(0, 0, None, 0, 0)
    (entry,) = [e for e in logs if e["event"] == "archive_stats_skipped"]
    assert (entry["log_level"], entry["reason"]) == ("info", "no_output_dir")


def test_collect_skips_a_broken_file_and_logs_only_its_error_type(tmp_path):
    _write(tmp_path, HINATA, [_msg(1, "2024-01-15T09:00:00Z")])
    broken = tmp_path / SAKURA
    broken.mkdir(parents=True)
    (broken / "messages.json").write_text("{not json", encoding="utf-8")
    with capture_logs() as logs:
        stats = collect_archive_stats(tmp_path)
    assert (stats.messages, stats.files, stats.skipped) == (1, 1, 1)
    (entry,) = [e for e in logs if e["event"] == "archive_stats_file_skipped"]
    assert (entry["log_level"], entry["error_type"]) == ("warning", "JSONDecodeError")
    assert "中川" not in json.dumps(entry, ensure_ascii=False)


def test_endpoint_returns_the_totals_and_logs_counts_only(tmp_path):
    _write(
        tmp_path,
        HINATA,
        [_msg(1, "2024-01-15T09:00:00Z", "picture"), _msg(2, "2024-02-01T09:00:00Z")],
    )
    with (
        patch("backend.api.content.get_output_dir", return_value=tmp_path),
        capture_logs() as logs,
    ):
        res = client.get("/api/archive/stats")
    assert res.status_code == 200
    assert res.json() == {
        "messages": 2,
        "photos": 1,
        "first_message_at": "2024-01-15T09:00:00Z",
    }
    (entry,) = [e for e in logs if e["event"] == "archive_stats"]
    assert (entry["messages"], entry["photos"], entry["files"], entry["skipped"]) == (
        2,
        1,
        1,
        0,
    )
    assert "金村" not in json.dumps(entry, ensure_ascii=False)


def test_endpoint_on_an_empty_archive(tmp_path):
    with patch("backend.api.content.get_output_dir", return_value=tmp_path):
        res = client.get("/api/archive/stats")
    assert res.json() == {"messages": 0, "photos": 0, "first_message_at": None}
