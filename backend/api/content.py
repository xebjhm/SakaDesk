"""
Content API for SakaDesk
Handles reading synced message data from pysaka output directory.

pysaka directory structure:
  output_dir/
    {service_name}/                    <- e.g., "日向坂46"
      messages/
        {group_id} {group_name}/       <- e.g., "34 金村 美玖"
          {member_id} {member_name}/   <- e.g., "58 金村 美玖"
            messages.json
            picture/
            video/
            voice/
      blogs/
        ...
"""

from fastapi import APIRouter, Header, HTTPException, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dataclasses import dataclass
from pathlib import Path
import asyncio
import hashlib
import json
import structlog
import os
from typing import Optional, List, Dict, Any

from backend.services.platform import (
    get_settings_path,
    is_test_mode,
    get_default_output_dir,
    is_windows,
    copy_file_to_clipboard,
)
from backend.services.path_resolver import (
    resolve_service_path,
    resolve_talk_room_path,
    resolve_messages_file,
    resolve_media_path,
)
from backend.services.chat_kind import (  # noqa: F401  (GROUP_CHAT_IDS re-exported)
    GROUP_CHAT_IDS,
    ID_NAME_PATTERN,
    is_group_chat,
    is_member_dir,
)
from backend.services.message_visibility import visible_messages
from backend.services.messages_cache import (
    NO_MESSAGES,
    get_messages_summary,
    stat_key,
)
from backend.services import avatar_resize, photo_thumb, profile_images_service
from backend.services.archive_urls import ArchiveReadError, archive_file_ok
from backend.services.media_range import MediaFileResponse
from backend.version import APP_VERSION
from backend.services.service_utils import (
    validate_service,
    get_service_identifier,
    get_service_display_name,
)

router = APIRouter()
logger = structlog.get_logger(__name__)

# Default fallback if settings not configured
DEFAULT_OUTPUT_DIR = get_default_output_dir()


def validate_path_within_dir(base_dir: Path, user_path: str) -> Path:
    """Validate that a user-provided path stays within the base directory."""
    if "\x00" in user_path or "\n" in user_path or "\r" in user_path:
        raise HTTPException(status_code=400, detail="Invalid path characters")

    base_resolved = base_dir.resolve()
    target_path = (base_dir / user_path).resolve()

    try:
        common = os.path.commonpath([str(base_resolved), str(target_path)])
        if common != str(base_resolved):
            logger.warning("path_traversal_blocked")
            raise HTTPException(status_code=403, detail="Access denied")
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    if (
        not str(target_path).startswith(str(base_resolved) + os.sep)
        and target_path != base_resolved
    ):
        raise HTTPException(status_code=403, detail="Access denied")

    return target_path


def get_output_dir() -> Path:
    """Get the configured output directory from settings."""
    settings_path = get_settings_path()
    if settings_path.exists():
        try:
            with open(settings_path, "r", encoding="utf-8") as f:
                settings = json.load(f)
                path_str = settings.get("output_dir")
                if path_str:
                    return Path(path_str)
        except Exception as e:
            logger.warning("Failed to load output_dir from settings", error=str(e))
    return DEFAULT_OUTPUT_DIR


