import asyncio
import contextlib
import json
import tempfile
import time
import aiohttp
import aiofiles
import traceback
from collections import defaultdict
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Any, Optional
from pysaka import Client, Group, SyncManager, RefreshFailedError, SessionExpiredError
from pysaka.credentials import get_token_manager
from backend.api.progress import progress_manager
from backend.services.background_tasks import track_background_task
from backend.services.platform import (
    get_session_dir,
    is_test_mode,
    get_default_output_dir,
)
from backend.services.notification_service import notify_sync_complete_async
from backend.services.service_utils import (
    get_service_enum,
    get_service_display_name,
    validate_service,
    _replace_with_retry,
)
import structlog

logger = structlog.get_logger(__name__)


# Initial (cursor-less) sync fetches a member's FULL history by default.
# 0 means unlimited: the whole group timeline is already downloaded to filter
# per member, so no client-side cap is applied and nothing is discarded. A
# positive value still caps the first sync to the newest N messages per member
# (see the guard in start_sync); callers may pass one explicitly.
DEFAULT_INITIAL_MESSAGE_LIMIT = 0


def _compute_group_since_ts(missing_timestamps: list) -> Optional[str]:
    """Earliest cursor to re-fetch a group's timeline from: None (full history)
    if any missing item lacks a timestamp, else min(ts) minus a 5-min overlap."""
    if any(not ts for ts in missing_timestamps):
        return None
    earliest = min(missing_timestamps)
    try:
        dt = datetime.fromisoformat(earliest.replace("Z", "+00:00")) - timedelta(
            seconds=300
        )
        return dt.isoformat().replace("+00:00", "Z")
    except (ValueError, TypeError):
        return None


