"""Tests for the KB (knowledge base / chatbot) index hooks — Task 6.

Verifies that the knowledge-index background hooks mirror the existing
search-index hooks in `sync_service.py` / `blog_service.py`: same trigger
point, same `members_with_changes` payload, same fire-and-forget
`asyncio.create_task` background scheduling, same non-fatal try/except (a
knowledge-index failure must never break or block the sync/backup flow it
rides along with). Also verifies `transcription_service.py` enqueues a
re-index of the parent member after writing `transcriptions.json` — voice/
video transcripts aren't covered by the sync hook, since sync completes
before on-demand transcription runs.
"""

import asyncio
import threading
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.services.blog_service import BlogBackupManager, BlogService
from backend.services.sync_service import SyncService
from backend.services.transcription_service import (
    TranscriptionResult,
    TranscriptionSegment,
    TranscriptionStorage,
)


async def _drain_background_tasks() -> None:
    """Await every task scheduled via `asyncio.create_task` besides this one.

    The hooks under test are deliberately fire-and-forget (scheduled, not
    awaited) so they never block the sync/backup/transcription flow. Tests
    must explicitly drain the loop to observe their effects.
    """
    current = asyncio.current_task()
    pending = [t for t in asyncio.all_tasks() if t is not current]
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


# ---------------------------------------------------------------------------
# Sync hook (sync_service.py)
# ---------------------------------------------------------------------------


def _make_metadata(groups: dict | None = None) -> dict:
    return {"groups": groups or {}, "last_sync": None}


def _member_info(group_id: int, member_id: int, member_name: str = "Test") -> dict:
    return {
        "group_id": group_id,
        "group_name": f"Group {group_id}",
        "group_thumbnail": None,
        "member_id": member_id,
        "member_name": member_name,
        "last_message_id": None,
        "thumbnail": None,
        "portrait": None,
    }