def load_sync_metadata(
    output_dir: Path,
) -> tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]], Dict[str, str]]:
    """
    Load sync_metadata.json from all service directories.
    Returns (member_entries, server_groups, last_sync_map) where:
      - member_entries: dict mapping "{group_id}_{member_id}" -> sync bookkeeping
      - server_groups: dict mapping "{service_name}:{group_id}" -> { state, is_active }
      - last_sync_map: dict mapping service_id -> ISO timestamp of last sync
    """
    all_members: Dict[str, Dict[str, Any]] = {}
    all_server_groups: Dict[str, Dict[str, Any]] = {}
    all_last_sync: Dict[str, str] = {}

    if not output_dir.exists():
        return all_members, all_server_groups, all_last_sync

    for service_dir in output_dir.iterdir():
        if not service_dir.is_dir():
            continue

        metadata_file = service_dir / "sync_metadata.json"
        if metadata_file.exists():
            try:
                with open(metadata_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    all_members.update(data.get("groups", {}))
                    # Namespace server_groups by service directory name to
                    # prevent cross-service ID collisions (group IDs are only
                    # unique within a single service).
                    for group_id, group_data in data.get("server_groups", {}).items():
                        all_server_groups[f"{service_dir.name}:{group_id}"] = group_data
                    # Extract last_sync timestamp, keyed by service ID
                    if "last_sync" in data:
                        service_id = get_service_identifier(service_dir.name)
                        if service_id:
                            all_last_sync[service_id] = data["last_sync"]
            except Exception as e:
                logger.warning(
                    "Failed to load sync_metadata.json",
                    service=service_dir.name,
                    error=str(e),
                )

    return all_members, all_server_groups, all_last_sync


def parse_id_name(folder_name: str) -> tuple[Optional[str], str]:
    """
    Parse a folder name in format "{id} {name}" or just "{name}".
    Returns (id, name) tuple. ID may be None if not present.
    """
    match = ID_NAME_PATTERN.match(folder_name)
    if match:
        return match.group(1), match.group(2)
    return None, folder_name


def get_member_dirs(group_dir: Path) -> List[Path]:
    """Get all member directories within a group directory (see ``is_member_dir``)."""
    return [item for item in group_dir.iterdir() if is_member_dir(item)]


@router.get("/groups")
async def get_groups(service: str | None = None):
    """
    List groups found in the output directory.

    When ``service`` (a service identifier like ``hinatazaka46``) is provided,
    only that service's groups are returned. Talk-room ids are only unique within
    a service, so a service-scoped view (e.g. the sidebar for the active service)
    must not receive other services' groups.

    pysaka structure:
      output_dir/{service}/messages/{group_id} {group_name}/{member_id} {member_name}/messages.json
    """
    if is_test_mode():
        from backend.fixtures.test_data import TEST_GROUPS

        return TEST_GROUPS

    output_dir = get_output_dir()
    if not output_dir.exists():
        logger.warning(f"Output directory does not exist: {output_dir}")
        return []

    # SD-BE-API-01: the scan parses every member's messages.json (potentially
    # many MB across a large library). Run it off the event loop in one thread
    # hop so it never freezes concurrent endpoints (media streaming, sync polls).
    return await asyncio.to_thread(_collect_groups, output_dir, service)


@dataclass(frozen=True)
class _GroupRef:
    """One conversation folder as listed by ``/groups`` (and the tray tooltip)."""

    service_id: str
    group_dir: Path
    group_id: str
    group_name: str
    member_dirs: List[Path]
    is_group_chat: bool
    is_active: bool
    is_graduated: bool
    #: Server-side unread snapshot for the phone -> Windows badge cap.
    #: ``None`` when absent (old metadata) -> callers must not cap on it.
    server_unread_count: Optional[int]


def _list_group_refs(
    output_dir: Path,
    server_groups: Dict[str, Dict[str, Any]],
    service_filter: str | None = None,
) -> tuple[List[_GroupRef], bool]:
    """Enumerate the conversation folders under ``output_dir``.

    Single source for ``/groups`` and the tray tooltip's unread total, so both
    agree on which conversations exist, which are group chats and what the
    server's unread snapshot is. ``server_groups`` comes from
    ``load_sync_metadata``. Returns ``(refs, matched_service)`` where
    ``matched_service`` is False when ``service_filter`` matched no directory.

    Blocking filesystem work - call via ``asyncio.to_thread``.
    """
    refs: List[_GroupRef] = []
    matched_service = False

    # Iterate over service directories (e.g., 日向坂46)
    for service_dir in output_dir.iterdir():
        if not service_dir.is_dir():
            continue

        messages_dir = service_dir / "messages"
        if not messages_dir.exists() or not messages_dir.is_dir():
            continue

        service_display_name = service_dir.name
        # Convert display name to service identifier (e.g., "日向坂46" -> "hinatazaka46")
        service_id = get_service_identifier(service_display_name)
        if not service_id:
            # Skip unknown service directories
            continue

        # Scope to one service when requested - ids are only unique per service.
        if service_filter and service_id != service_filter:
            continue
        matched_service = True

        # Iterate over group directories (e.g., "34 金村 美玖")
        for group_dir in messages_dir.iterdir():
            if not group_dir.is_dir():
                continue

            group_id, group_name = parse_id_name(group_dir.name)
            if not group_id:
                continue

            # Get member directories within this group
            member_dirs = get_member_dirs(group_dir)
            if not member_dirs:
                continue

            # Check if this is a group chat (multiple members or special group ID)
            is_group = is_group_chat(service_id, group_id, len(member_dirs))

            # Derive status from group-level server state
            sg = server_groups.get(f"{service_display_name}:{group_id}")
            if sg:
                is_graduated = sg.get("state") == "closed"
                is_active = sg.get("is_active", True) if not is_graduated else False
                server_unread_count = sg.get("unread_count")
            else:
                # No server data yet - need to sync first
                is_graduated = False
                is_active = True
                server_unread_count = None

            refs.append(
                _GroupRef(
                    service_id=service_id,
                    group_dir=group_dir,
                    group_id=group_id,
                    group_name=group_name,
                    member_dirs=member_dirs,
                    is_group_chat=is_group,
                    is_active=is_active,
                    is_graduated=is_graduated,
                    server_unread_count=server_unread_count,
                )
            )
    return refs, matched_service


def _collect_groups(output_dir: Path, service_filter: str | None = None) -> dict:
    """Scan the output tree and build the /groups payload.

    When ``service_filter`` is given (a service identifier like
    ``"hinatazaka46"``), only that service's groups are returned — a
    service-scoped view (e.g. the sidebar for the active service) must not
    receive other services' groups. Group/talk ids are only unique WITHIN a
    service (the same id can name a different conversation in another service),
    which is also why the frontend keys unread state by the service-scoped
    path rather than by id.

    Blocking filesystem work (directory walk + per-file json.load) — call via
    ``asyncio.to_thread``, never on the loop (SD-BE-API-01).
    """
    # Load sync metadata for group status (source of truth)
    sync_metadata, server_groups, last_sync_map = load_sync_metadata(output_dir)

    group_refs, matched_service = _list_group_refs(
        output_dir, server_groups, service_filter
    )

    groups = []
    for ref in group_refs:
        service_id = ref.service_id
        group_dir = ref.group_dir
        group_id = ref.group_id
        group_name = ref.group_name
        member_dirs = ref.member_dirs
        is_group = ref.is_group_chat
        is_graduated = ref.is_graduated
        is_active = ref.is_active
        server_unread_count = ref.server_unread_count

        members_info = []
        last_message_id = 0
        total_messages = 0
        group_thumbnail = None
        group_thumbnail_local = None

        for member_dir in member_dirs:
            member_id, member_name = parse_id_name(member_dir.name)
            msg_file = member_dir / "messages.json"

            member_meta = {
                "id": member_id,
                "name": member_name,
                "dir_name": member_dir.name,
                # Relative path from output_dir to member dir
                "path": str(member_dir.relative_to(output_dir)).replace("\\", "/"),
            }

            if msg_file.exists():
                try:
                    summary = get_messages_summary(msg_file)
                    m_data = summary.require_member()
                    member_meta["thumbnail"] = m_data.get("thumbnail")
                    member_meta["portrait"] = m_data.get("portrait")
                    member_meta["phone_image"] = m_data.get("phone_image")
                    member_meta["group_thumbnail"] = m_data.get("group_thumbnail")

                    has_group_thumbnail = bool(m_data.get("group_thumbnail"))
                    if has_group_thumbnail:
                        group_thumbnail = m_data.get("group_thumbnail")

                    try:
                        # Get last message ID (last in file order, as before)
                        last_id = summary.require_last_id()
                        if last_id is not NO_MESSAGES and last_id > last_message_id:
                            last_message_id = last_id

                        # Count messages
                        total_messages += summary.require_total()
                    finally:
                        # After the sidebar totals, so archived-image trouble
                        # can never cost a member its counts. Never raises.
                        member_meta.update(
                            profile_images_service.local_urls(
                                output_dir, member_dir, member_meta["path"]
                            )
                        )
                        if has_group_thumbnail:
                            group_thumbnail_local = member_meta.get(
                                "group_thumbnail_local"
                            )
                except Exception as e:
                    logger.warning(
                        "Failed to read messages file",
                        file_path=str(msg_file),
                        error=str(e),
                    )

            members_info.append(member_meta)

        member_count = len(members_info)

        groups.append(
            {
                "id": group_id,
                "name": group_name,
                "service": service_id,
                "dir_name": group_dir.name,
                # Path to group directory relative to output_dir
                "group_path": str(group_dir.relative_to(output_dir)).replace("\\", "/"),
                "member_count": member_count,
                "is_group_chat": is_group,
                "is_active": is_active,
                "is_graduated": is_graduated,
                "server_unread_count": server_unread_count,
                "thumbnail": group_thumbnail,
                "thumbnail_local": group_thumbnail_local,
                "last_message_id": last_message_id,
                "total_messages": total_messages,
                "members": members_info,
            }
        )

    # A requested service that matched no directory yields an empty list, which
    # is indistinguishable from "not synced yet". Log it so a mismatched/stale
    # service identifier (vs an empty sidebar) is debuggable (SD-BE-API-01).
    if service_filter and not matched_service:
        logger.warning(
            "groups requested for unknown or unsynced service",
            service=service_filter,
        )

    # Sort: active first, then by group ID
    groups.sort(
        key=lambda g: (not g["is_active"], g["is_group_chat"], int(str(g["id"])))
    )
    return {"groups": groups, "last_sync": last_sync_map}


_NO_CACHE = "no-cache"


def _etag(files: list[Path], *params: Any) -> Optional[str]:
    """Strong validator for a response built from ``files`` with ``params``.

    Covers every input of the response: the files' stat keys, the query
    parameters that shape it, and the app version (a code change can change
    the shape). None if a file vanished mid-request (no caching then).
    """
    try:
        keys = [(str(f), stat_key(f)) for f in files]
    except OSError:
        return None
    raw = json.dumps([keys, [str(p) for p in params], APP_VERSION], ensure_ascii=False)
    return '"' + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32] + '"'