class SyncService:
    """
    Per-service sync orchestrator for SakaDesk.

    Manages the synchronization lifecycle: loading credentials, fetching messages,
    downloading media, and tracking sync state. Each instance handles one service
    (hinatazaka46, sakurazaka46, or nogizaka46).
    """

    def __init__(self, service: str = "hinatazaka46"):
        validate_service(service)
        self._service = service
        self.output_dir = get_default_output_dir()
        self.service_data_dir = (
            get_default_output_dir()
        )  # Will be updated in start_sync
        self._profile_refreshed = False  # Only refresh nickname once per session
        self.config_dir = Path(".")
        self.running = False
        # self.metadata_file will be resolved dynamically now based on configured output_dir
        self.metadata_file: Optional[Path] = None
        self.manager: Optional[SyncManager] = None
        # Concurrency ownership (SVC-C1): a reference to the currently running
        # sync asyncio.Task plus a monotonically increasing generation token.
        # cancel() calls task.cancel() and awaits its unwind; the run's finally
        # only clears self.running when it still owns the current generation, so a
        # stale (cancelled / superseded) run cannot clear a newer run's flag.
        self._task: Optional["asyncio.Task[Any]"] = None
        self._generation: int = 0

    def _get_group(self) -> Group:
        """Get Group enum for this service."""
        return get_service_enum(self._service)

    def _resolve_service_paths(self, app_settings: dict) -> None:
        """Set output_dir / service_data_dir / metadata_file for this service."""
        self.output_dir = Path(
            app_settings.get("output_dir", str(get_default_output_dir()))
        )
        service_display = get_service_display_name(self._service)
        self.service_data_dir = self.output_dir / service_display
        self.metadata_file = self.service_data_dir / "sync_metadata.json"

    async def load_config(self):
        """Load config from pysaka's TokenManager (WCM on Windows)."""
        # Test mode uses fixtures
        if is_test_mode():
            from backend.fixtures.test_data import TEST_AUTH_CONFIG

            return TEST_AUTH_CONFIG

        try:
            tm = get_token_manager()
            token_data = tm.load_session(self._service)
            if token_data:
                return token_data
        except Exception as e:
            logger.error("Config load error", error=str(e))
        return {}

    async def load_app_settings(self):
        """Load application settings via centralized store."""
        from backend.services.settings_store import load_config

        return await load_config()

    async def get_output_dir(self):
        """Resolve the effective output directory."""
        settings = await self.load_app_settings()
        path_str = settings.get("output_dir")
        if path_str:
            return Path(path_str)
        return get_default_output_dir()

    async def load_metadata(self):
        """Load sync metadata for quick checks (per-service location)."""
        output_dir = await self.get_output_dir()
        service_display = get_service_display_name(self._service)
        metadata_file = output_dir / service_display / "sync_metadata.json"

        if metadata_file.exists():
            try:
                async with aiofiles.open(metadata_file, "r", encoding="utf-8") as f:
                    data = json.loads(await f.read())
                    logger.debug(
                        "Sync metadata loaded",
                        last_sync=data.get("last_sync"),
                        group_count=len(data.get("groups", {})),
                    )
                    return data
            except Exception as e:
                logger.error(
                    "Failed to load sync metadata",
                    error=str(e),
                    metadata_file=str(metadata_file),
                )
        return {"groups": {}, "last_sync": None}

    async def save_metadata(self, metadata):
        """Save sync metadata to the per-service JSON file (atomic write)."""
        import os

        if self.metadata_file is None:
            raise RuntimeError("save_metadata called before start_sync")
        self.service_data_dir.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            dir=str(self.metadata_file.parent), suffix=".tmp"
        )
        os.close(fd)
        try:
            async with aiofiles.open(tmp_path, "w", encoding="utf-8") as f:
                await f.write(json.dumps(metadata, ensure_ascii=False, indent=2))
            # SD-BE-SVC-17: retry the final rename on transient Windows lock
            # errors (AV / Search indexer holding sync_metadata.json), matching
            # blog_service / settings_store — a momentary hold must not fail the
            # whole sync at its very last step and discard the metadata update.
            _replace_with_retry(tmp_path, str(self.metadata_file))
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(tmp_path)
            raise

    def _reset_message_cursor(self) -> None:
        """Delete only the per-member sync cursor (sync_state.json) so a force
        resync re-fetches every member from scratch. Deliberately KEEPS
        sync_metadata.json — it holds the phone->Windows server_unread_count (the
        read/unread cap) and group state, which the re-sync refreshes in place.
        Deleting it made a full resync appear to reset the read state."""
        import os

        state_file = self.service_data_dir / "sync_state.json"
        if state_file.exists():
            with contextlib.suppress(OSError):
                os.unlink(str(state_file))

    async def _authenticated_client(self, session: aiohttp.ClientSession) -> Client:
        """Build an authenticated Client for this service, refreshing the token if
        needed. Verifies a failed refresh with a live get_groups call before giving
        up; deletes a truly-expired session and raises SessionExpiredError."""
        config = await self.load_config()
        token = config.get("access_token")
        if not token:
            raise Exception("Not authenticated")

        auth_dir = str(get_session_dir())
        client = Client(
            group=self._get_group(),
            access_token=token,
            cookies=config.get("cookies"),
            app_id=config.get("x-talk-app-id"),
            user_agent=config.get("user-agent"),
            auth_dir=auth_dir,
        )

        try:
            await client.refresh_if_needed(session, min_seconds_remaining=300)
        except (SessionExpiredError, RefreshFailedError) as refresh_err:
            logger.warning(
                "Token refresh failed - verifying token validity",
                error_type=type(refresh_err).__name__,
                error=str(refresh_err),
            )
            try:
                test_groups = await client.get_groups(session, include_inactive=False)
                if test_groups is not None:
                    logger.info(
                        "Token is still valid despite refresh failure - continuing",
                        groups_found=len(test_groups),
                    )
                else:
                    logger.error("Token verification failed - session is truly expired")
                    tm = get_token_manager()
                    tm.delete_session(self._service)
                    raise SessionExpiredError("Session expired") from refresh_err
            except SessionExpiredError:
                logger.error("Token verification confirmed session is expired")
                tm = get_token_manager()
                tm.delete_session(self._service)
                raise

        if client.access_token != token:
            logger.info(
                "Tokens refreshed during auth check - saving to storage",
                extra={
                    "has_new_cookies": bool(client.cookies),
                    "cookie_count": len(client.cookies) if client.cookies else 0,
                    "cookie_keys": list(client.cookies.keys())
                    if client.cookies
                    else [],
                },
            )
            try:
                tm = get_token_manager()
                access_token = client.access_token
                if access_token is None:
                    logger.warning(
                        "No access token to persist after refresh; skipping save"
                    )
                else:
                    tm.save_session(
                        self._service,
                        access_token,
                        client.refresh_token,
                        client.cookies,
                    )
                    logger.info("Refreshed tokens saved successfully to TokenManager")
            except Exception as e:
                logger.error(
                    "Failed to save refreshed tokens", error=str(e), exc_info=True
                )
        else:
            logger.debug("Token unchanged after refresh check, no save needed")

        return client

    async def start_sync(
        self,
        include_inactive: bool = True,
        force_resync: bool = False,
        initial_limit: int = DEFAULT_INITIAL_MESSAGE_LIMIT,
    ):
        """
        Main sync function.
        - include_inactive: True to sync offline members too
        - force_resync: True to delete previous sync state and fetching fresh logic
        - initial_limit: On a member's initial (cursor-less) sync, keep only the
          newest N messages; 0 (the default) means unlimited — keep full history.
        """
        if self.running:
            return False

        self.running = True
        # Claim ownership of this run (SVC-C1): bump the generation token and
        # register the running task so cancel() can target it and a stale run's
        # finally can detect it no longer owns self.running.
        self._generation += 1
        my_generation = self._generation
        self._task = asyncio.current_task()
        progress = progress_manager.get(self._service)

        try:
            # Load Configuration FIRST - needed for force_resync and all subsequent operations
            app_settings = await self.load_app_settings()
            if not app_settings.get("is_configured"):
                logger.warning(
                    "Sync skipped - configuration incomplete",
                    is_configured=app_settings.get("is_configured"),
                    has_output_dir=bool(app_settings.get("output_dir")),
                )
                progress.error("Output folder not configured")
                return

            self._resolve_service_paths(app_settings)
            assert self.metadata_file is not None  # set by _resolve_service_paths

            # Handle Force Resync: reset only the per-member message cursor so every
            # member is re-fetched from scratch. Do NOT delete sync_metadata.json —
            # it holds the phone->Windows server_unread_count (the read/unread cap)
            # and group state, which the re-sync refreshes in place. Deleting it made
            # a full resync un-mask messages the user had already read (the read
            # state appeared to reset).
            if force_resync:
                logger.info("Force Resync requested. Resetting message cursor...")
                self._reset_message_cursor()

            # Detect if fresh sync for THIS service (empty service dir or just metadata)
            existing_files = (
                list(self.service_data_dir.iterdir())
                if self.service_data_dir.exists()
                else []
            )
            existing_content = [
                f
                for f in existing_files
                if f.name not in ["sync_metadata.json", "sync_state.json"]
            ]
            is_fresh = len(existing_content) == 0

            logger.info(
                "sync_start",
                service=self._service,
                is_fresh=is_fresh,
                connector_limit=20,
            )

            connector = aiohttp.TCPConnector(limit=20)
            async with aiohttp.ClientSession(connector=connector) as session:
                client = await self._authenticated_client(session)

                # Create fresh SyncManager each sync (don't cache stale client)
                # Use service_data_dir so sync_state.json is per-service
                self.manager = SyncManager(client, self.service_data_dir)

                sync_t0 = time.monotonic()
                progress.start_phase("scanning", "Scanning Groups", 1, 0, "group")
                # Honor the include_inactive flag (SVC-I9): True fetches both
                # online and offline members; False limits to active ones.
                groups = await client.get_groups(
                    session, include_inactive=include_inactive
                )

                if not groups:
                    logger.info("No groups found!")
                    progress.complete()
                    return

                progress.set_completed(len(groups))
                # Build task list
                tasks = []
                metadata = await self.load_metadata()

                progress.start_phase(
                    "discovering", "Discovering", 1, len(groups), "group"
                )

                # Build group-level server state (merge into existing, never delete)
                if "server_groups" not in metadata:
                    metadata["server_groups"] = {}
                for g in groups:
                    gid_str = str(g["id"])
                    sub = g.get("subscription", {})
                    sub_state = sub.get("state") if sub else None
                    metadata["server_groups"][gid_str] = {
                        "state": g.get("state", "open"),
                        "is_active": sub_state in ("active", "cancelled")
                        if g.get("state") != "closed"
                        else False,
                        # Server-side unread count (phone -> Windows signal). The API
                        # omits the field when zero, so a missing value means 0 here.
                        "unread_count": int(g.get("unread_count", 0)),
                    }

                for g in groups:
                    # Skip closed groups — their timeline/members return 404
                    if g.get("state") == "closed":
                        continue

                    members = await client.get_members(session, g["id"])
                    for m in members:
                        tasks.append(
                            {
                                "group": g,
                                "member": m,
                            }
                        )

                        # Update per-member sync bookkeeping (no status flags)
                        key = f"{g['id']}_{m['id']}"
                        if key not in metadata["groups"]:
                            metadata["groups"][key] = {
                                "group_id": g["id"],
                                "group_name": g.get("name"),
                                "group_thumbnail": g.get("thumbnail"),
                                "member_id": m["id"],
                                "member_name": m.get("name"),
                                "last_message_id": None,
                                "thumbnail": m.get("thumbnail"),
                                "portrait": m.get("portrait"),
                            }
                        else:
                            metadata["groups"][key]["group_name"] = g.get("name")
                            metadata["groups"][key]["member_name"] = m.get("name")
                            metadata["groups"][key]["thumbnail"] = m.get("thumbnail")
                            metadata["groups"][key]["portrait"] = m.get("portrait")
                            metadata["groups"][key]["group_thumbnail"] = g.get(
                                "thumbnail"
                            )

                total_members = len(tasks)
                self.output_dir.mkdir(parents=True, exist_ok=True)

                closed_count = sum(1 for g in groups if g.get("state") == "closed")
                logger.info(
                    "phase1_complete",
                    elapsed=f"{time.monotonic() - sync_t0:.1f}s",
                    groups=len(groups),
                    closed_groups=closed_count,
                    active_groups=len(groups) - closed_count,
                    total_members=total_members,
                )

                # Global Media Queue
                media_queue: list[dict[str, Any]] = []

                # Phase 2: Sync Members (Group-Level Timeline Fetch)
                # Instead of fetching the group timeline once per member (N API calls),
                # fetch once per group and distribute to all members (1 API call).
                phase2_t0 = time.monotonic()
                progress.start_phase(
                    "syncing", "Collecting Metadata", 2, total_members, "members"
                )

                if self.manager is None:
                    raise RuntimeError("SyncManager not initialized")

                # Group tasks by group_id for batch fetching
                tasks_by_group: dict[int, list[dict[str, Any]]] = defaultdict(list)
                for task in tasks:
                    tasks_by_group[task["group"]["id"]].append(task)

                SYNC_OVERLAP_SECONDS = 300  # 5-minute overlap window

                async def sync_group(
                    gid: int, group_tasks: list[dict[str, Any]]
                ) -> list[tuple[dict[str, Any], int]]:
                    if self.manager is None:
                        raise RuntimeError("SyncManager not initialized")

                    g_t0 = time.monotonic()
                    g_name = group_tasks[0]["group"].get("name", "?")

                    # Find the oldest timestamp cursor across all members.
                    # Only consider SYNCED members; unsynced ones (last_ts=None)
                    # will naturally get all prefetched messages in sync_member
                    # (its filter passes everything when last_ts is None), and
                    # sync_member's own update_sync_state records the correct
                    # cursor after processing.
                    since_timestamps = [
                        self.manager.get_last_ts(gid, t["member"]["id"])
                        for t in group_tasks
                    ]
                    synced_ts = [s for s in since_timestamps if s is not None]
                    none_count = len(since_timestamps) - len(synced_ts)

                    # SVC-I2: a group that mixes SYNCED (has cursor) and UNSYNCED
                    # (no cursor) members must be fetched in full. Using
                    # min(synced cursors) - overlap returns only recent messages,
                    # but the unsynced members need their COMPLETE history —
                    # sync_member records their cursor from what it writes, so
                    # anything not in this fetch is lost forever.
                    if synced_ts and none_count == 0:
                        min_ts = min(synced_ts)
                        # Subtract overlap to catch boundary messages
                        try:
                            dt = datetime.fromisoformat(min_ts.replace("Z", "+00:00"))
                            overlap_dt = dt - timedelta(seconds=SYNC_OVERLAP_SECONDS)
                            min_since_ts: str | None = overlap_dt.isoformat().replace(
                                "+00:00", "Z"
                            )
                        except (ValueError, TypeError):
                            min_since_ts = min_ts
                    else:
                        # Either a genuine first sync (all new) OR a mixed group
                        # with at least one unsynced member — full fetch so the
                        # unsynced members get complete history (SVC-I2).
                        min_since_ts = None

                    if none_count:
                        logger.debug(
                            "group_has_unsynced_members",
                            group=g_name,
                            group_id=gid,
                            members=len(group_tasks),
                            unsynced_members=none_count,
                            full_fetch=min_since_ts is None,
                        )

                    # ONE API call for the entire group
                    all_messages = await self.manager.client.get_messages(
                        session, gid, since_ts=min_since_ts
                    )

                    # Process each member using pre-fetched data (in-memory filtering)
                    group_results: list[tuple[dict[str, Any], int]] = []
                    for task, member_ts in zip(group_tasks, since_timestamps):
                        member_id = task["member"]["id"]
                        member_prefetched = all_messages

                        # SVC-I9: bound the FIRST sync of a cursor-less member to
                        # the newest ``initial_limit`` messages. get_messages has
                        # no server-side count cap, so cap client-side here: slice
                        # this member's newest N messages out of the full timeline
                        # and hand only those to sync_member. sync_member records
                        # the cursor from the newest message it writes, so the
                        # cursor stays correct; older history beyond the cap is
                        # intentionally not fetched (the documented first-sync cap).
                        if member_ts is None and initial_limit and initial_limit > 0:
                            member_msgs = [
                                m
                                for m in all_messages
                                if m.get("member_id") == member_id
                            ]
                            if len(member_msgs) > initial_limit:
                                member_msgs.sort(
                                    key=lambda m: (m.get("published_at") or "", m["id"])
                                )
                                member_prefetched = member_msgs[-initial_limit:]

                        count = await self.manager.sync_member(
                            session,
                            task["group"],
                            task["member"],
                            media_queue,
                            prefetched_messages=member_prefetched,
                        )
                        m_name = task["member"]["name"]
                        progress.update(
                            1, detail=f"{m_name} ({count:,})", detail_extra=""
                        )
                        group_results.append((task, count))

                    group_new = sum(c for _, c in group_results)
                    logger.debug(
                        "group_sync_done",
                        group=g_name,
                        group_id=gid,
                        members=len(group_tasks),
                        fetched_msgs=len(all_messages),
                        new_msgs=group_new,
                        min_since_ts=min_since_ts,
                        elapsed=f"{time.monotonic() - g_t0:.1f}s",
                    )
                    return group_results

                # Groups run in parallel (1 API call each instead of N).
                # SVC-I3: return_exceptions=True so a single group's failure does
                # NOT propagate mid-flight and leave sibling coroutines writing
                # files while the session is torn down. gather awaits every group
                # (success or failure) before returning, so no writer is orphaned.
                group_ids = list(tasks_by_group.keys())
                all_group_results = await asyncio.gather(
                    *[sync_group(gid, tasks_by_group[gid]) for gid in group_ids],
                    return_exceptions=True,
                )

                # Aggregate per-group outcomes. Successful groups are kept even
                # when a sibling failed (partial success). Session-expiry errors
                # are re-raised so the api layer surfaces the re-login sentinel
                # (SVC-I1); other failures are logged per group.
                results = []
                group_errors: list[tuple[int, BaseException]] = []
                for gid, res in zip(group_ids, all_group_results):
                    if isinstance(res, (SessionExpiredError, RefreshFailedError)):
                        raise res
                    if isinstance(res, BaseException):
                        group_errors.append((gid, res))
                        logger.error(
                            "group_sync_failed",
                            group_id=gid,
                            error=str(res),
                            error_type=type(res).__name__,
                        )
                        continue
                    results.extend(res)

                # Only fail the whole sync if EVERY group failed; a partial
                # failure still persists the groups that succeeded.
                if group_errors and not results:
                    first_gid, first_err = group_errors[0]
                    raise RuntimeError(
                        f"All {len(group_errors)} group(s) failed to sync; "
                        f"first error (group {first_gid}): {first_err}"
                    )

                logger.info(
                    "phase2_complete",
                    elapsed=f"{time.monotonic() - phase2_t0:.1f}s",
                    groups=len(tasks_by_group),
                    failed_groups=len(group_errors),
                    total_members=total_members,
                )

                # Update Metadata from results and track new message counts
                total_new_messages = 0
                members_with_new = 0
                for task, count in results:
                    if count > 0:
                        total_new_messages += count
                        members_with_new += 1
                        key = f"{task['group']['id']}_{task['member']['id']}"
                        last_id = self.manager.get_last_id(
                            task["group"]["id"], task["member"]["id"]
                        )
                        last_ts = self.manager.get_last_ts(
                            task["group"]["id"], task["member"]["id"]
                        )
                        if last_id or last_ts:
                            if key in metadata["groups"]:
                                metadata["groups"][key]["last_message_id"] = last_id
                                metadata["groups"][key]["last_sync_ts"] = last_ts

                # Send notification for new messages (after Phase 2, before media download)
                if total_new_messages > 0:
                    # SD-BE-SVC-18: use the async wrapper so plyer's blocking
                    # Win32 notify runs off the event loop (it otherwise stalls
                    # the loop mid-sync, exactly while the UI polls /progress).
                    await notify_sync_complete_async(
                        total_new_messages, members_with_new
                    )

                    # Update search index in background (non-fatal, must not block sync)
                    # The single-thread _write_executor can be contended by blog
                    # indexing; awaiting here would stall Phase 3 for minutes.
                    try:
                        from backend.services.search_service import get_search_service

                        search_svc = get_search_service()
                        members_with_changes = [
                            (task["group"], task["member"])
                            for task, count in results
                            if count > 0
                        ]

                        async def _bg_index():
                            try:
                                indexed = await search_svc.index_members(
                                    members_with_changes, self._service
                                )
                                logger.info("Search index updated", indexed=indexed)
                            except Exception as e:
                                logger.warning(
                                    "Search index update failed (non-fatal)",
                                    error=str(e),
                                )

                        # SVC-M1: retain the task (feat's track_background_task)
                        # so it is not GC'd mid-run and its exceptions are not
                        # lost — mirrors the knowledge-index hook below.
                        track_background_task(_bg_index(), name="sync_search_index")
                    except Exception as e:
                        logger.warning(
                            "Search index update failed (non-fatal)", error=str(e)
                        )

                    # Update knowledge base (KB chatbot) index in background too
                    # (non-fatal, must not block sync) — mirrors the search-index
                    # hook above exactly, same members_with_changes payload, so the
                    # KB chatbot's corpus stays fresh without slowing down sync.
                    try:
                        from backend.services.knowledge_service import (
                            get_knowledge_service,
                            kb_enabled,
                        )

                        async def _bg_index_knowledge():
                            try:
                                if not await kb_enabled():
                                    logger.debug(
                                        "Knowledge index hook skipped (KB disabled)"
                                    )
                                    return
                                knowledge_svc = await get_knowledge_service()
                                indexed = await knowledge_svc.index_members(
                                    members_with_changes, self._service
                                )
                                logger.info("Knowledge index updated", indexed=indexed)
                            except Exception as e:
                                logger.warning(
                                    "Knowledge index update failed (non-fatal)",
                                    error=str(e),
                                )

                        # Retained (not bare `asyncio.create_task`) -- an
                        # un-retained task can be garbage-collected mid-run;
                        # see `background_tasks.track_background_task`.
                        track_background_task(
                            _bg_index_knowledge(), name="sync_knowledge_index"
                        )
                    except Exception as e:
                        logger.warning(
                            "Knowledge index update failed (non-fatal)", error=str(e)
                        )

                # Phase 3: Media Download (Queued)
                phase3_t0 = time.monotonic()
                media_count = len(media_queue)
                progress.start_phase(
                    "downloading", "Downloading Media", 3, media_count, "files"
                )

                if media_queue:
                    logger.info("Downloading media files", media_count=media_count)

                    # Track accumulation manually to ensure we report honest numbers
                    total_successed = 0

                    # Collect all dimensions for batch update. Keyed by member dir,
                    # then by message id (int) -> metadata, matching
                    # process_media_queue / update_message_metadata.
                    all_dimensions_by_dir: dict[Path, dict[int, dict[str, Any]]] = {}

                    # CLI-style: Process in chunks of 50
                    chunk_size = 50
                    for i in range(0, media_count, chunk_size):
                        chunk = media_queue[i : i + chunk_size]

                        # Use list to capture successes from callback scope
                        chunk_stats = [0]

                        async def chunk_cb(c, t):
                            chunk_stats[0] = c
                            # Show accumulated specific success count
                            # Note: users might be confused if this lags behind 'i'.
                            # But it's honest.
                            current_total = total_successed + c
                            progress.set_completed(
                                current_total, detail=f"{current_total:,} files"
                            )

                        chunk_dimensions = await self.manager.process_media_queue(
                            session, chunk, progress_callback=chunk_cb
                        )

                        # Merge chunk dimensions into all_dimensions_by_dir
                        for member_dir, dims in chunk_dimensions.items():
                            if member_dir not in all_dimensions_by_dir:
                                all_dimensions_by_dir[member_dir] = {}
                            all_dimensions_by_dir[member_dir].update(dims)

                        # Add chunk's actual successes to total
                        total_successed += chunk_stats[0]

                    # Update messages.json files with extracted metadata (dimensions, duration, is_muted)
                    for member_dir, meta in all_dimensions_by_dir.items():
                        messages_file = member_dir / "messages.json"
                        await self.manager.update_message_metadata(messages_file, meta)

                else:
                    logger.info("No new media to download.")

                logger.info(
                    "phase3_complete",
                    elapsed=f"{time.monotonic() - phase3_t0:.1f}s",
                    media_count=media_count,
                )

                metadata["last_sync"] = datetime.now(timezone.utc).isoformat()
                await self.save_metadata(metadata)

                logger.info(
                    "sync_complete",
                    total_elapsed=f"{time.monotonic() - sync_t0:.1f}s",
                    new_messages=total_new_messages,
                    members_with_new=members_with_new,
                    media_downloaded=media_count,
                )

            # Cache user nickname so the frontend has it before rendering
            # messages.  First sync of the session uses refresh_profile to pick
            # up any nickname changes; subsequent syncs use get_profile (cached)
            # since users rarely change nicknames mid-session.
            try:
                if not self._profile_refreshed:
                    from backend.api.profile import refresh_profile

                    await refresh_profile(self._service)
                    self._profile_refreshed = True
                else:
                    from backend.api.profile import get_profile

                    await get_profile(self._service)
            except Exception as e:
                logger.warning(
                    "Profile nickname cache failed — user may see %%% placeholders",
                    service=self._service,
                    error_type=type(e).__name__,
                    error=str(e),
                )

            # Auto-enqueue blog backup if enabled (runs in background after modal closes)
            try:
                from backend.services.settings_store import load_config

                blog_settings = await load_config()
                if blog_settings.get("blogs_full_backup"):
                    from backend.services.blog_service import get_blog_backup_manager

                    manager = get_blog_backup_manager()
                    manager.start([self._service])
                    logger.info(
                        "Blog backup auto-enqueued after sync", service=self._service
                    )
            except Exception as e:
                logger.warning(
                    "Blog backup auto-enqueue failed (non-fatal)", error=str(e)
                )

            progress.complete()

        except asyncio.CancelledError:
            # Cooperative cancellation via cancel() (SVC-C1). Report the cancel
            # and re-raise so the task unwinds cleanly and the awaiting cancel()
            # sees it complete.
            logger.warning("Sync cancelled", service=self._service)
            with contextlib.suppress(Exception):
                progress.error("CANCELLED")
            raise
        except (SessionExpiredError, RefreshFailedError):
            # Surface the session-expiry sentinels so the api layer's
            # run_sync_task handler maps them to SESSION_EXPIRED/REFRESH_FAILED,
            # which the frontend keys on to open the re-login modal (SVC-I1).
            # A generic progress.error(str(e)) here would make those detail
            # strings unreachable, so re-raise instead.
            raise
        except Exception as e:
            logger.error("Sync error", error=str(e))
            logger.error(traceback.format_exc())
            progress.error(str(e))
        finally:
            # Only the run that still owns the current generation may clear the
            # running flag / task reference. A stale run (cancelled, superseded
            # by a newer /start) must not clobber a newer run's bookkeeping.
            if self._generation == my_generation:
                self.running = False
                self._task = None

    async def cancel(self) -> bool:
        """Cancel the running sync and wait for it to truly unwind (SVC-C1).

        A real ``task.cancel()`` (rather than merely flipping ``running``)
        guarantees the background task stops writing ``messages.json`` /
        ``sync_metadata.json`` / ``sync_state.json`` before this returns, so a
        subsequent ``start_sync`` cannot launch a second concurrent sync over the
        same output directory. Returns True if a task was cancelled.
        """
        task = self._task
        if task is None or task.done():
            # Nothing owned a live task; make sure the flag is clear either way.
            self.running = False
            self._task = None
            return False

        # SD-BE-SVC-04: snapshot the generation we are cancelling. `await task`
        # yields to the event loop; a queued /start can run in that window and
        # take ownership (new generation, new _task). The force-clear below must
        # only fire when we still own that generation, or it would destroy the
        # newer run's bookkeeping and permit a second concurrent writer.
        my_generation = self._generation

        task.cancel()
        # Await the task's unwind so files are flushed/closed before we return.
        # Any error the run raised while unwinding is already reported via
        # progress inside start_sync/verify, so swallow it.
        # SD-BE-SVC-16: catch CancelledError narrowly — suppress only when the
        # AWAITED task was itself cancelled (expected), and re-raise if THIS
        # (the cancelling) task was cancelled at the await point, honoring
        # asyncio's cancellation contract instead of silently continuing.
        try:
            await task
        except asyncio.CancelledError:
            if not task.cancelled():
                raise
        except Exception:
            pass

        # The task's own finally clears running/_task when it still owns the
        # generation; force-clear here as a safety net for the caller, but only
        # if a newer run has not claimed ownership during the await (SD-BE-SVC-04).
        if self._generation == my_generation:
            self.running = False
            self._task = None
        return True

    async def stop(self) -> None:
        """Shutdown-barrier hook (SVC-S1): stop this service's writer and
        return only once it can no longer write.

        Thin alias over ``cancel()`` — idempotent (safe to call when nothing
        is running) and already awaits the running task's full unwind, which
        is exactly the "drained" guarantee the app-shutdown write barrier
        needs before releasing the data-dir lock.
        """
        await self.cancel()

    async def check_new_messages(self):
        """
        Lightweight check for new messages.
        Uses metadata to quickly check if any member has new messages.
        """
        if self.running:
            return []

        try:
            config = await self.load_config()
            token = config.get("access_token")
            if not token:
                return []

            metadata = await self.load_metadata()
            if not metadata.get("groups"):
                return []

            new_messages = []

            # auth_dir for fallback headless refresh if needed
            auth_dir = str(get_session_dir())

            connector = aiohttp.TCPConnector(limit=10)
            async with aiohttp.ClientSession(connector=connector) as session:
                client = Client(
                    group=self._get_group(),
                    access_token=token,
                    cookies=config.get("cookies"),
                    app_id=config.get("x-talk-app-id"),
                    user_agent=config.get("user-agent"),
                    auth_dir=auth_dir,
                )

                # Group members by group_id for batch fetching
                server_groups = metadata.get("server_groups", {})
                members_by_group: dict[str, list[dict]] = defaultdict(list)
                for key, info in metadata["groups"].items():
                    gid = str(info.get("group_id", ""))
                    sg = server_groups.get(gid, {})
                    if not sg.get("is_active"):
                        continue
                    # Accept members with either timestamp or ID cursor
                    if info.get("last_sync_ts") or info.get("last_message_id"):
                        members_by_group[gid].append(info)

                # ONE API call per group instead of per member
                for gid_str, member_infos in members_by_group.items():
                    try:
                        gid_int = int(gid_str)
                        # Prefer timestamp cursor; fall back to ID for old state
                        ts_list = [
                            m["last_sync_ts"]
                            for m in member_infos
                            if m.get("last_sync_ts")
                        ]
                        if ts_list:
                            min_ts = min(ts_list)
                            msgs = await client.get_messages(
                                session, gid_int, since_ts=min_ts
                            )
                        else:
                            min_last_id = min(
                                m["last_message_id"] for m in member_infos
                            )
                            msgs = await client.get_messages(
                                session, gid_int, since_id=min_last_id
                            )

                        for info in member_infos:
                            member_ts = info.get("last_sync_ts")
                            if member_ts:
                                # SD-BE-SVC-12: strict `>` — the stored cursor IS
                                # the newest already-synced message's
                                # published_at, and get_messages(since_ts=) is
                                # inclusive, so `>=` re-counted that boundary
                                # message as "new" on every check (perpetual
                                # false positive). This check has no id-dedupe,
                                # so the boundary must be excluded here.
                                member_msgs = [
                                    m
                                    for m in msgs
                                    if m.get("member_id") == info["member_id"]
                                    and (m.get("published_at") or "") > member_ts
                                ]
                            else:
                                member_msgs = [
                                    m
                                    for m in msgs
                                    if m.get("member_id") == info["member_id"]
                                    and m["id"] > (info.get("last_message_id") or 0)
                                ]
                            if member_msgs:
                                new_messages.append(
                                    {
                                        "member_name": info["member_name"],
                                        "count": len(member_msgs),
                                        "thumbnail": info.get("thumbnail"),
                                    }
                                )
                    except Exception as e:
                        # SD-BE-SVC-12: log the group actually being processed.
                        # `gid` is a stale leak from the earlier grouping loop
                        # (last member's group); the loop variable here is
                        # `gid_str`.
                        logger.debug(
                            "Failed to check messages for group",
                            group_id=gid_str,
                            error=str(e),
                        )

            return new_messages

        except Exception as e:
            logger.error("Check for new messages error", error=str(e))
            return []

    async def sync_older_messages(self, group_id, member_id, limit):
        """
        Fetch older messages logic.
        (Placeholder during architecture refactor)
        """
        return 0

    async def verify_and_fix_media(self) -> dict[str, Any]:
        """Scan every member's messages.json for missing media (absent/0-byte) and
        backfill it using fresh timeline URLs. One-click, per-service, idempotent."""
        totals: dict[str, Any] = {
            "members": 0,
            "checked": 0,
            "missing": 0,
            "repaired": 0,
            "failed": 0,
            "still_missing": 0,
            # Media-type messages with no recorded/downloadable media source
            # (e.g. media removed on the server). Reported so completeness is
            # never overclaimed as "all present" while these exist.
            "unresolved": 0,
            # Details of the unresolved items (member + timestamp + type) for the
            # results view, capped to keep the payload small.
            "unresolved_items": [],
        }
        if self.running:
            return totals
        self.running = True
        # SD-BE-SVC-02: claim ownership with the SAME machinery as start_sync so
        # /cancel can target this run with a real task.cancel() and serialize it
        # against a subsequent start_sync (exactly one writer per member dir at a
        # time). Without this, cancel() saw no _task, force-cleared running, and
        # a new sync could start writing concurrently with the still-running
        # verify. The /verify endpoint also assigns self._task to close the
        # schedule-delay gap; re-capture here for the direct-call path.
        self._generation += 1
        my_generation = self._generation
        self._task = asyncio.current_task()
        progress = progress_manager.get(self._service)
        try:
            app_settings = await self.load_app_settings()
            if not app_settings.get("is_configured"):
                logger.warning(
                    "Verify skipped - configuration incomplete",
                    is_configured=app_settings.get("is_configured"),
                    has_output_dir=bool(app_settings.get("output_dir")),
                )
                progress.error("Output folder not configured")
                return totals

            self._resolve_service_paths(app_settings)
            messages_root = self.service_data_dir / "messages"

            progress.reset()
            progress.start_phase("verifying", "Verifying", 1, 0, "members")

            if not messages_root.exists():
                progress.complete()
                progress.set_result(totals)
                return totals

            connector = aiohttp.TCPConnector(limit=20)
            async with aiohttp.ClientSession(connector=connector) as session:
                client = await self._authenticated_client(session)
                # Always build a fresh manager with the freshly-authenticated client — never
                # reuse a cached client whose token may have expired (mirrors start_sync).
                manager = SyncManager(client, self.service_data_dir)
                self.manager = manager

                # Phase 1: offline scan, group gaps by group id.
                gaps_by_group: dict[int, list[tuple[Path, list]]] = defaultdict(list)
                for group_dir in sorted(
                    p for p in messages_root.iterdir() if p.is_dir()
                ):
                    try:
                        gid = int(group_dir.name.split(" ", 1)[0])
                    except (ValueError, IndexError):
                        continue
                    for member_dir in sorted(
                        p for p in group_dir.iterdir() if p.is_dir()
                    ):
                        if not (member_dir / "messages.json").exists():
                            continue
                        totals["members"] += 1
                        scan = await asyncio.to_thread(
                            manager.scan_member_media, member_dir
                        )
                        totals["checked"] += scan["checked"]
                        scan_unresolved = scan.get("unresolved") or []
                        totals["unresolved"] += len(scan_unresolved)
                        # member_dir.name is "<id> <name>"; show just the name.
                        member_name = member_dir.name.split(" ", 1)[-1]
                        for u in scan_unresolved:
                            if len(totals["unresolved_items"]) < 200:
                                totals["unresolved_items"].append(
                                    {
                                        "member": member_name,
                                        "timestamp": u.get("timestamp"),
                                        "media_type": u.get("media_type"),
                                    }
                                )
                        if scan["missing"]:
                            totals["missing"] += len(scan["missing"])
                            gaps_by_group[gid].append((member_dir, scan["missing"]))
                        progress.update(1, detail=f"{member_dir.name}")

                # Phase 2: per-group fresh timeline fetch + reconcile.
                if totals["missing"] == 0:
                    progress.complete()
                    progress.set_result(totals)
                    return totals

                progress.start_phase(
                    "repairing", "Repairing Media", 2, totals["missing"], "files"
                )
                done = 0
                for gid, members in gaps_by_group.items():
                    since_ts = _compute_group_since_ts(
                        [d["timestamp"] for _, miss in members for d in miss]
                    )
                    timeline = await manager.client.get_messages(
                        session, gid, since_ts=since_ts
                    )
                    for member_dir, missing in members:
                        base = done

                        async def _cb(c, t, _base=base):
                            progress.set_completed(
                                _base + c, detail=f"{_base + c:,} files"
                            )

                        report = await manager.reconcile_member_media(
                            session,
                            member_dir,
                            missing,
                            timeline,
                            progress_callback=_cb,
                        )
                        done += len(missing)
                        totals["repaired"] += report["repaired"]
                        totals["failed"] += report["failed"]
                        totals["still_missing"] += report["still_missing"]

            progress.complete()
            progress.set_result(totals)
            logger.info("verify_complete", service=self._service, **totals)
            return totals
        except asyncio.CancelledError:
            # SD-BE-SVC-02: cooperative cancellation via cancel(). Report and
            # re-raise so the task unwinds cleanly (stops writing media /
            # messages.json) and the awaiting cancel() sees it complete.
            logger.warning("Verify cancelled", service=self._service)
            with contextlib.suppress(Exception):
                progress.error("CANCELLED")
            raise
        finally:
            # SD-BE-SVC-02: mirror start_sync — only the run that still owns the
            # current generation may clear running/_task, so a stale (cancelled /
            # superseded) verify cannot clobber a newer run's ownership.
            if self._generation == my_generation:
                self.running = False
                self._task = None
