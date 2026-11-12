"""The autouse Memories stubs must track the real signatures."""

import pytest

from backend.services import sync_service


@pytest.mark.asyncio
async def test_stubs_are_awaitable_with_real_signature(tmp_path):
    assert await sync_service.refresh_member_profiles("hinatazaka46", tmp_path) is False
    assert await sync_service.build_memory_index(tmp_path) == 0


def test_stubs_reject_signature_drift(tmp_path):
    with pytest.raises(TypeError):
        sync_service.build_memory_index(tmp_path, "unexpected")
    with pytest.raises(TypeError):
        sync_service.refresh_member_profiles("s", tmp_path, bogus=True)
