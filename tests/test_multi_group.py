"""
Tests for multi-group functionality.

NOTE: Multi-group support is PLANNED but NOT YET IMPLEMENTED.
These tests are skipped until the multi-group architecture is added.
Currently, ZakaDesk only supports Hinatazaka46 (hardcoded in sync_service.py).

When implementing multi-group support:
1. AuthService should use TokenManager per-group
2. SyncService should iterate over authenticated groups
3. These tests should be updated and enabled
"""

import pytest


MULTI_GROUP_NOT_IMPLEMENTED = "Multi-group support not yet implemented - see TODO.md"


@pytest.mark.skip(reason=MULTI_GROUP_NOT_IMPLEMENTED)
@pytest.mark.asyncio
async def test_auth_service_multi_group_status():
    """Verify AuthService returns status for all 3 groups.

    BLOCKED: Current AuthService only supports single-group (Hinatazaka46).
    This test requires implementing per-group authentication tracking.
    """
    pass


@pytest.mark.skip(reason=MULTI_GROUP_NOT_IMPLEMENTED)
@pytest.mark.asyncio
async def test_auth_service_login_saves_session():
    """Verify login saves session to TokenManager with correct group.

    BLOCKED: Current login_with_browser() is hardcoded to Hinatazaka46.
    This test requires adding group parameter to login flow.
    """
    pass


@pytest.mark.skip(reason=MULTI_GROUP_NOT_IMPLEMENTED)
@pytest.mark.asyncio
async def test_sync_service_skips_unauthenticated_groups():
    """Verify SyncService only attempts to sync authenticated groups.

    BLOCKED: Current SyncService uses HinatazakaClient (single group).
    This test requires implementing multi-group sync loop.
    """
    pass