def _etag_matches(if_none_match: Optional[str], etag: Optional[str]) -> bool:
    """RFC 9110 ``If-None-Match`` check using weak comparison.

    Accepts ``*`` (matches whenever a representation exists), comma-separated
    lists and weak ``W/"..."`` forms.
    """
    if etag is None or not if_none_match:
        return False
    for candidate in if_none_match.split(","):
        candidate = candidate.strip()
        if candidate == "*":
            return True
        if candidate.startswith("W/"):
            candidate = candidate[2:]
        if candidate == etag:
            return True
    return False


def _not_modified(etag: str) -> Response:
    return Response(status_code=304, headers={"ETag": etag, "Cache-Control": _NO_CACHE})


def _load_member_messages(
    msg_file: Path, limit: int, last_read_id: int, output_dir: Optional[Path] = None
) -> dict:
    """Blocking body of messages_by_path (unchanged logic) — run in a thread."""
    with open(msg_file, "r", encoding="utf-8") as f:
        data: dict = json.load(f)
    messages = visible_messages(data.get("messages", []))
    messages.sort(key=lambda x: x.get("timestamp", ""))
    total = len(messages)
    unread_count = 0
    max_message_id = 0
    if last_read_id > 0:
        for m in messages:
            msg_id = m.get("id", 0)
            if msg_id > max_message_id:
                max_message_id = msg_id
            if msg_id > last_read_id:
                unread_count += 1
    else:
        unread_count = total
        if messages:
            max_message_id = max(m.get("id", 0) for m in messages)
    if limit > 0:
        messages = messages[-limit:]
    data["messages"] = messages
    data["total_count"] = total
    data["unread_count"] = unread_count
    data["max_message_id"] = max_message_id
    if isinstance(data.get("member"), dict):
        output_dir = output_dir or get_output_dir()
        data["member"].update(
            profile_images_service.local_urls(output_dir, msg_file.parent)
        )
    return data


