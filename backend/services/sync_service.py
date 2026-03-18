
import asyncio
import json
import time
import aiohttp
import aiofiles
import traceback
from collections import defaultdict
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Any, Optional
from pyzaka import Client, Group, SyncManager, RefreshFailedError, SessionExpiredError
from pyzaka.credentials import get_token_manager
from backend.api.progress import progress_manager
from backend.services.platform import get_session_dir, is_test_mode, get_default_output_dir
from backend.services.notification_service import notify_sync_complete
from backend.services.service_utils import get_service_enum, get_service_display_name, validate_service
import structlog

logger = structlog.get_logger(__name__)


# Default to only sync latest messages on initial sync
DEFAULT_INITIAL_MESSAGE_LIMIT = 1000

class SyncService:
    """
    Per-service sync orchestrator for ZakaDesk.

    Manages the synchronization lifecycle: loading credentials, fetching messages,
    downloading media, and tracking sync state. Each instance handles one service
    (hinatazaka46, sakurazaka46, or nogizaka46).
    """

    def __init__(self, service: str = "hinatazaka46"):
        validate_service(service)
        self._service = service
        self.output_dir = get_default_output_dir()
        self.service_data_dir = get_default_output_dir()  # Will be updated in start_sync
        self.config_dir = Path(".")
        self.running = False
        # self.metadata_file will be resolved dynamically now based on configured output_dir
        self.metadata_file: Optional[Path] = None
        self.manager = None

    def _get_group(self) -> Group:
        """Get Group enum for this service."""
        return get_service_enum(self._service)

    async def load_config(self):
        """Load config from pyzaka's TokenManager (WCM on Windows)."""
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
                async with aiofiles.open(metadata_file, 'r', encoding='utf-8') as f:
                    data = json.loads(await f.read())
                    logger.debug("Sync metadata loaded", last_sync=data.get("last_sync"), group_count=len(data.get("groups", {})))
                    return data
            except Exception as e:
                logger.error("Failed to load sync metadata", error=str(e), metadata_file=str(metadata_file))
        return {"groups": {}, "last_sync": None}
    
    async def save_metadata(self, metadata):
        """Save sync metadata to the per-service JSON file (atomic write)."""
        import os

        if self.metadata_file is None:
            raise RuntimeError("save_metadata called before start_sync")
        self.service_data_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.metadata_file.with_suffix(".json.tmp")
        async with aiofiles.open(tmp, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(metadata, ensure_ascii=False, indent=2))
        os.replace(tmp, self.metadata_file)

    async def start_sync(self, include_inactive: bool = True, force_resync: bool = False, initial_limit: int = DEFAULT_INITIAL_MESSAGE_LIMIT):
        """
        Main sync function.
        - include_inactive: True to sync offline members too
        - force_resync: True to delete previous sync state and fetching fresh logic
        - initial_limit: Only fetch latest N messages per member on initial sync
        """
        if self.running:
            return False

        self.running = True
        progress = progress_manager.get(self._service)

        try:
            # Load Configuration FIRST - needed for force_resync and all subsequent operations
            app_settings = await self.load_app_settings()
            if not app_settings.get("is_configured"):
                logger.warning("Sync skipped - configuration incomplete", is_configured=app_settings.get("is_configured", False), has_output_dir=bool(app_settings.get("output_dir")))
                progress.error("Output folder not configured")
                return

            self.output_dir = Path(app_settings.get("output_dir", str(get_default_output_dir())))

            # Per-service data directory for state files
            service_display = get_service_display_name(self._service)
            self.service_data_dir = self.output_dir / service_display
            self.metadata_file = self.service_data_dir / "sync_metadata.json"

            # Handle Force Resync: Clean slate to ensure fresh URLs and no state gaps
            if force_resync:
                logger.info("Force Resync requested. Clearing state...")
                if self.metadata_file.exists():
                    self.metadata_file.unlink()

                # SyncManager stores state in: service_data_dir / "sync_state.json"
                state_file = self.service_data_dir / "sync_state.json"
                if state_file.exists():
                    state_file.unlink()

            # Load credentials from pyzaka's TokenManager (same as CLI)
            config = await self.load_config()
            token = config.get('access_token')
            if not token:
                raise Exception("Not authenticated")

            # Get auth_dir for headless refresh (from platform settings)
            auth_dir = str(get_session_dir())

            # Detect if fresh sync for THIS service (empty service dir or just metadata)
            existing_files = list(self.service_data_dir.iterdir()) if self.service_data_dir.exists() else []
            existing_content = [f for f in existing_files if f.name not in ["sync_metadata.json", "sync_state.json"]]
            is_fresh = len(existing_content) == 0

            logger.info(
                "sync_start",
                service=self._service,
                is_fresh=is_fresh,
                connector_limit=20,
            )

            connector = aiohttp.TCPConnector(limit=20)
            async with aiohttp.ClientSession(connector=connector) as session:
                # Create client with auth_dir for headless refresh (CLI pattern)
                client = Client(
                    group=self._get_group(),
                    access_token=token,
                    refresh_token=config.get('refresh_token'),
                    cookies=config.get('cookies'),
                    app_id=config.get('x-talk-app-id'),
                    user_agent=config.get('user-agent'),
                    auth_dir=auth_dir  # Enable headless refresh
                )

                # Lazy refresh - only refresh if token expires within 5 minutes
                # This reduces API calls and makes usage less detectable
                try:
                    await client.refresh_if_needed(session, min_seconds_remaining=300)
                except (SessionExpiredError, RefreshFailedError) as refresh_err:
                    # Token refresh mechanism failed - but the token itself might
                    # still be valid (e.g., fresh token where JWT parsing failed
                    # or cookies don't work for the refresh endpoint).
                    # Verify with a real API call before giving up.
                    logger.warning(
                        "Token refresh failed - verifying token validity",
                        error_type=type(refresh_err).__name__,
                        error=str(refresh_err),
                    )
                    try:
                        test_groups = await client.get_groups(session, include_inactive=False)
                        if test_groups is not None:
                            logger.info(
                                "Token is still valid despite refresh failure - continuing sync",
                                groups_found=len(test_groups),
                            )
                        else:
                            # get_groups returned None - token is invalid
                            logger.error("Token verification failed - session is truly expired")
                            tm = get_token_manager()
                            tm.delete_session(self._service)
                            raise SessionExpiredError("Session expired") from refresh_err
                    except SessionExpiredError:
                        logger.error("Token verification confirmed session is expired")
                        tm = get_token_manager()
                        tm.delete_session(self._service)
                        raise

                # Save refreshed tokens if they changed (CLI pattern)
                if client.access_token != token:
                    logger.info(
                        "Tokens refreshed during auth check - saving to storage",
                        extra={
                            "has_new_cookies": bool(client.cookies),
                            "cookie_count": len(client.cookies) if client.cookies else 0,
                            "cookie_keys": list(client.cookies.keys()) if client.cookies else []
                        }
                    )
                    try:
                        tm = get_token_manager()
                        tm.save_session(
                            self._service,
                            client.access_token,
                            client.refresh_token,
                            client.cookies
                        )
                        logger.info("Refreshed tokens saved successfully to TokenManager")
                    except Exception as e:
                        logger.error("Failed to save refreshed tokens", error=str(e), exc_info=True)
                else:
                    logger.debug("Token unchanged after refresh check, no save needed")

                # Create fresh SyncManager each sync (don't cache stale client)
                # Use service_data_dir so sync_state.json is per-service
                self.manager = SyncManager(client, self.service_data_dir)

                sync_t0 = time.monotonic()
                progress.start_phase("scanning", "Scanning Groups", 1, 0, "group")
                # Always include_inactive=True to get both online and offline members
                groups = await client.get_groups(session, include_inactive=True)

                if not groups:
                    logger.info("No groups found!")
                    progress.complete()
                    return
                
                progress.set_completed(len(groups))
                # Build task list
                tasks = []
                metadata = await self.load_metadata()
                
                progress.start_phase("discovering", "Discovering", 1, len(groups), "group")

                # Build group-level server state (merge into existing, never delete)
                if 'server_groups' not in metadata:
                    metadata['server_groups'] = {}
                for g in groups:
                    gid = str(g['id'])
                    sub = g.get('subscription', {})
                    sub_state = sub.get('state') if sub else None
                    metadata['server_groups'][gid] = {
                        'state': g.get('state', 'open'),
                        'is_active': sub_state in ('active', 'cancelled') if g.get('state') != 'closed' else False,
                    }

                for g in groups:
                    # Skip closed groups — their timeline/members return 404
                    if g.get('state') == 'closed':
                        continue

                    members = await client.get_members(session, g['id'])
                    for m in members:
                        tasks.append({
                            'group': g,
                            'member': m,
                        })

                        # Update per-member sync bookkeeping (no status flags)
                        key = f"{g['id']}_{m['id']}"
                        if key not in metadata['groups']:
                            metadata['groups'][key] = {
                                'group_id': g['id'],
                                'group_name': g.get('name'),
                                'group_thumbnail': g.get('thumbnail'),
                                'member_id': m['id'],
                                'member_name': m.get('name'),
                                'last_message_id': None,
                                'thumbnail': m.get('thumbnail'),
                                'portrait': m.get('portrait'),
                            }
                        else:
                            metadata['groups'][key]['group_name'] = g.get('name')
                            metadata['groups'][key]['member_name'] = m.get('name')
                            metadata['groups'][key]['thumbnail'] = m.get('thumbnail')
                            metadata['groups'][key]['portrait'] = m.get('portrait')
                            metadata['groups'][key]['group_thumbnail'] = g.get('thumbnail')
                
                total_members = len(tasks)
                self.output_dir.mkdir(parents=True, exist_ok=True)

                closed_count = sum(1 for g in groups if g.get('state') == 'closed')
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
                progress.start_phase("syncing", "Collecting Metadata", 2, total_members, "members")

                if self.manager is None:
                    raise RuntimeError("SyncManager not initialized")

                # Group tasks by group_id for batch fetching
                tasks_by_group: dict[int, list[dict[str, Any]]] = defaultdict(list)
                for task in tasks:
                    tasks_by_group[task['group']['id']].append(task)

                SYNC_OVERLAP_SECONDS = 300  # 5-minute overlap window

                async def sync_group(gid: int, group_tasks: list[dict[str, Any]]) -> list[tuple[dict[str, Any], int]]:
                    if self.manager is None:
                        raise RuntimeError("SyncManager not initialized")

                    g_t0 = time.monotonic()
                    g_name = group_tasks[0]['group'].get('name', '?')

                    # Find the oldest timestamp cursor across all members.
                    # Only consider SYNCED members; unsynced ones (last_ts=None)
                    # are seeded to the group's current head below.
                    since_timestamps = [
                        self.manager.get_last_ts(gid, t['member']['id'])
                        for t in group_tasks
                    ]
                    synced_ts = [s for s in since_timestamps if s is not None]
                    none_count = len(since_timestamps) - len(synced_ts)

                    if synced_ts:
                        min_ts = min(synced_ts)
                        # Subtract overlap to catch boundary messages
                        try:
                            dt = datetime.fromisoformat(min_ts.replace('Z', '+00:00'))
                            overlap_dt = dt - timedelta(seconds=SYNC_OVERLAP_SECONDS)
                            min_since_ts: str | None = overlap_dt.isoformat().replace('+00:00', 'Z')
                        except (ValueError, TypeError):
                            min_since_ts = min_ts
                    else:
                        # Every member is new — genuine first sync
                        min_since_ts = None

                    if none_count:
                        logger.debug(
                            "group_has_unsynced_members",
                            group=g_name, group_id=gid,
                            members=len(group_tasks),
                            unsynced_members=none_count,
                            full_fetch=min_since_ts is None,
                        )

                    # ONE API call for the entire group
                    all_messages = await self.manager.client.get_messages(
                        session, gid, since_ts=min_since_ts
                    )

                    # Seed unsynced members: set their cursor to the group's
                    # current head so the next sync treats them as caught-up.
                    if none_count and all_messages:
                        head_id = max(m['id'] for m in all_messages)
                        head_ts = max(
                            (m.get('published_at') or '' for m in all_messages),
                            default=None,
                        )
                        for task, ts in zip(group_tasks, since_timestamps):
                            if ts is None:
                                mid = task['member']['id']
                                self.manager.update_sync_state(
                                    gid, mid, head_id, 0, last_ts=head_ts,
                                )
                                logger.debug(
                                    "seeded_unsynced_member",
                                    group=g_name, member=task['member']['name'],
                                    member_id=mid, seeded_last_ts=head_ts,
                                )

                    # Process each member using pre-fetched data (in-memory filtering)
                    group_results: list[tuple[dict[str, Any], int]] = []
                    for task in group_tasks:
                        count = await self.manager.sync_member(
                            session,
                            task['group'],
                            task['member'],
                            media_queue,
                            prefetched_messages=all_messages,
                        )
                        m_name = task['member']['name']
                        progress.update(1, detail=f"{m_name} ({count:,})", detail_extra="")
                        group_results.append((task, count))

                    group_new = sum(c for _, c in group_results)
                    logger.debug(
                        "group_sync_done",
                        group=g_name, group_id=gid,
                        members=len(group_tasks),
                        fetched_msgs=len(all_messages),
                        new_msgs=group_new,
                        min_since_ts=min_since_ts,
                        elapsed=f"{time.monotonic() - g_t0:.1f}s",
                    )
                    return group_results

                # Groups run in parallel (1 API call each instead of N)
                all_group_results = await asyncio.gather(*[
                    sync_group(gid, gt) for gid, gt in tasks_by_group.items()
                ])
                results = [item for sublist in all_group_results for item in sublist]

                logger.info(
                    "phase2_complete",
                    elapsed=f"{time.monotonic() - phase2_t0:.1f}s",
                    groups=len(tasks_by_group),
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
                        last_id = self.manager.get_last_id(task['group']['id'], task['member']['id'])
                        last_ts = self.manager.get_last_ts(task['group']['id'], task['member']['id'])
                        if last_id or last_ts:
                            if key in metadata['groups']:
                                metadata['groups'][key]['last_message_id'] = last_id
                                metadata['groups'][key]['last_sync_ts'] = last_ts

                # Send notification for new messages (after Phase 2, before media download)
                if total_new_messages > 0:
                    notify_sync_complete(total_new_messages, members_with_new)

                    # Update search index in background (non-fatal, must not block sync)
                    # The single-thread _write_executor can be contended by blog
                    # indexing; awaiting here would stall Phase 3 for minutes.
                    try:
                        from backend.services.search_service import get_search_service
                        search_svc = get_search_service()
                        members_with_changes = [
                            (task['group'], task['member'])
                            for task, count in results if count > 0
                        ]

                        async def _bg_index():
                            try:
                                indexed = await search_svc.index_members(members_with_changes, self._service)
                                logger.info("Search index updated", indexed=indexed)
                            except Exception as e:
                                logger.warning("Search index update failed (non-fatal)", error=str(e))

                        asyncio.create_task(_bg_index())
                    except Exception as e:
                        logger.warning("Search index update failed (non-fatal)", error=str(e))

                # Phase 3: Media Download (Queued)
                phase3_t0 = time.monotonic()
                media_count = len(media_queue)
                progress.start_phase("downloading", "Downloading Media", 3, media_count, "files")
                
                if media_queue:
                    logger.info("Downloading media files", media_count=media_count)

                    # Track accumulation manually to ensure we report honest numbers
                    total_successed = 0

                    # Collect all dimensions for batch update
                    all_dimensions_by_dir: dict[Path, dict[str, Any]] = {}

                    # CLI-style: Process in chunks of 50
                    chunk_size = 50
                    for i in range(0, media_count, chunk_size):
                        chunk = media_queue[i:i+chunk_size]

                        # Use list to capture successes from callback scope
                        chunk_stats = [0]

                        async def chunk_cb(c, t):
                            chunk_stats[0] = c
                            # Show accumulated specific success count
                            # Note: users might be confused if this lags behind 'i'.
                            # But it's honest.
                            current_total = total_successed + c
                            progress.set_completed(current_total, detail=f"{current_total:,} files")

                        chunk_dimensions = await self.manager.process_media_queue(session, chunk, progress_callback=chunk_cb)

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

                metadata['last_sync'] = datetime.now(timezone.utc).isoformat()
                await self.save_metadata(metadata)

                logger.info(
                    "sync_complete",
                    total_elapsed=f"{time.monotonic() - sync_t0:.1f}s",
                    new_messages=total_new_messages,
                    members_with_new=members_with_new,
                    media_downloaded=media_count,
                )

            # Auto-enqueue blog backup if enabled (runs in background after modal closes)
            try:
                from backend.services.settings_store import load_config
                blog_settings = await load_config()
                if blog_settings.get("blogs_full_backup"):
                    from backend.services.blog_service import get_blog_backup_manager
                    manager = get_blog_backup_manager()
                    await manager.start([self._service])
                    logger.info("Blog backup auto-enqueued after sync", service=self._service)
            except Exception as e:
                logger.warning("Blog backup auto-enqueue failed (non-fatal)", error=str(e))

            progress.complete()
            
        except Exception as e:

            logger.error("Sync error", error=str(e))
            logger.error(traceback.format_exc())
            progress.error(str(e))
        finally:
            self.running = False


    async def check_new_messages(self):
        """
        Lightweight check for new messages.
        Uses metadata to quickly check if any member has new messages.
        """
        if self.running:
            return []
            
        try:
            config = await self.load_config()
            token = config.get('access_token')
            if not token:
                return []

            metadata = await self.load_metadata()
            if not metadata.get('groups'):
                return []
            
            new_messages = []
            
            # auth_dir for fallback headless refresh if needed
            auth_dir = str(get_session_dir())

            connector = aiohttp.TCPConnector(limit=10)
            async with aiohttp.ClientSession(connector=connector) as session:
                client = Client(
                    group=self._get_group(),
                    access_token=token,
                    refresh_token=config.get('refresh_token'),
                    cookies=config.get('cookies'),
                    app_id=config.get('x-talk-app-id'),
                    user_agent=config.get('user-agent'),
                    auth_dir=auth_dir  # Enable headless refresh fallback
                )
                
                # Group members by group_id for batch fetching
                server_groups = metadata.get('server_groups', {})
                members_by_group: dict[int, list[dict]] = defaultdict(list)
                for key, info in metadata['groups'].items():
                    gid = str(info.get('group_id', ''))
                    sg = server_groups.get(gid, {})
                    if not sg.get('is_active'):
                        continue
                    last_id = info.get('last_message_id')
                    if last_id:
                        members_by_group[info['group_id']].append(info)

                # ONE API call per group instead of per member
                for gid, member_infos in members_by_group.items():
                    try:
                        min_last_id = min(m['last_message_id'] for m in member_infos)
                        msgs = await client.get_messages(
                            session, gid, since_id=min_last_id
                        )
                        for info in member_infos:
                            member_msgs = [
                                m for m in msgs
                                if m.get('member_id') == info['member_id']
                                and m['id'] > info['last_message_id']
                            ]
                            if member_msgs:
                                new_messages.append({
                                    'member_name': info['member_name'],
                                    'count': len(member_msgs),
                                    'thumbnail': info.get('thumbnail')
                                })
                    except Exception as e:
                        logger.debug("Failed to check messages for group", group_id=gid, error=str(e))
            
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
