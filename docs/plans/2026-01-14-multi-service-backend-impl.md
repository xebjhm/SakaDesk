# Multi-Service Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement backend support for multiple services (Hinatazaka46, Nogizaka46, Sakurazaka46) with separate auth, sync, and the blogs feature.

**Architecture:** Refactor hardcoded single-service code to parameterized multi-service. AuthService and SyncService accept service parameter. Settings split into global vs per-service. New param-based content API alongside deprecated path-based. Blogs use metadata sync + on-demand fetch pattern.

**Tech Stack:** FastAPI, PyHako (Group enum, TokenManager, blog scrapers), aiohttp, Pydantic, structlog

**Design Document:** [2026-01-14-multi-service-backend.md](2026-01-14-multi-service-backend.md)

---

## Phase 1: Multi-Service Foundation

### Task 1.1: Add Service Utilities Module

**Files:**
- Create: `backend/services/service_utils.py`
- Test: `backend/tests/test_service_utils.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_service_utils.py
import pytest
from backend.services.service_utils import (
    get_all_services,
    get_service_display_name,
    get_service_enum,
    validate_service,
)
from pyhako import Group


def test_get_all_services():
    services = get_all_services()
    assert len(services) == 3
    assert "hinatazaka46" in services
    assert "nogizaka46" in services
    assert "sakurazaka46" in services


def test_get_service_display_name():
    assert get_service_display_name("hinatazaka46") == "日向坂46"
    assert get_service_display_name("nogizaka46") == "乃木坂46"
    assert get_service_display_name("sakurazaka46") == "櫻坂46"


def test_get_service_enum():
    assert get_service_enum("hinatazaka46") == Group.HINATAZAKA46
    assert get_service_enum("nogizaka46") == Group.NOGIZAKA46
    assert get_service_enum("sakurazaka46") == Group.SAKURAZAKA46


def test_validate_service_valid():
    assert validate_service("hinatazaka46") == "hinatazaka46"


def test_validate_service_invalid():
    with pytest.raises(ValueError):
        validate_service("invalid_service")
```

**Step 2: Run test to verify it fails**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_service_utils.py -v`
Expected: FAIL with "No module named 'backend.services.service_utils'"

**Step 3: Write minimal implementation**

```python
# backend/services/service_utils.py
"""
Service utilities for multi-service support.
Maps between service identifiers and PyHako Group enum.
"""
from pyhako import Group
from pyhako.client import GROUP_CONFIG


def get_all_services() -> list[str]:
    """Get list of all supported service identifiers."""
    return [g.value for g in Group]


def get_service_display_name(service: str) -> str:
    """Get display name for a service (e.g., '日向坂46')."""
    group = get_service_enum(service)
    return GROUP_CONFIG[group]["display_name"]


def get_service_enum(service: str) -> Group:
    """Convert service string to Group enum."""
    try:
        return Group(service)
    except ValueError:
        raise ValueError(f"Unknown service: {service}")


def validate_service(service: str) -> str:
    """Validate service identifier. Raises ValueError if invalid."""
    get_service_enum(service)  # Will raise if invalid
    return service


def get_service_config(service: str) -> dict:
    """Get full config for a service."""
    group = get_service_enum(service)
    return GROUP_CONFIG[group]
```

**Step 4: Run test to verify it passes**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_service_utils.py -v`
Expected: PASS

**Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk && git add backend/services/service_utils.py backend/tests/test_service_utils.py && git commit -m "feat: add service utilities module for multi-service support"
```

---

### Task 1.2: Refactor AuthService to Support Multiple Services

**Files:**
- Modify: `backend/services/auth_service.py`
- Test: `backend/tests/test_auth_service.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_auth_service.py
import pytest
from unittest.mock import patch, MagicMock
from backend.services.auth_service import AuthService


@pytest.fixture
def auth_service():
    return AuthService()


def test_get_all_status_returns_all_services(auth_service):
    """get_status() with no args returns status for all services."""
    with patch('backend.services.auth_service.get_token_manager') as mock_tm:
        mock_tm.return_value.load_session.return_value = None

        import asyncio
        result = asyncio.run(auth_service.get_status())

        assert "services" in result
        assert "hinatazaka46" in result["services"]
        assert "nogizaka46" in result["services"]
        assert "sakurazaka46" in result["services"]


def test_get_status_single_service(auth_service):
    """get_status(service) returns status for specific service only."""
    with patch('backend.services.auth_service.get_token_manager') as mock_tm:
        mock_tm.return_value.load_session.return_value = None

        import asyncio
        result = asyncio.run(auth_service.get_status(service="hinatazaka46"))

        assert "authenticated" in result
        assert result["authenticated"] == False


def test_get_status_invalid_service(auth_service):
    """get_status with invalid service raises ValueError."""
    import asyncio
    with pytest.raises(ValueError):
        asyncio.run(auth_service.get_status(service="invalid"))