@router.get("/messages_by_path")
async def get_messages_by_path(
    response: Response,
    path: str,
    limit: int = 0,
    offset: int = 0,
    last_read_id: int = 0,
    if_none_match: Optional[str] = Header(default=None),
):
    """
    Get messages using the relative path from output dir.
    Path should point to the member directory containing messages.json.

    Example path: "日向坂46/messages/34 金村 美玖/58 金村 美玖"

    Parameters:
    - limit: Maximum number of messages to return (returns latest messages)
    - last_read_id: For calculating unread count

    Sends an ETag with ``Cache-Control: no-cache``; a matching
    ``If-None-Match`` gets ``304`` without the file being parsed.
    """
    if is_test_mode():
        from backend.fixtures.test_data import get_test_messages_response

        return get_test_messages_response(path, last_read_id)

    output_dir = get_output_dir()
    safe_path = validate_path_within_dir(output_dir, path)
    logger.debug("Loading messages", path=path, limit=limit, last_read_id=last_read_id)

    msg_file = safe_path / "messages.json"
    if not msg_file.exists():
        logger.debug("Messages file not found", file_path=str(msg_file))
        raise HTTPException(status_code=404, detail="No messages found")

    # offset is a response-shaping API parameter, so it is keyed even though
    # the handler does not use it yet.
    etag = _etag(
        [msg_file, *profile_images_service.index_files(safe_path)],
        "member",
        path,
        limit,
        offset,
        last_read_id,
    )
    if etag is not None and _etag_matches(if_none_match, etag):
        return _not_modified(etag)

    try:
        data = await asyncio.to_thread(
            _load_member_messages,
            msg_file,
            limit,
            last_read_id,
            output_dir,
        )
    except Exception as e:
        logger.error("Failed to load messages", path=path, error=str(e))
        raise HTTPException(status_code=500, detail="An internal error occurred")

    if etag is not None:
        response.headers["ETag"] = etag
        response.headers["Cache-Control"] = _NO_CACHE
    return data


def _group_member_files(safe_path: Path) -> list[Path]:
    files = []
    for member_dir in sorted(safe_path.iterdir()):
        if member_dir.is_dir() and parse_id_name(member_dir.name)[0]:
            msg_file = member_dir / "messages.json"
            if msg_file.exists():
                files.append(msg_file)
                files.extend(profile_images_service.index_files(member_dir))
    return files


