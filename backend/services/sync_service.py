
import asyncio
import json
import aiohttp
import aiofiles
import traceback
from pathlib import Path
from datetime import datetime
from typing import Any
from pyhako import Client, Group, SyncManager, RefreshFailedError, SessionExpiredError
from pyhako.config import (
    MEDIA_DOWNLOAD_CONCURRENCY_INCREMENTAL,
    MEDIA_DOWNLOAD_CONCURRENCY_INITIAL,
)
from pyhako.credentials import get_token_manager
from backend.api.progress import progress_manager
from backend.services.platform import get_session_dir, is_test_mode
from backend.services.notification_service import notify_sync_complete
from backend.services.service_utils import get_service_enum, get_service_display_name, validate_service
import structlog

logger = structlog.get_logger(__name__)


def migrate_legacy_state(output_dir: Path, service: str) -> bool:
    """Migrate shared state files to per-service location.

    Returns True if migration was performed, False if already migrated or nothing to migrate.
    """
    service_display = get_service_display_name(service)
    service_dir = output_dir / service_display

    # Skip if already migrated (per-service state file exists)
    if (service_dir / "sync_state.json").exists():
        return False

    legacy_state = output_dir / "sync_state.json"
    legacy_meta = output_dir / "sync_metadata.json"

    if not legacy_state.exists() and not legacy_meta.exists():
        return False  # Fresh install, nothing to migrate

    # Find group_ids belonging to this service by checking existing directories
    messages_dir = service_dir / "messages"
    if not messages_dir.exists():
        return False

    existing_groups: set[int] = set()
    for d in messages_dir.iterdir():
        if d.is_dir():
            try:
                # Directory names like "87 MemberName" - extract group_id
                group_id = int(d.name.split()[0])
                existing_groups.add(group_id)
            except (ValueError, IndexError):
                pass

    if not existing_groups:
        return False  # No data for this service

    logger.info(f"Migrating legacy state for {service}", groups=list(existing_groups))

    # Filter and write sync_state.json
    if legacy_state.exists():
        with open(legacy_state, encoding='utf-8') as f:
            all_state = json.load(f)
        service_state = {
            k: v for k, v in all_state.items()
            if int(k.split("_")[0]) in existing_groups
        }
        if service_state:
            service_dir.mkdir(parents=True, exist_ok=True)
            with open(service_dir / "sync_state.json", 'w', encoding='utf-8') as f:
                json.dump(service_state, f, indent=2)
            logger.info(f"Migrated sync_state.json for {service}", entries=len(service_state))

    # Filter and write sync_metadata.json
    if legacy_meta.exists():
        with open(legacy_meta, encoding='utf-8') as f:
            all_meta = json.load(f)

        groups_data = all_meta.get("groups", {})
        service_groups = {
            k: v for k, v in groups_data.items()
            if v.get("group_id") in existing_groups
        }

        if service_groups:
            service_meta = {
                "groups": service_groups,
                "last_sync": all_meta.get("last_sync")
            }
            service_dir.mkdir(parents=True, exist_ok=True)
            with open(service_dir / "sync_metadata.json", 'w', encoding='utf-8') as f:
                json.dump(service_meta, f, ensure_ascii=False, indent=2)
            logger.info(f"Migrated sync_metadata.json for {service}", entries=len(service_groups))

    return True

# Default to only sync latest messages on initial sync
DEFAULT_INITIAL_MESSAGE_LIMIT = 1000