async def _run_start_sync(
    tmp_path: Path,
    mock_search_svc: MagicMock,
    mock_knowledge_svc: MagicMock,
    *,
    kb_enabled_return: bool = True,
) -> tuple[SyncService, AsyncMock]:
    """Run `SyncService.start_sync()` to completion for one member with 5 new
    messages, with the pysaka `Client`/`SyncManager` mocked out, and drain any
    background tasks the search/knowledge index hooks scheduled.

    `kb_enabled_return` defaults to `True` so callers exercise the "KB is on"
    path without having to isolate settings themselves; the disabled gate
    (item 1) is covered by its own dedicated test class, which passes `False`.

    Returns `(svc, mock_save_metadata)` so callers can assert sync reached its
    normal completion (metadata persisted) regardless of what the knowledge
    hook did.
    """
    svc = SyncService()
    mock_progress = MagicMock()

    groups = [
        {
            "id": 100,
            "name": "Group1",
            "state": "open",
            "subscription": {"state": "active"},
        }
    ]
    members = [{"id": 1, "name": "MemberA", "thumbnail": None, "portrait": None}]

    mock_client = MagicMock()
    mock_client.access_token = "tok"
    mock_client.refresh_if_needed = AsyncMock()
    mock_client.get_groups = AsyncMock(return_value=groups)
    mock_client.get_members = AsyncMock(return_value=members)
    mock_client.get_messages = AsyncMock(return_value=[])

    mock_manager = MagicMock()
    mock_manager.get_last_ts = MagicMock(return_value="2025-03-20T12:00:00Z")
    mock_manager.get_last_id = MagicMock(return_value=999)
    mock_manager.sync_member = AsyncMock(return_value=5)  # 5 new messages
    mock_manager.client = mock_client
    mock_manager.process_media_queue = AsyncMock(return_value={})

    with (
        patch.object(
            svc,
            "load_app_settings",
            new_callable=AsyncMock,
            return_value={"is_configured": True, "output_dir": str(tmp_path)},
        ),
        patch.object(
            svc,
            "load_config",
            new_callable=AsyncMock,
            return_value={"access_token": "tok"},
        ),
        patch.object(
            svc,
            "load_metadata",
            new_callable=AsyncMock,
            return_value=_make_metadata(
                groups={"100_1": _member_info(100, 1, member_name="MemberA")}
            ),
        ),
        patch.object(
            svc, "save_metadata", new_callable=AsyncMock
        ) as mock_save_metadata,
        patch(
            "backend.services.sync_service.get_service_display_name",
            return_value="日向坂46",
        ),
        patch(
            "backend.services.sync_service.get_session_dir",
            return_value=tmp_path / "session",
        ),
        patch("backend.services.sync_service.aiohttp.TCPConnector"),
        patch("backend.services.sync_service.aiohttp.ClientSession") as mock_sess_cls,
        patch("backend.services.sync_service.Client", return_value=mock_client),
        patch("backend.services.sync_service.SyncManager", return_value=mock_manager),
        patch("backend.services.sync_service.progress_manager") as mock_pm,
        patch(
            "backend.services.sync_service.notify_sync_complete_async",
            new_callable=AsyncMock,
        ),
        patch(
            "backend.services.search_service.get_search_service",
            return_value=mock_search_svc,
        ),
        patch(
            "backend.services.knowledge_service.get_knowledge_service",
            new=AsyncMock(return_value=mock_knowledge_svc),
        ),
        # Task 3's shared `kb_enabled()` guard early-returns every index hook
        # before it builds the knowledge service -- these hook tests are about
        # the trigger/payload/dedupe behavior once the KB is on, not the gate
        # itself, so arrange enabled=True by default (settings default to
        # False); the disabled-gate test class passes `kb_enabled_return=False`.
        patch(
            "backend.services.knowledge_service.kb_enabled",
            new=AsyncMock(return_value=kb_enabled_return),
        ),
    ):
        mock_pm.get.return_value = mock_progress
        mock_session = AsyncMock()
        mock_sess_ctx = AsyncMock()
        mock_sess_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_sess_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_sess_cls.return_value = mock_sess_ctx

        await svc.start_sync()
        await _drain_background_tasks()

    return svc, mock_save_metadata


_EXPECTED_MEMBERS_WITH_CHANGES = [
    (
        {
            "id": 100,
            "name": "Group1",
            "state": "open",
            "subscription": {"state": "active"},
        },
        {"id": 1, "name": "MemberA", "thumbnail": None, "portrait": None},
    )
]


