
import asyncio
import json
import aiohttp
import aiofiles
import traceback
from pathlib import Path
from datetime import datetime
from typing import Any
from pyhako import Client, Group, sanitize_name, SyncManager, SessionExpiredError
from pyhako.credentials import TokenManager
from pyhako.utils import get_media_extension
from backend.api.progress import progress
from backend.services.platform import get_session_dir, is_test_mode
from backend.services.notification_service import notify_sync_complete
import logging

# Backward compatibility alias for old code that used HinatazakaClient
def HinatazakaClient(**kwargs):
    return Client(group=Group.HINATAZAKA46, **kwargs)

logger = logging.getLogger(__name__)

# Default to only sync latest messages on initial sync
DEFAULT_INITIAL_MESSAGE_LIMIT = 1000

class SyncService:
    def __init__(self):
        self.output_dir = Path("output")
        self.config_dir = Path(".")
        self.running = False
        # self.metadata_file will be resolved dynamically now based on configured output_dir
        self.manager = None
        self._group = Group.HINATAZAKA46  # Default group

        # Use pyhako's TokenManager (same as CLI) - handles WCM on Windows
        try:
            self._token_manager = TokenManager()
        except Exception as e:
            logger.warning(f"TokenManager init failed (will retry on sync): {e}")
            self._token_manager = None

    def _get_token_manager(self) -> TokenManager:
        """Get or create TokenManager."""
        if self._token_manager is None:
            self._token_manager = TokenManager()
        return self._token_manager

    async def load_config(self):
        """Load config from pyhako's TokenManager (WCM on Windows)."""
        # Test mode uses fixtures
        if is_test_mode():
            from backend.fixtures.test_data import TEST_AUTH_CONFIG
            return TEST_AUTH_CONFIG

        try:
            tm = self._get_token_manager()
            token_data = tm.load_session(self._group.value)
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
                async with aiofiles.open(settings_path, 'r') as f:
                    return json.loads(await f.read())
            except:
                pass
        return {}

    async def get_output_dir(self):
        """Resolve the effective output directory."""
        settings = await self.load_app_settings()
        path_str = settings.get("output_dir")
        if path_str:
            return Path(path_str)
        return Path("output")

    async def load_metadata(self):
        """Load sync metadata for quick checks."""
        output_dir = await self.get_output_dir()
        metadata_file = output_dir / "sync_metadata.json"
        
        if metadata_file.exists():
            try:
                async with aiofiles.open(metadata_file, 'r', encoding='utf-8') as f:
                    return json.loads(await f.read())
            except:
                pass
        return {"groups": {}, "last_sync": None}
    
    async def save_metadata(self, metadata):
        self.output_dir.mkdir(parents=True, exist_ok=True)
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

        try:
            # Load Configuration FIRST - needed for force_resync and all subsequent operations
            app_settings = await self.load_app_settings()
            if not app_settings.get("is_configured"):
                logger.warning("Skipping sync: Output folder not configured.")
                progress.error("Output folder not configured")
                return

            self.output_dir = Path(app_settings.get("output_dir", "output"))
            self.metadata_file = self.output_dir / "sync_metadata.json"

            # Handle Force Resync: Clean slate to ensure fresh URLs and no state gaps
            if force_resync:
                logger.info("Force Resync requested. Clearing state...")
                if self.metadata_file.exists():
                    self.metadata_file.unlink()

                # SyncManager stores state in: output_dir / "sync_state.json"
                state_file = self.output_dir / "sync_state.json"
                if state_file.exists():
                    state_file.unlink()

            # Load credentials from pyhako's TokenManager (same as CLI)
            config = await self.load_config()
            token = config.get('access_token')
            if not token:
                raise Exception("Not authenticated")

            # Get auth_dir for headless refresh (from platform settings)
            auth_dir = str(get_session_dir())

            # Detect if fresh sync (empty output or just metadata)
            # Smart Concurrency: 20 for fresh, 5 for update
            existing_files = list(self.output_dir.iterdir()) if self.output_dir.exists() else []
            # Filter out metadata files
            existing_content = [f for f in existing_files if f.name not in ["sync_metadata.json", "sync_state.json"]]
            is_fresh = len(existing_content) == 0

            limit = 20 if is_fresh else 5
            logger.info(f"Smart Concurrency: limit={limit} (Fresh={is_fresh})")

            connector = aiohttp.TCPConnector(limit=limit)
            async with aiohttp.ClientSession(connector=connector) as session:
                # Create client with auth_dir for headless refresh (CLI pattern)
                client = HinatazakaClient(
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
                    # Session invalidated - signal frontend to redirect to login
                    logger.warning("Session expired - user needs to re-login")
                    progress.error("Session expired. Please login again.")
                    raise  # Re-raise so API endpoint can return proper error

                # Save refreshed tokens if they changed (CLI pattern)
                if client.access_token != token:
                    logger.info("Tokens refreshed during auth check - saving to storage")
                    try:
                        tm = self._get_token_manager()
                        tm.save_session(
                            self._group.value,
                            client.access_token,
                            client.refresh_token,
                            client.cookies
                        )
                    except Exception as e:
                        logger.warning(f"Failed to save refreshed tokens: {e}")

                # Create fresh SyncManager each sync (don't cache stale client)
                self.manager = SyncManager(client, self.output_dir)

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
                
                for g in groups:
                    members = await client.get_members(session, g['id'])
                    for m in members:
                        # Store active status from subscription
                        is_active = g.get('subscription', {}).get('state') == 'active'
                        tasks.append({
                            'group': g, 
                            'member': m,
                            'is_active': is_active
                        })
                        
                        # Update metadata (GUI Specific)
                        key = f"{g['id']}_{m['id']}"
                        if key not in metadata['groups']:
                            metadata['groups'][key] = {
                                'group_id': g['id'],
                                'group_name': g.get('name'),
                                'group_thumbnail': g.get('thumbnail'),
                                'member_id': m['id'],
                                'member_name': m.get('name'),
                                'is_active': is_active,
                                'last_message_id': None,
                                'thumbnail': m.get('thumbnail'),
                                'portrait': m.get('portrait')
                            }
                        else:
                            metadata['groups'][key]['is_active'] = is_active
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

                        chunk_dimensions = await self.manager.process_media_queue(session, chunk, concurrency=5, progress_callback=chunk_cb)

                        # Merge chunk dimensions into all_dimensions_by_dir
                        for member_dir, dims in chunk_dimensions.items():
                            if member_dir not in all_dimensions_by_dir:
                                all_dimensions_by_dir[member_dir] = {}
                            all_dimensions_by_dir[member_dir].update(dims)

                        # Add chunk's actual successes to total
                        total_successed += chunk_stats[0]

                    # Update messages.json files with extracted dimensions
                    for member_dir, dims in all_dimensions_by_dir.items():
                        messages_file = member_dir / "messages.json"
                        await self.manager.update_message_dimensions(messages_file, dims)

                else:
                    logger.info("No new media to download.")
                
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
                client = HinatazakaClient(
                    access_token=token,
                    refresh_token=config.get('refresh_token'),
                    cookies=config.get('cookies'),
                    app_id=config.get('x-talk-app-id'),
                    user_agent=config.get('user-agent'),
                    auth_dir=auth_dir  # Enable headless refresh fallback
                )
                
                # Just check active groups for now
                for key, info in metadata['groups'].items():
                    if not info.get('is_active'):
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
                        except:
                            pass
            
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
