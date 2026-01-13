"""
Content API for HakoDesk
Handles reading synced message data from PyHako output directory.

PyHako directory structure:
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
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pathlib import Path
import json
import structlog
import os
import re
from typing import Optional, List, Dict, Any

from backend.services.platform import get_settings_path, is_test_mode

router = APIRouter()
logger = structlog.get_logger(__name__)

# Default fallback if settings not configured
DEFAULT_OUTPUT_DIR = Path("output")

# Group IDs that should be treated as group chat (multiple members posting)
GROUP_CHAT_IDS = ['43', '79']  # 日向坂46 group chat IDs


def validate_path_within_dir(base_dir: Path, user_path: str) -> Path:
    """Validate that a user-provided path stays within the base directory."""
    if '\x00' in user_path or '\n' in user_path or '\r' in user_path:
        raise HTTPException(status_code=400, detail="Invalid path characters")

    base_resolved = base_dir.resolve()
    target_path = (base_dir / user_path).resolve()

    try:
        common = os.path.commonpath([str(base_resolved), str(target_path)])
        if common != str(base_resolved):
            logger.warning(f"Path traversal attempt: {user_path} -> {target_path}")
            raise HTTPException(status_code=403, detail="Access denied")
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    if not str(target_path).startswith(str(base_resolved) + os.sep) and target_path != base_resolved:
        raise HTTPException(status_code=403, detail="Access denied")

    return target_path


def get_output_dir() -> Path:
    """Get the configured output directory from settings."""
    settings_path = get_settings_path()
    if settings_path.exists():
        try:
            with open(settings_path, 'r', encoding='utf-8') as f:
                settings = json.load(f)
                path_str = settings.get("output_dir")
                if path_str:
                    return Path(path_str)
        except Exception:
            pass
    return DEFAULT_OUTPUT_DIR


def parse_id_name(folder_name: str) -> tuple[Optional[str], str]:
    """
    Parse a folder name in format "{id} {name}" or just "{name}".
    Returns (id, name) tuple. ID may be None if not present.
    """
    match = re.match(r'^(\d+)\s+(.+)$', folder_name)
    if match:
        return match.group(1), match.group(2)
    return None, folder_name


def get_member_dirs(group_dir: Path) -> List[Path]:
    """Get all member directories within a group directory."""
    members = []
    for item in group_dir.iterdir():
        if item.is_dir():
            member_id, _ = parse_id_name(item.name)
            if member_id and (item / "messages.json").exists():
                members.append(item)
    return members


@router.get("/groups")
async def get_groups():
    """
    List all groups found in the output directory.

    PyHako structure:
      output_dir/{service}/messages/{group_id} {group_name}/{member_id} {member_name}/messages.json
    """
    if is_test_mode():
        from backend.fixtures.test_data import TEST_GROUPS
        return TEST_GROUPS

    output_dir = get_output_dir()
    if not output_dir.exists():
        logger.warning(f"Output directory does not exist: {output_dir}")
        return []

    groups = []

    # Load metadata for enrichment
    metadata_map = {}
    meta_file = output_dir / "sync_metadata.json"
    if meta_file.exists():
        try:
            with open(meta_file, 'r', encoding='utf-8') as f:
                meta = json.load(f)
                metadata_map = meta.get('groups', {})
        except Exception:
            pass

    # Iterate over service directories (e.g., 日向坂46)
    for service_dir in output_dir.iterdir():
        if not service_dir.is_dir():
            continue

        messages_dir = service_dir / "messages"
        if not messages_dir.exists() or not messages_dir.is_dir():
            continue

        service_name = service_dir.name

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

            members_info = []
            last_message_id = 0
            total_messages = 0
            is_active = True
            group_thumbnail = None

            for member_dir in member_dirs:
                member_id, member_name = parse_id_name(member_dir.name)
                msg_file = member_dir / "messages.json"

                member_meta = {
                    "id": member_id,
                    "name": member_name,
                    "dir_name": member_dir.name,
                    # Relative path from output_dir to member dir
                    "path": str(member_dir.relative_to(output_dir)).replace("\\", "/")
                }

                if msg_file.exists():
                    try:
                        with open(msg_file, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            m_data = data.get('member', {})
                            member_meta['thumbnail'] = m_data.get('thumbnail')
                            member_meta['portrait'] = m_data.get('portrait')
                            member_meta['phone_image'] = m_data.get('phone_image')
                            member_meta['group_thumbnail'] = m_data.get('group_thumbnail')

                            if m_data.get('group_thumbnail'):
                                group_thumbnail = m_data.get('group_thumbnail')

                            # Get last message ID
                            msgs = data.get('messages', [])
                            if msgs:
                                last_id = msgs[-1].get('id', 0)
                                if last_id > last_message_id:
                                    last_message_id = last_id

                            # Count messages
                            m_total = data.get('total_messages', len(msgs))
                            total_messages += m_total

                            # Get is_active from member data
                            if 'is_active' in m_data:
                                is_active = m_data.get('is_active', True)
                    except Exception as e:
                        logger.debug(f"Error reading {msg_file}: {e}")

                members_info.append(member_meta)

            member_count = len(members_info)
            # Check if this is a group chat (multiple members or special group ID)
            is_group_chat = member_count > 1 or group_id in GROUP_CHAT_IDS

            groups.append({
                "id": group_id,
                "name": group_name,
                "service": service_name,
                "dir_name": group_dir.name,
                # Path to group directory relative to output_dir
                "group_path": str(group_dir.relative_to(output_dir)).replace("\\", "/"),
                "member_count": member_count,
                "is_group_chat": is_group_chat,
                "is_active": is_active,
                "thumbnail": group_thumbnail,
                "last_message_id": last_message_id,
                "total_messages": total_messages,
                "members": members_info
            })

    # Sort: active first, then by group ID
    groups.sort(key=lambda g: (not g['is_active'], g['is_group_chat'], int(str(g['id']))))
    return groups


@router.get("/messages_by_path")
async def get_messages_by_path(path: str, limit: int = 0, offset: int = 0, last_read_id: int = 0):
    """
    Get messages using the relative path from output dir.
    Path should point to the member directory containing messages.json.

    Example path: "日向坂46/messages/34 金村 美玖/58 金村 美玖"

    Parameters:
    - limit: Maximum number of messages to return (returns latest messages)
    - last_read_id: For calculating unread count
    """
    if is_test_mode():
        from backend.fixtures.test_data import get_test_messages_response
        return get_test_messages_response(path, last_read_id)

    output_dir = get_output_dir()
    safe_path = validate_path_within_dir(output_dir, path)

    msg_file = safe_path / "messages.json"
    if not msg_file.exists():
        raise HTTPException(status_code=404, detail="No messages found")

    try:
        with open(msg_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            messages = data.get('messages', [])

            # Sort by timestamp
            messages.sort(key=lambda x: x.get('timestamp', ''))

            total = len(messages)

            # Calculate unread count and max_message_id
            unread_count = 0
            max_message_id = 0
            if last_read_id > 0:
                for m in messages:
                    msg_id = m.get('id', 0)
                    if msg_id > max_message_id:
                        max_message_id = msg_id
                    if msg_id > last_read_id:
                        unread_count += 1
            else:
                unread_count = total
                if messages:
                    max_message_id = max(m.get('id', 0) for m in messages)

            # Simple pagination: return latest messages
            if limit > 0:
                messages = messages[-limit:]

            data['messages'] = messages
            data['total_count'] = total
            data['unread_count'] = unread_count
            data['max_message_id'] = max_message_id
            return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/group_messages/{group_path:path}")
async def get_group_messages(group_path: str, limit: int = 200, offset: int = 0, last_read_id: int = 0):
    """
    Get merged messages from all members in a group (for group chats).

    Example group_path: "日向坂46/messages/43 日向坂46"

    Parameters:
    - limit: Maximum number of messages to return (returns latest messages)
    - last_read_id: For calculating unread count
    """
    output_dir = get_output_dir()
    safe_path = validate_path_within_dir(output_dir, group_path)

    if not safe_path.is_dir():
        raise HTTPException(status_code=404, detail="Group not found")

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
            with open(msg_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                member_info = data.get('member', {})
                members_map[member_id] = {
                    "id": member_id,
                    "name": member_name,
                    "thumbnail": member_info.get('thumbnail'),
                    "portrait": member_info.get('portrait'),
                    "phone_image": member_info.get('phone_image'),
                    "group_thumbnail": member_info.get('group_thumbnail')
                }

                for msg in data.get('messages', []):
                    msg['member_id'] = member_id
                    msg['member_name'] = member_name
                    all_messages.append(msg)
        except Exception:
            pass

    all_messages.sort(key=lambda m: m.get('timestamp', ''))
    total = len(all_messages)

    # Calculate unread count
    unread_count = 0
    max_message_id = 0
    if last_read_id > 0:
        for m in all_messages:
            msg_id = m.get('id', 0)
            if msg_id > max_message_id:
                max_message_id = msg_id
            if msg_id > last_read_id:
                unread_count += 1
    else:
        unread_count = total
        if all_messages:
            max_message_id = max(m.get('id', 0) for m in all_messages)

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
        "messages": paginated
    }


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

    result: Dict[str, int] = {}

    for path, state in read_states.items():
        try:
            # Parse the read state - support both old format (int) and new format (dict)
            if isinstance(state, dict):
                last_read_id = state.get('lastReadId', 0)
                revealed_ids = set(state.get('revealedIds', []))
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
                with open(msg_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    messages = data.get('messages', [])
                    # A message is unread if: ID > lastReadId AND ID not in revealedIds
                    unread = sum(
                        1 for m in messages
                        if m.get('id', 0) > last_read_id and m.get('id', 0) not in revealed_ids
                    )
                    result[path] = unread
            elif safe_path.is_dir():
                # Group chat path - count messages from all member subdirs
                total_unread = 0
                for member_dir in safe_path.iterdir():
                    if not member_dir.is_dir():
                        continue
                    member_msg_file = member_dir / "messages.json"
                    if member_msg_file.exists():
                        try:
                            with open(member_msg_file, 'r', encoding='utf-8') as f:
                                data = json.load(f)
                                messages = data.get('messages', [])
                                total_unread += sum(
                                    1 for m in messages
                                    if m.get('id', 0) > last_read_id and m.get('id', 0) not in revealed_ids
                                )
                        except Exception:
                            pass
                result[path] = total_unread
            else:
                result[path] = 0
        except Exception as e:
            logger.debug(f"Error calculating unread for {path}: {e}")
            result[path] = 0

    return result


@router.get("/media/{file_path:path}")
async def get_media(file_path: str):
    """Serve media files."""
    output_dir = get_output_dir()
    safe_path = validate_path_within_dir(output_dir, file_path)
    logger.debug(f"Media request: {file_path} -> {safe_path}, exists={safe_path.exists()}")

    if not safe_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(safe_path)