class TestSyncKnowledgeHook:
    """Knowledge-index hook fired after `SyncService.start_sync()` finds new messages."""

    @pytest.mark.asyncio
    async def test_schedules_knowledge_index_with_same_members_as_search_hook(
        self, tmp_path
    ):
        mock_search_svc = MagicMock()
        mock_search_svc.index_members = AsyncMock(return_value=5)
        mock_knowledge_svc = MagicMock()
        mock_knowledge_svc.index_members = AsyncMock(return_value=5)

        await _run_start_sync(tmp_path, mock_search_svc, mock_knowledge_svc)

        mock_knowledge_svc.index_members.assert_awaited_once()
        mock_search_svc.index_members.assert_awaited_once()

        knowledge_members, knowledge_service = (
            mock_knowledge_svc.index_members.await_args.args
        )
        search_members, search_service = mock_search_svc.index_members.await_args.args

        assert knowledge_members == search_members == _EXPECTED_MEMBERS_WITH_CHANGES
        assert knowledge_service == search_service == "hinatazaka46"

    @pytest.mark.asyncio
    async def test_knowledge_index_failure_is_non_fatal(self, tmp_path):
        mock_search_svc = MagicMock()
        mock_search_svc.index_members = AsyncMock(return_value=5)
        mock_knowledge_svc = MagicMock()
        mock_knowledge_svc.index_members = AsyncMock(side_effect=RuntimeError("boom"))

        # Must not raise even though the knowledge index blows up.
        svc, mock_save_metadata = await _run_start_sync(
            tmp_path, mock_search_svc, mock_knowledge_svc
        )

        mock_knowledge_svc.index_members.assert_awaited_once()
        # Sync still ran to completion (reached the post-hook metadata save).
        mock_save_metadata.assert_awaited_once()
        assert svc.running is False

    @pytest.mark.asyncio
    async def test_knowledge_index_hook_uses_retained_background_task_helper(
        self, tmp_path
    ):
        """Fix 4 (pwave-2): the hook must schedule via the shared
        `track_background_task` helper (retained set + exception-logged
        done-callback), not a bare, un-retained `asyncio.create_task` that a
        GC pass could collect mid-run on a slow first index. blog_service.py's
        and transcription_service.py's hooks use the identical call (verified
        by code inspection, not re-tested per hook here)."""
        from backend.services import sync_service as sync_module

        calls: list[str] = []
        real_track = sync_module.track_background_task

        def _spy_track(coro, *, name):
            calls.append(name)
            return real_track(coro, name=name)

        with patch.object(sync_module, "track_background_task", _spy_track):
            mock_search_svc = MagicMock()
            mock_search_svc.index_members = AsyncMock(return_value=5)
            mock_knowledge_svc = MagicMock()
            mock_knowledge_svc.index_members = AsyncMock(return_value=5)

            await _run_start_sync(tmp_path, mock_search_svc, mock_knowledge_svc)

        assert "sync_knowledge_index" in calls


# ---------------------------------------------------------------------------
# Blog backup hook (blog_service.py)
# ---------------------------------------------------------------------------


class TestBlogBackupKnowledgeHook:
    """Knowledge-index hook fired after `BlogBackupManager._run_backup()` completes."""

    @pytest.mark.asyncio
    async def test_schedules_knowledge_index_after_backup(self):
        manager = BlogBackupManager()
        mock_search_svc = MagicMock()
        mock_search_svc.index_blogs_for_service = AsyncMock(return_value=2)
        mock_knowledge_svc = MagicMock()
        mock_knowledge_svc.index_blogs_for_service = AsyncMock(return_value=3)

        with (
            patch.object(BlogService, "sync_full_backup", new=AsyncMock()),
            patch(
                "backend.services.search_service.get_search_service",
                return_value=mock_search_svc,
            ),
            patch(
                "backend.services.knowledge_service.get_knowledge_service",
                new=AsyncMock(return_value=mock_knowledge_svc),
            ),
            # See `_run_start_sync`'s comment: the KB must read as enabled for
            # this hook to reach `index_blogs_for_service` at all.
            patch(
                "backend.services.knowledge_service.kb_enabled",
                new=AsyncMock(return_value=True),
            ),
        ):
            await manager._run_backup("hinatazaka46", threading.Event())
            await _drain_background_tasks()

        mock_search_svc.index_blogs_for_service.assert_awaited_once_with("hinatazaka46")
        mock_knowledge_svc.index_blogs_for_service.assert_awaited_once_with(
            "hinatazaka46"
        )

    @pytest.mark.asyncio
    async def test_knowledge_index_failure_is_non_fatal(self):
        manager = BlogBackupManager()
        mock_search_svc = MagicMock()
        mock_search_svc.index_blogs_for_service = AsyncMock(return_value=2)
        mock_knowledge_svc = MagicMock()
        mock_knowledge_svc.index_blogs_for_service = AsyncMock(
            side_effect=RuntimeError("boom")
        )

        # Must not raise even though the knowledge index blows up.
        with (
            patch.object(BlogService, "sync_full_backup", new=AsyncMock()) as mock_sync,
            patch(
                "backend.services.search_service.get_search_service",
                return_value=mock_search_svc,
            ),
            patch(
                "backend.services.knowledge_service.get_knowledge_service",
                new=AsyncMock(return_value=mock_knowledge_svc),
            ),
            patch(
                "backend.services.knowledge_service.kb_enabled",
                new=AsyncMock(return_value=True),
            ),
        ):
            await manager._run_backup("hinatazaka46", threading.Event())
            await _drain_background_tasks()

        # The backup itself still ran (this is what "non-fatal" means here).
        mock_sync.assert_awaited_once()
        mock_knowledge_svc.index_blogs_for_service.assert_awaited_once()
        assert "hinatazaka46" not in manager.running_services()


