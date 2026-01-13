# TokenManager Singleton Refactor

## Problem Statement

TokenManager is instantiated multiple times across the codebase, causing:

1. **Excessive logging**: "Using KeyringStore" appears on every instantiation
2. **Unnecessary I/O**: KeyringStore probes the system keyring (write+delete test) on each initialization
3. **Wasted resources**: Multiple instances accessing the same backing credential store

### Current Instantiation Points (9 total)

**Cached (acceptable):**
- `auth_service.py:29, 37` - Cached via `_get_token_manager()` method
- `sync_service.py:38, 46` - Same pattern

**Per-request (problematic):**
- `diagnostics.py:148` - Creates new TokenManager per API call
- `profile.py:64` - Creates new TokenManager per API call
- `report.py:131` - Creates new TokenManager per API call
- `favorites.py:109` - Creates new TokenManager per API call
- `chat_features.py:79` - Creates new TokenManager per API call

## Solution

Add module-level singleton factory function to PyHako's `credentials.py`, following the existing pattern in HakoDesk's `credential_store.py`.

## Implementation

### Step 1: Add singleton to PyHako credentials.py

Add at the end of `PyHako/src/pyhako/credentials.py`:

```python
# Singleton instance
_token_manager: Optional[TokenManager] = None


def get_token_manager() -> TokenManager:
    """
    Get the singleton TokenManager instance.

    This avoids repeated keyring probe operations and log spam
    when TokenManager is accessed from multiple modules.
    """
    global _token_manager
    if _token_manager is None:
        _token_manager = TokenManager()
    return _token_manager
```

### Step 2: Update HakoDesk call sites

Change from direct instantiation to using the factory function:

**Before:**
```python
from pyhako.credentials import TokenManager
TokenManager().save_session(...)
```

**After:**
```python
from pyhako.credentials import get_token_manager
get_token_manager().save_session(...)
```

### Files to Update

1. `backend/api/diagnostics.py` - Line 148
2. `backend/api/profile.py` - Line 64
3. `backend/api/report.py` - Line 131
4. `backend/api/favorites.py` - Line 109
5. `backend/api/chat_features.py` - Line 79

### Files Also Simplified (removed local caching)

- `backend/services/auth_service.py` - Removed `_get_token_manager()` method, now uses global singleton
- `backend/services/sync_service.py` - Removed `_get_token_manager()` method, now uses global singleton

## Testing

After implementation:
1. Start the app and verify "Using KeyringStore" appears only once
2. Make multiple API calls to diagnostics, profile, report, favorites, chat_features
3. Confirm no additional "Using KeyringStore" log entries

## Benefits

- Single keyring probe on first use
- Clean logs (one "Using KeyringStore" message)
- Consistent with existing `get_credential_store()` pattern in HakoDesk
- Code changes: 7 files updated, 2 services simplified

## Implementation Status

**COMPLETED** - All changes implemented on 2025-01-14