```

**Step 2: Run test to verify it fails**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_auth_service.py -v`
Expected: FAIL (current get_status doesn't accept service param or return services dict)

**Step 3: Modify AuthService**

Update `backend/services/auth_service.py`:

```python
"""
Authentication Service for HakoDesk

Uses pyhako's TokenManager for credential storage (same as CLI).
This ensures consistent behavior across CLI and GUI:
- Windows: Windows Credential Manager (WCM)
- Linux: Plaintext fallback (development only)
"""
import json
import base64
import structlog
from pathlib import Path
from datetime import datetime
from typing import Optional
import aiohttp
from pyhako import BrowserAuth, Group, Client
from pyhako.credentials import get_token_manager

from backend.services.platform import get_session_dir, is_dev_mode, is_test_mode
from backend.services.service_utils import (
    get_all_services,
    get_service_enum,
    get_service_display_name,
    validate_service,
)

logger = structlog.get_logger(__name__)


class AuthService:
    def __init__(self):
        self._session_dir = get_session_dir()

    def _get_group(self, service: str) -> Group:
        """Convert service string to Group enum."""
        return get_service_enum(service)

    def _is_token_expired(self, token: str) -> bool:
        """Check if JWT token is expired."""
        try:
            parts = token.split('.')
            if len(parts) >= 2:
                payload = parts[1]
                payload += '=' * (4 - len(payload) % 4)
                decoded = base64.b64decode(payload)
                data = json.loads(decoded)
                if 'exp' in data:
                    exp_time = datetime.fromtimestamp(data['exp'])
                    now = datetime.now()
                    is_expired = now > exp_time
                    remaining_seconds = (exp_time - now).total_seconds()
                    logger.debug(
                        f"Token expiry check: expired={is_expired}, "
                        f"remaining_seconds={remaining_seconds:.0f}, "
                        f"exp_time={exp_time.isoformat()}"
                    )
                    return is_expired
            logger.warning("Token does not have expected JWT structure")
        except Exception as e:
            logger.error(f"Failed to parse token expiry: {e}")
        return True

    def _get_token_expiry(self, token: str) -> Optional[str]:
        """Get token expiry as ISO string, or None if can't parse."""
        try:
            parts = token.split('.')
            if len(parts) >= 2:
                payload = parts[1]
                payload += '=' * (4 - len(payload) % 4)
                decoded = base64.b64decode(payload)
                data = json.loads(decoded)
                if 'exp' in data:
                    exp_time = datetime.fromtimestamp(data['exp'])
                    return exp_time.isoformat()
        except Exception:
            pass
        return None

    def _get_token_remaining_seconds(self, token: str) -> float:
        """Get seconds remaining until token expires."""
        try:
            parts = token.split('.')
            if len(parts) >= 2:
                payload = parts[1]
                payload += '=' * (4 - len(payload) % 4)
                decoded = base64.b64decode(payload)
                data = json.loads(decoded)
                if 'exp' in data:
                    exp_time = datetime.fromtimestamp(data['exp'])
                    return (exp_time - datetime.now()).total_seconds()
        except Exception as e:
            logger.error(f"Failed to parse token expiry: {e}")
        return -1

    def _get_service_auth_status(self, service: str) -> dict:
        """Get auth status for a single service."""
        try:
            tm = get_token_manager()
            token_data = tm.load_session(service)

            if token_data:
                token = token_data.get('access_token')
                if token:
                    if self._is_token_expired(token):
                        return {
                            "authenticated": False,
                            "token_expired": True,
                            "expires_at": None,
                            "display_name": get_service_display_name(service),
                        }
                    return {
                        "authenticated": True,
                        "expires_at": self._get_token_expiry(token),
                        "display_name": get_service_display_name(service),
                    }
        except Exception as e:
            logger.error(f"Failed to check auth status for {service}: {e}")

        return {
            "authenticated": False,
            "expires_at": None,
            "display_name": get_service_display_name(service),
        }

    async def get_status(self, service: Optional[str] = None):
        """
        Check authentication status.

        Args:
            service: If provided, return status for that service only.
                     If None, return status for all services.
        """
        logger.debug("Checking authentication status", service=service)

        if is_test_mode():
            from backend.fixtures.test_data import TEST_AUTH_CONFIG
            if service:
                return {
                    "authenticated": True,
                    "expires_at": None,
                    "display_name": get_service_display_name(service),
                }
            return {
                "services": {
                    s: {"authenticated": True, "expires_at": None, "display_name": get_service_display_name(s)}
                    for s in get_all_services()
                }
            }

        if service:
            validate_service(service)
            return self._get_service_auth_status(service)

        # Return status for all services
        return {
            "services": {
                s: self._get_service_auth_status(s)
                for s in get_all_services()
            }
        }

    async def login_with_browser(self, service: str):
        """Launch browser for OAuth login for a specific service."""
        validate_service(service)
        group = self._get_group(service)

        try:
            logger.info(f"Starting browser login for {service}, session dir: {self._session_dir}")

            creds = await BrowserAuth.login(
                group=group,
                headless=False,
                user_data_dir=str(self._session_dir),
                channel="chrome"
            )

            if creds:
                self._save_credentials(service, creds)
                logger.info(f"Login successful for {service}, credentials saved")
                return True

        except Exception as e:
            logger.error(f"Login error for {service}: {e}")
            return False

        return False

    def _save_credentials(self, service: str, creds: dict):
        """Save credentials to pyhako's TokenManager."""
        try:
            tm = get_token_manager()
            tm.save_session(
                service,
                creds.get('access_token'),
                creds.get('refresh_token'),
                creds.get('cookies')
            )
            logger.info(f"Credentials saved for {service}")
        except Exception as e:
            logger.error(f"Failed to save credentials for {service}: {e}")
            raise

    def logout(self, service: str):
        """Clear credentials for a specific service."""
        validate_service(service)
        try:
            tm = get_token_manager()
            tm.delete_session(service)
            logger.info(f"Credentials cleared for {service}")
        except Exception as e:
            logger.error(f"Failed to clear credentials for {service}: {e}")

    async def refresh_if_needed(self, service: str, threshold_minutes: int = 10) -> dict:
        """
        Check token expiry and refresh if within threshold for a specific service.
        """
        validate_service(service)
        group = self._get_group(service)

        logger.debug(f"refresh_if_needed for {service}, threshold={threshold_minutes}m")

        if is_test_mode():
            return {"refreshed": False, "remaining_seconds": 3600, "status": "test_mode"}

        try:
            tm = get_token_manager()
            token_data = tm.load_session(service)

            if not token_data or not token_data.get('access_token'):
                logger.warning(f"No token found for {service}")
                return {"refreshed": False, "remaining_seconds": 0, "status": "no_token"}

            token = token_data['access_token']
            remaining_seconds = self._get_token_remaining_seconds(token)
            threshold_seconds = threshold_minutes * 60

            if remaining_seconds > threshold_seconds:
                return {
                    "refreshed": False,
                    "remaining_seconds": remaining_seconds,
                    "status": "valid"
                }

            logger.info(f"Token for {service} expires in {remaining_seconds:.0f}s, refreshing...")

            client = Client(
                group=group,
                access_token=token,
                cookies=token_data.get('cookies'),
                auth_dir=self._session_dir
            )

            async with aiohttp.ClientSession() as session:
                refresh_success = await client.refresh_access_token(session)

                if refresh_success:
                    tm.save_session(
                        service,
                        client.access_token,
                        None,
                        client.cookies
                    )
                    new_remaining = self._get_token_remaining_seconds(client.access_token)
                    logger.info(f"Token refreshed for {service}, new expiry in {new_remaining:.0f}s")
                    return {
                        "refreshed": True,
                        "remaining_seconds": new_remaining,
                        "status": "refreshed"
                    }
                else:
                    return {
                        "refreshed": False,
                        "remaining_seconds": remaining_seconds,
                        "status": "refresh_failed"
                    }

        except Exception as e:
            logger.error(f"refresh_if_needed error for {service}: {e}", exc_info=True)
            return {"refreshed": False, "remaining_seconds": 0, "status": f"error: {e}"}

    def get_config(self, service: str) -> dict:
        """Get the current config for a service (for sync service)."""
        validate_service(service)

        if is_test_mode():
            from backend.fixtures.test_data import TEST_AUTH_CONFIG
            return TEST_AUTH_CONFIG

        try:
            tm = get_token_manager()
            token_data = tm.load_session(service)
            return token_data or {}
        except Exception as e:
            logger.error(f"Failed to load config for {service}: {e}")
            return {}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_auth_service.py -v`
Expected: PASS

**Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk && git add backend/services/auth_service.py backend/tests/test_auth_service.py && git commit -m "feat: refactor AuthService to support multiple services"
```

---

### Task 1.3: Update Auth API Endpoints

**Files:**
- Modify: `backend/api/auth.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_auth_api.py
import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_get_status_returns_all_services():
    """GET /api/auth/status returns status for all services."""
    response = client.get("/api/auth/status")
    assert response.status_code == 200
    data = response.json()
    assert "services" in data
    assert "hinatazaka46" in data["services"]
    assert "nogizaka46" in data["services"]
    assert "sakurazaka46" in data["services"]


def test_login_requires_service_param():
    """POST /api/auth/login without service param returns 422."""
    response = client.post("/api/auth/login")
    assert response.status_code == 422


def test_refresh_requires_service_param():
    """POST /api/auth/refresh-if-needed without service param returns 422."""
    response = client.post("/api/auth/refresh-if-needed")
    assert response.status_code == 422
```

**Step 2: Run test to verify it fails**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_auth_api.py -v`
Expected: FAIL

**Step 3: Update auth API**

```python
# backend/api/auth.py
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, Dict, Any
from backend.services.auth_service import AuthService
from backend.services.service_utils import validate_service, get_all_services

router = APIRouter()
auth_service = AuthService()


class ServiceAuthStatus(BaseModel):
    authenticated: bool
    expires_at: Optional[str] = None
    display_name: str
    token_expired: Optional[bool] = None


class AllServicesStatus(BaseModel):
    services: Dict[str, ServiceAuthStatus]


class RefreshResult(BaseModel):
    refreshed: bool
    remaining_seconds: float
    status: str


@router.get("/status", response_model=AllServicesStatus)
async def get_status():
    """Get authentication status for all services."""
    return await auth_service.get_status()


@router.post("/login")
async def login(service: str = Query(..., description="Service to login to")):
    """Login to a specific service via browser OAuth."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    success = await auth_service.login_with_browser(service)
    if not success:
        raise HTTPException(status_code=401, detail="Login failed")
    return {"status": "ok", "service": service}


@router.post("/logout")
async def logout(service: str = Query(..., description="Service to logout from")):
    """Logout from a specific service."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    auth_service.logout(service)
    return {"status": "ok", "service": service}


@router.post("/refresh-if-needed", response_model=RefreshResult)
async def refresh_if_needed(service: str = Query(..., description="Service to refresh")):
    """Proactively refresh token if it's close to expiring for a specific service."""
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    result = await auth_service.refresh_if_needed(service, threshold_minutes=10)
    return result
```

**Step 4: Run test to verify it passes**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_auth_api.py -v`
Expected: PASS

**Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk && git add backend/api/auth.py backend/tests/test_auth_api.py && git commit -m "feat: update auth API endpoints for multi-service support"
```

---

### Task 1.4: Update Settings Structure (Global vs Per-Service)

**Files:**
- Modify: `backend/api/settings.py`
- Test: `backend/tests/test_settings.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_settings.py
import pytest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch


def test_settings_has_global_and_services_structure():
    """Settings should have global and services sections."""
    from backend.api.settings import load_config, save_config

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        settings_path = Path(f.name)

    with patch('backend.api.settings.SETTINGS_FILE', settings_path):
        # Save new structure
        save_config({
            "global": {
                "theme": "dark",
                "notifications_enabled": True,
            },
            "services": {
                "hinatazaka46": {
                    "sync_enabled": True,
                    "blogs_full_backup": False,
                }
            },
            "is_configured": True,
            "output_dir": "/tmp/output",
        })

        config = load_config()
        assert "global" in config or "is_configured" in config  # Backward compat

    settings_path.unlink()
```

**Step 2: Run test to verify behavior**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_settings.py::test_settings_has_global_and_services_structure -v`

**Step 3: Update settings API with new structure**

Update `backend/api/settings.py` to add service-specific settings:

```python
# Add to backend/api/settings.py after existing imports
from backend.services.service_utils import get_all_services

# Add new models
class ServiceSettings(BaseModel):
    sync_enabled: bool = True
    adaptive_sync_enabled: bool = True
    last_sync: Optional[str] = None
    blogs_full_backup: bool = False


class GlobalSettings(BaseModel):
    theme: str = "system"
    language: str = "en"
    notifications_enabled: bool = True
    update_channel: str = "stable"


# Add new endpoint
@router.get("/service/{service}")
async def get_service_settings(service: str):
    """Get settings for a specific service."""
    from backend.services.service_utils import validate_service
    validate_service(service)

    config = load_config()
    services = config.get("services", {})
    service_config = services.get(service, {})

    return ServiceSettings(
        sync_enabled=service_config.get("sync_enabled", True),
        adaptive_sync_enabled=service_config.get("adaptive_sync_enabled", True),
        last_sync=service_config.get("last_sync"),
        blogs_full_backup=service_config.get("blogs_full_backup", False),
    )


@router.post("/service/{service}")
async def update_service_settings(service: str, update: ServiceSettings):
    """Update settings for a specific service."""
    from backend.services.service_utils import validate_service
    validate_service(service)

    config = load_config()
    if "services" not in config:
        config["services"] = {}

    config["services"][service] = {
        "sync_enabled": update.sync_enabled,
        "adaptive_sync_enabled": update.adaptive_sync_enabled,
        "last_sync": update.last_sync,
        "blogs_full_backup": update.blogs_full_backup,
    }

    save_config(config)
    return update
```

**Step 4: Run test to verify it passes**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_settings.py -v`
Expected: PASS

**Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk && git add backend/api/settings.py backend/tests/test_settings.py && git commit -m "feat: add per-service settings structure"
```

---

### Task 1.5: Refactor SyncService to Support Multiple Services

**Files:**
- Modify: `backend/services/sync_service.py`
- Modify: `backend/api/sync.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_sync_service.py
import pytest
from backend.services.sync_service import SyncService


def test_sync_service_accepts_service_param():
    """SyncService should accept a service parameter."""
    service = SyncService(service="hinatazaka46")
    assert service._service == "hinatazaka46"


def test_sync_service_invalid_service_raises():
    """SyncService with invalid service should raise."""
    with pytest.raises(ValueError):
        SyncService(service="invalid")
```

**Step 2: Run test to verify it fails**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_sync_service.py -v`
Expected: FAIL (SyncService doesn't accept service param)

**Step 3: Refactor SyncService**

Key changes to `backend/services/sync_service.py`:
- Add `service` parameter to `__init__`
- Replace hardcoded `self._group = Group.HINATAZAKA46` with dynamic group
- Update all `self._group.value` to `self._service`
- Update `HinatazakaClient(...)` to `Client(group=self._get_group(), ...)`

```python
# backend/services/sync_service.py - Key changes (partial, showing structure)

from backend.services.service_utils import get_service_enum, validate_service

class SyncService:
    def __init__(self, service: str = "hinatazaka46"):
        validate_service(service)
        self._service = service
        self.output_dir = Path("output")
        self.config_dir = Path(".")
        self.running = False
        self.manager = None

    def _get_group(self) -> Group:
        return get_service_enum(self._service)

    async def load_config(self):
        """Load config from pyhako's TokenManager."""
        if is_test_mode():
            from backend.fixtures.test_data import TEST_AUTH_CONFIG
            return TEST_AUTH_CONFIG

        try:
            tm = get_token_manager()
            token_data = tm.load_session(self._service)  # Use service, not group.value
            if token_data:
                return token_data
        except Exception as e:
            logger.error(f"Config load error: {e}")
        return {}

    # ... rest of methods updated to use self._service and self._get_group()
```

**Step 4: Update sync API to accept service param**

```python
# backend/api/sync.py
from fastapi import Query
from backend.services.service_utils import validate_service, get_all_services

# Create sync services per-service (lazy initialization)
_sync_services: dict[str, SyncService] = {}

def get_sync_service(service: str) -> SyncService:
    if service not in _sync_services:
        _sync_services[service] = SyncService(service=service)
    return _sync_services[service]


@router.post("/start")
async def start_sync(
    service: str = Query(None, description="Service to sync (omit for all authenticated)"),
    include_inactive: bool = False,
    force_resync: bool = False
):
    if service:
        validate_service(service)
        sync_service = get_sync_service(service)
        if sync_service.running:
            raise HTTPException(status_code=400, detail=f"Sync already running for {service}")
        # Start sync for specific service
        asyncio.create_task(run_sync_task(service, include_inactive, force_resync))
        return {"status": "started", "service": service}
    else:
        # Start sync for all authenticated services
        # TODO: Implement multi-service sync orchestration
        raise HTTPException(status_code=501, detail="Multi-service sync not yet implemented")


@router.get("/progress")
async def get_progress(service: str = Query(None)):
    """Get current sync progress."""
    if service:
        validate_service(service)
        # Return progress for specific service
        return progress.get_status()  # TODO: Per-service progress
    else:
        # Return progress for all services
        return {"services": {s: progress.get_status() for s in get_all_services()}}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_sync_service.py -v`
Expected: PASS

**Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk && git add backend/services/sync_service.py backend/api/sync.py backend/tests/test_sync_service.py && git commit -m "feat: refactor SyncService and API for multi-service support"
```

---

## Phase 2: Content API Migration

### Task 2.1: Add Path Resolver Utility

**Files:**
- Create: `backend/services/path_resolver.py`
- Test: `backend/tests/test_path_resolver.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_path_resolver.py
import pytest
from pathlib import Path
from unittest.mock import patch
from backend.services.path_resolver import (
    resolve_service_path,
    find_folder_by_id,
    resolve_talk_room_path,
    resolve_member_path,
)


def test_resolve_service_path():
    """resolve_service_path returns path with display name."""
    with patch('backend.services.path_resolver.get_output_dir', return_value=Path("/output")):
        path = resolve_service_path("hinatazaka46")
        assert path == Path("/output/日向坂46")


def test_find_folder_by_id(tmp_path):
    """find_folder_by_id finds folder starting with ID."""
    (tmp_path / "40 松田 好花").mkdir()
    (tmp_path / "78 日向坂46 四期生ライブ").mkdir()

    result = find_folder_by_id(tmp_path, 40)
    assert result.name == "40 松田 好花"

    result = find_folder_by_id(tmp_path, 78)
    assert result.name == "78 日向坂46 四期生ライブ"


def test_find_folder_by_id_not_found(tmp_path):
    """find_folder_by_id raises if not found."""
    (tmp_path / "40 松田 好花").mkdir()

    with pytest.raises(FileNotFoundError):
        find_folder_by_id(tmp_path, 999)
```

**Step 2: Run test to verify it fails**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_path_resolver.py -v`
Expected: FAIL

**Step 3: Write implementation**

```python
# backend/services/path_resolver.py
"""
Path resolver for multi-service content API.
Converts API parameters to disk paths, decoupling API from disk structure.
"""
from pathlib import Path
from typing import Optional
import re

from backend.services.service_utils import get_service_display_name, validate_service


def get_output_dir() -> Path:
    """Get configured output directory."""
    from backend.services.platform import get_settings_path
    import json

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
    return Path("output")


def resolve_service_path(service: str) -> Path:
    """Get base path for a service's content."""
    validate_service(service)
    display_name = get_service_display_name(service)
    return get_output_dir() / display_name


def find_folder_by_id(base_path: Path, folder_id: int) -> Path:
    """
    Find a folder that starts with the given ID.
    Folder names are in format "{id} {name}", e.g., "40 松田 好花".
    """
    if not base_path.exists():
        raise FileNotFoundError(f"Base path does not exist: {base_path}")

    pattern = re.compile(rf"^{folder_id}\s+.+$")

    for item in base_path.iterdir():
        if item.is_dir() and pattern.match(item.name):
            return item

    raise FileNotFoundError(f"No folder found with ID {folder_id} in {base_path}")


def resolve_talk_room_path(service: str, talk_room_id: int) -> Path:
    """Resolve path to a talk room directory."""
    service_path = resolve_service_path(service)
    messages_path = service_path / "messages"
    return find_folder_by_id(messages_path, talk_room_id)


def resolve_member_path(service: str, talk_room_id: int, member_id: int) -> Path:
    """Resolve path to a member directory within a talk room."""
    talk_room_path = resolve_talk_room_path(service, talk_room_id)
    return find_folder_by_id(talk_room_path, member_id)


def resolve_messages_file(service: str, talk_room_id: int, member_id: int) -> Path:
    """Resolve path to messages.json file."""
    member_path = resolve_member_path(service, talk_room_id, member_id)
    return member_path / "messages.json"


def resolve_media_path(
    service: str,
    talk_room_id: int,
    member_id: int,
    media_type: str,
    filename: str
) -> Path:
    """Resolve path to a media file."""
    member_path = resolve_member_path(service, talk_room_id, member_id)
    return member_path / media_type / filename
```

**Step 4: Run test to verify it passes**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_path_resolver.py -v`
Expected: PASS

**Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk && git add backend/services/path_resolver.py backend/tests/test_path_resolver.py && git commit -m "feat: add path resolver for param-based content API"
```

---

### Task 2.2: Add Param-Based Content Endpoints

**Files:**
- Modify: `backend/api/content.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_content_api.py
import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_get_talk_rooms_requires_service():
    """GET /api/content/talk_rooms requires service param."""
    response = client.get("/api/content/talk_rooms")
    assert response.status_code == 422


def test_get_messages_param_based():
    """GET /api/content/messages with params works."""
    # This will 404 if no data, but should not 422
    response = client.get("/api/content/messages?service=hinatazaka46&talk_room_id=40&member_id=64")
    assert response.status_code in [200, 404]  # 404 is ok if no data
```

**Step 2: Run test to verify it fails**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_content_api.py -v`
Expected: FAIL (endpoints don't exist)

**Step 3: Add new param-based endpoints to content.py**

```python
# Add to backend/api/content.py

from backend.services.path_resolver import (
    resolve_service_path,
    resolve_talk_room_path,
    resolve_member_path,
    resolve_messages_file,
    resolve_media_path,
    find_folder_by_id,
)
from backend.services.service_utils import validate_service


@router.get("/talk_rooms")
async def get_talk_rooms(service: str = Query(..., description="Service identifier")):
    """
    List all talk rooms for a service (param-based).

    Returns talk rooms with their IDs, names, and member counts.
    """
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

        # Count members in this talk room
        member_dirs = [d for d in talk_room_dir.iterdir() if d.is_dir() and (d / "messages.json").exists()]
        member_count = len(member_dirs)

        # Determine type
        room_type = "group_event" if member_count > 1 or talk_room_id in GROUP_CHAT_IDS else "individual"

        talk_rooms.append({
            "id": int(talk_room_id),
            "name": talk_room_name,
            "type": room_type,
            "member_count": member_count,
        })

    talk_rooms.sort(key=lambda r: r["id"])
    return {"service": service, "talk_rooms": talk_rooms}


@router.get("/members")
async def get_members(
    service: str = Query(...),
    talk_room_id: int = Query(...)
):
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
            with open(msg_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                m_data = data.get('member', {})
                member_info['thumbnail'] = m_data.get('thumbnail')
                member_info['portrait'] = m_data.get('portrait')
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
    last_read_id: int = 0
):
    """
    Get messages for a member (param-based).

    This is the new preferred endpoint. Path-based /messages_by_path is deprecated.
    """
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
        with open(msg_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            messages = data.get('messages', [])
            messages.sort(key=lambda x: x.get('timestamp', ''))

            total = len(messages)
            unread_count = 0
            max_message_id = 0

            for m in messages:
                msg_id = m.get('id', 0)
                if msg_id > max_message_id:
                    max_message_id = msg_id
                if last_read_id > 0 and msg_id > last_read_id:
                    unread_count += 1

            if last_read_id == 0:
                unread_count = total

            if limit > 0:
                messages = messages[-limit:]

            data['messages'] = messages
            data['total_count'] = total
            data['unread_count'] = unread_count
            data['max_message_id'] = max_message_id
            return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/talk_room_messages")
async def get_talk_room_messages_param(
    service: str = Query(...),
    talk_room_id: int = Query(...),
    limit: int = 200,
    last_read_id: int = 0
):
    """Get merged messages from all members in a talk room (param-based)."""
    try:
        validate_service(service)
        talk_room_path = resolve_talk_room_path(service, talk_room_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Reuse existing group_messages logic
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
            with open(msg_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                member_info = data.get('member', {})
                members_map[member_id] = {
                    "id": member_id,
                    "name": member_name,
                    "thumbnail": member_info.get('thumbnail'),
                }

                for msg in data.get('messages', []):
                    msg['member_id'] = member_id
                    msg['member_name'] = member_name
                    all_messages.append(msg)
        except Exception as e:
            logger.warning(f"Failed to load messages: {e}")

    all_messages.sort(key=lambda m: m.get('timestamp', ''))
    total = len(all_messages)

    unread_count = sum(1 for m in all_messages if m.get('id', 0) > last_read_id) if last_read_id else total
    max_message_id = max((m.get('id', 0) for m in all_messages), default=0)

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


@router.get("/media")
async def get_media_param(
    service: str = Query(...),
    talk_room_id: int = Query(...),
    member_id: int = Query(...),
    type: str = Query(..., description="Media type: picture, video, voice"),
    file: str = Query(..., description="Filename")
):
    """Serve media files (param-based)."""
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
```

**Step 4: Run test to verify it passes**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_content_api.py -v`
Expected: PASS

**Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk && git add backend/api/content.py backend/tests/test_content_api.py && git commit -m "feat: add param-based content API endpoints"
```

---

## Phase 3: Blogs Feature

### Task 3.1: Create Blog Service

**Files:**
- Create: `backend/services/blog_service.py`
- Test: `backend/tests/test_blog_service.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_blog_service.py
import pytest
from backend.services.blog_service import BlogService


@pytest.fixture
def blog_service():
    return BlogService()


def test_get_blog_index_path(blog_service):
    """get_blog_index_path returns correct path."""
    path = blog_service.get_blog_index_path("hinatazaka46")
    assert path.name == "index.json"
    assert "blogs" in str(path)
```

**Step 2: Run test to verify it fails**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_blog_service.py -v`
Expected: FAIL

**Step 3: Write implementation**

```python
# backend/services/blog_service.py
"""
Blog service for HakoDesk.
Handles blog metadata sync, on-demand content fetching, and caching.
"""
import json
import aiohttp
import aiofiles
import structlog
from pathlib import Path
from typing import Optional, AsyncIterator
from datetime import datetime

from pyhako.blog import get_scraper, BlogEntry
from pyhako import Group

from backend.services.service_utils import get_service_enum, get_service_display_name, validate_service
from backend.services.path_resolver import get_output_dir

logger = structlog.get_logger(__name__)


class BlogService:
    def __init__(self):
        pass

    def get_blogs_base_path(self, service: str) -> Path:
        """Get base path for blogs storage."""
        validate_service(service)
        display_name = get_service_display_name(service)
        return get_output_dir() / display_name / "blogs"

    def get_blog_index_path(self, service: str) -> Path:
        """Get path to blog index file."""
        return self.get_blogs_base_path(service) / "index.json"

    def get_blog_cache_path(self, service: str, member_name: str, blog_id: str, date: str) -> Path:
        """Get path to cached blog content."""
        base = self.get_blogs_base_path(service)
        folder_name = f"{date}_{blog_id}"
        return base / member_name / folder_name

    async def load_blog_index(self, service: str) -> dict:
        """Load blog index from disk."""
        index_path = self.get_blog_index_path(service)
        if index_path.exists():
            try:
                async with aiofiles.open(index_path, 'r', encoding='utf-8') as f:
                    return json.loads(await f.read())
            except Exception as e:
                logger.error(f"Failed to load blog index: {e}")
        return {"members": {}, "last_sync": None}

    async def save_blog_index(self, service: str, index: dict):
        """Save blog index to disk."""
        index_path = self.get_blog_index_path(service)
        index_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(index_path, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(index, ensure_ascii=False, indent=2))

    async def get_blog_members(self, service: str) -> dict[str, str]:
        """Get members who have blogs for a service."""
        validate_service(service)
        group = get_service_enum(service)

        async with aiohttp.ClientSession() as session:
            scraper = get_scraper(group, session)
            return await scraper.get_members()

    async def sync_blog_metadata(self, service: str, progress_callback=None):
        """
        Sync blog metadata (titles, dates, URLs) for all members.
        This is lightweight - just metadata, not full content.
        """
        validate_service(service)
        group = get_service_enum(service)

        index = await self.load_blog_index(service)

        async with aiohttp.ClientSession() as session:
            scraper = get_scraper(group, session)
            members = await scraper.get_members()

            for member_id, member_name in members.items():
                if progress_callback:
                    await progress_callback(f"Scanning {member_name}")

                if member_id not in index["members"]:
                    index["members"][member_id] = {
                        "name": member_name,
                        "blogs": []
                    }

                existing_ids = {b["id"] for b in index["members"][member_id]["blogs"]}

                async for entry in scraper.get_blogs(member_id):
                    if entry.id not in existing_ids:
                        index["members"][member_id]["blogs"].append({
                            "id": entry.id,
                            "title": entry.title,
                            "published_at": entry.published_at.isoformat(),
                            "url": entry.url,
                            "thumbnail": entry.images[0] if entry.images else None,
                        })

        index["last_sync"] = datetime.utcnow().isoformat() + "Z"
        await self.save_blog_index(service, index)
        return index

    async def get_blog_list(self, service: str, member_id: str) -> dict:
        """Get blog list for a member from index."""
        index = await self.load_blog_index(service)
        member_data = index.get("members", {}).get(member_id, {})

        blogs = member_data.get("blogs", [])

        # Check which blogs are cached
        for blog in blogs:
            date = blog["published_at"][:10].replace("-", "")
            cache_path = self.get_blog_cache_path(service, member_data.get("name", ""), blog["id"], date)
            blog["cached"] = (cache_path / "blog.json").exists()

        return {
            "member_id": member_id,
            "member_name": member_data.get("name", ""),
            "blogs": sorted(blogs, key=lambda b: b["published_at"], reverse=True)
        }

    async def get_blog_content(self, service: str, blog_id: str) -> dict:
        """
        Get full blog content. Fetches on-demand if not cached.
        """
        validate_service(service)
        group = get_service_enum(service)

        # Find blog in index to get member info
        index = await self.load_blog_index(service)
        blog_meta = None
        member_name = None

        for member_id, member_data in index.get("members", {}).items():
            for blog in member_data.get("blogs", []):
                if blog["id"] == blog_id:
                    blog_meta = blog
                    member_name = member_data.get("name", "")
                    break
            if blog_meta:
                break

        if not blog_meta:
            raise ValueError(f"Blog {blog_id} not found in index")

        # Check cache
        date = blog_meta["published_at"][:10].replace("-", "")
        cache_path = self.get_blog_cache_path(service, member_name, blog_id, date)
        cache_file = cache_path / "blog.json"

        if cache_file.exists():
            async with aiofiles.open(cache_file, 'r', encoding='utf-8') as f:
                return json.loads(await f.read())

        # Fetch on-demand
        async with aiohttp.ClientSession() as session:
            scraper = get_scraper(group, session)
            entry = await scraper.get_blog_detail(blog_id)

            # Save to cache
            cache_path.mkdir(parents=True, exist_ok=True)

            content = {
                "meta": {
                    "id": entry.id,
                    "member_name": member_name,
                    "title": entry.title,
                    "published_at": entry.published_at.isoformat(),
                    "url": entry.url,
                },
                "content": {
                    "html": entry.content,
                },
                "images": [{"original_url": img, "local_path": None} for img in entry.images]
            }

            async with aiofiles.open(cache_file, 'w', encoding='utf-8') as f:
                await f.write(json.dumps(content, ensure_ascii=False, indent=2))

            return content

    async def get_cache_size(self, service: str) -> int:
        """Get total cache size in bytes for a service."""
        base_path = self.get_blogs_base_path(service)
        if not base_path.exists():
            return 0

        total = 0
        for file in base_path.rglob("*"):
            if file.is_file():
                total += file.stat().st_size
        return total

    async def clear_cache(self, service: str):
        """Clear all cached blog content for a service."""
        import shutil
        base_path = self.get_blogs_base_path(service)

        # Keep index.json, delete everything else
        index_path = self.get_blog_index_path(service)
        index_backup = None

        if index_path.exists():
            async with aiofiles.open(index_path, 'r', encoding='utf-8') as f:
                index_backup = await f.read()

        if base_path.exists():
            shutil.rmtree(base_path)

        # Restore index
        if index_backup:
            base_path.mkdir(parents=True, exist_ok=True)
            async with aiofiles.open(index_path, 'w', encoding='utf-8') as f:
                await f.write(index_backup)
```

**Step 4: Run test to verify it passes**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_blog_service.py -v`
Expected: PASS

**Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk && git add backend/services/blog_service.py backend/tests/test_blog_service.py && git commit -m "feat: add BlogService for metadata sync and on-demand fetching"
```

---

### Task 3.2: Create Blog API Endpoints

**Files:**
- Create: `backend/api/blogs.py`
- Modify: `backend/main.py` (add router)

**Step 1: Write the failing test**

```python
# backend/tests/test_blogs_api.py
import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_blogs_members_requires_service():
    response = client.get("/api/blogs/members")
    assert response.status_code == 422


def test_blogs_list_requires_params():
    response = client.get("/api/blogs/list")
    assert response.status_code == 422


def test_blogs_cache_size_endpoint():
    response = client.get("/api/blogs/cache-size?service=hinatazaka46")
    assert response.status_code == 200
    assert "size_bytes" in response.json()
```

**Step 2: Run test to verify it fails**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_blogs_api.py -v`
Expected: FAIL

**Step 3: Write implementation**

```python
# backend/api/blogs.py
"""
Blogs API for HakoDesk.
Provides endpoints for blog browsing, content fetching, and cache management.
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional

from backend.services.blog_service import BlogService
from backend.services.service_utils import validate_service

router = APIRouter()
blog_service = BlogService()


class BlogMeta(BaseModel):
    id: str
    title: str
    published_at: str
    url: str
    thumbnail: Optional[str] = None
    cached: bool = False


class BlogListResponse(BaseModel):
    member_id: str
    member_name: str
    blogs: List[BlogMeta]


class BlogContentResponse(BaseModel):
    meta: dict
    content: dict
    images: List[dict]


class CacheSizeResponse(BaseModel):
    service: str
    size_bytes: int
    size_mb: float


@router.get("/members")
async def get_blog_members(service: str = Query(...)):
    """Get members who have blogs for a service."""
    try:
        validate_service(service)
        members = await blog_service.get_blog_members(service)
        return {"service": service, "members": [{"id": k, "name": v} for k, v in members.items()]}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list", response_model=BlogListResponse)
async def get_blog_list(
    service: str = Query(...),
    member_id: str = Query(...)
):
    """Get blog list for a member."""
    try:
        validate_service(service)
        return await blog_service.get_blog_list(service, member_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/content", response_model=BlogContentResponse)
async def get_blog_content(
    service: str = Query(...),
    blog_id: str = Query(...)
):
    """Get full blog content (fetches on-demand if not cached)."""
    try:
        validate_service(service)
        return await blog_service.get_blog_content(service, blog_id)
    except ValueError as e:
        raise HTTPException(status_code=400 if "Invalid service" in str(e) else 404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cache-size", response_model=CacheSizeResponse)
async def get_cache_size(service: str = Query(...)):
    """Get cache size for a service's blogs."""
    try:
        validate_service(service)
        size_bytes = await blog_service.get_cache_size(service)
        return CacheSizeResponse(
            service=service,
            size_bytes=size_bytes,
            size_mb=round(size_bytes / (1024 * 1024), 2)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/cache")
async def clear_cache(service: str = Query(...)):
    """Clear blog cache for a service."""
    try:
        validate_service(service)
        await blog_service.clear_cache(service)
        return {"status": "ok", "service": service}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

**Step 4: Add router to main.py**

Add to `backend/main.py`:
```python
from backend.api import blogs
app.include_router(blogs.router, prefix="/api/blogs", tags=["blogs"])
```

**Step 5: Run test to verify it passes**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/test_blogs_api.py -v`
Expected: PASS

**Step 6: Commit**

```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk && git add backend/api/blogs.py backend/main.py backend/tests/test_blogs_api.py && git commit -m "feat: add blogs API endpoints"
```

---

### Task 3.3: Integrate Blog Metadata Sync into Sync Process

**Files:**
- Modify: `backend/services/sync_service.py`

**Step 1: Add blog metadata sync to start_sync**

Add after Phase 3 (media download) in `sync_service.py`:

```python
# Add to start_sync method after media download phase

# Phase 4: Blog Metadata Sync (lightweight)
progress.start_phase("blogs", "Syncing Blog Metadata", 4, 0, "")
try:
    from backend.services.blog_service import BlogService
    blog_service = BlogService()

    async def blog_progress(msg):
        progress.set_detail(msg)

    await blog_service.sync_blog_metadata(self._service, progress_callback=blog_progress)
    logger.info(f"Blog metadata synced for {self._service}")
except Exception as e:
    logger.warning(f"Blog metadata sync failed (non-fatal): {e}")
```

**Step 2: Run existing tests to ensure no regression**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/ -v`
Expected: PASS

**Step 3: Commit**

```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk && git add backend/services/sync_service.py && git commit -m "feat: integrate blog metadata sync into sync process"
```

---

## Phase 4: Frontend Updates (Summary)

> **Note:** Frontend tasks are summarized here. Detailed implementation depends on existing frontend patterns.

### Task 4.1: Update App.tsx Auth Flow

- Call `GET /api/auth/status` on mount
- If no services authenticated, show `AddServicePage`
- Store authenticated services in Zustand

### Task 4.2: Create AddServicePage Component

- Show three service cards (Hinatazaka, Nogizaka, Sakurazaka)
- Click card → `POST /api/auth/login?service=xxx` → Browser OAuth
- On success, redirect to main app

### Task 4.3: Update ServiceRail with "+" Button

- Add Plus icon at bottom of service list
- Click → navigate to AddServicePage
- Only show authenticated services in rail

### Task 4.4: Migrate Content API Calls to Param-Based

- Replace `messages_by_path` with `messages?service=&talk_room_id=&member_id=`
- Replace `group_messages/{path}` with `talk_room_messages?service=&talk_room_id=`
- Replace `media/{path}` with `media?service=&talk_room_id=&member_id=&type=&file=`

### Task 4.5: Create BlogsFeature Component

- Blog list view (by member)
- Blog reader view (render HTML content)
- Cache status indicator

---

## Future TODOs

- [ ] Remove deprecated path-based content endpoints after frontend migration
- [ ] Add full backup mode for blogs (download all during sync)
- [ ] Add per-service progress tracking (currently global)
- [ ] Add concurrent multi-service sync support

---

## Test Commands Summary

```bash
# Run all backend tests
cd /home/xtorker/repos/Project-PyHako/HakoDesk && python -m pytest backend/tests/ -v

# Run specific test file
python -m pytest backend/tests/test_auth_service.py -v

# Run with coverage
python -m pytest backend/tests/ --cov=backend --cov-report=html
```