class SyncService:
    """
    Per-service sync orchestrator for HakoDesk.

    Manages the synchronization lifecycle: loading credentials, fetching messages,
    downloading media, and tracking sync state. Each instance handles one service
    (hinatazaka46, sakurazaka46, or nogizaka46).
    """

    def __init__(self, service: str = "hinatazaka46"):
        validate_service(service)
        self._service = service
        self.output_dir = Path("output")
        self.service_data_dir = Path("output")  # Will be updated in start_sync
        self.config_dir = Path(".")
        self.running = False
        # self.metadata_file will be resolved dynamically now based on configured output_dir
        self.manager = None

    def _get_group(self) -> Group:
        """Get Group enum for this service."""
        return get_service_enum(self._service)

    async def load_config(self):
        """Load config from pyhako's TokenManager (WCM on Windows)."""
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
            logger.error(f"Config load error: {e}")
        return {}
    
    async def load_app_settings(self):
        """Load application settings (output dir, etc)."""
        from backend.services.platform import get_settings_path
        settings_path = get_settings_path()
        if settings_path.exists():
            try:
                async with aiofiles.open(settings_path, 'r', encoding='utf-8') as f:
                    data = json.loads(await f.read())
                    logger.debug("App settings loaded", settings_keys=list(data.keys()), is_configured=data.get("is_configured"))
                    return data
            except Exception as e:
                logger.error("Failed to load app settings", error=str(e), settings_path=str(settings_path))
        return {}

    async def get_output_dir(self):
        """Resolve the effective output directory."""
        settings = await self.load_app_settings()
        path_str = settings.get("output_dir")
        if path_str:
            return Path(path_str)
        return Path("output")

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
        """Save sync metadata to the per-service JSON file."""
        self.service_data_dir.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(self.metadata_file, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(metadata, ensure_ascii=False, indent=2))

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

            self.output_dir = Path(app_settings.get("output_dir", "output"))

            # Per-service data directory for state files
            service_display = get_service_display_name(self._service)
            self.service_data_dir = self.output_dir / service_display
            self.metadata_file = self.service_data_dir / "sync_metadata.json"

            # Migrate legacy shared state files to per-service location
            try:
                if migrate_legacy_state(self.output_dir, self._service):
                    logger.info(f"Legacy state migrated for {self._service}")
            except Exception as e:
                logger.warning(f"Migration failed (non-fatal): {e}")

            # Handle Force Resync: Clean slate to ensure fresh URLs and no state gaps
            if force_resync:
                logger.info("Force Resync requested. Clearing state...")
                if self.metadata_file.exists():
                    self.metadata_file.unlink()

                # SyncManager stores state in: service_data_dir / "sync_state.json"
                state_file = self.service_data_dir / "sync_state.json"
                if state_file.exists():
                    state_file.unlink()

            # Load credentials from pyhako's TokenManager (same as CLI)
            config = await self.load_config()
            token = config.get('access_token')
            if not token:
                raise Exception("Not authenticated")

            # Get auth_dir for headless refresh (from platform settings)
            auth_dir = str(get_session_dir())

            # Detect if fresh sync for THIS service (empty service dir or just metadata)
            # Smart Concurrency: 20 for fresh, 5 for update
            existing_files = list(self.service_data_dir.iterdir()) if self.service_data_dir.exists() else []
            # Filter out metadata files
            existing_content = [f for f in existing_files if f.name not in ["sync_metadata.json", "sync_state.json"]]
            is_fresh = len(existing_content) == 0

            limit = 20 if is_fresh else 5
            media_concurrency = MEDIA_DOWNLOAD_CONCURRENCY_INITIAL if is_fresh else MEDIA_DOWNLOAD_CONCURRENCY_INCREMENTAL
            logger.info(f"Smart Concurrency: limit={limit}, media_concurrency={media_concurrency} (Fresh={is_fresh})")

            connector = aiohttp.TCPConnector(limit=limit)
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
                except SessionExpiredError:
                    # Session invalidated server-side (e.g., logged in elsewhere)
                    logger.warning("Session expired - user needs to re-login")
                    tm = get_token_manager()
                    tm.delete_session(self._service)
                    logger.info(f"Cleared invalid session for {self._service}")
                    progress.error("Authentication session has expired. Please log in again to continue using the service.")
                    raise  # Re-raise so API endpoint can return proper error
                except RefreshFailedError:
                    # All refresh attempts failed unexpectedly - potential bug
                    logger.error("All token refresh plans failed - possible bug")
                    tm = get_token_manager()
                    tm.delete_session(self._service)
                    logger.info(f"Cleared failed session for {self._service}")
                    progress.error("Authentication failed unexpectedly. Please log in again to continue using the service. If this persists, please report this issue.")
                    raise  # Re-raise so API endpoint can return proper error

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
                        logger.error(f"Failed to save refreshed tokens: {e}", exc_info=True)
                else:
                    logger.debug("Token unchanged after refresh check, no save needed")

                # Create fresh SyncManager each sync (don't cache stale client)
                # Use service_data_dir so sync_state.json is per-service
                self.manager = SyncManager(client, self.service_data_dir)

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
                
                # Global Media Queue
                media_queue: list[dict[str, Any]] = []
                
                # Phase 2: Sync Members (Parallel)
                progress.start_phase("syncing", "Collecting Metadata", 2, total_members, "members")
                sem = asyncio.Semaphore(limit) # Use same limit for semaphore
                
                assert self.manager is not None  # Set at line 191

                async def sync_worker(task):
                    m_name = task['member']['name']

                    # Granular progress callback
                    async def sub_progress(date_str, count):
                        # Update detail immediately to show activity
                        # "MemberName (5,400)"
                        progress.set_detail(f"{m_name} ({count:,})")

                    async with sem:
                        # Pass sub_progress to manager
                        assert self.manager is not None
                        count = await self.manager.sync_member(
                            session, 
                            task['group'], 
                            task['member'], 
                            media_queue, 
                            progress_callback=sub_progress
                        )
                        progress.update(1, detail=f"{m_name} ({count:,})", detail_extra="")
                        return task, count

                # Run parallel sync
                results = await asyncio.gather(*[sync_worker(t) for t in tasks])
                
                # Update Metadata from results and track new message counts
                total_new_messages = 0
                members_with_new = 0
                for task, count in results:
                    if count > 0:
                        total_new_messages += count
                        members_with_new += 1
                        key = f"{task['group']['id']}_{task['member']['id']}"
                        last_id = self.manager.get_last_id(task['group']['id'], task['member']['id'])
                        if last_id:
                            if key in metadata['groups']:
                                metadata['groups'][key]['last_message_id'] = last_id

                # Send notification for new messages (after Phase 2, before media download)
                if total_new_messages > 0:
                    notify_sync_complete(total_new_messages, members_with_new)

                    # Update search index with new messages (non-fatal)
                    try:
                        from backend.services.search_service import get_search_service
                        search_svc = get_search_service()
                        members_with_changes = [
                            (task['group'], task['member'])
                            for task, count in results if count > 0
                        ]
                        indexed = await search_svc.index_members(members_with_changes, self._service)
                        logger.info("Search index updated", indexed=indexed)
                    except Exception as e:
                        logger.warning("Search index update failed (non-fatal)", error=str(e))

                # Phase 3: Media Download (Queued)
                media_count = len(media_queue)
                progress.start_phase("downloading", "Downloading Media", 3, media_count, "files")
                
                if media_queue:
                    logger.info(f"Downloading {media_count} media files...")

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

                        chunk_dimensions = await self.manager.process_media_queue(session, chunk, concurrency=media_concurrency, progress_callback=chunk_cb)

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

                # Phase 5: Blog Sync
                # Mode depends on per-service setting: blogs_full_backup
                # - False (default): Sync metadata only, content fetched on-demand
                # - True: Full backup - download all content + images for offline reading
                service_settings = app_settings.get("services", {}).get(self._service, {})
                blogs_full_backup = service_settings.get("blogs_full_backup", False)

                if blogs_full_backup:
                    progress.start_phase("blogs", "Backing up blogs (full)", 5, 0, "")
                else:
                    progress.start_phase("blogs", "Syncing blog metadata", 5, 0, "")

                try:
                    from backend.services.blog_service import BlogService
                    blog_service = BlogService()

                    async def blog_progress(msg):
                        progress.set_detail(msg)

                    if blogs_full_backup:
                        await blog_service.sync_full_backup(self._service, progress_callback=blog_progress)
                        logger.info(f"Full blog backup complete for {self._service}")
                    else:
                        await blog_service.sync_blog_metadata(self._service, progress_callback=blog_progress)
                        logger.info(f"Blog metadata synced for {self._service}")
                except Exception as e:
                    logger.warning(f"Blog sync failed (non-fatal): {e}")

                # Update blog search index (non-fatal)
                try:
                    from backend.services.search_service import get_search_service
                    search_svc = get_search_service()
                    await search_svc.index_blogs_for_service(self._service)
                except Exception as e:
                    logger.warning(f"Blog search index update failed (non-fatal): {e}")

                metadata['last_sync'] = datetime.utcnow().isoformat() + "Z"
                await self.save_metadata(metadata)

            progress.complete()
            
        except Exception as e:

            logger.error(f"Sync Error: {e}")
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
                
                # Just check active groups for now
                server_groups = metadata.get('server_groups', {})
                for key, info in metadata['groups'].items():
                    gid = str(info.get('group_id', ''))
                    sg = server_groups.get(gid, {})
                    if not sg.get('is_active'):
                        continue
                    
                    last_id = info.get('last_message_id')
                    if last_id:
                        # Fetch just the latest message to compare
                        try:
                            msgs = await client.get_messages(
                                session, 
                                info['group_id'], 
                                since_id=last_id
                            )
                            member_msgs = [m for m in msgs if m.get('member_id') == info['member_id']]
                            if member_msgs:
                                new_messages.append({
                                    'member_name': info['member_name'],
                                    'count': len(member_msgs),
                                    'thumbnail': info.get('thumbnail')
                                })
                        except Exception as e:
                            logger.debug(f"Failed to check messages for {info.get('member_name', 'unknown')}: {e}")
            
            return new_messages
            
        except Exception as e:
            logger.error(f"Check for new messages error: {e}")
            return []

    async def sync_older_messages(self, group_id, member_id, limit):
        """
        Fetch older messages logic.
        (Placeholder during architecture refactor)
        """
        return 0