# ---------------------------------------------------------------------------
# Transcription hook (transcription_service.py)
# ---------------------------------------------------------------------------


def _member_dir(tmp_path: Path) -> Path:
    """A member dir following the real on-disk convention:
    `<output_dir>/<display_name>/messages/<gid name>/<mid name>`.
    """
    member_dir = tmp_path / "日向坂46" / "messages" / "100 Group1" / "1 MemberA"
    member_dir.mkdir(parents=True)
    return member_dir


def _transcription_result(message_id: int = 500) -> TranscriptionResult:
    return TranscriptionResult(
        message_id=message_id,
        media_type="voice",
        language="ja",
        model="gemini-3.1-flash-lite",
        duration_seconds=1.0,
        full_text="やあ",
        segments=[TranscriptionSegment(start=0.0, end=1.0, text="やあ")],
    )


class TestTranscriptionKnowledgeHook:
    """Knowledge re-index enqueued after `TranscriptionStorage.save()`."""

    @pytest.mark.asyncio
    async def test_save_enqueues_reindex_for_parent_member(self, tmp_path):
        member_dir = _member_dir(tmp_path)
        storage = TranscriptionStorage()
        mock_knowledge_svc = MagicMock()
        mock_knowledge_svc.index_members = AsyncMock(return_value=1)

        with (
            patch(
                "backend.services.knowledge_service.get_knowledge_service",
                new=AsyncMock(return_value=mock_knowledge_svc),
            ),
            # See `_run_start_sync`'s comment: the KB must read as enabled for
            # this hook to reach `index_members` at all.
            patch(
                "backend.services.knowledge_service.kb_enabled",
                new=AsyncMock(return_value=True),
            ),
        ):
            storage.save(member_dir, _transcription_result())
            await _drain_background_tasks()

        mock_knowledge_svc.index_members.assert_awaited_once_with(
            [({"id": 100, "name": "Group1"}, {"id": 1, "name": "MemberA"})],
            "hinatazaka46",
        )

    @pytest.mark.asyncio
    async def test_save_non_fatal_when_index_members_raises(self, tmp_path):
        member_dir = _member_dir(tmp_path)
        storage = TranscriptionStorage()
        mock_knowledge_svc = MagicMock()
        mock_knowledge_svc.index_members = AsyncMock(side_effect=RuntimeError("boom"))

        with (
            patch(
                "backend.services.knowledge_service.get_knowledge_service",
                new=AsyncMock(return_value=mock_knowledge_svc),
            ),
            patch(
                "backend.services.knowledge_service.kb_enabled",
                new=AsyncMock(return_value=True),
            ),
        ):
            # Must not raise even though the knowledge index blows up.
            storage.save(member_dir, _transcription_result())
            await _drain_background_tasks()

        # The hook actually reached (and blew up in) `index_members` -- this
        # is the call whose failure must be non-fatal, not skipped entirely.
        mock_knowledge_svc.index_members.assert_awaited_once()
        # The transcript itself was still saved successfully — the write is
        # not rolled back or affected by the background re-index failing.
        loaded = storage.load(member_dir, 500)
        assert loaded is not None
        assert loaded.full_text == "やあ"

    def test_save_without_running_event_loop_is_non_fatal(self, tmp_path):
        """`save()` may run from a plain sync context with no event loop
        (e.g. a script/test) — `asyncio.create_task()` must not raise there.
        """
        member_dir = _member_dir(tmp_path)
        storage = TranscriptionStorage()

        storage.save(member_dir, _transcription_result())  # no running loop here

        loaded = storage.load(member_dir, 500)
        assert loaded is not None

    def test_save_skips_reindex_for_unresolvable_path(self, tmp_path):
        """A member_dir that doesn't match the on-disk service/messages/group/
        member convention (e.g. a synthetic tmp_path in some other test) is
        skipped rather than raising.
        """
        storage = TranscriptionStorage()
        member_dir = tmp_path / "not-a-real-layout"
        member_dir.mkdir()

        storage.save(member_dir, _transcription_result())

        assert storage.load(member_dir, 500) is not None


