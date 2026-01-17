# Per-Service State Files Design

## Problem

Currently `sync_state.json` and `sync_metadata.json` are shared across all services in the output root directory. This causes:

1. **Potential ID collision** - Keys are `{group_id}_{member_id}` which are NOT unique across services
2. **Race conditions** - Concurrent syncs of multiple services write to the same file
3. **Poor portability** - Cannot cleanly delete/export a single service's data

## Solution

Move state files into per-service directories.

### New Structure

```
output/
├── 日向坂46/
│   ├── sync_metadata.json    # Per-service metadata
│   ├── sync_state.json       # Per-service state (managed by PyHako SyncManager)
│   ├── blogs/
│   └── messages/
├── 櫻坂46/
│   ├── sync_metadata.json
│   ├── sync_state.json
│   ├── blogs/
│   └── messages/
└── 乃木坂46/
    ├── sync_metadata.json
    ├── sync_state.json
    ├── blogs/
    └── messages/
```

## Code Changes

### 1. HakoDesk `SyncService` (sync_service.py)

Change SyncManager instantiation to use service-specific directory:

```python
# Before
self.manager = SyncManager(client, self.output_dir)
self.metadata_file = self.output_dir / "sync_metadata.json"

# After
service_display_name = get_service_display_name(self._service)
self.service_data_dir = self.output_dir / service_display_name
self.manager = SyncManager(client, self.service_data_dir)
self.metadata_file = self.service_data_dir / "sync_metadata.json"
```

### 2. HakoDesk `content.py`

Update metadata loading to read from per-service location:

```python
# Before
meta_file = output_dir / "sync_metadata.json"

# After
service_display = get_service_display_name(service)
meta_file = output_dir / service_display / "sync_metadata.json"
```

### 3. Migration Function

Add migration logic to split legacy shared files:

```python
def migrate_legacy_state(output_dir: Path, service: str) -> bool:
    """Migrate shared state files to per-service location.

    Returns True if migration was performed, False if already migrated.
    """
    service_display = get_service_display_name(service)
    service_dir = output_dir / service_display

    # Skip if already migrated
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

    existing_groups = set()
    for d in messages_dir.iterdir():
        if d.is_dir():
            try:
                group_id = int(d.name.split()[0])
                existing_groups.add(group_id)
            except (ValueError, IndexError):
                pass

    # Filter and write sync_state.json
    if legacy_state.exists():
        with open(legacy_state, encoding='utf-8') as f:
            all_state = json.load(f)
        service_state = {
            k: v for k, v in all_state.items()
            if int(k.split("_")[0]) in existing_groups
        }
        if service_state:
            with open(service_dir / "sync_state.json", 'w', encoding='utf-8') as f:
                json.dump(service_state, f, indent=2)

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
            with open(service_dir / "sync_metadata.json", 'w', encoding='utf-8') as f:
                json.dump(service_meta, f, ensure_ascii=False, indent=2)

    return True
```

### 4. Files to Update

| File | Change |
|------|--------|
| `backend/services/sync_service.py` | Use `service_data_dir` for SyncManager and metadata |
| `backend/api/content.py` | Read metadata from per-service location |
| `backend/api/settings.py` | Update `check_fresh_install` to check per-service dirs |
| `backend/api/diagnostics.py` | Update metadata path for diagnostics |
| `backend/api/report.py` | Update metadata path for reports |

## Migration Strategy

1. Migration runs automatically at start of `start_sync()`
2. Legacy root files are left in place (safe, user can delete manually)
3. Each service migrates independently on first sync after upgrade

## Benefits

- **No race conditions** - Each service writes to its own files
- **Clean portability** - Delete service folder = complete removal
- **ID collision safe** - Same group_id in different services won't conflict
- **Independent state** - Services can sync without interfering with each other

## Implementation Status

**Completed: 2026-01-17**

Files modified:
- `backend/services/sync_service.py` - Added `migrate_legacy_state()` function, updated to use `service_data_dir`
- `backend/api/content.py` - Removed unused root-level metadata loading
- `backend/api/diagnostics.py` - Updated to read from per-service metadata files
- `backend/api/report.py` - Updated to read from per-service metadata files
