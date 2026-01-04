from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
import json
import logging
from typing import List, Optional

from backend.services.platform import get_settings_path

router = APIRouter()
logger = logging.getLogger(__name__)

# Default fallback if settings not configured
DEFAULT_OUTPUT_DIR = Path("output")


def get_output_dir() -> Path:
    """
    Get the configured output directory from settings.
    Falls back to 'output' if not configured.
    """
    settings_path = get_settings_path()
    if settings_path.exists():
        try:
            with open(settings_path, 'r', encoding='utf-8') as f:
                settings = json.load(f)
                path_str = settings.get("output_dir")
                if path_str:
                    return Path(path_str)
        except:
            pass
    return DEFAULT_OUTPUT_DIR

# Group IDs that should be treated as group chat regardless of member count
GROUP_CHAT_IDS = ['43']  # 日向坂46

@router.get("/groups")
async def get_groups():
    """
    List all groups found in the output directory.
    Returns groups with member count and is_active status.
    """
    output_dir = get_output_dir()
    if not output_dir.exists():
        return []
    
    groups = []
    
    # Load metadata for enrichment (thumbnails)
    metadata_map = {}
    meta_file = output_dir / "sync_metadata.json"
    if meta_file.exists():
        try:
            with open(meta_file, 'r', encoding='utf-8') as f:
                meta = json.load(f)
                metadata_map = meta.get('groups', {})
        except:
            pass

    for g_dir in output_dir.iterdir():
        if g_dir.is_dir() and "_" in g_dir.name:
            try:
                gid, gname = g_dir.name.split("_", 1)
                
                # Count members in this group
                member_dirs = [m for m in g_dir.iterdir() if m.is_dir() and "_" in m.name]
                member_count = len(member_dirs)
                
                if member_count == 0:
                    continue
                
                # Check if this is a group chat (multi-member or exception like group 43)
                is_group_chat = member_count > 1 or gid in GROUP_CHAT_IDS
                
                members_info = []
                is_active = True  # Default to active
                group_thumbnail = None
                
                # Check metadata for group info
                for key, val in metadata_map.items():
                    if key.startswith(f"{gid}_"):
                        if val.get('group_thumbnail'):
                            group_thumbnail = val.get('group_thumbnail')
                        # Also could refine is_active logic here if needed, but existing logic considers all members
                        
                
                last_message_id = 0
                total_messages = 0
                
                for m_dir in member_dirs:
                    mid, mname = m_dir.name.split("_", 1)
                    
                    msg_file = m_dir / "messages.json"
                    member_meta = {"id": mid, "name": mname, "dir_name": m_dir.name}
                    
                    if msg_file.exists():
                        try:
                            with open(msg_file, 'r', encoding='utf-8') as f:
                                data = json.load(f)
                                m_data = data.get('member', {})
                                member_meta['thumbnail'] = m_data.get('thumbnail')
                                member_meta['portrait'] = m_data.get('portrait')
                                member_meta['phone_image'] = m_data.get('phone_image')
                                
                                # Access metadata map fallback (Key: gid_mid)
                                meta_key = f"{gid}_{mid}"
                                meta_val = metadata_map.get(meta_key, {})
                                
                                # Priority: messages.json > metadata.json
                                member_meta['group_thumbnail'] = m_data.get('group_thumbnail') or meta_val.get('group_thumbnail')
                                
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
                        except:
                            pass
                    
                    members_info.append(member_meta)
                
                groups.append({
                    "id": gid,
                    "name": gname,
                    "dir_name": g_dir.name,
                    "member_count": member_count,
                    "is_group_chat": is_group_chat,
                    "is_active": is_active,
                    "thumbnail": group_thumbnail,
                    "last_message_id": last_message_id,
                    "total_messages": total_messages,
                    "members": members_info
                })
            except:
                continue
    
    # Sort: active first, then by group ID, group chats last within each section
    groups.sort(key=lambda g: (not g['is_active'], g['is_group_chat'], int(g['id'])))
    return groups