# ---------------------------------------------------------------------------
# Shared `kb_enabled()` gate (Task 3, item 1) -- every hook must skip BEFORE
# building the knowledge service when the KB is off.
# ---------------------------------------------------------------------------


class TestHooksSkipWhenKbDisabled:
    """`settings.knowledge_base.enabled = false` (the default): none of the
    three index hooks may call `get_knowledge_service()` -- a disabled KB
    must never build the embedder/store/LLM client just to throw the result
    away (see `kb_enabled`'s docstring)."""

    @pytest.mark.asyncio
    async def test_sync_hook_never_builds_knowledge_service(self, tmp_path):
        mock_search_svc = MagicMock()
        mock_search_svc.index_members = AsyncMock(return_value=5)
        mock_knowledge_svc = MagicMock()
        mock_knowledge_svc.index_members = AsyncMock(return_value=5)

        await _run_start_sync(
            tmp_path, mock_search_svc, mock_knowledge_svc, kb_enabled_return=False
        )

        mock_knowledge_svc.index_members.assert_not_awaited()
        # The search-index hook (unaffected by the KB gate) still ran --
        # proof the sync itself completed normally, only the KB hook skipped.
        mock_search_svc.index_members.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_blog_backup_hook_never_builds_knowledge_service(self):
        manager = BlogBackupManager()
        mock_search_svc = MagicMock()
        mock_search_svc.index_blogs_for_service = AsyncMock(return_value=2)
        mock_knowledge_svc = MagicMock()
        mock_knowledge_svc.index_blogs_for_service = AsyncMock(return_value=3)

        with (
            patch.object(BlogService, "sync_full_backup", new=AsyncMock()),
            patch(
                "backend.services.search_service.get_search_service",
                return_value=mock_search_svc,
            ),
            patch(
                "backend.services.knowledge_service.get_knowledge_service",
                new=AsyncMock(return_value=mock_knowledge_svc),
            ),
            patch(
                "backend.services.knowledge_service.kb_enabled",
                new=AsyncMock(return_value=False),
            ),
        ):
            await manager._run_backup("hinatazaka46", threading.Event())
            await _drain_background_tasks()

        mock_knowledge_svc.index_blogs_for_service.assert_not_awaited()
        mock_search_svc.index_blogs_for_service.assert_awaited_once_with("hinatazaka46")

    @pytest.mark.asyncio
    async def test_transcription_hook_never_builds_knowledge_service(self, tmp_path):
        member_dir = _member_dir(tmp_path)
        storage = TranscriptionStorage()
        mock_knowledge_svc = MagicMock()
        mock_knowledge_svc.index_members = AsyncMock(return_value=1)

        with (
            patch(
                "backend.services.knowledge_service.get_knowledge_service",
                new=AsyncMock(return_value=mock_knowledge_svc),
            ),
            patch(
                "backend.services.knowledge_service.kb_enabled",
                new=AsyncMock(return_value=False),
            ),
        ):
            storage.save(member_dir, _transcription_result())
            await _drain_background_tasks()

        mock_knowledge_svc.index_members.assert_not_awaited()
        # The transcript write itself is unaffected by the KB gate.
        loaded = storage.load(member_dir, 500)
        assert loaded is not None