def _load_group_messages(
    safe_path: Path,
    group_path: str,
    limit: int,
    last_read_id: int,
    output_dir: Optional[Path] = None,
) -> dict:
    """Blocking body of group_messages (unchanged logic) — run in a thread."""
    output_dir = output_dir or get_output_dir()  # once, not per member
    group_rel = profile_images_service.rel_path(output_dir, safe_path)
    all_messages = []
    members_map = {}

    for member_dir in safe_path.iterdir():
        if not member_dir.is_dir():
            continue

        member_id, member_name = parse_id_name(member_dir.name)
        if not member_id:
            continue

        msg_file = member_dir / "messages.json"
        if not msg_file.exists():
            continue

        try:
            with open(msg_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                member_info = data.get("member", {})
                members_map[member_id] = {
                    "id": member_id,
                    "name": member_name,
                    "thumbnail": member_info.get("thumbnail"),
                    "portrait": member_info.get("portrait"),
                    "phone_image": member_info.get("phone_image"),
                    "group_thumbnail": member_info.get("group_thumbnail"),
                }
                members_map[member_id].update(
                    profile_images_service.local_urls(
                        output_dir,
                        member_dir,
                        f"{group_rel}/{member_dir.name}" if group_rel else None,
                    )
                )

                for msg in visible_messages(data.get("messages", [])):
                    msg["member_id"] = member_id
                    msg["member_name"] = member_name
                    all_messages.append(msg)
        except Exception as e:
            logger.warning(
                "Failed to load member messages in group chat",
                member_dir=str(member_dir),
                error=str(e),
            )

    all_messages.sort(key=lambda m: m.get("timestamp", ""))
    total = len(all_messages)

    # Calculate unread count
    unread_count = 0
    max_message_id = 0
    if last_read_id > 0:
        for m in all_messages:
            msg_id = m.get("id", 0)
            if msg_id > max_message_id:
                max_message_id = msg_id
            if msg_id > last_read_id:
                unread_count += 1
    else:
        unread_count = total
        if all_messages:
            max_message_id = max(m.get("id", 0) for m in all_messages)

    # Simple pagination: return latest messages
    if limit > 0:
        paginated = all_messages[-limit:]
    else:
        paginated = all_messages

    return {
        "group_path": group_path,
        "total_messages": total,
        "unread_count": unread_count,
        "max_message_id": max_message_id,
        "members": list(members_map.values()),
        "messages": paginated,
    }


@router.get("/group_messages/{group_path:path}")
async def get_group_messages(
    response: Response,
    group_path: str,
    limit: int = 200,
    offset: int = 0,
    last_read_id: int = 0,
    if_none_match: Optional[str] = Header(default=None),
):
    """
    Get merged messages from all members in a group (for group chats).

    Example group_path: "日向坂46/messages/43 日向坂46"

    Parameters:
    - limit: Maximum number of messages to return (returns latest messages)
    - last_read_id: For calculating unread count

    Sends an ETag with ``Cache-Control: no-cache``; a matching
    ``If-None-Match`` gets ``304`` without the files being parsed.
    """
    output_dir = get_output_dir()
    safe_path = validate_path_within_dir(output_dir, group_path)

    if not safe_path.is_dir():
        raise HTTPException(status_code=404, detail="Group not found")

    files = await asyncio.to_thread(_group_member_files, safe_path)
    # offset is a response-shaping API parameter, so it is keyed even though
    # the handler does not use it yet.
    etag = _etag(files, "group", group_path, limit, offset, last_read_id)
    if etag is not None and _etag_matches(if_none_match, etag):
        return _not_modified(etag)

    data = await asyncio.to_thread(
        _load_group_messages,
        safe_path,
        group_path,
        limit,
        last_read_id,
        output_dir,
    )
    if etag is not None:
        response.headers["ETag"] = etag
        response.headers["Cache-Control"] = _NO_CACHE
    return data


@router.get("/profile_images")
async def get_profile_images(path: str):
    """Archived list icon / chat icon / call-screen images of one member, newest
    first per kind; falls back to the remote URLs before pysaka archived them."""
    output_dir = get_output_dir()
    member_dir = validate_path_within_dir(output_dir, path)
    msg_file = member_dir / "messages.json"
    if not msg_file.exists():
        raise HTTPException(status_code=404, detail="No messages found")

    def _build() -> dict:
        try:
            member_block = get_messages_summary(msg_file).require_member()
        except (OSError, ValueError, AttributeError):  # unreadable / malformed
            member_block = {}
        return profile_images_service.list_images(
            output_dir,
            member_dir,
            member_block,
            profile_images_service.rel_path(output_dir, member_dir),
        )

    return await asyncio.to_thread(_build)


class ReadStateInput(BaseModel):
    """Read state for a single conversation."""

    lastReadId: int = 0
    revealedIds: List[int] = []


@router.post("/unread_counts")
async def get_unread_counts(read_states: Dict[str, Any]):
    """
    Calculate accurate unread counts for multiple paths.

    This is the single source of truth for unread counts.
    The frontend should use this instead of estimating based on message IDs.

    A message is considered UNREAD if:
    - Its ID is greater than lastReadId (not sequentially read), AND
    - Its ID is NOT in revealedIds (not individually revealed)

    Args:
        read_states: Dictionary mapping path -> {lastReadId: int, revealedIds: int[]}
                     e.g., {"path/to/member": {"lastReadId": 100, "revealedIds": [150, 200]}}

    Returns:
        Dictionary mapping path -> unread_count
    """
    output_dir = get_output_dir()
    if not output_dir.exists():
        return {}

    # SD-BE-API-01: this re-reads messages.json for every conversation in the
    # request. Offload the whole scan to a thread so a large batch does not
    # block the event loop.
    return await asyncio.to_thread(_compute_unread_counts, output_dir, read_states)


def _compute_unread_counts(
    output_dir: Path, read_states: Dict[str, Any]
) -> Dict[str, int]:
    """Compute per-path unread counts by reading each conversation's messages.json.

    Blocking filesystem work — call via ``asyncio.to_thread`` (SD-BE-API-01).
    """
    result: Dict[str, int] = {}

    for path, state in read_states.items():
        try:
            # Parse the read state - support both old format (int) and new format (dict)
            if isinstance(state, dict):
                last_read_id = state.get("lastReadId", 0)
                revealed_ids = set(state.get("revealedIds", []))
            else:
                # Legacy format: just lastReadId as int
                last_read_id = int(state) if state else 0
                revealed_ids = set()

            safe_path = validate_path_within_dir(output_dir, path)

            # Check if it's a group chat (has subdirectories with messages.json)
            # or individual member (has messages.json directly)
            msg_file = safe_path / "messages.json"

            if msg_file.exists():
                # Individual member path
                result[path] = get_messages_summary(msg_file).unread_count(
                    last_read_id, revealed_ids
                )
            elif safe_path.is_dir():
                # Group chat path - count messages from all member subdirs
                total_unread = 0
                for member_dir in safe_path.iterdir():
                    if not member_dir.is_dir():
                        continue
                    member_msg_file = member_dir / "messages.json"
                    if member_msg_file.exists():
                        try:
                            total_unread += get_messages_summary(
                                member_msg_file
                            ).unread_count(last_read_id, revealed_ids)
                        except Exception as e:
                            logger.warning(
                                "Failed to calculate unread count for member",
                                member_dir=str(member_dir),
                                error=str(e),
                            )
                result[path] = total_unread
            else:
                result[path] = 0
        except Exception as e:
            logger.debug(f"Error calculating unread for {path}: {e}")
            result[path] = 0

    return result


def _resolve_media_path(file_path: str) -> Path:
    """Resolve a media file path, translating service ID to display name.

    Raises HTTPException 404 if the resolved path does not exist.
    """
    output_dir = get_output_dir()

    parts = file_path.split("/", 1)
    if len(parts) == 2:
        service_part, rest = parts
        try:
            display_name = get_service_display_name(service_part)
            file_path = f"{display_name}/{rest}"
        except ValueError:
            pass

    safe_path = validate_path_within_dir(output_dir, file_path)
    if not safe_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return safe_path


@router.get("/media/{file_path:path}")
async def get_media(file_path: str):
    """Serve media files.

    Path format: {service_id}/{rest} where service_id is romaji (e.g., 'sakurazaka46')
    and rest is the relative path from the service directory (e.g., 'messages/.../voice/123.m4a').

    The service_id is translated to the display name (e.g., '櫻坂46') for disk lookup.

    Range requests get bounded ``206`` bodies (at most
    ``media_range.MEDIA_RANGE_CAP`` bytes) and reading stops when the client
    disconnects, so paused or abandoned video/voice downloads never hold one
    of WebView2's six per-host connections. Requests without ``Range`` (e.g.
    ``<img>``) get the full file with ``200``. See ``backend.services.media_range``;
    it also logs the ``media_request`` breadcrumb.
    """
    safe_path = _resolve_media_path(file_path)
    return MediaFileResponse(safe_path)


@router.get("/avatar/{file_path:path}")
async def get_avatar(file_path: str, w: int = Query(...)):
    """Serve an archived avatar downscaled to ``w`` px (square WebP).

    ``file_path`` is the same as for ``/media/{file_path}`` and is validated
    the same way. ``w`` must be one of ``avatar_resize.ALLOWED_WIDTHS``
    (400 otherwise). The variant is cached on disk; a source that is not
    larger than ``w``, or one Pillow cannot read, is served unchanged.
    """
    if w not in avatar_resize.ALLOWED_WIDTHS:
        logger.info("avatar_request_rejected", reason="width", width=w)
        raise HTTPException(status_code=400, detail="Unsupported width")
    safe_path = _resolve_media_path(file_path)
    served = await asyncio.to_thread(avatar_resize.resized_avatar, safe_path, w)
    if served == safe_path:
        return FileResponse(safe_path)
    return FileResponse(served, media_type="image/webp")


_THUMB_CACHE_CONTROL = "private, max-age=86400"


def _etags(if_none_match: Optional[str]) -> set[str]:
    """The entity tags of an ``If-None-Match`` header (weak prefixes dropped)."""
    if not if_none_match:
        return set()
    return {t.strip().removeprefix("W/") for t in if_none_match.split(",")}


@router.get("/thumb/{file_path:path}")
async def get_thumb(
    file_path: str,
    w: int = Query(...),
    if_none_match: Optional[str] = Header(default=None),
):
    """Serve an archived picture downscaled to fit ``w`` px (WebP, aspect kept).

    ``file_path`` is the same as for ``/media/{file_path}`` and is validated
    the same way (403 outside the output dir), then must be a regular file
    inside it (``archive_file_ok``). ``w`` must be one of
    ``photo_thumb.ALLOWED_WIDTHS`` (400 otherwise). A missing file, a
    non-picture (video, voice, unknown) or a picture that cannot be decoded
    safely answers 404, so the client falls back to the full media URL. The
    variant is cached on disk (see ``backend.services.photo_thumb``). The
    answer carries a stable ``ETag`` (the variant's hash name; a matching
    ``If-None-Match`` gets 304), ``Cache-Control: private, max-age=86400``
    and ``X-Content-Type-Options: nosniff``. The body is read into memory
    first (thumbnails are small), so a variant evicted meanwhile answers
    404, never a 500.
    """
    if w not in photo_thumb.ALLOWED_WIDTHS:
        logger.info("thumb_request_rejected", reason="width", width=w)
        raise HTTPException(status_code=400, detail="Unsupported width")
    # The path checks stat the archive: off the event loop, on the thumbnail
    # pool, so hundreds of tile requests never stall other requests.
    safe_path, rel = await photo_thumb.run_io(_thumb_source, file_path)
    served = await photo_thumb.thumbnail(safe_path, rel, w)
    if served is None:
        raise HTTPException(status_code=404, detail="No thumbnail")
    # The variant's name is a hash of (path, size, mtime, width): a stable ETag.
    headers = {
        "ETag": f'"{served.stem}"',
        "Cache-Control": _THUMB_CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
    }
    if headers["ETag"] in _etags(if_none_match):
        return Response(status_code=304, headers=headers)
    body = await photo_thumb.run_io(photo_thumb.read_variant, served)
    if body is None:
        raise HTTPException(status_code=404, detail="No thumbnail")
    return Response(content=body, media_type="image/webp", headers=headers)


def _thumb_source(file_path: str) -> tuple[Path, str]:
    """``(validated archive file, output-relative POSIX path)``. Blocking.

    403 outside the output dir, 404 when it is not a regular archive file.
    """
    safe_path = _resolve_media_path(file_path)
    output_dir = get_output_dir()
    try:
        is_file = archive_file_ok(output_dir, safe_path)
    except ArchiveReadError:
        logger.info("memories_skip", view="photo_thumb", reason="unreadable")
        raise HTTPException(status_code=404, detail="File not found") from None
    if not is_file:
        logger.info("memories_skip", view="photo_thumb", reason="not_file")
        raise HTTPException(status_code=404, detail="File not found")
    return safe_path, safe_path.relative_to(output_dir.resolve()).as_posix()


# =============================================================================
# Param-based Content Endpoints (New API)
# These use query parameters instead of path parameters for cleaner URLs
# =============================================================================


@router.get("/talk_rooms")
async def get_talk_rooms(service: str = Query(..., description="Service identifier")):
    """List all talk rooms for a service (param-based)."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    service_path = resolve_service_path(service)
    messages_path = service_path / "messages"

    if not messages_path.exists():
        return {"service": service, "talk_rooms": []}

    talk_rooms = []
    for talk_room_dir in messages_path.iterdir():
        if not talk_room_dir.is_dir():
            continue

        talk_room_id, talk_room_name = parse_id_name(talk_room_dir.name)
        if not talk_room_id:
            continue

        member_dirs = [
            d
            for d in talk_room_dir.iterdir()
            if d.is_dir() and (d / "messages.json").exists()
        ]
        member_count = len(member_dirs)
        room_type = (
            "group_event"
            if is_group_chat(service, talk_room_id, member_count)
            else "individual"
        )

        talk_rooms.append(
            {
                "id": int(talk_room_id),
                "name": talk_room_name,
                "type": room_type,
                "member_count": member_count,
            }
        )

    talk_rooms.sort(key=lambda r: r["id"])  # type: ignore[arg-type,return-value]
    return {"service": service, "talk_rooms": talk_rooms}


@router.get("/members")
async def get_members(service: str = Query(...), talk_room_id: int = Query(...)):
    """List members in a talk room (param-based)."""
    try:
        validate_service(service)
        talk_room_path = resolve_talk_room_path(service, talk_room_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    members = []
    for member_dir in talk_room_path.iterdir():
        if not member_dir.is_dir():
            continue

        member_id, member_name = parse_id_name(member_dir.name)
        if not member_id:
            continue

        msg_file = member_dir / "messages.json"
        if not msg_file.exists():
            continue

        member_info = {"id": int(member_id), "name": member_name}

        try:
            with open(msg_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                m_data = data.get("member", {})
                member_info["thumbnail"] = m_data.get("thumbnail")
                member_info["portrait"] = m_data.get("portrait")
        except Exception:
            pass

        members.append(member_info)

    return {"service": service, "talk_room_id": talk_room_id, "members": members}


@router.get("/messages")
async def get_messages_param(
    service: str = Query(...),
    talk_room_id: int = Query(...),
    member_id: int = Query(...),
    limit: int = 0,
    last_read_id: int = 0,
):
    """Get messages for a member (param-based)."""
    try:
        validate_service(service)
        msg_file = resolve_messages_file(service, talk_room_id, member_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    if not msg_file.exists():
        raise HTTPException(status_code=404, detail="No messages found")

    try:
        with open(msg_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            messages = data.get("messages", [])
            messages.sort(key=lambda x: x.get("timestamp", ""))

            total = len(messages)
            unread_count = 0
            max_message_id = 0

            for m in messages:
                msg_id = m.get("id", 0)
                if msg_id > max_message_id:
                    max_message_id = msg_id
                if last_read_id > 0 and msg_id > last_read_id:
                    unread_count += 1

            if last_read_id == 0:
                unread_count = total

            if limit > 0:
                messages = messages[-limit:]

            data["messages"] = messages
            data["total_count"] = total
            data["unread_count"] = unread_count
            data["max_message_id"] = max_message_id
            return data
    except Exception as e:
        logger.error(
            "Failed to load messages",
            service=service,
            talk_room_id=talk_room_id,
            member_id=member_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="An internal error occurred")


@router.get("/talk_room_messages")
async def get_talk_room_messages_param(
    service: str = Query(...),
    talk_room_id: int = Query(...),
    limit: int = 200,
    last_read_id: int = 0,
):
    """Get merged messages from all members in a talk room (param-based)."""
    try:
        validate_service(service)
        talk_room_path = resolve_talk_room_path(service, talk_room_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    all_messages = []
    members_map = {}

    for member_dir in talk_room_path.iterdir():
        if not member_dir.is_dir():
            continue

        member_id, member_name = parse_id_name(member_dir.name)
        if not member_id:
            continue

        msg_file = member_dir / "messages.json"
        if not msg_file.exists():
            continue

        try:
            with open(msg_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                member_info = data.get("member", {})
                members_map[member_id] = {
                    "id": int(member_id),
                    "name": member_name,
                    "thumbnail": member_info.get("thumbnail"),
                }

                for msg in visible_messages(data.get("messages", [])):
                    msg["member_id"] = member_id
                    msg["member_name"] = member_name
                    all_messages.append(msg)
        except Exception as e:
            logger.warning(f"Failed to load messages: {e}")

    all_messages.sort(key=lambda m: m.get("timestamp", ""))
    total = len(all_messages)

    unread_count = (
        sum(1 for m in all_messages if m.get("id", 0) > last_read_id)
        if last_read_id
        else total
    )
    max_message_id = max((m.get("id", 0) for m in all_messages), default=0)

    if limit > 0:
        all_messages = all_messages[-limit:]

    return {
        "service": service,
        "talk_room_id": talk_room_id,
        "total_messages": total,
        "unread_count": unread_count,
        "max_message_id": max_message_id,
        "members": list(members_map.values()),
        "messages": all_messages,
    }


@router.get("/media_file")
async def get_media_param(
    service: str = Query(...),
    talk_room_id: int = Query(...),
    member_id: int = Query(...),
    type: str = Query(..., description="Media type: picture, video, voice"),
    file: str = Query(..., description="Filename"),
):
    """Serve media files (param-based)."""
    # Validate media type
    ALLOWED_MEDIA_TYPES = {"picture", "video", "voice"}
    if type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid media type: {type}. Allowed: {', '.join(ALLOWED_MEDIA_TYPES)}",
        )

    # Validate filename (no path traversal)
    if "/" in file or "\\" in file or ".." in file or "\x00" in file:
        raise HTTPException(status_code=400, detail="Invalid filename")

    try:
        validate_service(service)
        media_path = resolve_media_path(service, talk_room_id, member_id, type, file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    if not media_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(media_path)


@router.get("/download/{file_path:path}")
async def download_media(file_path: str, filename: Optional[str] = None):
    """Serve a media file with Content-Disposition: attachment.

    Same path resolution as /media/{file_path} but forces a download
    dialog instead of inline display.  A hidden iframe pointing at this
    URL triggers the webview's native download handler.

    Args:
        filename: Custom download filename (e.g. with timestamp prefix).
                  Defaults to the file's actual name on disk.
    """
    safe_path = _resolve_media_path(file_path)
    return FileResponse(
        safe_path,
        filename=filename or safe_path.name,
        media_type="application/octet-stream",
    )


class ClipboardRequest(BaseModel):
    media_url: str


@router.post("/clipboard")
async def copy_to_clipboard(request: ClipboardRequest):
    """Copy a media file to the Windows clipboard.

    Resolves the media URL to a local file path and places it on the
    clipboard using CF_HDROP format so it can be pasted into other apps.

    Returns 501 on non-Windows platforms.
    """
    if not is_windows():
        raise HTTPException(
            status_code=501, detail="Clipboard copy is only supported on Windows"
        )

    # Extract the file path from the media URL.
    # media_url is like "/api/content/media/hinatazaka46/messages/.../video/1.mp4"
    prefix = "/api/content/media/"
    if not request.media_url.startswith(prefix):
        raise HTTPException(status_code=400, detail="Invalid media URL format")

    from urllib.parse import unquote

    file_path_str = unquote(request.media_url[len(prefix) :])
    safe_path = _resolve_media_path(file_path_str)

    try:
        copy_file_to_clipboard(safe_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except RuntimeError as e:
        logger.error("Clipboard operation failed", error=str(e))
        raise HTTPException(status_code=500, detail="Clipboard operation failed")

    return {"ok": True}