@router.get("/messages_by_path")
async def get_messages_by_path(path: str, limit: int = 0, offset: int = 0, last_read_id: int = 0):
    """
    Get messages using the relative path from output dir.
    limit=0 means all messages.
    If limit > 0, returns the *last* limit messages (latest) by default if offset is 0.
    last_read_id: If provided, calculates unread_count (messages with id > last_read_id).
    """
    output_dir = get_output_dir()
    safe_path = (output_dir / path).resolve()
    if not str(safe_path).startswith(str(output_dir.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    
    msg_file = safe_path / "messages.json"
    if not msg_file.exists():
        raise HTTPException(status_code=404, detail="No messages found")
        
    try:
        with open(msg_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            messages = data.get('messages', [])
            
            # Filter/Sort
            # Sort by timestamp to handle non-monotonic IDs
            messages.sort(key=lambda x: x.get('timestamp', ''))
            
            total = len(messages)
            
            # Calculate unread count from ALL messages (before limiting)
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
                # No lastReadId provided - all are unread
                unread_count = total
                if messages:
                    max_message_id = max(m.get('id', 0) for m in messages)
            
            if limit > 0:
                # If we want the *latest* N messages:
                # slice from max(0, total - limit) to total
                start = max(0, total - limit)
                messages = messages[start:]
                
            data['messages'] = messages
            data['total_count'] = total
            data['unread_count'] = unread_count
            data['max_message_id'] = max_message_id
            return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/group_messages/{group_dir}")
async def get_group_messages(group_dir: str, limit: int = 200, offset: int = 0, last_read_id: int = 0):
    """
    Get merged messages from all members in a group (for live events/group chats).
    last_read_id: If provided, calculates unread_count (messages with id > last_read_id).
    """
    output_dir = get_output_dir()
    safe_path = (output_dir / group_dir).resolve()
    if not str(safe_path).startswith(str(output_dir.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not safe_path.is_dir():
        raise HTTPException(status_code=404, detail="Group not found")
    
    all_messages = []
    members_map = {}
    
    for m_dir in safe_path.iterdir():
        if m_dir.is_dir() and "_" in m_dir.name:
            mid, mname = m_dir.name.split("_", 1)
            
            msg_file = m_dir / "messages.json"
            if msg_file.exists():
                try:
                    with open(msg_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        member_info = data.get('member', {})
                        members_map[mid] = {
                            "id": mid,
                            "name": mname,
                            "thumbnail": member_info.get('thumbnail'),
                            "portrait": member_info.get('portrait'),
                            "phone_image": member_info.get('phone_image'),
                            "group_thumbnail": member_info.get('group_thumbnail')
                        }
                        
                        for msg in data.get('messages', []):
                            msg['member_id'] = mid
                            msg['member_name'] = mname
                            all_messages.append(msg)
                except:
                    pass
    
    all_messages.sort(key=lambda m: m.get('timestamp', ''))
    total = len(all_messages)
    
    # Calculate unread count from ALL messages (before limiting)
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
    
    # Return latest 'limit' messages
    if limit > 0:
        start = max(0, total - limit)
        paginated = all_messages[start:]
    else:
        paginated = all_messages
    
    return {
        "group_dir": group_dir,
        "total_messages": total,
        "unread_count": unread_count,
        "max_message_id": max_message_id,
        "members": list(members_map.values()),
        "messages": paginated
    }


@router.get("/media/{file_path:path}")
async def get_media(file_path: str):
    """Serve media files."""
    output_dir = get_output_dir()
    safe_path = (output_dir / file_path).resolve()
    logger.debug(f"Media request: {file_path} -> {safe_path}, exists={safe_path.exists()}")
    
    if not str(safe_path).startswith(str(output_dir.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    if not safe_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
        
    return FileResponse(safe_path)
